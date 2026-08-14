/**
 * Owner-only controlled PTY authentication for Registry workers.
 *
 * The renderer supplies only Worker/method identity. Exact terminal arguments
 * stay in a process-private probe cache and launch facts come only from the
 * immutable Installation Store. No terminal data is persisted or logged.
 */
import { createHash, randomBytes } from 'node:crypto'
import { execFile as nodeExecFile } from 'node:child_process'
import { basename } from 'node:path'
import * as nodePty from 'node-pty'
import type { AcpAgentInstallationRecord } from '@pihuo-agent/core'
import {
  findInstallationById,
  getSharedStore,
  loadWorkerSecretsSnapshotForSpawn,
  type WorkerSecretsSpawnSnapshot,
} from '@pihuo-agent/core'
import { buildEffectiveWorkerEnv, type SanitizedAuthMethod } from '@pihuo-agent/adapters'
import type { WorkerRegistration } from '@pihuo-agent/shared'

export const TERMINAL_AUTH_FEATURE_ENV = 'PIHUO_AGENT_ACP_TERMINAL_AUTH'
export const TERMINAL_AUTH_TTL_MS = 2 * 60 * 1000
export const TERMINAL_AUTH_MAX_OUTPUT_BYTES = 512 * 1024
export const TERMINAL_AUTH_MAX_OUTPUT_BYTES_PER_SECOND = 128 * 1024
export const TERMINAL_AUTH_MAX_INPUT_FRAME = 8 * 1024
export const TERMINAL_AUTH_MAX_CONCURRENT = 2
export const TERMINAL_AUTH_IDLE_TIMEOUT_MS = 2 * 60 * 1000
export const TERMINAL_AUTH_ABSOLUTE_TIMEOUT_MS = 10 * 60 * 1000
export const TERMINAL_AUTH_STATUS_TTL_MS = 5 * 60 * 1000
export const TERMINAL_AUTH_MAX_RETAINED_STATUSES = 64
export const TERMINAL_AUTH_MIN_COLS = 20
export const TERMINAL_AUTH_MAX_COLS = 300
export const TERMINAL_AUTH_MIN_ROWS = 5
export const TERMINAL_AUTH_MAX_ROWS = 200

type Disposable = { dispose(): void }

export interface TerminalAuthPty {
  readonly pid: number
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(signal?: string): void
  onData(listener: (data: string) => void): Disposable
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): Disposable
}

export type TerminalAuthPtySpawn = (
  command: string,
  args: string[],
  options: {
    name: string
    cols: number
    rows: number
    cwd: string
    env: Record<string, string>
  },
) => TerminalAuthPty

export type TerminalAuthExecFile = (
  file: string,
  args: string[],
  options: {
    windowsHide: boolean
    timeout: number
    shell: false
  },
  callback: (error: Error | null) => void,
) => void

export type TerminalAuthTerminationDependencies = {
  platform?: NodeJS.Platform
  graceMs?: number
  reapMs?: number
  execFile?: TerminalAuthExecFile
  killProcessGroup?: (pid: number, signal: 'SIGTERM' | 'SIGKILL') => void
}

export type TerminalAuthOwnerDependencies = {
  findWorker?: (workerId: string) => WorkerRegistration | undefined
  findInstallation?: (installationId: string) => AcpAgentInstallationRecord | undefined
  loadWorkerSecretsSnapshot?: (workerId: string) => WorkerSecretsSpawnSnapshot
  ambientEnv?: Readonly<Record<string, string | undefined>>
}

type TerminalAuthRuntimeLimits = {
  maxOutputBytes?: number
  maxOutputBytesPerSecond?: number
  idleTimeoutMs?: number
  absoluteTimeoutMs?: number
}

type AttemptRuntime = {
  disposables: Disposable[]
  idleTimer?: ReturnType<typeof setTimeout>
  absoluteTimer?: ReturnType<typeof setTimeout>
  rateWindowStartedAt: number
  rateWindowBytes: number
  limits: Required<TerminalAuthRuntimeLimits>
  handlers: TerminalAuthProcessHandlers
  termination: TerminalAuthTerminationDependencies
}

export type TerminalAuthAttempt = {
  attemptId: string
  token: string
  workerId: string
  methodId: string
  createdAt: number
  expiresAt: number
  used: boolean
  origin?: string
  desktopCapabilityDigest: string
  executionBoundaryDigest: string
  launchBoundaryDigest: string
  secretRevisionHmac: string
  command: string
  args: string[]
  cwd: string
  env: Record<string, string>
  status: 'pending' | 'running' | 'exited' | 'cancelled' | 'failed'
  exitCode?: number | null
  /** Public bounded diagnostic phase only; never terminal data. */
  phase?: string
  startedAt?: number
  finishedAt?: number
  pty?: TerminalAuthPty
  outputBytes: number
  expiryTimer?: ReturnType<typeof setTimeout>
  terminationPromise?: Promise<void>
  runtime?: AttemptRuntime
}

type PrivateProbeEntry = {
  boundaryDigest: string
  methods: SanitizedAuthMethod[]
}

type TerminalAuthPublicStatus = {
  attemptId: string
  workerId: string
  methodId: string
  status: TerminalAuthAttempt['status']
  exitCode: number | null
  phase?: string
  startedAt?: number
  finishedAt?: number
}

type RetainedTerminalAuthStatus = {
  value: TerminalAuthPublicStatus
  expiresAt: number
  timer: ReturnType<typeof setTimeout>
}

const attempts = new Map<string, TerminalAuthAttempt>()
const tokens = new Map<string, string>()
const privateProbeMethods = new Map<string, PrivateProbeEntry>()
const retainedStatuses = new Map<string, RetainedTerminalAuthStatus>()
const inFlightTerminations = new Set<Promise<void>>()
let terminalAuthAdmissionOpen = true

export class TerminalAuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus: number = 400,
  ) {
    super(message)
    this.name = 'TerminalAuthError'
  }
}

function requireTerminalAuthAdmission(): void {
  if (!terminalAuthAdmissionOpen) {
    throw new TerminalAuthError('WORKER_NOT_READY', 'Terminal authentication is shutting down', 503)
  }
}

function highEntropy(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function desktopCapabilityDigest(token: string): string {
  return sha256(`desktop-auth-terminal\0${token}`)
}

function executionBoundaryDigest(worker: WorkerRegistration): string {
  const source = worker.source?.type === 'registry' ? worker.source : undefined
  return sha256(
    JSON.stringify({
      workerId: worker.id,
      installationId: worker.installationId ?? source?.installationId ?? null,
      registryId: source?.registryId ?? null,
      registryVersion: source?.registryVersion ?? null,
      manifestDigest: source?.manifestDigest ?? null,
      distribution: source?.distribution ?? null,
      authRevision: worker.authRevision ?? 0,
      probedAt: worker.capabilitySummary?.probedAt ?? null,
    }),
  )
}

function currentRegistryWorker(
  workerId: string,
  dependencies: TerminalAuthOwnerDependencies,
): WorkerRegistration {
  const worker = (
    dependencies.findWorker ??
    ((id: string) =>
      getSharedStore()
        .listWorkers()
        .find((entry) => entry.id === id))
  )(workerId)
  if (!worker || !worker.enabled || worker.source?.type !== 'registry') {
    throw new TerminalAuthError(
      'WORKER_AUTH_FAILED',
      'Terminal authentication execution boundary changed',
      409,
    )
  }
  return worker
}

function clonePrivateMethod(method: SanitizedAuthMethod): SanitizedAuthMethod {
  return {
    ...method,
    ...(method.envVarNames ? { envVarNames: [...method.envVarNames] } : {}),
    ...(method.terminalArgs ? { terminalArgs: [...method.terminalArgs] } : {}),
    ...(method.terminalEnvKeys ? { terminalEnvKeys: [...method.terminalEnvKeys] } : {}),
    ...(method.terminalEnv ? { terminalEnv: { ...method.terminalEnv } } : {}),
  }
}

/** Replace (never merge) the exact process-private auth methods from a probe. */
export function recordTerminalAuthProbeMethods(input: {
  worker: WorkerRegistration
  methods: SanitizedAuthMethod[]
}): void {
  const next = {
    boundaryDigest: executionBoundaryDigest(input.worker),
    methods: input.methods.map(clonePrivateMethod),
  }
  const previous = privateProbeMethods.get(input.worker.id)
  if (previous && sha256(JSON.stringify(previous)) !== sha256(JSON.stringify(next))) {
    invalidateTerminalAuthAttempts(input.worker.id)
  }
  privateProbeMethods.set(input.worker.id, next)
}

/** Capture only methods that still belong to this exact Worker execution boundary. */
export function snapshotTerminalAuthProbeMethods(
  worker: WorkerRegistration,
): SanitizedAuthMethod[] | undefined {
  const cached = privateProbeMethods.get(worker.id)
  if (!cached || cached.boundaryDigest !== executionBoundaryDigest(worker)) return undefined
  return cached.methods.map(clonePrivateMethod)
}

export function clearTerminalAuthProbeMethods(workerId?: string): void {
  if (workerId) {
    invalidateTerminalAuthAttempts(workerId)
    privateProbeMethods.delete(workerId)
  } else {
    for (const id of privateProbeMethods.keys()) invalidateTerminalAuthAttempts(id)
    privateProbeMethods.clear()
  }
}

export function isTerminalAuthFeatureEnabled(): boolean {
  const value = process.env[TERMINAL_AUTH_FEATURE_ENV]
  return value !== '0' && value !== 'false' && value !== 'off'
}

let ptyReadyCache: boolean | null = null

/** True only when the native node-pty runtime dependency can be loaded. */
export function isPtyFeatureReady(): boolean {
  if (!isTerminalAuthFeatureEnabled()) return false
  if (ptyReadyCache != null) return ptyReadyCache
  ptyReadyCache = typeof nodePty.spawn === 'function'
  return ptyReadyCache
}

export function setPtyFeatureReadyForTests(ready: boolean | null): void {
  ptyReadyCache = ready
}

function defaultPtySpawn(
  command: string,
  args: string[],
  options: Parameters<TerminalAuthPtySpawn>[2],
): TerminalAuthPty {
  if (typeof nodePty.spawn !== 'function') {
    throw new TerminalAuthError('WORKER_NOT_READY', 'Terminal authentication is unavailable', 503)
  }
  return nodePty.spawn(command, args, options) as TerminalAuthPty
}

function clearAttemptTimers(attempt: TerminalAuthAttempt): void {
  const runtime = attempt.runtime
  if (!runtime) return
  if (runtime.idleTimer) clearTimeout(runtime.idleTimer)
  if (runtime.absoluteTimer) clearTimeout(runtime.absoluteTimer)
  for (const disposable of runtime.disposables.splice(0)) {
    try {
      disposable.dispose()
    } catch {
      /* native listener cleanup */
    }
  }
}

function clearAttemptExpiryTimer(attempt: TerminalAuthAttempt): void {
  if (attempt.expiryTimer) clearTimeout(attempt.expiryTimer)
  attempt.expiryTimer = undefined
}

function scrubAttemptToken(attempt: TerminalAuthAttempt): void {
  clearAttemptExpiryTimer(attempt)
  if (attempt.token) tokens.delete(attempt.token)
  attempt.token = ''
}

function scrubAttemptLaunch(attempt: TerminalAuthAttempt): void {
  attempt.command = ''
  attempt.args = []
  attempt.cwd = ''
  attempt.env = {}
}

function publicStatus(attempt: TerminalAuthAttempt): TerminalAuthPublicStatus {
  return {
    attemptId: attempt.attemptId,
    workerId: attempt.workerId,
    methodId: attempt.methodId,
    status: attempt.status,
    exitCode: attempt.exitCode ?? null,
    ...(attempt.phase ? { phase: attempt.phase } : {}),
    ...(attempt.startedAt ? { startedAt: attempt.startedAt } : {}),
    ...(attempt.finishedAt ? { finishedAt: attempt.finishedAt } : {}),
  }
}

function deleteRetainedStatus(attemptId: string): void {
  const retained = retainedStatuses.get(attemptId)
  if (retained) clearTimeout(retained.timer)
  retainedStatuses.delete(attemptId)
}

function retainTerminalStatus(attempt: TerminalAuthAttempt): void {
  deleteRetainedStatus(attempt.attemptId)
  const expiresAt = Date.now() + TERMINAL_AUTH_STATUS_TTL_MS
  const timer = setTimeout(() => {
    const current = retainedStatuses.get(attempt.attemptId)
    if (current?.expiresAt === expiresAt) retainedStatuses.delete(attempt.attemptId)
  }, TERMINAL_AUTH_STATUS_TTL_MS)
  timer.unref?.()
  retainedStatuses.set(attempt.attemptId, {
    value: publicStatus(attempt),
    expiresAt,
    timer,
  })
  while (retainedStatuses.size > TERMINAL_AUTH_MAX_RETAINED_STATUSES) {
    const oldest = retainedStatuses.keys().next().value as string | undefined
    if (!oldest) break
    deleteRetainedStatus(oldest)
  }
}

function finalizeTerminalAttempt(attempt: TerminalAuthAttempt): void {
  clearAttemptExpiryTimer(attempt)
  clearAttemptTimers(attempt)
  scrubAttemptToken(attempt)
  scrubAttemptLaunch(attempt)
  retainTerminalStatus(attempt)
  if (attempts.get(attempt.attemptId) === attempt) attempts.delete(attempt.attemptId)
  attempt.pty = undefined
  attempt.runtime = undefined
}

function failAttemptBoundary(attempt: TerminalAuthAttempt): void {
  if (terminalAttemptEnded(attempt)) return
  attempt.status = 'failed'
  attempt.phase = 'execution_boundary_changed'
  attempt.finishedAt = Date.now()
  const onError = attempt.runtime?.handlers.onError
  onError?.('WORKER_AUTH_FAILED')
  const termination = terminateAttemptPty(attempt)
  finalizeTerminalAttempt(attempt)
  void termination.finally(() => {
    attempt.terminationPromise = undefined
  })
}

function invalidateTerminalAuthAttempts(workerId: string): void {
  for (const attempt of attempts.values()) {
    if (attempt.workerId === workerId && !terminalAttemptEnded(attempt)) {
      failAttemptBoundary(attempt)
    }
  }
}

function boundedDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)))
}

function createPtyExitWaiter(pty: TerminalAuthPty): {
  hasExited(): boolean
  wait(timeoutMs: number): Promise<boolean>
  dispose(): void
} {
  let exited = false
  let resolveExit: (() => void) | undefined
  const disposable = pty.onExit(() => {
    exited = true
    resolveExit?.()
  })
  return {
    hasExited: () => exited,
    wait: async (timeoutMs) => {
      if (exited) return true
      await Promise.race([
        new Promise<void>((resolve) => {
          resolveExit = resolve
        }),
        boundedDelay(timeoutMs),
      ])
      resolveExit = undefined
      return exited
    },
    dispose: () => disposable.dispose(),
  }
}

function runTaskkill(
  pid: number,
  force: boolean,
  dependencies: TerminalAuthTerminationDependencies & {
    graceMs: number
    reapMs: number
  },
): Promise<void> {
  const invoke: TerminalAuthExecFile =
    dependencies.execFile ??
    ((file, args, options, callback) => {
      nodeExecFile(file, args, options, (error) => callback(error))
    })
  const args = ['/PID', String(pid), '/T', ...(force ? ['/F'] : [])]
  return new Promise((resolve) => {
    try {
      invoke(
        'taskkill',
        args,
        {
          windowsHide: true,
          timeout: force ? dependencies.reapMs : dependencies.graceMs,
          shell: false,
        },
        () => resolve(),
      )
    } catch {
      resolve()
    }
  })
}

function terminateAttemptPty(
  attempt: TerminalAuthAttempt,
  overrides: TerminalAuthTerminationDependencies = {},
): Promise<void> {
  if (attempt.terminationPromise) return attempt.terminationPromise
  const pty = attempt.pty
  if (!pty) return Promise.resolve()
  clearAttemptTimers(attempt)
  const inherited = attempt.runtime?.termination ?? {}
  const dependencies = {
    ...inherited,
    ...overrides,
    graceMs: overrides.graceMs ?? inherited.graceMs ?? 500,
    reapMs: overrides.reapMs ?? inherited.reapMs ?? 500,
  }
  const waiter = createPtyExitWaiter(pty)
  const terminate = async () => {
    try {
      if ((dependencies.platform ?? process.platform) === 'win32') {
        if (pty.pid > 0) await runTaskkill(pty.pid, false, dependencies)
        if (!waiter.hasExited()) await waiter.wait(dependencies.graceMs)
        if (!waiter.hasExited()) {
          if (pty.pid > 0) await runTaskkill(pty.pid, true, dependencies)
          // node-pty's Windows API accepts no POSIX signal argument.
          try {
            pty.kill()
          } catch {
            /* already exited */
          }
          if (!waiter.hasExited()) await waiter.wait(dependencies.reapMs)
        }
        return
      }

      const killGroup =
        dependencies.killProcessGroup ??
        ((pid: number, signal: 'SIGTERM' | 'SIGKILL') => process.kill(pid, signal))
      try {
        if (pty.pid > 0) killGroup(-pty.pid, 'SIGTERM')
      } catch {
        /* already exited */
      }
      try {
        pty.kill('SIGTERM')
      } catch {
        /* already exited */
      }
      if (!waiter.hasExited()) await waiter.wait(dependencies.graceMs)
      if (!waiter.hasExited()) {
        try {
          if (pty.pid > 0) killGroup(-pty.pid, 'SIGKILL')
        } catch {
          /* already reaped */
        }
        try {
          pty.kill('SIGKILL')
        } catch {
          /* already reaped */
        }
        if (!waiter.hasExited()) await waiter.wait(dependencies.reapMs)
      }
    } finally {
      try {
        waiter.dispose()
      } catch {
        /* native listener cleanup */
      }
    }
  }
  const termination = terminate()
  attempt.terminationPromise = termination
  inFlightTerminations.add(termination)
  void termination.then(
    () => {
      inFlightTerminations.delete(termination)
    },
    () => {
      inFlightTerminations.delete(termination)
    },
  )
  return termination
}

export function resetTerminalAuthAttemptsForTests(): void {
  for (const attempt of [...attempts.values()]) {
    void cancelTerminalAuthAttempt(attempt.attemptId, { graceMs: 0, reapMs: 0 })
  }
  attempts.clear()
  inFlightTerminations.clear()
  tokens.clear()
  privateProbeMethods.clear()
  terminalAuthAdmissionOpen = true
  for (const attemptId of [...retainedStatuses.keys()]) deleteRetainedStatus(attemptId)
}

function sweepExpiredAttempts(now = Date.now()): void {
  for (const attempt of attempts.values()) {
    if (attempt.status === 'pending' && now >= attempt.expiresAt) {
      expirePendingAttempt(attempt, now)
    }
  }
}

function expirePendingAttempt(attempt: TerminalAuthAttempt, now: number): void {
  if (attempt.status !== 'pending' || now < attempt.expiresAt) return
  attempt.status = 'failed'
  attempt.phase = 'expired'
  attempt.finishedAt = now
  finalizeTerminalAttempt(attempt)
}

function scheduleAttemptExpiry(attempt: TerminalAuthAttempt, delayMs = TERMINAL_AUTH_TTL_MS): void {
  clearAttemptExpiryTimer(attempt)
  attempt.expiryTimer = setTimeout(() => {
    attempt.expiryTimer = undefined
    const now = Date.now()
    const remaining = attempt.expiresAt - now
    if (attempt.status === 'pending' && remaining > 0) {
      scheduleAttemptExpiry(attempt, remaining)
      return
    }
    expirePendingAttempt(attempt, now)
  }, delayMs)
  attempt.expiryTimer.unref?.()
}

function exactPrivateTerminalMethod(
  worker: WorkerRegistration,
  methodId: string,
): SanitizedAuthMethod {
  const cached = privateProbeMethods.get(worker.id)
  if (!cached || cached.boundaryDigest !== executionBoundaryDigest(worker)) {
    throw new TerminalAuthError(
      'WORKER_AUTH_FAILED',
      'Terminal authentication requires a fresh re-probe',
      409,
    )
  }
  const matches = cached.methods.filter((method) => method.id === methodId)
  if (matches.length !== 1 || matches[0]!.type !== 'terminal') {
    throw new TerminalAuthError(
      'WORKER_AUTH_FAILED',
      'Selected terminal authentication method is unavailable',
      409,
    )
  }
  return matches[0]!
}

function exactInstallation(
  worker: WorkerRegistration,
  dependencies: TerminalAuthOwnerDependencies,
): AcpAgentInstallationRecord {
  const source = worker.source?.type === 'registry' ? worker.source : undefined
  const installationId = worker.installationId
  if (!source || !installationId || source.installationId !== installationId) {
    throw new TerminalAuthError(
      'ACP_INSTALL_DIGEST_MISMATCH',
      'Registry Worker installation identity does not match',
      409,
    )
  }
  const installation = (dependencies.findInstallation ?? findInstallationById)(installationId)
  if (
    !installation ||
    !installation.launchSpec ||
    installation.status === 'removed' ||
    installation.status === 'staging' ||
    installation.registryId !== source.registryId ||
    installation.registryVersion !== source.registryVersion ||
    installation.manifestDigest !== source.manifestDigest ||
    installation.distribution !== source.distribution ||
    installation.target !== source.target ||
    installation.launchSpec.distribution !== source.distribution
  ) {
    throw new TerminalAuthError(
      'ACP_INSTALL_DIGEST_MISMATCH',
      'Registry Worker installation facts do not match',
      409,
    )
  }
  return installation
}

type MaterializedTerminalAuthCommand = {
  command: string
  args: string[]
  cwd: string
  env: Record<string, string>
  executionBoundaryDigest: string
  launchBoundaryDigest: string
  secretRevisionHmac: string
}

function materializeTerminalAuthCommandWithBoundary(
  input: { worker: WorkerRegistration; methodId: string },
  dependencies: TerminalAuthOwnerDependencies = {},
): MaterializedTerminalAuthCommand {
  const method = exactPrivateTerminalMethod(input.worker, input.methodId)
  const installation = exactInstallation(input.worker, dependencies)
  const spec = installation.launchSpec!
  const terminalArgs = [...(method.terminalArgs ?? [])]
  let command: string
  let args: string[]

  if (spec.distribution === 'npx' || spec.distribution === 'uvx') {
    if (spec.executable) {
      if (!installation.resolvedExecutable || installation.resolvedExecutable !== spec.executable) {
        throw new TerminalAuthError(
          'ACP_INSTALL_DIGEST_MISMATCH',
          'Registry package launch facts do not match',
          409,
        )
      }
      command = spec.interpreter ?? spec.executable
      args = [...(spec.interpreter ? [spec.executable] : []), ...terminalArgs]
    } else if (
      !spec.runnerCommand ||
      !spec.packageSpec ||
      installation.runnerCommand !== spec.runnerCommand ||
      installation.packageSpec !== spec.packageSpec
    ) {
      throw new TerminalAuthError(
        'ACP_INSTALL_DIGEST_MISMATCH',
        'Registry runner launch facts do not match',
        409,
      )
    } else {
      command = spec.runnerCommand
      args = [...spec.runnerArgs, spec.packageSpec, ...terminalArgs]
    }
  } else if (spec.distribution === 'binary') {
    if (
      !spec.executable ||
      !installation.resolvedExecutable ||
      installation.resolvedExecutable !== spec.executable
    ) {
      throw new TerminalAuthError(
        'ACP_INSTALL_DIGEST_MISMATCH',
        'Registry binary launch facts do not match',
        409,
      )
    }
    command = spec.executable
    args = terminalArgs
  } else {
    throw new TerminalAuthError(
      'ACP_REGISTRY_ENTRY_INVALID',
      'Registry terminal authentication launch is unsupported',
      409,
    )
  }

  const secretSnapshot = (
    dependencies.loadWorkerSecretsSnapshot ?? loadWorkerSecretsSnapshotForSpawn
  )(input.worker.id)
  const env = buildEffectiveWorkerEnv({
    ambientEnv: dependencies.ambientEnv ?? process.env,
    workerEnv: { ...spec.env, ...(method.terminalEnv ?? {}) },
    workerSecrets: secretSnapshot.secrets,
  })
  return {
    command,
    args,
    cwd: installation.installDir,
    env,
    executionBoundaryDigest: executionBoundaryDigest(input.worker),
    launchBoundaryDigest: sha256(
      JSON.stringify({
        installationId: installation.installationId,
        registryId: installation.registryId,
        registryVersion: installation.registryVersion,
        distribution: installation.distribution,
        manifestDigest: installation.manifestDigest,
        target: installation.target ?? null,
        status: installation.status,
        installDir: installation.installDir,
        runnerCommand: installation.runnerCommand ?? null,
        packageSpec: installation.packageSpec ?? null,
        resolvedExecutable: installation.resolvedExecutable ?? null,
        launchSpec: installation.launchSpec,
        method: clonePrivateMethod(method),
        command,
        args,
      }),
    ),
    secretRevisionHmac: secretSnapshot.revisionHmac,
  }
}

export function materializeTerminalAuthCommand(
  input: { worker: WorkerRegistration; methodId: string },
  dependencies: TerminalAuthOwnerDependencies = {},
): { command: string; args: string[]; cwd: string; env: Record<string, string> } {
  const launch = materializeTerminalAuthCommandWithBoundary(input, dependencies)
  return {
    command: launch.command,
    args: launch.args,
    cwd: launch.cwd,
    env: launch.env,
  }
}

function revalidateTerminalAuthAttempt(
  attempt: TerminalAuthAttempt,
  dependencies: TerminalAuthOwnerDependencies,
): void {
  try {
    const worker = currentRegistryWorker(attempt.workerId, dependencies)
    const fresh = materializeTerminalAuthCommandWithBoundary(
      {
        worker,
        methodId: attempt.methodId,
      },
      dependencies,
    )
    if (
      fresh.executionBoundaryDigest !== attempt.executionBoundaryDigest ||
      fresh.launchBoundaryDigest !== attempt.launchBoundaryDigest ||
      fresh.secretRevisionHmac !== attempt.secretRevisionHmac
    ) {
      throw new TerminalAuthError(
        'WORKER_AUTH_FAILED',
        'Terminal authentication execution boundary changed',
        409,
      )
    }
    // Always replace the launch with one materialized from the current atomic
    // secret snapshot; no pending secret-bearing object may reach spawn.
    attempt.command = fresh.command
    attempt.args = fresh.args
    attempt.cwd = fresh.cwd
    attempt.env = fresh.env
  } catch (error) {
    failAttemptBoundary(attempt)
    if (error instanceof TerminalAuthError) throw error
    throw new TerminalAuthError(
      'WORKER_AUTH_FAILED',
      'Terminal authentication execution boundary changed',
      409,
    )
  }
}

export type CreateTerminalAuthInput = {
  workerId: string
  methodId: string
  /** Owner-resolved Worker; never accepted from the HTTP body. */
  worker: WorkerRegistration
  origin?: string
  /** Current Owner Desktop capability; only its digest is retained. */
  desktopToken: string
  /** Explicitly rejected if a non-typed caller attempts injection. */
  command?: unknown
  args?: unknown
  env?: unknown
}

export function createTerminalAuthAttempt(
  input: CreateTerminalAuthInput,
  dependencies: TerminalAuthOwnerDependencies = {},
): {
  attemptId: string
  token: string
  expiresAt: string
  commandPreview: { command: string; args: [] }
} {
  requireTerminalAuthAdmission()
  if (!isTerminalAuthFeatureEnabled()) {
    throw new TerminalAuthError('WORKER_NOT_READY', 'Terminal authentication is disabled', 409)
  }
  if (!isPtyFeatureReady()) {
    throw new TerminalAuthError('WORKER_NOT_READY', 'Terminal authentication is unavailable', 503)
  }
  if (input.command !== undefined || input.args !== undefined || input.env !== undefined) {
    throw new TerminalAuthError(
      'ACP_REGISTRY_ENTRY_INVALID',
      'Terminal authentication rejects client launch input',
      409,
    )
  }
  if (!input.workerId || !input.methodId || input.worker.id !== input.workerId) {
    throw new TerminalAuthError('ACP_REGISTRY_ENTRY_INVALID', 'Worker or method mismatch', 409)
  }
  if (!input.desktopToken) {
    throw new TerminalAuthError('WORKER_AUTH_FAILED', 'Desktop authentication is required', 401)
  }

  sweepExpiredAttempts()
  const concurrent = [...attempts.values()].filter(
    (attempt) => attempt.status === 'pending' || attempt.status === 'running',
  ).length
  if (concurrent >= TERMINAL_AUTH_MAX_CONCURRENT) {
    throw new TerminalAuthError(
      'WORKER_NOT_READY',
      'Too many terminal authentication attempts',
      429,
    )
  }

  const launch = materializeTerminalAuthCommandWithBoundary(
    {
      worker: input.worker,
      methodId: input.methodId,
    },
    dependencies,
  )
  const attemptId = `ta_${highEntropy(18)}`
  const token = highEntropy(32)
  const createdAt = Date.now()
  const attempt: TerminalAuthAttempt = {
    attemptId,
    token,
    workerId: input.workerId,
    methodId: input.methodId,
    createdAt,
    expiresAt: createdAt + TERMINAL_AUTH_TTL_MS,
    used: false,
    ...(Object.hasOwn(input, 'origin') ? { origin: input.origin } : {}),
    desktopCapabilityDigest: desktopCapabilityDigest(input.desktopToken),
    executionBoundaryDigest: launch.executionBoundaryDigest,
    launchBoundaryDigest: launch.launchBoundaryDigest,
    secretRevisionHmac: launch.secretRevisionHmac,
    command: launch.command,
    args: launch.args,
    cwd: launch.cwd,
    env: launch.env,
    status: 'pending',
    outputBytes: 0,
  }
  attempts.set(attemptId, attempt)
  tokens.set(token, attemptId)
  scheduleAttemptExpiry(attempt)
  return {
    attemptId,
    token,
    expiresAt: new Date(attempt.expiresAt).toISOString(),
    // Never disclose terminal args or an absolute runner/executable path.
    commandPreview: { command: basename(launch.command), args: [] },
  }
}

export function consumeTerminalAuthToken(
  input: {
    token: string
    workerId: string
    methodId: string
    attemptId: string
    origin?: string
    desktopToken: string
  },
  dependencies: TerminalAuthOwnerDependencies = {},
): TerminalAuthAttempt {
  requireTerminalAuthAdmission()
  const mappedAttemptId = tokens.get(input.token)
  const attempt = mappedAttemptId ? attempts.get(mappedAttemptId) : undefined
  if (!attempt || mappedAttemptId !== input.attemptId) {
    throw new TerminalAuthError('WORKER_AUTH_FAILED', 'Invalid or expired auth token', 401)
  }
  if (attempt.used) {
    throw new TerminalAuthError('WORKER_AUTH_FAILED', 'Authentication token already used', 401)
  }
  const now = Date.now()
  if (now >= attempt.expiresAt) {
    expirePendingAttempt(attempt, now)
    throw new TerminalAuthError('WORKER_AUTH_FAILED', 'Authentication token expired', 401)
  }
  if (input.workerId !== attempt.workerId) {
    throw new TerminalAuthError('WORKER_AUTH_FAILED', 'Authentication token worker mismatch', 401)
  }
  if (input.methodId !== attempt.methodId) {
    throw new TerminalAuthError('WORKER_AUTH_FAILED', 'Authentication token method mismatch', 401)
  }
  const originMatches =
    Object.hasOwn(attempt, 'origin') === Object.hasOwn(input, 'origin') &&
    attempt.origin === input.origin
  if (!originMatches) {
    throw new TerminalAuthError('WORKER_AUTH_FAILED', 'Authentication token Origin mismatch', 401)
  }
  if (
    !input.desktopToken ||
    desktopCapabilityDigest(input.desktopToken) !== attempt.desktopCapabilityDigest
  ) {
    throw new TerminalAuthError('WORKER_AUTH_FAILED', 'Desktop capability changed', 401)
  }
  revalidateTerminalAuthAttempt(attempt, dependencies)
  attempt.used = true
  scrubAttemptToken(attempt)
  return attempt
}

function mergedLimits(limits: TerminalAuthRuntimeLimits = {}): Required<TerminalAuthRuntimeLimits> {
  return {
    maxOutputBytes: limits.maxOutputBytes ?? TERMINAL_AUTH_MAX_OUTPUT_BYTES,
    maxOutputBytesPerSecond:
      limits.maxOutputBytesPerSecond ?? TERMINAL_AUTH_MAX_OUTPUT_BYTES_PER_SECOND,
    idleTimeoutMs: limits.idleTimeoutMs ?? TERMINAL_AUTH_IDLE_TIMEOUT_MS,
    absoluteTimeoutMs: limits.absoluteTimeoutMs ?? TERMINAL_AUTH_ABSOLUTE_TIMEOUT_MS,
  }
}

function terminalAttemptEnded(attempt: TerminalAuthAttempt): boolean {
  return (
    attempt.status === 'cancelled' || attempt.status === 'failed' || attempt.status === 'exited'
  )
}

function refreshIdleTimer(attempt: TerminalAuthAttempt): void {
  const runtime = attempt.runtime
  if (!runtime || terminalAttemptEnded(attempt)) return
  if (runtime.idleTimer) clearTimeout(runtime.idleTimer)
  runtime.idleTimer = setTimeout(() => {
    failRunningAttempt(attempt, 'idle_timeout')
  }, runtime.limits.idleTimeoutMs)
  runtime.idleTimer.unref?.()
}

function failRunningAttempt(attempt: TerminalAuthAttempt, phase: string): void {
  if (terminalAttemptEnded(attempt)) return
  attempt.status = 'failed'
  attempt.phase = phase
  attempt.finishedAt = Date.now()
  const onError = attempt.runtime?.handlers.onError
  onError?.('WORKER_AUTH_FAILED')
  const termination = terminateAttemptPty(attempt)
  finalizeTerminalAttempt(attempt)
  void termination.finally(() => {
    attempt.terminationPromise = undefined
  })
}

export type TerminalAuthProcessHandlers = {
  onData: (chunk: string) => void
  onExit: (code: number | null) => void
  onError?: (code: 'WORKER_AUTH_FAILED') => void
}

/** Start the exact command using node-pty only. There is deliberately no pipe fallback. */
export function startTerminalAuthProcess(
  attempt: TerminalAuthAttempt,
  handlers: TerminalAuthProcessHandlers,
  dependencies: {
    ptySpawn?: TerminalAuthPtySpawn
    limits?: TerminalAuthRuntimeLimits
    termination?: TerminalAuthTerminationDependencies
    owner?: TerminalAuthOwnerDependencies
  } = {},
): boolean {
  requireTerminalAuthAdmission()
  if (attempt.status !== 'pending') {
    throw new TerminalAuthError('WORKER_AUTH_FAILED', 'Attempt is not pending', 409)
  }
  revalidateTerminalAuthAttempt(attempt, dependencies.owner ?? {})
  const limits = mergedLimits(dependencies.limits)
  const runtime: AttemptRuntime = {
    disposables: [],
    rateWindowStartedAt: Date.now(),
    rateWindowBytes: 0,
    limits,
    handlers,
    termination: dependencies.termination ?? {},
  }
  attempt.runtime = runtime
  attempt.status = 'running'
  attempt.startedAt = Date.now()
  attempt.phase = 'pty_running'

  try {
    const pty = (dependencies.ptySpawn ?? defaultPtySpawn)(attempt.command, [...attempt.args], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: attempt.cwd,
      env: { ...attempt.env },
    })
    attempt.pty = pty
    scrubAttemptToken(attempt)
    scrubAttemptLaunch(attempt)
    runtime.disposables.push(
      pty.onData((chunk) => {
        if (terminalAttemptEnded(attempt)) return
        const now = Date.now()
        const bytes = Buffer.byteLength(chunk, 'utf8')
        if (now - runtime.rateWindowStartedAt >= 1_000) {
          runtime.rateWindowStartedAt = now
          runtime.rateWindowBytes = 0
        }
        attempt.outputBytes += bytes
        runtime.rateWindowBytes += bytes
        if (
          attempt.outputBytes > runtime.limits.maxOutputBytes ||
          runtime.rateWindowBytes > runtime.limits.maxOutputBytesPerSecond
        ) {
          failRunningAttempt(attempt, 'output_limit')
          return
        }
        refreshIdleTimer(attempt)
        handlers.onData(chunk)
      }),
    )
    runtime.disposables.push(
      pty.onExit(({ exitCode }) => {
        if (terminalAttemptEnded(attempt)) return
        attempt.status = 'exited'
        attempt.exitCode = Number.isInteger(exitCode) ? exitCode : null
        attempt.finishedAt = Date.now()
        attempt.phase = 'exited'
        handlers.onExit(attempt.exitCode)
        finalizeTerminalAttempt(attempt)
      }),
    )
    refreshIdleTimer(attempt)
    runtime.absoluteTimer = setTimeout(() => {
      failRunningAttempt(attempt, 'absolute_timeout')
    }, runtime.limits.absoluteTimeoutMs)
    runtime.absoluteTimer.unref?.()
    return true
  } catch {
    attempt.status = 'failed'
    attempt.phase = 'spawn_error'
    attempt.finishedAt = Date.now()
    handlers.onError?.('WORKER_AUTH_FAILED')
    finalizeTerminalAttempt(attempt)
    return false
  }
}

export function writeTerminalAuthInput(attempt: TerminalAuthAttempt, data: string): void {
  if (Buffer.byteLength(data, 'utf8') > TERMINAL_AUTH_MAX_INPUT_FRAME) {
    throw new TerminalAuthError('WORKER_AUTH_FAILED', 'Input frame is too large', 413)
  }
  if (attempt.status !== 'running' || !attempt.pty) {
    throw new TerminalAuthError('WORKER_AUTH_FAILED', 'Attempt is not running', 409)
  }
  attempt.pty.write(data)
  refreshIdleTimer(attempt)
}

export function resizeTerminalAuth(attempt: TerminalAuthAttempt, cols: number, rows: number): void {
  if (
    !Number.isInteger(cols) ||
    !Number.isInteger(rows) ||
    cols < TERMINAL_AUTH_MIN_COLS ||
    cols > TERMINAL_AUTH_MAX_COLS ||
    rows < TERMINAL_AUTH_MIN_ROWS ||
    rows > TERMINAL_AUTH_MAX_ROWS
  ) {
    throw new TerminalAuthError('WORKER_AUTH_FAILED', 'Invalid terminal dimensions', 400)
  }
  if (attempt.status !== 'running' || !attempt.pty) {
    throw new TerminalAuthError('WORKER_AUTH_FAILED', 'Attempt is not running', 409)
  }
  attempt.pty.resize(cols, rows)
  refreshIdleTimer(attempt)
}

export function cancelTerminalAuthAttempt(
  attemptId: string,
  termination: TerminalAuthTerminationDependencies = {},
): Promise<void> {
  const attempt = attempts.get(attemptId)
  if (!attempt) return Promise.resolve()
  if (terminalAttemptEnded(attempt)) {
    return attempt.terminationPromise ?? Promise.resolve()
  }
  attempt.status = 'cancelled'
  attempt.phase = 'cancelled'
  attempt.finishedAt = Date.now()
  const terminated = terminateAttemptPty(attempt, termination)
  finalizeTerminalAttempt(attempt)
  return terminated.finally(() => {
    attempt.terminationPromise = undefined
  })
}

export async function cancelAllTerminalAuthAttempts(
  termination: TerminalAuthTerminationDependencies = {},
): Promise<void> {
  const cancellations = [...attempts.values()].map((attempt) => {
    const onError = attempt.runtime?.handlers.onError
    const cancellation = cancelTerminalAuthAttempt(attempt.attemptId, termination)
    try {
      onError?.('WORKER_AUTH_FAILED')
    } catch {
      /* shutdown continues */
    }
    return cancellation
  })
  await Promise.all(new Set([...inFlightTerminations, ...cancellations]))
}

export async function drainTerminalAuthAttemptsForShutdown(input: {
  stopAdmission: () => void | Promise<void>
  termination?: TerminalAuthTerminationDependencies
}): Promise<void> {
  terminalAuthAdmissionOpen = false
  // Invoke synchronously after the module gate closes, so no POST/upgrade can
  // create or consume an attempt while the network server begins draining.
  const admissionStopped = (async () => input.stopAdmission())()
  const admissionResult = admissionStopped.then(
    () => ({ ok: true as const }),
    (error: unknown) => ({ ok: false as const, error }),
  )

  await cancelAllTerminalAuthAttempts(input.termination)
  const result = await admissionResult
  // A second pass covers work accepted by the HTTP server immediately before
  // its admission boundary closed; the module gate prevents any newer work.
  await cancelAllTerminalAuthAttempts(input.termination)
  if (!result.ok) throw result.error
}

export function getTerminalAuthAttempt(attemptId: string): TerminalAuthAttempt | undefined {
  return attempts.get(attemptId)
}

export function terminalAuthAttemptPublicStatus(
  workerId: string,
  attemptId: string,
): TerminalAuthPublicStatus | null {
  sweepExpiredAttempts()
  const attempt = attempts.get(attemptId)
  if (attempt) return attempt.workerId === workerId ? publicStatus(attempt) : null
  const retained = retainedStatuses.get(attemptId)
  if (!retained || retained.value.workerId !== workerId) return null
  if (Date.now() >= retained.expiresAt) {
    deleteRetainedStatus(attemptId)
    return null
  }
  return { ...retained.value }
}
