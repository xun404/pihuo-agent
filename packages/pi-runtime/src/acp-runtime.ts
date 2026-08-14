import { resolve as resolvePath } from 'node:path'
import {
  AcpSessionCatalog,
  applySecretsToEnv,
  computeAcpExecutionFingerprint,
  getSharedStore,
  acquireOwnerLease,
  resolveRouterDataPaths,
  type OwnerLeaseHandle,
  type OwnerLeaseDeps,
} from '@pihuo-agent/core'
import {
  cleanupRemoteAcpSession,
  getAcpSessionManager,
  resetAcpSessionManager,
  type AcpSessionManager,
  type AcpSessionCatalogRecord,
  type AcpFingerprintFn,
} from '@pihuo-agent/adapters'
import type { WorkerRegistration } from '@pihuo-agent/shared'
import {
  createLocalRuntimeDispatchPort,
  setRuntimeDispatchPort,
  resetRuntimeDispatchPortForTests,
} from './runtime-dispatch-port.js'
import { assertTeamMemberModelAccepted } from './team-members.js'
import { getTeamTemplateService } from './team-template-service.js'
import { createRemoteRuntimeDispatchPort } from './remote-runtime-dispatch-port.js'
import { getWorkerScheduler } from './scheduler.js'
import { getWorkerEventEmitter } from './worker-events.js'

interface WorkerStorePort {
  listWorkers(): WorkerRegistration[]
}

export type AcpRuntimeMode = 'owner' | 'remote-client'

/**
 * Explicit process role for single-writer runtime composition.
 * - owner: must acquire lease and host Scheduler/SessionManager/catalog
 * - client-only: never grab lease; use RemoteRuntimeDispatchPort only
 * - auto: try lease (default for tests / legacy)
 */
export type RuntimeRole = 'owner' | 'client-only' | 'auto'

export interface AcpRuntimeOptions {
  catalogPath?: string
  applySecrets?: boolean
  registerProcessHandlers?: boolean
  remoteCleanupTimeoutMs?: number
  store?: WorkerStorePort
  /** Injected lease deps for tests */
  leaseDeps?: OwnerLeaseDeps
  /** Default true. When false, skip lease (test isolation only). */
  acquireLease?: boolean
  /**
   * Process role. Non-owner processes must use `client-only` so they never steal
   * the owner lease. Main http-server uses `owner`.
   */
  role?: RuntimeRole
  heartbeatIntervalMs?: number
}

export interface AcpRuntime {
  mode: AcpRuntimeMode
  manager: AcpSessionManager | null
  catalog: AcpSessionCatalog | null
  catalogPath: string
  lease: OwnerLeaseHandle | null
  close(): Promise<void>
}

interface RuntimeState {
  signature: string
  store: WorkerStorePort
  runtime: AcpRuntime
  signalHandler?: () => void
  heartbeatTimer?: ReturnType<typeof setInterval>
  exitHandler?: () => void
}

let state: RuntimeState | null = null

const MAX_TIMER_DELAY_MS = 2_147_483_647

export function resolveAcpRuntimeTimerMs(value: unknown, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(Math.max(1, Math.floor(parsed)), MAX_TIMER_DELAY_MS)
}

function defaultCatalogPath(): string {
  return resolvePath(resolveRouterDataPaths().catalogPath)
}

function runtimeSignature(options: {
  catalogPath: string
  applySecrets: boolean
  registerProcessHandlers: boolean
  remoteCleanupTimeoutMs: number
  heartbeatIntervalMs: number
  acquireLease: boolean
  role: RuntimeRole
}): string {
  // Role must be part of signature so owner vs client-only never collide as "same" runtime.
  return JSON.stringify(options)
}

function cloneWorker(worker: WorkerRegistration): WorkerRegistration {
  return {
    ...worker,
    args: [...worker.args],
    env: { ...worker.env },
    roles: [...worker.roles],
    capabilities: [...worker.capabilities],
    availableModels: worker.availableModels?.map((option) => ({ ...option })),
  }
}

function createRemoteCleanup(
  store: WorkerStorePort,
  timeoutMs: number,
): (record: AcpSessionCatalogRecord) => Promise<void> | void {
  return (record) => {
    // Capture before the first await so route-level Store mutation cannot change
    // the command/env used to clean up the old execution boundary.
    const registered = store.listWorkers().find((worker) => worker.id === record.workerId)
    if (!registered) return
    const worker = cloneWorker(registered)
    return cleanupRemoteAcpSession(record, {
      command: worker.command,
      args: [...worker.args],
      env: { ...worker.env },
      kind: worker.kind,
      timeoutMs,
    })
  }
}

function enterRemoteClient(
  signature: string,
  store: WorkerStorePort,
  catalogPath: string,
): AcpRuntime {
  const runtime: AcpRuntime = {
    mode: 'remote-client',
    manager: null,
    catalog: null,
    catalogPath,
    lease: null,
    close: async () => {
      setRuntimeDispatchPort(null)
    },
  }
  setRuntimeDispatchPort(createRemoteRuntimeDispatchPort())
  state = { signature, store, runtime }
  return runtime
}

export function initializeAcpRuntime(options: AcpRuntimeOptions = {}): AcpRuntime {
  const role: RuntimeRole = options.role ?? 'auto'
  const resolved = {
    catalogPath: resolvePath(options.catalogPath ?? defaultCatalogPath()),
    applySecrets: options.applySecrets ?? true,
    registerProcessHandlers: options.registerProcessHandlers ?? true,
    remoteCleanupTimeoutMs: resolveAcpRuntimeTimerMs(options.remoteCleanupTimeoutMs, 5_000),
    heartbeatIntervalMs: resolveAcpRuntimeTimerMs(options.heartbeatIntervalMs, 10_000),
    // client-only never acquires; owner/auto respect acquireLease
    acquireLease: role === 'client-only' ? false : (options.acquireLease ?? true),
    role,
  }
  const signature = runtimeSignature({
    catalogPath: resolved.catalogPath,
    applySecrets: resolved.applySecrets,
    registerProcessHandlers: resolved.registerProcessHandlers,
    remoteCleanupTimeoutMs: resolved.remoteCleanupTimeoutMs,
    heartbeatIntervalMs: resolved.heartbeatIntervalMs,
    acquireLease: resolved.acquireLease,
    role: resolved.role,
  })
  if (state) {
    if (state.signature !== signature) {
      throw new Error('ACP runtime is already initialized with incompatible configuration')
    }
    return state.runtime
  }

  if (resolved.applySecrets) applySecretsToEnv(process.env)

  // Studio / client-only: never create writable Store or steal lease.
  if (role === 'client-only') {
    process.env.PIHUO_AGENT_CLIENT_ONLY = '1'
    process.env.PIHUO_AGENT_RUNTIME_ROLE = 'client-only'
    // Optional readOnly store only if caller injects one — default empty stub
    const store = options.store ?? {
      listWorkers: () => [],
    }
    return enterRemoteClient(signature, store, resolved.catalogPath)
  }

  process.env.PIHUO_AGENT_CLIENT_ONLY = '0'
  process.env.PIHUO_AGENT_RUNTIME_ROLE =
    role === 'owner' ? 'owner' : (process.env.PIHUO_AGENT_RUNTIME_ROLE ?? 'auto')

  // Lease-first: never construct a writable Store until we own the catalog.
  let lease: OwnerLeaseHandle | null = null
  if (resolved.acquireLease) {
    const acquired = acquireOwnerLease(resolved.catalogPath, options.leaseDeps)
    if (!acquired.ok) {
      if (role === 'owner') {
        throw new Error(
          'RUNTIME_OWNER_EXISTS: cannot start owner runtime; another process holds the catalog lease',
        )
      }
      // auto → remote-client: stub store only (no owner LocalStore / state.json side effects)
      process.env.PIHUO_AGENT_CLIENT_ONLY = '1'
      process.env.PIHUO_AGENT_RUNTIME_ROLE = 'client-only'
      const stubStore = options.store ?? { listWorkers: () => [] }
      return enterRemoteClient(signature, stubStore, resolved.catalogPath)
    }
    lease = acquired.lease
  }

  // Only after lease (or explicit acquireLease:false for tests): writable shared store
  const store = options.store ?? getSharedStore({ mode: 'owner' })

  const catalog = new AcpSessionCatalog(resolved.catalogPath)
  const fingerprintFn: AcpFingerprintFn = ({
    command,
    args,
    model,
    reasoning,
    explicitEnv,
    ambientEnv,
  }) =>
    computeAcpExecutionFingerprint(
      command,
      [...args],
      model,
      reasoning,
      { ...explicitEnv },
      Object.fromEntries(
        Object.entries(ambientEnv).filter(
          (entry): entry is [string, string] => entry[1] !== undefined,
        ),
      ),
    )
  const remoteCleanup = createRemoteCleanup(store, resolved.remoteCleanupTimeoutMs)
  const manager = getAcpSessionManager({
    catalogPort: catalog,
    catalogRequired: true,
    fingerprintFn,
    remoteCleanup,
  })

  const scheduler = getWorkerScheduler()
  // Fail orphan running/pending_approval jobs left by a previous process before serving,
  // then tick so persisted queued jobs resume admission.
  scheduler.reconcileOrphanJobs()
  void scheduler.tick()

  setRuntimeDispatchPort(
    createLocalRuntimeDispatchPort({
      store: getSharedStore(),
      scheduler,
      events: getWorkerEventEmitter(),
      assertRoleModel: assertTeamMemberModelAccepted,
      applyTeamTemplate: (input) =>
        getTeamTemplateService().apply({
          sessionId: input.context.routerSessionId,
          templateId: input.templateId,
          expectedTeamRevision: input.expectedTeamRevision,
          mappings: input.mappings,
        }),
    }),
  )

  const heartbeatIntervalMs = resolved.heartbeatIntervalMs
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined
  if (lease) {
    heartbeatTimer = setInterval(() => {
      try {
        lease?.heartbeat()
      } catch {
        /* ok */
      }
    }, heartbeatIntervalMs)
    heartbeatTimer.unref?.()
  }

  let closePromise: Promise<void> | null = null
  const runtime: AcpRuntime = {
    mode: 'owner',
    manager,
    catalog,
    catalogPath: resolved.catalogPath,
    lease,
    close: () => {
      if (!closePromise) {
        closePromise = (async () => {
          if (heartbeatTimer) clearInterval(heartbeatTimer)
          // Drain scheduler before tearing down ACP / releasing lease
          try {
            await scheduler.shutdown({ deadlineMs: 8_000 })
          } catch {
            /* best-effort */
          }
          try {
            await manager.closeAll()
          } finally {
            catalog.close()
            lease?.release()
            setRuntimeDispatchPort(null)
          }
        })()
      }
      return closePromise
    },
  }

  const runtimeState: RuntimeState = { signature, store, runtime, heartbeatTimer }
  state = runtimeState
  if (resolved.registerProcessHandlers) {
    const signalHandler = () => {
      void runtime.close()
    }
    runtimeState.signalHandler = signalHandler
    process.on('SIGTERM', signalHandler)
    process.on('SIGINT', signalHandler)
    const exitHandler = () => {
      try {
        lease?.release()
      } catch {
        /* ok */
      }
    }
    runtimeState.exitHandler = exitHandler
    process.on('exit', exitHandler)
  }
  return runtime
}

export function getAcpRuntime(): AcpRuntime {
  if (!state) throw new Error('ACP runtime has not been initialized')
  return state.runtime
}

export async function resetAcpRuntimeForTests(): Promise<void> {
  const current = state
  state = null
  if (current?.signalHandler) {
    process.off('SIGTERM', current.signalHandler)
    process.off('SIGINT', current.signalHandler)
  }
  if (current?.exitHandler) {
    process.off('exit', current.exitHandler)
  }
  if (current?.heartbeatTimer) {
    clearInterval(current.heartbeatTimer)
  }
  if (current) await current.runtime.close()
  resetAcpSessionManager()
  resetRuntimeDispatchPortForTests()
}
