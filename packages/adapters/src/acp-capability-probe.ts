/**
 * Capability probe: initialize → session/new (auth gate) → readiness.
 * Does not mutate command health; outputs WorkerReadiness + capability summary.
 */
import type { WorkerReadiness, WorkerReadinessNextAction } from '@swarmdesk-agent/shared'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { Readable, Writable } from 'node:stream'
import {
  AcpSessionDriver,
  AcpSessionRuntimeError,
  type InitializeDriverOptions,
} from './acp-session-driver.js'
import {
  isAuthRequiredError,
  sanitizeAuthMethods,
  toPublicAuthMethodSummary,
  type SanitizedAuthMethod,
} from './acp-auth.js'
import { ndJsonStream, type Stream } from '@agentclientprotocol/sdk'

export type CapabilityProbeCode =
  | 'ACP_PROTOCOL_INCOMPATIBLE'
  | 'ACP_RUNNER_MISSING'
  | 'ACP_INSTALL_FAILED'
  | 'WORKER_AUTH_REQUIRED'
  | 'WORKER_AUTH_FAILED'
  | 'WORKER_NOT_READY'
  | 'SPAWN_FAILED'
  | 'INITIALIZE_FAILED'
  | 'SESSION_FAILED'
  | 'PROBE_TIMEOUT'
  | 'PROBE_ABORTED'
  | 'PROCESS_EXITED'
  | 'PROCESS_CLEANUP_FAILED'
  | 'SESSION_READY'
  | 'DEGRADED'

export type CapabilityProbeResult = {
  readiness: WorkerReadiness
  authMethods: SanitizedAuthMethod[]
  capabilitySummary: {
    protocolVersion?: number
    authMethods?: Array<{ id: string; name?: string; description?: string; type?: string }>
    sessionLoad?: boolean
    sessionResume?: boolean
    sessionList?: boolean
    authLogout?: boolean
    agentName?: string
    agentVersion?: string
    probedAt: string
  }
  /** Driver left open only when ready and keepDriver=true */
  driver?: AcpSessionDriver
}

export type CapabilityProbeOptions = InitializeDriverOptions & {
  /** When true and probe succeeds, caller owns the driver (must dispose). */
  keepDriver?: boolean
  /**
   * If provided, attempt agent authenticate(methodId) when auth_required,
   * then re-try session/new.
   */
  authenticateMethodId?: string
}

export type SpawnedAcpSetupInput = {
  command: string
  args: readonly string[]
  cwd: string
  env: Readonly<Record<string, string>>
  /** Owner-confirmed PTY implementation readiness. */
  terminalAuthReady: boolean
  authenticateMethodId?: string
  signal?: AbortSignal
  timeoutMs?: number
}

export type SpawnedAcpLogoutCode =
  | 'LOGOUT_SUCCEEDED'
  | 'LOGOUT_UNSUPPORTED'
  | 'LOGOUT_FAILED'
  | 'ACP_PROTOCOL_INCOMPATIBLE'
  | 'ACP_RUNNER_MISSING'
  | 'SPAWN_FAILED'
  | 'PROBE_TIMEOUT'
  | 'PROBE_ABORTED'
  | 'PROCESS_EXITED'
  | 'PROCESS_CLEANUP_FAILED'
  | 'INITIALIZE_FAILED'

export type SpawnedAcpLogoutResult = {
  ok: boolean
  code: SpawnedAcpLogoutCode
  message: string
  authMethods: SanitizedAuthMethod[]
  capabilitySummary: CapabilityProbeResult['capabilitySummary']
}

function nowIso(): string {
  return new Date().toISOString()
}

function boundedPublicText(value: unknown, maxBytes = 128): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined
  if (/[\u0000-\u001f\u007f-\u009f]/u.test(value)) return undefined
  if (Buffer.byteLength(value, 'utf8') > maxBytes) return undefined
  return value
}

function summarizeCapabilities(
  driver: AcpSessionDriver,
  init: NonNullable<AcpSessionDriver['initResponseData']>,
  authMethods: SanitizedAuthMethod[],
  probedAt: string,
): CapabilityProbeResult['capabilitySummary'] {
  const caps = driver.capabilities
  return {
    protocolVersion: init.protocolVersion,
    authMethods: toPublicAuthMethodSummary(authMethods),
    sessionLoad: Boolean(caps.loadSession),
    sessionResume:
      caps.sessionCapabilities?.resume !== undefined && caps.sessionCapabilities?.resume !== null,
    authLogout: driver.hasCapability('logout'),
    agentName: boundedPublicText(init.agentInfo?.name),
    agentVersion: boundedPublicText(init.agentInfo?.version),
    probedAt,
  }
}

function readiness(
  status: WorkerReadiness['status'],
  code: string | undefined,
  message: string,
  nextAction: WorkerReadinessNextAction,
): WorkerReadiness {
  return {
    status,
    code,
    message,
    checkedAt: nowIso(),
    nextAction,
  }
}

/**
 * Probe an already-connected transport (tests / manager reuse).
 * Caller supplies a live Stream paired with a fake or real agent.
 */
export async function probeConnectedAgent(
  cwd: string,
  transportStream: Stream,
  opts: CapabilityProbeOptions = {},
): Promise<CapabilityProbeResult> {
  const probedAt = nowIso()
  let driver: AcpSessionDriver | undefined
  try {
    driver = await AcpSessionDriver.connect(cwd, transportStream)
    const init = await driver.initialize({
      terminalAuth: opts.terminalAuth,
      clientName: opts.clientName,
      clientVersion: opts.clientVersion,
    })
    const authMethods = sanitizeAuthMethods(init.authMethods)
    const capabilitySummary = summarizeCapabilities(driver, init, authMethods, probedAt)

    try {
      await driver.sessionNew()
    } catch (err) {
      if (isAuthRequiredError(err)) {
        if (opts.authenticateMethodId) {
          const selectedMethod = authMethods.find(
            (method) => method.id === opts.authenticateMethodId && method.type === 'agent',
          )
          if (!selectedMethod) {
            driver.dispose()
            return {
              readiness: readiness(
                'failed',
                'WORKER_AUTH_FAILED',
                'Selected authentication method is unavailable',
                'authenticate',
              ),
              authMethods,
              capabilitySummary,
            }
          }
          try {
            await driver.authenticate(opts.authenticateMethodId)
          } catch {
            driver.dispose()
            return {
              readiness: readiness(
                'failed',
                'WORKER_AUTH_FAILED',
                'Agent authentication failed',
                'authenticate',
              ),
              authMethods,
              capabilitySummary,
            }
          }
          try {
            await driver.sessionNew()
            // authenticated path falls through to ready
          } catch (sessionError) {
            driver.dispose()
            const authenticationStillRequired = isAuthRequiredError(sessionError)
            return {
              readiness: readiness(
                'failed',
                authenticationStillRequired ? 'WORKER_AUTH_FAILED' : 'SESSION_FAILED',
                authenticationStillRequired
                  ? 'Agent authentication failed'
                  : 'ACP session setup failed',
                authenticationStillRequired ? 'authenticate' : 'retry',
              ),
              authMethods,
              capabilitySummary,
            }
          }
        } else {
          driver.dispose()
          return {
            readiness: readiness(
              'auth_required',
              'WORKER_AUTH_REQUIRED',
              'Agent requires authentication before session/new',
              preferAuthNextAction(authMethods),
            ),
            authMethods,
            capabilitySummary,
          }
        }
      } else {
        driver.dispose()
        return {
          readiness: readiness('failed', 'SESSION_FAILED', 'ACP session setup failed', 'retry'),
          authMethods,
          capabilitySummary,
        }
      }
    }

    const result: CapabilityProbeResult = {
      readiness: readiness(
        'ready',
        'SESSION_READY',
        'Initialize and session/new succeeded',
        'none',
      ),
      authMethods,
      capabilitySummary,
    }
    if (opts.keepDriver) {
      result.driver = driver
    } else {
      await cleanupSetupSession(driver)
      driver.dispose()
    }
    return result
  } catch (err) {
    if (driver) {
      try {
        driver.dispose()
      } catch {
        /* ignore */
      }
    }
    if (err instanceof AcpSessionRuntimeError && err.code === 'protocol_incompatible') {
      return {
        readiness: readiness(
          'incompatible',
          'ACP_PROTOCOL_INCOMPATIBLE',
          'ACP protocol version is incompatible',
          'upgrade_application',
        ),
        authMethods: [],
        capabilitySummary: { probedAt },
      }
    }
    return {
      readiness: readiness('failed', 'INITIALIZE_FAILED', 'ACP initialization failed', 'retry'),
      authMethods: [],
      capabilitySummary: { probedAt },
    }
  }
}

async function cleanupSetupSession(driver: AcpSessionDriver): Promise<void> {
  if (!driver.agentSessionId) return
  try {
    if (driver.hasCapability('close')) {
      await driver.closeSession()
      return
    }
    if (driver.hasCapability('delete')) {
      await driver.deleteSession()
    }
  } catch {
    // Setup cleanup is best-effort; readiness reflects protocol setup, not retention support.
  }
}

function preferAuthNextAction(methods: SanitizedAuthMethod[]): WorkerReadinessNextAction {
  if (methods.some((m) => m.type === 'terminal')) return 'open_terminal_auth'
  if (methods.some((m) => m.type === 'env_var')) return 'configure_env_secret'
  if (methods.some((m) => m.type === 'agent')) return 'authenticate'
  return 'authenticate'
}

/** Map spawn / runner failures without a live connection. */
export function readinessForSpawnFailure(input: {
  code: 'ACP_RUNNER_MISSING' | 'SPAWN_FAILED' | 'ACP_INSTALL_FAILED'
  message: string
}): WorkerReadiness {
  const next: WorkerReadinessNextAction =
    input.code === 'ACP_RUNNER_MISSING' ? 'install_runner' : 'retry'
  return readiness('failed', input.code, input.message, next)
}

export function readinessPrepared(): WorkerReadiness {
  return readiness('prepared', undefined, 'Prepared; ACP probe/auth not yet completed', 'retry')
}

const DEFAULT_SETUP_TIMEOUT_MS = 15_000
const MAX_SETUP_TIMEOUT_MS = 120_000
const TERMINATE_GRACE_MS = 250
const KILL_REAP_TIMEOUT_MS = 2_000
const OPERATION_SETTLE_TIMEOUT_MS = 1_000

type ProcessTreeCleanupDependencies = {
  platform?: NodeJS.Platform
  execFileImpl?: (
    file: string,
    args: string[],
    options: { windowsHide: boolean; timeout: number },
    callback: (error: Error | null) => void,
  ) => ChildProcess
  terminateGraceMs?: number
  killReapTimeoutMs?: number
}

type SpawnLifecycleFailureCode =
  | 'ACP_RUNNER_MISSING'
  | 'SPAWN_FAILED'
  | 'PROBE_TIMEOUT'
  | 'PROBE_ABORTED'
  | 'PROCESS_EXITED'
  | 'PROCESS_CLEANUP_FAILED'

class SpawnLifecycleFailure extends Error {
  constructor(readonly code: SpawnLifecycleFailureCode) {
    super(code)
    this.name = 'SpawnLifecycleFailure'
  }
}

function resolveSetupTimeoutMs(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_SETUP_TIMEOUT_MS
  return Math.min(Math.max(1, Math.floor(parsed)), MAX_SETUP_TIMEOUT_MS)
}

function failureForSpawnError(error: unknown): SpawnLifecycleFailure {
  const code =
    error && typeof error === 'object' ? (error as NodeJS.ErrnoException).code : undefined
  return new SpawnLifecycleFailure(code === 'ENOENT' ? 'ACP_RUNNER_MISSING' : 'SPAWN_FAILED')
}

function signalChild(proc: ChildProcess, signal: NodeJS.Signals): void {
  try {
    if (process.platform !== 'win32' && proc.pid) {
      process.kill(-proc.pid, signal)
      return
    }
    proc.kill(signal)
  } catch {
    try {
      proc.kill(signal)
    } catch {}
  }
}

async function signalWindowsProcessTree(
  proc: ChildProcess,
  signal: NodeJS.Signals,
  deps: ProcessTreeCleanupDependencies,
): Promise<boolean> {
  if (!proc.pid) {
    try {
      proc.kill(signal)
    } catch {}
    return false
  }
  const execFileImpl =
    deps.execFileImpl ??
    (execFile as unknown as NonNullable<ProcessTreeCleanupDependencies['execFileImpl']>)
  const force = signal === 'SIGKILL'
  const args = ['/PID', String(proc.pid), '/T', ...(force ? ['/F'] : [])]
  const timeout = deps.killReapTimeoutMs ?? KILL_REAP_TIMEOUT_MS
  const confirmed = await new Promise<boolean>((resolve) => {
    try {
      execFileImpl('taskkill.exe', args, { windowsHide: true, timeout }, (error) => resolve(!error))
    } catch {
      resolve(false)
    }
  })
  if (!confirmed) {
    try {
      proc.kill(signal)
    } catch {}
  }
  return confirmed
}

function waitForExit(proc: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve(true)
  return new Promise((resolve) => {
    let settled = false
    const finish = (exited: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      proc.removeListener('exit', onExit)
      resolve(exited)
    }
    const onExit = () => finish(true)
    const timer = setTimeout(() => finish(false), timeoutMs)
    proc.once('exit', onExit)
  })
}

async function terminateAndReap(
  proc: ChildProcess,
  deps: ProcessTreeCleanupDependencies = {},
): Promise<void> {
  const platform = deps.platform ?? process.platform
  const terminateGraceMs = deps.terminateGraceMs ?? TERMINATE_GRACE_MS
  const killReapTimeoutMs = deps.killReapTimeoutMs ?? KILL_REAP_TIMEOUT_MS
  let treeCleanupConfirmed = true
  try {
    if (!proc.pid && proc.exitCode === null && proc.signalCode === null) return
    if (proc.exitCode === null && proc.signalCode === null) {
      treeCleanupConfirmed =
        platform === 'win32'
          ? await signalWindowsProcessTree(proc, 'SIGTERM', deps)
          : (signalChild(proc, 'SIGTERM'), true)
      if (!(await waitForExit(proc, terminateGraceMs))) {
        treeCleanupConfirmed =
          platform === 'win32'
            ? await signalWindowsProcessTree(proc, 'SIGKILL', deps)
            : (signalChild(proc, 'SIGKILL'), true)
        if (!(await waitForExit(proc, killReapTimeoutMs))) {
          throw new SpawnLifecycleFailure('PROCESS_CLEANUP_FAILED')
        }
      }
    } else if (proc.pid) {
      // A detached descendant can outlive its group leader / launcher wrapper.
      if (platform === 'win32') {
        treeCleanupConfirmed = await signalWindowsProcessTree(proc, 'SIGKILL', deps)
      } else {
        try {
          process.kill(-proc.pid, 'SIGKILL')
        } catch {}
      }
    }
    if (!treeCleanupConfirmed) {
      throw new SpawnLifecycleFailure('PROCESS_CLEANUP_FAILED')
    }
  } finally {
    try {
      proc.stdin?.destroy()
    } catch {}
    try {
      proc.stdout?.destroy()
    } catch {}
    try {
      proc.stderr?.destroy()
    } catch {}
  }
}

/** Test seam for the exact cleanup boundary used by spawned probe/logout. */
export async function terminateSpawnedProcessTreeForTests(
  proc: ChildProcess,
  deps: ProcessTreeCleanupDependencies,
): Promise<void> {
  await terminateAndReap(proc, deps)
}

type SpawnedOperationResult<T> =
  { ok: true; value: T } | { ok: false; failure: SpawnLifecycleFailure }

type OperationOutcome<T> = { ok: true; value: T } | { ok: false; error: unknown }

async function waitForOperationSettlement<T>(
  outcome: Promise<OperationOutcome<T>>,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      outcome.then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), OPERATION_SETTLE_TIMEOUT_MS)
        timer.unref?.()
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function runSpawnedSetup<T>(
  input: SpawnedAcpSetupInput,
  operation: (proc: ChildProcess) => Promise<T>,
): Promise<SpawnedOperationResult<T>> {
  if (input.signal?.aborted) {
    return { ok: false, failure: new SpawnLifecycleFailure('PROBE_ABORTED') }
  }

  let proc: ChildProcess
  try {
    proc = spawn(input.command, [...input.args], {
      cwd: input.cwd,
      env: { ...input.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
      windowsHide: true,
    })
  } catch (error) {
    return { ok: false, failure: failureForSpawnError(error) }
  }

  // Drain diagnostics without retaining, returning, or logging their contents.
  proc.stderr?.on('data', () => {})

  let timeout: ReturnType<typeof setTimeout> | undefined
  let abortCleanup: (() => void) | undefined
  let processCleanup: (() => void) | undefined
  const operationOutcome: Promise<OperationOutcome<T>> = Promise.resolve()
    .then(() => operation(proc))
    .then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    )
  let result: SpawnedOperationResult<T>
  try {
    const lifecycleFailure = new Promise<never>((_resolve, reject) => {
      const onError = (error: Error) => reject(failureForSpawnError(error))
      const onExit = () => reject(new SpawnLifecycleFailure('PROCESS_EXITED'))
      proc.once('error', onError)
      proc.once('exit', onExit)
      processCleanup = () => {
        proc.removeListener('error', onError)
        proc.removeListener('exit', onExit)
      }
    })

    const deadline = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(
        () => reject(new SpawnLifecycleFailure('PROBE_TIMEOUT')),
        resolveSetupTimeoutMs(input.timeoutMs),
      )
    })

    const cancellation = new Promise<never>((_resolve, reject) => {
      if (!input.signal) return
      const onAbort = () => reject(new SpawnLifecycleFailure('PROBE_ABORTED'))
      input.signal.addEventListener('abort', onAbort, { once: true })
      abortCleanup = () => input.signal?.removeEventListener('abort', onAbort)
      if (input.signal.aborted) onAbort()
    })

    const value = await Promise.race([
      operationOutcome.then((outcome) => {
        if (!outcome.ok) throw outcome.error
        if (
          proc.exitCode !== null ||
          proc.signalCode !== null ||
          proc.stdout?.readableEnded === true
        ) {
          throw new SpawnLifecycleFailure('PROCESS_EXITED')
        }
        return outcome.value
      }),
      lifecycleFailure,
      deadline,
      cancellation,
    ])
    result = { ok: true, value }
  } catch (error) {
    result = {
      ok: false,
      failure:
        error instanceof SpawnLifecycleFailure
          ? error
          : new SpawnLifecycleFailure('PROCESS_EXITED'),
    }
  } finally {
    if (timeout) clearTimeout(timeout)
    abortCleanup?.()
    processCleanup?.()
  }
  let cleanupFailure: SpawnLifecycleFailure | undefined
  try {
    await terminateAndReap(proc)
  } catch {
    cleanupFailure = new SpawnLifecycleFailure('PROCESS_CLEANUP_FAILED')
  }
  if (!result.ok && !(await waitForOperationSettlement(operationOutcome))) {
    cleanupFailure = new SpawnLifecycleFailure('PROCESS_CLEANUP_FAILED')
  }
  return cleanupFailure ? { ok: false, failure: cleanupFailure } : result
}

function readinessForLifecycleFailure(failure: SpawnLifecycleFailure): WorkerReadiness {
  switch (failure.code) {
    case 'ACP_RUNNER_MISSING':
      return readiness(
        'failed',
        failure.code,
        lifecycleFailureMessage(failure.code),
        'install_runner',
      )
    case 'SPAWN_FAILED':
      return readiness('failed', failure.code, lifecycleFailureMessage(failure.code), 'retry')
    case 'PROBE_TIMEOUT':
      return readiness('failed', failure.code, lifecycleFailureMessage(failure.code), 'retry')
    case 'PROBE_ABORTED':
      return readiness('failed', failure.code, lifecycleFailureMessage(failure.code), 'retry')
    case 'PROCESS_EXITED':
      return readiness('failed', failure.code, lifecycleFailureMessage(failure.code), 'retry')
    case 'PROCESS_CLEANUP_FAILED':
      return readiness('failed', failure.code, lifecycleFailureMessage(failure.code), 'retry')
  }
}

function lifecycleFailureMessage(code: SpawnLifecycleFailureCode): string {
  switch (code) {
    case 'ACP_RUNNER_MISSING':
      return 'ACP runner is unavailable'
    case 'SPAWN_FAILED':
      return 'ACP process could not be started'
    case 'PROBE_TIMEOUT':
      return 'ACP setup timed out'
    case 'PROBE_ABORTED':
      return 'ACP setup was cancelled'
    case 'PROCESS_EXITED':
      return 'ACP process exited during setup'
    case 'PROCESS_CLEANUP_FAILED':
      return 'ACP process cleanup could not be confirmed'
  }
}

/**
 * Open a one-shot ACP setup process. It never returns a live driver or Session.
 */
export async function probeSpawnedAgent(
  input: SpawnedAcpSetupInput,
): Promise<CapabilityProbeResult> {
  const result = await runSpawnedSetup(input, async (proc) => {
    const probe = await probeConnectedAgent(input.cwd, ndjsonStreamForChild(proc), {
      terminalAuth: input.terminalAuthReady,
      authenticateMethodId: input.authenticateMethodId,
    })
    return probe
  })
  if (result.ok) return result.value
  return {
    readiness: readinessForLifecycleFailure(result.failure),
    authMethods: [],
    capabilitySummary: { probedAt: nowIso() },
  }
}

function ndjsonStreamForChild(proc: ChildProcess): import('@agentclientprotocol/sdk').Stream {
  if (!proc.stdin || !proc.stdout) throw new SpawnLifecycleFailure('SPAWN_FAILED')
  const input = Writable.toWeb(proc.stdin) as WritableStream<Uint8Array>
  const output = Readable.toWeb(proc.stdout) as ReadableStream<Uint8Array>
  return ndJsonStream(input, output)
}

function emptyLogoutResult(code: SpawnedAcpLogoutCode, message: string): SpawnedAcpLogoutResult {
  return {
    ok: code === 'LOGOUT_SUCCEEDED',
    code,
    message,
    authMethods: [],
    capabilitySummary: { probedAt: nowIso() },
  }
}

/** Call the real ACP logout RPC over a one-shot setup process. */
export async function logoutSpawnedAgent(
  input: SpawnedAcpSetupInput,
): Promise<SpawnedAcpLogoutResult> {
  const result = await runSpawnedSetup(input, async (proc) => {
    let driver: AcpSessionDriver | undefined
    const probedAt = nowIso()
    try {
      driver = await AcpSessionDriver.connect(input.cwd, ndjsonStreamForChild(proc))
      let init: Awaited<ReturnType<AcpSessionDriver['initialize']>>
      try {
        init = await driver.initialize({ terminalAuth: input.terminalAuthReady })
      } catch (error) {
        if (error instanceof AcpSessionRuntimeError && error.code === 'protocol_incompatible') {
          return emptyLogoutResult(
            'ACP_PROTOCOL_INCOMPATIBLE',
            'ACP protocol version is incompatible',
          )
        }
        return emptyLogoutResult('INITIALIZE_FAILED', 'ACP initialization failed')
      }
      const authMethods = sanitizeAuthMethods(init.authMethods)
      const capabilitySummary = summarizeCapabilities(driver, init, authMethods, probedAt)
      if (!driver.hasCapability('logout')) {
        return {
          ok: false,
          code: 'LOGOUT_UNSUPPORTED' as const,
          message: 'Agent does not support logout',
          authMethods,
          capabilitySummary,
        }
      }
      try {
        await driver.logout()
      } catch {
        return {
          ok: false,
          code: 'LOGOUT_FAILED' as const,
          message: 'Agent logout failed',
          authMethods,
          capabilitySummary,
        }
      }
      return {
        ok: true,
        code: 'LOGOUT_SUCCEEDED' as const,
        message: 'Agent logout succeeded',
        authMethods,
        capabilitySummary,
      }
    } finally {
      try {
        driver?.dispose()
      } catch {}
    }
  })

  if (result.ok) return result.value
  const code = result.failure.code
  return emptyLogoutResult(code, lifecycleFailureMessage(code))
}
