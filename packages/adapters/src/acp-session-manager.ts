import { randomBytes, createHmac, createHash } from 'node:crypto'
import { resolve as pathResolve } from 'node:path'
import { realpathSync, rmSync } from 'node:fs'
import { spawn, type ChildProcess } from 'node:child_process'
import { Writable, Readable } from 'node:stream'
import { type SessionConfigOption, type AgentCapabilities } from '@agentclientprotocol/sdk'
import type { WorkerKind, WorkerModelOption } from '@swarmdesk-agent/shared'
import { extractModelOptions } from './acp-model-options.js'
import { prepareOpenCodeAcpEnv, OPENCODE_ZEN_FREE_MODELS } from './opencode-acp-env.js'
import { buildProviderEvidenceMap } from './model-eligibility.js'
import { buildEffectiveWorkerEnv } from './worker-env.js'
import { type AcpPermissionRequest } from './acp-session.js'
import type { AcpSessionCatalogPort, AcpSessionCatalogRecord } from './acp-session-catalog-port.js'
import {
  AcpSessionDriver,
  type SessionDisposition,
  type OnSessionReadyResult,
  type AcpRecoveryError,
  AcpSessionRuntimeError,
  isAcpSessionRuntimeError,
  type PromptBinding,
  type PromptResult,
} from './acp-session-driver.js'

// ── fingerprint & keys ──

function killProcessGroup(proc: ChildProcess, signal: NodeJS.Signals) {
  try {
    if (proc.pid) process.kill(-proc.pid, signal)
  } catch {
    try {
      proc.kill(signal)
    } catch {}
  }
}

let _hmacSecret: Buffer | null = null
function hmacSecret(): Buffer {
  if (!_hmacSecret) _hmacSecret = randomBytes(32)
  return _hmacSecret
}

export interface AcpFingerprintInput {
  command: string
  args: readonly string[]
  model?: string
  explicitEnv: Readonly<Record<string, string>>
  ambientEnv: Readonly<Record<string, string | undefined>>
}

export type AcpFingerprintFn = (input: AcpFingerprintInput) => string

export interface SessionEntryConfig {
  command: string
  args: string[]
  model?: string
  env: Record<string, string>
  /** Spawn-only worker-scoped credentials; excluded from canonical fingerprints. */
  workerSecrets?: Record<string, string>
  /** Cached candidates for execute eligibility (not part of fingerprint) */
  availableModels?: WorkerModelOption[]
  /**
   * Provider evidence from discovery (auth store + env + disabled).
   * When set, Manager MUST use this map and not recompute from env alone.
   */
  providers?: Record<string, import('./model-eligibility.js').ProviderEvidence>
  workerKind?: string
  eligibilityRevision?: string
  /** Registry installation identity (fingerprint boundary). */
  installationId?: string
  /** Registry manifest digest when source=registry. */
  manifestDigest?: string
  /** Execution branching profile. */
  runtimeProfile?: string
  /** Monotonic auth/credential revision (never secret values). */
  authRevision?: number
  /** HMAC of worker-scoped secret key names + revision (not values). */
  workerSecretRevisionHmac?: string
}

function openCodeAcpPrepFromConfig(config: SessionEntryConfig) {
  // Prefer full candidate set; empty array still means "we know candidates" (fail-closed).
  const candidates = config.availableModels !== undefined ? config.availableModels : undefined
  // Whitelisted ambient + worker env + model credentials only — never full process.env.
  const effectiveEnv = buildEffectiveWorkerEnv({
    ambientEnv: process.env,
    workerEnv: config.env,
    workerSecrets: config.workerSecrets,
    model: config.model,
  })
  // Use discovery evidence when provided — do not recompute from env alone
  // (would miss OpenCode auth.json-authenticated providers).
  let providers = config.providers
  if (!providers && candidates && candidates.length > 0) {
    providers = buildProviderEvidenceMap({
      modelIds: candidates.map((m) => m.modelId),
      env: effectiveEnv,
      zenFreeAllowlist: [...OPENCODE_ZEN_FREE_MODELS],
    })
  }
  return prepareOpenCodeAcpEnv({
    baseEnv: effectiveEnv as NodeJS.ProcessEnv,
    model: config.model ?? undefined,
    candidates,
    providers,
    zenFreeAllowlist: [...OPENCODE_ZEN_FREE_MODELS],
  })
}

/** Effective spawn env for non-OpenCode workers (Claude/Codex/…). */
export function buildWorkerProcessEnv(
  config: SessionEntryConfig,
  ambientEnv: Readonly<Record<string, string | undefined>> = process.env,
): Record<string, string> {
  return buildEffectiveWorkerEnv({
    ambientEnv,
    workerEnv: config.env,
    workerSecrets: config.workerSecrets,
    model: config.model,
  })
}

/** Effective spawn env for non-OpenCode workers (Claude/Codex/…). */
function workerSpawnEnv(config: SessionEntryConfig): Record<string, string> {
  return buildWorkerProcessEnv(config)
}

export interface WorkerExecutionConfig {
  command: string
  args: string[]
  env?: Record<string, string>
  model?: string
  kind?: WorkerKind
  enabled?: boolean
  installationId?: string
  runtimeProfile?: string
  authRevision?: number
  launchSpec?: {
    distribution?: string
    runnerCommand?: string
    runnerArgs?: string[]
    packageSpec?: string
    executable?: string
    agentArgs?: string[]
    env?: Record<string, string>
    artifact?: {
      archiveUrl?: string
      declaredSha256?: string
      observedSha256?: string
      executableRelativePath?: string
    }
  }
}

function canonicalEnvEntries(
  env: Readonly<Record<string, string | undefined>>,
): Array<[string, string]> {
  return Object.entries(env)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
}

export function computeExecutionFingerprint(
  cfg: SessionEntryConfig,
  fingerprintFn?: AcpFingerprintFn,
  ambientEnv: Readonly<Record<string, string | undefined>> = process.env,
): string {
  // Fold kind + eligibility/auth/install revisions into explicitEnv so both default HMAC
  // and injected fingerprintFn see configuration boundary changes.
  const boundaryEnv = {
    ...cfg.env,
    ...(cfg.workerKind ? { __RA_WORKER_KIND: cfg.workerKind } : {}),
    ...(cfg.eligibilityRevision ? { __RA_ELIG_REV: cfg.eligibilityRevision } : {}),
    ...(cfg.installationId ? { __RA_INSTALLATION_ID: cfg.installationId } : {}),
    ...(cfg.manifestDigest ? { __RA_MANIFEST_DIGEST: cfg.manifestDigest } : {}),
    ...(cfg.runtimeProfile ? { __RA_RUNTIME_PROFILE: cfg.runtimeProfile } : {}),
    ...(cfg.authRevision !== undefined ? { __RA_AUTH_REV: String(cfg.authRevision) } : {}),
    ...(cfg.workerSecretRevisionHmac
      ? { __RA_WORKER_SECRET_REV: cfg.workerSecretRevisionHmac }
      : {}),
  }
  if (fingerprintFn) {
    return fingerprintFn({
      command: cfg.command,
      args: [...cfg.args],
      model: cfg.model,
      explicitEnv: { ...boundaryEnv },
      ambientEnv: { ...ambientEnv },
    })
  }
  const canonical = JSON.stringify({
    command: cfg.command,
    args: cfg.args,
    model: cfg.model ?? null,
    workerKind: cfg.workerKind ?? null,
    eligibilityRevision: cfg.eligibilityRevision ?? null,
    installationId: cfg.installationId ?? null,
    manifestDigest: cfg.manifestDigest ?? null,
    runtimeProfile: cfg.runtimeProfile ?? null,
    authRevision: cfg.authRevision ?? null,
    workerSecretRevisionHmac: cfg.workerSecretRevisionHmac ?? null,
    explicitEnv: canonicalEnvEntries(boundaryEnv),
    ambientEnv: canonicalEnvEntries(ambientEnv),
  })
  return createHmac('sha256', hmacSecret()).update(canonical).digest('hex')
}

function launchSpecFingerprint(spec: WorkerExecutionConfig['launchSpec']): string {
  if (!spec) return ''
  return JSON.stringify({
    distribution: spec.distribution,
    runnerCommand: spec.runnerCommand ?? null,
    runnerArgs: spec.runnerArgs ?? [],
    packageSpec: spec.packageSpec ?? null,
    executable: spec.executable ?? null,
    agentArgs: spec.agentArgs ?? [],
    env: canonicalEnvEntries(spec.env ?? {}),
    artifact: spec.artifact
      ? {
          archiveUrl: spec.artifact.archiveUrl,
          declaredSha256: spec.artifact.declaredSha256 ?? null,
          observedSha256: spec.artifact.observedSha256 ?? null,
          executableRelativePath: spec.artifact.executableRelativePath,
        }
      : null,
  })
}

export function workerExecutionConfigChanged(
  before: WorkerExecutionConfig,
  after: WorkerExecutionConfig,
): boolean {
  return (
    before.command !== after.command ||
    before.model !== after.model ||
    before.kind !== after.kind ||
    before.enabled !== after.enabled ||
    before.args.length !== after.args.length ||
    before.args.some((arg, index) => arg !== after.args[index]) ||
    JSON.stringify(canonicalEnvEntries(before.env ?? {})) !==
      JSON.stringify(canonicalEnvEntries(after.env ?? {})) ||
    before.installationId !== after.installationId ||
    before.runtimeProfile !== after.runtimeProfile ||
    before.authRevision !== after.authRevision ||
    launchSpecFingerprint(before.launchSpec) !== launchSpecFingerprint(after.launchSpec)
  )
}

function canonicalizeCwd(raw: string): string {
  try {
    return realpathSync(pathResolve(raw))
  } catch {
    return pathResolve(raw)
  }
}

export interface SessionReuseKey {
  routerSessionId: string
  workerId: string
  teamMemberId?: string
  teamMemberRevision?: number
  canonicalCwd: string
  executionFingerprint: string
}

export function buildSessionReuseKey(
  params: {
    routerSessionId: string
    workerId: string
    teamMemberId?: string
    teamMemberRevision?: number
    cwd: string
    config: SessionEntryConfig
  },
  fingerprintFn?: AcpFingerprintFn,
): SessionReuseKey {
  return {
    routerSessionId: params.routerSessionId,
    workerId: params.workerId,
    teamMemberId: params.teamMemberId,
    teamMemberRevision: params.teamMemberRevision,
    canonicalCwd: canonicalizeCwd(params.cwd),
    executionFingerprint: computeExecutionFingerprint(params.config, fingerprintFn),
  }
}

function reuseKeyToString(k: SessionReuseKey): string {
  return computeKeyDigest(k)
}

export function computeKeyDigest(key: SessionReuseKey): string {
  const data = JSON.stringify({
    routerSessionId: key.routerSessionId,
    workerId: key.workerId,
    ...(key.teamMemberId
      ? {
          teamMemberId: key.teamMemberId,
          teamMemberRevision: key.teamMemberRevision ?? null,
        }
      : {}),
    canonicalCwd: key.canonicalCwd,
    executionFingerprint: key.executionFingerprint,
  })
  return createHash('sha256').update(data).digest('hex')
}

// ── prompt binding (re-exported from driver) ──

export type {
  PromptBinding,
  AcpRecoveryError,
  OnSessionReadyResult,
  SessionDisposition,
} from './acp-session-driver.js'

type ModelConfigDriver = Pick<AcpSessionDriver, 'configOptions' | 'setConfigOption'>

export async function applyPinnedModelOrThrow(
  driver: ModelConfigDriver,
  configuredModel: string | undefined,
): Promise<void> {
  const model = configuredModel?.trim()
  if (!model) return

  const modelOptions = extractModelOptions(driver.configOptions)
  const declared = modelOptions.ok && modelOptions.models.some((option) => option.modelId === model)
  const configOption = driver.configOptions.find(
    (option) =>
      option.type === 'select' &&
      'options' in option &&
      Array.isArray(option.options) &&
      option.options.some((entry) =>
        'group' in entry
          ? entry.options.some((nested) => nested.value === model)
          : 'value' in entry && entry.value === model,
      ),
  )
  if (!declared || !configOption) {
    throw new AcpSessionRuntimeError(
      'model_configuration_failed',
      'The configured ACP model is unavailable. Update the worker model and retry.',
      false,
    )
  }

  try {
    await driver.setConfigOption(configOption.id, model)
  } catch (cause) {
    throw new AcpSessionRuntimeError(
      'model_configuration_failed',
      'The configured ACP model could not be applied. Update the worker model and retry.',
      false,
      { cause },
    )
  }
}

// ── request / result ──

export interface EnqueuePromptRequest {
  key: SessionReuseKey
  config: SessionEntryConfig
  kind: WorkerKind
  task: string
  binding: PromptBinding
  signal?: AbortSignal
}

export interface EnqueuePromptResult {
  ok: boolean
  output?: string
  stopReason?: string
  error?: string
  modelUsed?: string
  reusedSession: boolean
  sessionDisposition?: string
}

// ── live entry (internal) ──

const STDERR_MAX_BYTES = 8000
const UNCOMMITTED_SESSION_CLEANUP_TIMEOUT_MS = 1_500
const MAX_TIMER_DELAY_MS = 2_147_483_647

/** validating = claimed for eligibility/setup before running (prevents double-claim races) */
type EntryState = 'starting' | 'idle' | 'validating' | 'running' | 'closing' | 'closed' | 'broken'

interface LiveEntry {
  key: SessionReuseKey
  state: EntryState
  proc: ChildProcess
  driver: AcpSessionDriver
  agentSessionId: string
  capabilities: AgentCapabilities

  createdAt: number
  lastUsedAt: number
  generation: number
  summary: string
  currentBinding: PromptBinding | null
  promptQueue: QueueItem[]
  configOptions: SessionConfigOption[]
  /** Spawn-time config for live reuse eligibility re-checks */
  sessionConfig?: SessionEntryConfig
  workerKind?: WorkerKind
  _sigkillScheduled?: boolean
  _closing?: boolean
  _closeApplied?: boolean
  isolatedHome?: string
}

interface QueueItem {
  task: string
  binding: PromptBinding
  resolve: (r: EnqueuePromptResult) => void
  reject: (e: unknown) => void
  abortCleanup?: () => void
}

// ── manager ──

export interface AcpSessionManagerConfig {
  idleTimeoutMs?: number
  poolMax?: number
  cancelGraceMs?: number
  onActivity?: (event: string, meta?: Record<string, unknown>) => void
  /** Stable fingerprint provider (injected, typically from @swarmdesk-agent/core). */
  fingerprintFn?: AcpFingerprintFn
  /** Session catalog port for cross-process session tracking (injected). */
  catalogPort?: AcpSessionCatalogPort
  /** Production reuse must fail closed when catalog/fingerprint dependencies are absent. */
  catalogRequired?: boolean
  /** Best-effort remote lifecycle cleanup; invoked after deterministic local deletion. */
  remoteCleanup?: (record: AcpSessionCatalogRecord) => void | Promise<void>
}

function positiveInt(value: unknown, fallback: number): number {
  const numeric = Number(value)
  return Number.isInteger(numeric) && numeric > 0 ? numeric : fallback
}

function positiveEnvInt(name: string, fallback: number): number {
  return positiveInt(process.env[name], fallback)
}

function positiveTimerInt(value: unknown, fallback: number): number {
  return Math.min(positiveInt(value, fallback), MAX_TIMER_DELAY_MS)
}

function spawnDetachedAcpProcess(input: {
  command: string
  args: string[]
  cwd: string
  env: Record<string, string>
  isolatedHome?: string
}): ChildProcess {
  try {
    return spawn(input.command, input.args, {
      cwd: input.cwd,
      env: input.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
    })
  } catch (error) {
    if (input.isolatedHome) {
      try {
        rmSync(input.isolatedHome, { recursive: true, force: true })
      } catch {}
    }
    throw error
  }
}

export class AcpSessionManager {
  private entries = new Map<string, LiveEntry>()
  private idleTimeoutMs: number
  private poolMax: number
  private cancelGraceMs: number
  private idleTimer: ReturnType<typeof setInterval> | null = null
  private closed = false
  private reuseEnabled: boolean
  private sessionToProject = new Map<string, string>()
  private onActivity?: (event: string, meta?: Record<string, unknown>) => void
  private fingerprintFn?: AcpSessionManagerConfig['fingerprintFn']
  private catalogPort?: AcpSessionCatalogPort
  private catalogRequired: boolean
  private remoteCleanup?: AcpSessionManagerConfig['remoteCleanup']

  constructor(cfg: AcpSessionManagerConfig = {}) {
    const defaultIdleTimeoutMs = positiveEnvInt('ACP_SESSION_IDLE_MS', 900_000)
    const defaultPoolMax = positiveEnvInt('ACP_SESSION_POOL_MAX', 8)
    const defaultCancelGraceMs = positiveEnvInt('ACP_SESSION_CANCEL_GRACE_MS', 2_000)
    this.idleTimeoutMs = positiveTimerInt(cfg.idleTimeoutMs, defaultIdleTimeoutMs)
    this.poolMax = positiveInt(cfg.poolMax, defaultPoolMax)
    this.cancelGraceMs = positiveTimerInt(cfg.cancelGraceMs, defaultCancelGraceMs)
    this.reuseEnabled = process.env.ACP_SESSION_REUSE !== '0'
    this.onActivity = cfg.onActivity
    this.fingerprintFn = cfg.fingerprintFn
    this.catalogPort = cfg.catalogPort
    this.catalogRequired = cfg.catalogRequired ?? false
    this.remoteCleanup = cfg.remoteCleanup
    this.idleTimer = setInterval(() => this.reapIdle(), 30_000)
    if (this.idleTimer.unref) this.idleTimer.unref()
  }

  private activity(event: string, meta?: Record<string, unknown>): void {
    try {
      this.onActivity?.(event, meta)
    } catch {
      // Observability hooks must never own ACP session lifecycle semantics.
    }
  }

  private assertEntryActive(keyStr: string, entry: LiveEntry): void {
    if (
      this.entries.get(keyStr) === entry &&
      !entry._closing &&
      entry.state !== 'closing' &&
      entry.state !== 'closed' &&
      entry.state !== 'broken'
    )
      return
    // A reset/delete may win while initialize/resume/new is awaiting. Close a
    // driver that arrived late and never commit or prompt the retired session.
    this.closeEntry(entry)
    throw new Error('ACP session closed during startup')
  }

  setSessionProject(routerSessionId: string, projectId: string): void {
    this.sessionToProject.set(routerSessionId, projectId)
  }

  canAccept(key: SessionReuseKey): boolean {
    const existing = this.entries.get(reuseKeyToString(key))
    if (existing) return true
    if (this.entries.size < this.poolMax) return true
    this.evictLRU()
    return this.entries.size < this.poolMax
  }

  willReuse(key: SessionReuseKey): boolean {
    if (!this.reuseEnabled) return false
    const entry = this.entries.get(reuseKeyToString(key))
    return Boolean(
      entry &&
      (entry.state === 'starting' ||
        entry.state === 'idle' ||
        entry.state === 'validating' ||
        entry.state === 'running'),
    )
  }

  /**
   * Atomically claim an idle entry for a prompt before any await.
   * Returns false if another claim/run already owns the entry.
   */
  private tryClaimEntry(entry: LiveEntry, binding: PromptBinding): boolean {
    if (
      entry.state === 'running' ||
      entry.state === 'starting' ||
      entry.state === 'validating' ||
      entry.state === 'closing' ||
      entry.state === 'closed' ||
      entry.state === 'broken' ||
      entry.currentBinding
    ) {
      return false
    }
    if (entry.state !== 'idle') return false
    entry.state = 'validating'
    entry.currentBinding = binding
    entry.lastUsedAt = Date.now()
    return true
  }

  private releaseClaim(entry: LiveEntry, binding: PromptBinding): void {
    if (entry.currentBinding === binding) {
      entry.currentBinding = null
    }
    if (entry.state === 'validating') {
      entry.state = 'idle'
    }
  }

  private isBusy(entry: LiveEntry): boolean {
    return (
      entry.state === 'running' ||
      entry.state === 'starting' ||
      entry.state === 'validating' ||
      Boolean(entry.currentBinding)
    )
  }

  getCatalogPort(): AcpSessionCatalogPort | undefined {
    return this.catalogPort
  }

  setCatalogPort(port: AcpSessionCatalogPort | undefined): void {
    this.catalogPort = port
  }

  assertCompatibleConfig(cfg: AcpSessionManagerConfig): void {
    if (cfg.catalogPort !== undefined && cfg.catalogPort !== this.catalogPort) {
      throw new Error('ACP session manager already has an incompatible catalog')
    }
    if (cfg.fingerprintFn !== undefined && cfg.fingerprintFn !== this.fingerprintFn) {
      throw new Error('ACP session manager already has an incompatible fingerprint provider')
    }
    if (cfg.catalogRequired !== undefined && cfg.catalogRequired !== this.catalogRequired) {
      throw new Error('ACP session manager already has an incompatible required-mode policy')
    }
    if (cfg.remoteCleanup !== undefined && cfg.remoteCleanup !== this.remoteCleanup) {
      throw new Error('ACP session manager already has an incompatible remote cleanup provider')
    }
  }

  buildReuseKey(params: {
    routerSessionId: string
    workerId: string
    teamMemberId?: string
    teamMemberRevision?: number
    cwd: string
    config: SessionEntryConfig
  }): SessionReuseKey {
    if (this.catalogRequired && !this.fingerprintFn) {
      throw new AcpSessionRuntimeError(
        'acp_runtime_not_configured',
        'ACP runtime is unavailable. Restart the application and retry.',
        false,
      )
    }
    return buildSessionReuseKey(params, this.fingerprintFn)
  }

  computeKeyDigest(key: SessionReuseKey): string {
    return computeKeyDigest(key)
  }

  private queuePrompt(entry: LiveEntry, req: EnqueuePromptRequest): Promise<EnqueuePromptResult> {
    return new Promise((resolve, reject) => {
      const item: QueueItem = { task: req.task, binding: req.binding, resolve, reject }
      entry.promptQueue.push(item)
      const signal = req.binding.signal
      if (!signal) return

      const onAbort = () => {
        const idx = entry.promptQueue.indexOf(item)
        if (idx < 0) return
        entry.promptQueue.splice(idx, 1)
        item.abortCleanup?.()
        reject(new Error('Cancelled'))
      }
      signal.addEventListener('abort', onAbort, { once: true })
      item.abortCleanup = () => signal.removeEventListener('abort', onAbort)
      if (signal.aborted) onAbort()
    })
  }

  private rejectQueued(entry: LiveEntry, error: Error): void {
    while (entry.promptQueue.length > 0) {
      const item = entry.promptQueue.shift()!
      item.abortCleanup?.()
      item.reject(error)
    }
  }

  async enqueuePrompt(req: EnqueuePromptRequest): Promise<EnqueuePromptResult> {
    if (this.closed) return { ok: false, error: 'Session manager closed', reusedSession: false }
    if (req.binding.signal?.aborted) return { ok: false, error: 'Cancelled', reusedSession: false }

    if (this.reuseEnabled && this.catalogRequired && (!this.catalogPort || !this.fingerprintFn)) {
      throw new AcpSessionRuntimeError(
        'acp_runtime_not_configured',
        'ACP runtime is unavailable. Restart the application and retry.',
        false,
      )
    }

    // P0-4a: reject when catalog is configured but unavailable
    if (this.reuseEnabled && this.catalogPort && !this.catalogIsAvailable()) {
      throw this.catalogStorageFailure()
    }

    if (!this.reuseEnabled) {
      const keyStr = reuseKeyToString(req.key)
      let entry = this.entries.get(keyStr)
      if (entry) {
        if (entry.state === 'broken' || entry.state === 'closing' || entry.state === 'closed') {
          this.entries.delete(keyStr)
          entry = undefined
        } else if (this.isBusy(entry)) {
          return { ok: false, error: 'capacity_exhausted', reusedSession: false }
        } else {
          this.entries.delete(keyStr)
          this.closeEntry(entry)
        }
      }
      return this.createAndExecute(req)
    }

    const keyStr = reuseKeyToString(req.key)
    let entry = this.entries.get(keyStr)
    if (
      entry &&
      (entry.state === 'broken' || entry.state === 'closing' || entry.state === 'closed')
    ) {
      this.entries.delete(keyStr)
      entry = undefined
    }
    if (entry) {
      // Busy (including validating claim) → FIFO queue; never double-enter executePrompt
      if (this.isBusy(entry)) {
        return this.queuePrompt(entry, req)
      }
      // Atomic claim before any await in executePrompt
      if (!this.tryClaimEntry(entry, req.binding)) {
        return this.queuePrompt(entry, req)
      }
      this.activity('session_reused', {
        summary: entry.summary,
        workerId: entry.key.workerId,
        routerSessionId: entry.key.routerSessionId,
      })
      return this.executePrompt(entry, req.task, req.binding, true, 'live_reused', true)
    }
    if (this.entries.size >= this.poolMax) {
      this.evictLRU()
      if (this.entries.size >= this.poolMax) {
        return { ok: false, error: 'capacity_exhausted', reusedSession: false }
      }
    }

    // P0-1: Route through openAndBind when catalog available for cross-process recovery
    if (this.catalogIsAvailable()) {
      return this.openAndBind(req)
    }

    return this.createAndExecute(req)
  }

  async openAndBind(
    req: EnqueuePromptRequest,
    onSessionReady?: (result: OnSessionReadyResult) => void,
  ): Promise<EnqueuePromptResult> {
    if (this.closed) return { ok: false, error: 'Session manager closed', reusedSession: false }
    if (req.binding.signal?.aborted) return { ok: false, error: 'Cancelled', reusedSession: false }

    const keyDigest = this.computeKeyDigest(req.key)
    const catalog = this.catalogPort
    const record = this.lookupCatalogRecord(keyDigest)

    if (!record || !catalog) {
      return this.createAndExecute(req)
    }

    if (record.state === 'stale') {
      throw new AcpSessionRuntimeError(
        'session_not_found',
        'The previous ACP context is unavailable. Reset the ACP context and retry.',
        true,
      )
    }

    const caps = record.capabilities
    const canResume = caps.resume
    const canLoad = caps.loadSession

    if (!canResume && !canLoad) {
      this.markCatalogStale(keyDigest, 'recovery_not_supported')
      throw new AcpSessionRuntimeError(
        'recovery_not_supported',
        'This agent cannot recover the previous ACP context. Reset the ACP context and retry.',
        true,
      )
    }

    const disposition: SessionDisposition = canResume ? 'resume' : 'load'
    try {
      return await this.openSessionForRecovery(
        req,
        disposition,
        record.agentSessionId,
        onSessionReady,
      )
    } catch (cause) {
      if (isAcpSessionRuntimeError(cause)) throw cause
      const reason =
        cause instanceof Error && /not found|unknown session|no such session/i.test(cause.message)
          ? 'session_not_found'
          : 'recovery_failed'
      this.markCatalogStale(keyDigest, reason)
      throw new AcpSessionRuntimeError(
        reason,
        reason === 'session_not_found'
          ? 'The previous ACP context no longer exists. Reset the ACP context and retry.'
          : 'The previous ACP context could not be recovered. Reset the ACP context and retry.',
        true,
        { cause },
      )
    }
  }

  private async openSessionForRecovery(
    req: EnqueuePromptRequest,
    disposition: SessionDisposition,
    agentSessionId: string,
    onSessionReady?: (result: OnSessionReadyResult) => void,
  ): Promise<EnqueuePromptResult> {
    const { key, config, kind, task, binding } = req
    let command: string
    let args: string[]
    let env: Record<string, string>
    let isolatedHome: string | undefined
    if (kind === 'opencode') {
      const prep = openCodeAcpPrepFromConfig(config)
      command = config.command
      args = config.args?.length ? [...config.args] : ['acp']
      env = prep.env as Record<string, string>
      isolatedHome = prep.isolatedHome
    } else {
      command = config.command
      args = [...config.args]
      env = workerSpawnEnv(config)
    }

    const proc = spawnDetachedAcpProcess({
      command,
      args,
      cwd: key.canonicalCwd,
      env,
      isolatedHome,
    })
    proc.stderr?.on('data', () => {
      // Always drain stderr so a verbose agent cannot block the ACP transport.
    })

    const keyStr = reuseKeyToString(key)
    const entry: LiveEntry = {
      key,
      state: 'starting',
      proc,
      driver: undefined!,
      agentSessionId: undefined!,
      capabilities: {},
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      generation: 1,
      summary: `w=${key.workerId} s=${key.routerSessionId.slice(0, 8)} gen=1 rec=${disposition}`,
      currentBinding: null,
      promptQueue: [],
      configOptions: [],
      sessionConfig: config,
      workerKind: kind,
      isolatedHome,
    }
    this.entries.set(keyStr, entry)

    proc.on('exit', () => {
      this.evictEntry(keyStr, entry)
    })
    proc.on('error', () => {
      this.evictEntry(keyStr, entry)
    })

    try {
      const driver = await AcpSessionDriver.fromChildProcess(
        key.canonicalCwd,
        Writable.toWeb(proc.stdin!) as WritableStream<Uint8Array>,
        Readable.toWeb(proc.stdout!) as ReadableStream<Uint8Array>,
      )
      entry.driver = driver
      this.assertEntryActive(keyStr, entry)

      await driver.initialize()
      this.assertEntryActive(keyStr, entry)
      const cap = driver.capabilities
      entry.capabilities = cap

      if (disposition === 'resume') {
        await driver.sessionResume(agentSessionId)
      } else {
        await driver.sessionLoad(agentSessionId)
      }
      this.assertEntryActive(keyStr, entry)

      entry.agentSessionId = agentSessionId
      entry.configOptions = [...driver.configOptions]
      await applyPinnedModelOrThrow(driver, config.model)
      this.assertEntryActive(keyStr, entry)

      try {
        this.catalogPort?.touch(this.computeKeyDigest(key), { recovered: true })
      } catch (cause) {
        throw new AcpSessionRuntimeError(
          'catalog_repair_required',
          'ACP session storage is unavailable. Repair the catalog before retrying.',
          false,
          { cause },
        )
      }

      entry.state = 'idle'
      entry.lastUsedAt = Date.now()
      this.activity('session_created', {
        summary: entry.summary,
        workerId: key.workerId,
        routerSessionId: key.routerSessionId,
        disposition,
      })

      try {
        onSessionReady?.({
          disposition,
          agentSessionId,
          capabilities: cap,
          configOptions: [...driver.configOptions],
        })
      } catch {
        this.activity('session_ready_observer_failed', {
          workerId: entry.key.workerId,
          code: 'session_ready_observer_failed',
        })
      }
      this.assertEntryActive(keyStr, entry)

      return this.executePrompt(
        entry,
        task,
        binding,
        true,
        disposition === 'resume' ? 'resumed' : 'loaded',
      )
    } catch (e) {
      this.failEntry(keyStr, entry, e instanceof Error ? e.message : String(e))
      throw e
    }
  }

  private async createAndExecute(req: EnqueuePromptRequest): Promise<EnqueuePromptResult> {
    const { key, config, kind, task, binding } = req
    let command: string
    let args: string[]
    let env: Record<string, string>
    let isolatedHome: string | undefined
    if (kind === 'opencode') {
      const prep = openCodeAcpPrepFromConfig(config)
      command = config.command
      args = config.args?.length ? [...config.args] : ['acp']
      env = prep.env as Record<string, string>
      isolatedHome = prep.isolatedHome
    } else {
      command = config.command
      args = [...config.args]
      env = workerSpawnEnv(config)
    }

    const proc = spawnDetachedAcpProcess({
      command,
      args,
      cwd: key.canonicalCwd,
      env,
      isolatedHome,
    })

    const stderrChunks: string[] = []
    proc.stderr?.on('data', (chunk: Buffer) => {
      const s = chunk.toString('utf8')
      if (stderrChunks.join('').length < STDERR_MAX_BYTES)
        stderrChunks.push(s.slice(0, STDERR_MAX_BYTES - stderrChunks.join('').length))
    })

    const keyStr = reuseKeyToString(key)
    const entry: LiveEntry = {
      key,
      state: 'starting',
      proc,
      driver: undefined!,
      agentSessionId: undefined!,
      capabilities: {},
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      generation: 1,
      summary: `w=${key.workerId} s=${key.routerSessionId.slice(0, 8)} gen=1`,
      currentBinding: null,
      promptQueue: [],
      configOptions: [],
      sessionConfig: config,
      workerKind: kind,
      isolatedHome,
    }
    this.entries.set(keyStr, entry)

    proc.on('exit', () => {
      this.evictEntry(keyStr, entry)
    })
    proc.on('error', () => {
      this.evictEntry(keyStr, entry)
    })

    let catalogCommitted = false
    try {
      const driver = await AcpSessionDriver.fromChildProcess(
        key.canonicalCwd,
        Writable.toWeb(proc.stdin!) as WritableStream<Uint8Array>,
        Readable.toWeb(proc.stdout!) as ReadableStream<Uint8Array>,
      )
      entry.driver = driver
      this.assertEntryActive(keyStr, entry)

      await driver.initialize()
      this.assertEntryActive(keyStr, entry)
      const cap = driver.capabilities
      entry.capabilities = cap

      const newResp = await driver.sessionNew()
      entry.agentSessionId = newResp.sessionId
      this.assertEntryActive(keyStr, entry)
      entry.configOptions = [...driver.configOptions]
      await applyPinnedModelOrThrow(driver, config.model)
      this.assertEntryActive(keyStr, entry)

      try {
        this.catalogPort?.upsert({
          version: 1,
          keyDigest: this.computeKeyDigest(key),
          routerSessionId: key.routerSessionId,
          workerId: key.workerId,
          teamMemberId: key.teamMemberId,
          teamMemberRevision: key.teamMemberRevision,
          installationId: config.installationId,
          manifestDigest: config.manifestDigest,
          canonicalCwd: key.canonicalCwd,
          executionFingerprint: key.executionFingerprint,
          agentSessionId: newResp.sessionId,
          capabilities: {
            loadSession: driver.hasCapability('load'),
            resume: driver.hasCapability('resume'),
            close: driver.hasCapability('close'),
            delete: driver.hasCapability('delete'),
          },
          state: 'ready',
          createdAt: new Date().toISOString(),
          lastUsedAt: new Date().toISOString(),
        })
        catalogCommitted = Boolean(this.catalogPort)
      } catch (cause) {
        throw new AcpSessionRuntimeError(
          'catalog_repair_required',
          'ACP session storage is unavailable. Repair the catalog before retrying.',
          false,
          { cause },
        )
      }

      entry.state = 'idle'
      entry.lastUsedAt = Date.now()
      this.activity('session_created', {
        summary: entry.summary,
        workerId: key.workerId,
        routerSessionId: key.routerSessionId,
      })
      this.assertEntryActive(keyStr, entry)

      return this.executePrompt(entry, task, binding, false, 'new')
    } catch (e) {
      if (!catalogCommitted) await this.discardUncommittedSession(entry)
      this.failEntry(keyStr, entry, e instanceof Error ? e.message : String(e))
      throw e
    }
  }

  private async discardUncommittedSession(entry: LiveEntry): Promise<void> {
    if (!entry.driver || !entry.agentSessionId) return

    let timeout: ReturnType<typeof setTimeout> | undefined
    // Start cleanup inside a promise turn so a non-conforming driver that throws
    // synchronously cannot replace the original catalog/session setup failure.
    const operation = Promise.resolve().then(() =>
      entry.driver.hasCapability('delete')
        ? entry.driver.deleteSession(entry.agentSessionId)
        : entry.driver.hasCapability('close')
          ? entry.driver.closeSession(entry.agentSessionId)
          : undefined,
    )
    const deadline = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(
        () => reject(new Error('uncommitted_session_cleanup_timeout')),
        UNCOMMITTED_SESSION_CLEANUP_TIMEOUT_MS,
      )
      timeout.unref?.()
    })

    try {
      await Promise.race([operation, deadline])
    } catch {
      this.activity('uncommitted_session_cleanup_failed', {
        workerId: entry.key.workerId,
        code: 'uncommitted_session_cleanup_failed',
      })
    } finally {
      if (timeout) clearTimeout(timeout)
    }
  }

  private async executePrompt(
    entry: LiveEntry,
    task: string,
    binding: PromptBinding,
    reusedSession: boolean,
    sessionDisposition?: string,
    alreadyClaimed = false,
  ): Promise<EnqueuePromptResult> {
    const keyStr = reuseKeyToString(entry.key)
    // Claim must happen before any await so two concurrent reuses cannot both run
    if (!alreadyClaimed) {
      if (!this.tryClaimEntry(entry, binding)) {
        // Race lost — never double-execute; queue for FIFO
        return this.queuePrompt(entry, {
          key: entry.key,
          config: entry.sessionConfig ?? { command: '', args: [], env: {} },
          kind: entry.workerKind ?? 'codex',
          task,
          binding,
        })
      }
    } else if (entry.currentBinding !== binding || entry.state !== 'validating') {
      // Claim lost between caller and here
      return this.queuePrompt(entry, {
        key: entry.key,
        config: entry.sessionConfig ?? { command: '', args: [], env: {} },
        kind: entry.workerKind ?? 'codex',
        task,
        binding,
      })
    }

    // Live reuse: re-check pin with live auth/disabled evidence (files may have changed)
    if (reusedSession && entry.sessionConfig?.model) {
      try {
        const { evaluateModelEligibility, buildCurrentEligibilityEvidence } =
          await import('./model-eligibility.js')
        const { OPENCODE_ZEN_FREE_MODELS } = await import('./opencode-acp-env.js')
        const { readAuthProviderIds, readDisabledProviders } = await import('./opencode-models.js')
        const cfg = entry.sessionConfig
        const candidates = cfg.availableModels ?? []
        const home = cfg.env?.HOME || process.env.HOME || process.env.USERPROFILE || ''
        const isOc = entry.workerKind === 'opencode'
        const providers = buildCurrentEligibilityEvidence({
          modelIds: candidates.map((m) => m.modelId).concat(cfg.model ? [cfg.model] : []),
          env: buildEffectiveWorkerEnv({
            ambientEnv: process.env,
            workerEnv: cfg.env,
            workerSecrets: cfg.workerSecrets,
            model: cfg.model,
          }),
          zenFreeAllowlist: [...OPENCODE_ZEN_FREE_MODELS],
          catalogProviders: cfg.providers,
          authProviders:
            isOc && home
              ? readAuthProviderIds(home, { xdgDataHome: cfg.env?.XDG_DATA_HOME })
              : undefined,
          disabledProviders:
            isOc && home
              ? [...readDisabledProviders(home, { xdgConfigHome: cfg.env?.XDG_CONFIG_HOME })]
              : undefined,
        })
        const pinModel = cfg.model?.trim() ?? ''
        if (pinModel) {
          const er = evaluateModelEligibility({
            modelId: pinModel,
            candidates,
            providers,
            zenFreeAllowlist: [...OPENCODE_ZEN_FREE_MODELS],
            purpose: 'execute',
          })
          if (!er.eligible) {
            this.releaseClaim(entry, binding)
            this.evictEntry(keyStr, entry)
            return {
              ok: false,
              error: er.errorCode ?? 'MODEL_PROVIDER_UNAVAILABLE',
              reusedSession: true,
            }
          }
        }
      } catch {
        // Fail closed: eligibility path must not silently continue with unknown pin state
        this.releaseClaim(entry, binding)
        this.evictEntry(keyStr, entry)
        this.activity('model_eligibility_check_failed', {
          workerId: entry.key.workerId,
          code: 'model_eligibility_check_failed',
        })
        return {
          ok: false,
          error: 'MODEL_ELIGIBILITY_CHECK_FAILED',
          reusedSession: true,
        }
      }
    }
    try {
      binding.onSessionReady?.(sessionDisposition ?? 'new')
    } catch {
      // This is an observer callback. A renderer/store notification failure
      // must not strand a claimed ACP session or stop the agent task.
      this.activity('session_ready_observer_failed', {
        workerId: entry.key.workerId,
        code: 'session_ready_observer_failed',
      })
    }
    entry.state = 'running'
    entry.currentBinding = binding
    entry.lastUsedAt = Date.now()
    let onAbort: (() => void) | undefined
    let abortEvictionTimer: ReturnType<typeof setTimeout> | undefined
    let resolveAbortResult: ((result: PromptResult) => void) | undefined
    const abortResult = new Promise<PromptResult>((resolve) => {
      resolveAbortResult = resolve
    })
    try {
      if (binding.signal?.aborted) {
        entry.currentBinding = null
        this.evictEntry(keyStr, entry)
        return { ok: false, error: 'Cancelled', reusedSession, sessionDisposition }
      }
      if (binding.signal) {
        onAbort = () => {
          try {
            entry.driver?.cancel().catch(() => {})
          } catch {}
          abortEvictionTimer = setTimeout(() => {
            if (entry.currentBinding === binding) {
              entry.currentBinding = null
              if (this.entries.get(keyStr) === entry) this.evictEntry(keyStr, entry)
              else this.closeEntry(entry)
              resolveAbortResult?.({
                ok: false,
                output: entry.driver?.partialOutput ?? '',
                stopReason: 'cancelled',
                error: 'Cancelled',
              })
            }
          }, this.cancelGraceMs)
          abortEvictionTimer.unref?.()
        }
        binding.signal.addEventListener('abort', onAbort, { once: true })
        if (binding.signal.aborted) {
          binding.signal.removeEventListener('abort', onAbort)
          entry.currentBinding = null
          this.evictEntry(keyStr, entry)
          return { ok: false, error: 'Cancelled', reusedSession, sessionDisposition }
        }
      }

      const promptResult = entry.driver.prompt(task, binding)
      const result: PromptResult = binding.signal
        ? await Promise.race([promptResult, abortResult])
        : await promptResult

      if (onAbort && binding.signal) binding.signal.removeEventListener('abort', onAbort)
      if (abortEvictionTimer) clearTimeout(abortEvictionTimer)

      // Cancellation makes remote state uncertain even when a non-conforming
      // agent races back with a successful prompt response. Do not reuse it.
      if (binding.signal?.aborted) {
        entry.currentBinding = null
        this.evictEntry(keyStr, entry)
        return {
          ok: false,
          output: result.output,
          stopReason: 'cancelled',
          error: 'Cancelled',
          modelUsed: undefined,
          reusedSession,
          sessionDisposition,
        }
      }

      if (result.stopReason === 'cancelled') {
        entry.currentBinding = null
        this.evictEntry(keyStr, entry)
        return {
          ok: false,
          output: result.output,
          stopReason: result.stopReason,
          error: 'Cancelled',
          modelUsed: undefined,
          reusedSession,
          sessionDisposition,
        }
      }

      entry.currentBinding = null
      const publicError = result.ok
        ? undefined
        : result.stopReason
          ? `ACP agent stopped before completing the task (${result.stopReason}).`
          : 'ACP agent failed while processing the task.'
      if (!result.ok && !result.stopReason) {
        // A request/transport failure has no protocol stop reason. Do not put
        // this connection back into the reusable pool; keep the durable
        // catalog mapping so the next dispatch can recover it normally.
        this.evictEntry(keyStr, entry)
        return {
          ok: false,
          output: result.output,
          error: publicError,
          modelUsed: undefined,
          reusedSession,
          sessionDisposition,
        }
      }
      if (entry._closing) {
        this.evictEntry(keyStr, entry)
        return {
          ok: result.ok,
          output: result.output,
          stopReason: result.stopReason,
          error: publicError,
          modelUsed: undefined,
          reusedSession,
          sessionDisposition,
        }
      }
      entry.state = 'idle'
      entry.lastUsedAt = Date.now()
      if (result.ok && this.catalogPort) {
        try {
          this.catalogPort.touch(this.computeKeyDigest(entry.key))
        } catch (cause) {
          throw new AcpSessionRuntimeError(
            'catalog_repair_required',
            'ACP session storage is unavailable. Repair the catalog before retrying.',
            false,
            { cause },
          )
        }
      }
      this.drainQueue(entry)
      if (!this.reuseEnabled && entry.state === 'idle') this.evictEntry(keyStr, entry)
      return {
        ok: result.ok,
        output: result.output,
        stopReason: result.stopReason,
        error: publicError,
        modelUsed: undefined,
        reusedSession,
        sessionDisposition,
      }
    } catch (e) {
      if (onAbort && binding.signal) binding.signal.removeEventListener('abort', onAbort)
      if (abortEvictionTimer) clearTimeout(abortEvictionTimer)
      entry.currentBinding = null
      entry.state = 'broken'
      this.evictEntry(keyStr, entry)
      if (isAcpSessionRuntimeError(e)) throw e
      return {
        ok: false,
        error: 'ACP agent failed while processing the task.',
        reusedSession,
        sessionDisposition,
      }
    }
  }

  private drainQueue(entry: LiveEntry): void {
    // Only one prompt may leave the queue at a time; claim before yielding to async
    while (entry.promptQueue.length > 0) {
      if (this.isBusy(entry) && entry.state !== 'idle') return
      if (entry.state !== 'idle' || entry.currentBinding) return
      const next = entry.promptQueue.shift()
      if (!next) return
      next.abortCleanup?.()
      if (!this.tryClaimEntry(entry, next.binding)) {
        // Lost race — put back at front and stop
        entry.promptQueue.unshift(next)
        return
      }
      void this.executePrompt(entry, next.task, next.binding, true, 'live_reused', true).then(
        next.resolve,
        next.reject,
      )
      return
    }
  }

  closeLiveByRouterSession(routerSessionId: string): void {
    const toClose: LiveEntry[] = []
    for (const [k, e] of this.entries) {
      if (e.key.routerSessionId === routerSessionId) {
        toClose.push(e)
        this.entries.delete(k)
      }
    }
    for (const e of toClose) {
      this.rejectQueued(e, new Error('ACP session closed by router session'))
      this.closeEntry(e)
    }
  }

  closeLiveByReuseKey(key: SessionReuseKey): void {
    const keyStr = reuseKeyToString(key)
    const entry = this.entries.get(keyStr)
    if (!entry) return
    this.entries.delete(keyStr)
    this.rejectQueued(entry, new Error('ACP session closed by router session'))
    this.closeEntry(entry)
  }

  /** Opaque digest for a reuse key (persist on Job; never re-derive for reset). */
  digestReuseKey(key: SessionReuseKey): string {
    return this.computeKeyDigest(key)
  }

  /**
   * Reset context by opaque digest from Job.reuseKeyDigest.
   * Prefer this over rebuild-from-current-config so auth/kind drift cannot miss the entry.
   */
  deleteContextByDigest(keyDigest: string): { deleted: boolean } {
    if (!keyDigest?.trim()) return { deleted: false }
    let foundLive = false
    for (const [k, entry] of this.entries) {
      if (this.computeKeyDigest(entry.key) === keyDigest) {
        foundLive = true
        this.entries.delete(k)
        this.rejectQueued(entry, new Error('ACP session reset by digest'))
        this.closeEntry(entry)
      }
    }
    if (!this.reuseEnabled) {
      return { deleted: foundLive }
    }
    // Fail closed when a catalog port is configured but unavailable (closed/corrupt)
    if (this.catalogPort && !this.catalogIsAvailable()) {
      throw this.catalogStorageFailure()
    }
    if (this.catalogRequired && !this.catalogPort) {
      throw this.catalogStorageFailure()
    }
    let records: AcpSessionCatalogRecord[] = []
    let catalogDeleted = false
    if (this.catalogIsAvailable()) {
      records = this.readCatalogRecords(() => {
        const record = this.catalogPort!.lookup(keyDigest)
        return record ? [record] : []
      })
      catalogDeleted = records.length > 0
      this.commitCatalogDelete(() => this.catalogPort!.deleteByKey(keyDigest))
      this.launchRemoteCleanup(records)
    }
    return { deleted: foundLive || catalogDeleted }
  }

  /** Reset every live/durable ACP context for one Chat-scoped role only. */
  deleteContextsByTeamMember(routerSessionId: string, teamMemberId: string): { deleted: number } {
    const digests = new Set<string>()
    for (const entry of this.entries.values()) {
      if (
        entry.key.routerSessionId === routerSessionId &&
        entry.key.teamMemberId === teamMemberId
      ) {
        digests.add(this.computeKeyDigest(entry.key))
      }
    }
    if (this.reuseEnabled && this.catalogIsAvailable()) {
      const records = this.readCatalogRecords(() =>
        this.catalogPort!.listByRouterSession(routerSessionId),
      )
      for (const record of records) {
        if (record.teamMemberId === teamMemberId) digests.add(record.keyDigest)
      }
    }

    let deleted = 0
    for (const digest of digests) {
      if (this.deleteContextByDigest(digest).deleted) deleted += 1
    }
    return { deleted }
  }

  /** Reset exactly one durable ACP context and hand its remote session to cleanup. */
  deleteContextByReuseKey(key: SessionReuseKey): void {
    if (!this.reuseEnabled) {
      this.closeLiveByReuseKey(key)
      return
    }
    const keyDigest = this.computeKeyDigest(key)
    this.deleteContextByDigest(keyDigest)
  }

  deleteContextByRouterSession(routerSessionId: string): void {
    if (!this.reuseEnabled) {
      this.closeLiveByRouterSession(routerSessionId)
      this.sessionToProject.delete(routerSessionId)
      return
    }

    let records: AcpSessionCatalogRecord[] = []
    let captureFailure: unknown
    try {
      records = this.readCatalogRecords(() =>
        this.catalogPort!.listByRouterSession(routerSessionId),
      )
    } catch (cause) {
      captureFailure = cause
    }
    this.closeLiveByRouterSession(routerSessionId)
    if (captureFailure) throw captureFailure
    this.commitCatalogDelete(() => this.catalogPort!.deleteByRouterSession(routerSessionId))
    this.launchRemoteCleanup(records)
    this.sessionToProject.delete(routerSessionId)
  }

  /** Delete several Router Session mappings with one durable catalog commit. */
  deleteContextsByRouterSessions(routerSessionIds: string[]): void {
    const sessionIds = [...new Set(routerSessionIds.filter(Boolean))]
    if (sessionIds.length === 0) return

    if (!this.reuseEnabled) {
      for (const sessionId of sessionIds) {
        this.closeLiveByRouterSession(sessionId)
        this.sessionToProject.delete(sessionId)
      }
      return
    }

    let records: AcpSessionCatalogRecord[] = []
    let captureFailure: unknown
    try {
      records = this.readCatalogRecords(() =>
        sessionIds.flatMap((sessionId) => this.catalogPort!.listByRouterSession(sessionId)),
      )
    } catch (cause) {
      captureFailure = cause
    }

    for (const sessionId of sessionIds) this.closeLiveByRouterSession(sessionId)
    if (captureFailure) throw captureFailure
    this.commitCatalogDelete(() => this.catalogPort!.deleteByRouterSessions(sessionIds))
    this.launchRemoteCleanup(records)
    for (const sessionId of sessionIds) this.sessionToProject.delete(sessionId)
  }

  deleteContextByWorker(workerId: string): void {
    let records: AcpSessionCatalogRecord[] = []
    let captureFailure: unknown
    const hasDurableCatalog = Boolean(this.catalogPort || this.catalogRequired)
    if (hasDurableCatalog) {
      try {
        records = this.readCatalogRecords(() => this.catalogPort!.listByWorker(workerId))
      } catch (cause) {
        captureFailure = cause
      }
    }
    const toClose: LiveEntry[] = []
    for (const [k, e] of this.entries) {
      if (e.key.workerId === workerId) {
        toClose.push(e)
        this.entries.delete(k)
      }
    }
    for (const e of toClose) {
      this.rejectQueued(e, new Error('ACP session evicted by worker delete'))
      this.closeEntry(e)
    }
    if (!hasDurableCatalog) return
    if (captureFailure) throw captureFailure
    this.commitCatalogDelete(() => this.catalogPort!.deleteByWorker(workerId))
    this.launchRemoteCleanup(records)
  }

  deleteContextByProject(projectId: string): void {
    const sessionIds = new Set<string>()
    for (const [routerSessionId, mappedProjectId] of this.sessionToProject) {
      if (mappedProjectId === projectId) sessionIds.add(routerSessionId)
    }
    this.deleteContextsByRouterSessions([...sessionIds])
  }

  /**
   * Snapshot installation references across live entries and the durable catalog.
   * Legacy catalog rows predate installationId; callers can resolve their workerId
   * against the current Worker Store. Catalog ambiguity fails closed.
   */
  listInstallationReferences(): {
    installationIds: string[]
    legacyWorkerIds: string[]
  } {
    const installationIds = new Set<string>()
    const legacyWorkerIds = new Set<string>()
    for (const entry of this.entries.values()) {
      const config = entry.sessionConfig
      if (config?.installationId) {
        installationIds.add(config.installationId)
      } else {
        legacyWorkerIds.add(entry.key.workerId)
      }
    }

    if (this.catalogPort || this.catalogRequired) {
      if (!this.catalogPort?.listAll) throw this.catalogStorageFailure()
      const records = this.readCatalogRecords(() => {
        return this.catalogPort!.listAll!()
      })
      for (const record of records) {
        if (record.installationId) installationIds.add(record.installationId)
        else legacyWorkerIds.add(record.workerId)
      }
    }

    return {
      installationIds: [...installationIds].sort(),
      legacyWorkerIds: [...legacyWorkerIds].sort(),
    }
  }

  private readCatalogRecords(read: () => AcpSessionCatalogRecord[]): AcpSessionCatalogRecord[] {
    if (!this.catalogPort) {
      if (this.catalogRequired) {
        throw new AcpSessionRuntimeError(
          'acp_runtime_not_configured',
          'ACP runtime is unavailable. Restart the application and retry.',
          false,
        )
      }
      return []
    }
    if (!this.catalogIsAvailable()) {
      throw this.catalogStorageFailure()
    }
    try {
      return read()
    } catch (cause) {
      throw this.catalogStorageFailure(cause)
    }
  }

  private commitCatalogDelete(remove: () => void): void {
    if (!this.catalogPort) {
      if (this.catalogRequired) {
        throw new AcpSessionRuntimeError(
          'acp_runtime_not_configured',
          'ACP runtime is unavailable. Restart the application and retry.',
          false,
        )
      }
      return
    }
    if (!this.catalogIsAvailable()) throw this.catalogStorageFailure()
    try {
      remove()
    } catch (cause) {
      throw this.catalogStorageFailure(cause)
    }
  }

  private catalogStorageFailure(cause?: unknown): AcpSessionRuntimeError {
    return new AcpSessionRuntimeError(
      'catalog_repair_required',
      'ACP session storage is unavailable. Repair the catalog before retrying.',
      false,
      cause === undefined ? undefined : { cause },
    )
  }

  private catalogIsAvailable(): boolean {
    if (!this.catalogPort) return false
    try {
      return this.catalogPort.isAvailable()
    } catch (cause) {
      throw this.catalogStorageFailure(cause)
    }
  }

  private lookupCatalogRecord(keyDigest: string): AcpSessionCatalogRecord | undefined {
    if (!this.catalogPort) return undefined
    if (!this.catalogIsAvailable()) throw this.catalogStorageFailure()
    try {
      return this.catalogPort.lookup(keyDigest)
    } catch (cause) {
      throw this.catalogStorageFailure(cause)
    }
  }

  private markCatalogStale(keyDigest: string, reason: string): void {
    if (!this.catalogPort || !this.catalogIsAvailable()) {
      throw this.catalogStorageFailure()
    }
    try {
      this.catalogPort.markStale(keyDigest, reason)
    } catch (cause) {
      throw this.catalogStorageFailure(cause)
    }
  }

  private launchRemoteCleanup(records: AcpSessionCatalogRecord[]): void {
    if (!this.remoteCleanup) return
    for (const record of records) {
      try {
        const pending = this.remoteCleanup(record)
        void Promise.resolve(pending).catch(() => {
          this.activity('remote_cleanup_failed', {
            workerId: record.workerId,
            code: 'remote_cleanup_failed',
          })
        })
      } catch {
        this.activity('remote_cleanup_failed', {
          workerId: record.workerId,
          code: 'remote_cleanup_failed',
        })
      }
    }
  }

  closeByProject(projectId: string): void {
    const toClose: LiveEntry[] = []
    for (const [k, e] of this.entries) {
      if (this.sessionToProject.get(e.key.routerSessionId) === projectId) {
        toClose.push(e)
        this.entries.delete(k)
      }
    }
    for (const e of toClose) {
      this.rejectQueued(e, new Error('Project closed'))
      this.closeEntry(e)
    }
  }

  invalidateWorker(workerId: string): void {
    for (const [k, e] of this.entries) {
      if (e.key.workerId === workerId) {
        this.activity('session_invalidated', {
          summary: e.summary,
          workerId: e.key.workerId,
          routerSessionId: e.key.routerSessionId,
          state: e.state,
        })
        if (e.state === 'idle') {
          this.entries.delete(k)
          this.closeEntry(e)
        } else {
          e._closing = true
          e.state = 'closing'
        }
      }
    }
  }

  async closeAll(): Promise<void> {
    this.closed = true
    if (this.idleTimer) {
      clearInterval(this.idleTimer)
      this.idleTimer = null
    }
    let needsGracePeriod = false
    for (const e of this.entries.values()) {
      if (e.currentBinding) {
        needsGracePeriod = true
        try {
          e.driver?.cancel().catch(() => {})
        } catch {}
      }
    }
    if (needsGracePeriod) await new Promise((r) => setTimeout(r, 2000))
    const all = [...this.entries.values()]
    this.entries.clear()
    for (const e of all) {
      this.rejectQueued(e, new Error('ACP session manager closed'))
      this.closeEntry(e)
    }
  }

  getDebugInfo() {
    const byState: Record<string, number> = {}
    let entries = 0
    for (const e of this.entries.values()) {
      entries++
      byState[e.state] = (byState[e.state] ?? 0) + 1
    }
    return { entries, entriesByState: byState }
  }

  private evictEntry(keyStr: string, entry: LiveEntry): void {
    if (this.entries.get(keyStr) !== entry) {
      this.closeEntry(entry)
      return
    }
    this.entries.delete(keyStr)
    this.activity('session_evicted', {
      summary: entry.summary,
      workerId: entry.key.workerId,
      routerSessionId: entry.key.routerSessionId,
      state: entry.state,
    })
    this.rejectQueued(entry, new Error('ACP session evicted'))
    this.closeEntry(entry)
  }

  private failEntry(keyStr: string, entry: LiveEntry, reason: string): void {
    if (this.entries.get(keyStr) === entry) this.entries.delete(keyStr)
    if (!entry._closeApplied) entry.state = 'broken'
    this.activity('session_broken', {
      summary: entry.summary,
      workerId: entry.key.workerId,
      routerSessionId: entry.key.routerSessionId,
      reason,
    })
    this.rejectQueued(entry, new Error(`ACP session ${reason}`))
    this.closeEntry(entry)
  }

  private closeEntry(entry: LiveEntry): void {
    if (entry._closeApplied) {
      // The transport may be assigned after a concurrent close won startup.
      try {
        entry.driver?.close()
      } catch {}
      entry.state = 'closed'
      return
    }
    entry._closeApplied = true
    entry._closing = true
    const previousState = entry.state
    entry.state = 'closing'
    this.activity('session_closed', {
      summary: entry.summary,
      workerId: entry.key.workerId,
      routerSessionId: entry.key.routerSessionId,
      state: previousState,
    })
    try {
      entry.driver?.close()
    } catch {}
    if (entry.isolatedHome) {
      try {
        rmSync(entry.isolatedHome, { recursive: true, force: true })
      } catch {}
    }
    if (entry.proc) {
      if (entry.proc.exitCode === null && entry.proc.signalCode === null) {
        try {
          killProcessGroup(entry.proc, 'SIGTERM')
        } catch {}
      }
      if (!entry._sigkillScheduled) {
        entry._sigkillScheduled = true
        const killTimer = setTimeout(() => {
          // Detached grandchildren may survive after the direct child exits.
          try {
            if (entry.proc) killProcessGroup(entry.proc, 'SIGKILL')
          } catch {}
        }, 2000)
        killTimer.unref?.()
      }
    }
    entry.state = 'closed'
  }

  private evictLRU(): void {
    let oldest: [string, LiveEntry] | null = null
    for (const [k, e] of this.entries) {
      if (e.state !== 'idle') continue
      if (!oldest || e.lastUsedAt < oldest[1].lastUsedAt) oldest = [k, e]
    }
    if (oldest) {
      this.entries.delete(oldest[0])
      this.closeEntry(oldest[1])
    }
  }

  private reapIdle(): void {
    const cutoff = Date.now() - this.idleTimeoutMs
    const toClose: Array<[string, LiveEntry]> = []
    for (const [k, e] of this.entries) {
      if (e.state === 'idle' && e.lastUsedAt < cutoff) toClose.push([k, e])
    }
    for (const [k, e] of toClose) {
      this.entries.delete(k)
      this.closeEntry(e)
    }
  }
}

let _singleton: AcpSessionManager | null = null

export function getAcpSessionManager(cfg?: AcpSessionManagerConfig): AcpSessionManager {
  if (!_singleton) _singleton = new AcpSessionManager(cfg)
  else if (cfg) _singleton.assertCompatibleConfig(cfg)
  return _singleton
}

export function resetAcpSessionManager(): void {
  if (_singleton) {
    _singleton.closeAll().catch(() => {})
    _singleton = null
  }
}
