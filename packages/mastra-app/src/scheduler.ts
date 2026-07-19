/**
 * Worker job scheduler: queue, concurrency slots, ACP execution, cancel.
 * @see plan — Worker 调度能力
 */
import {
  acpHealthFromJobOutcome,
  applyHealthReport,
  buildCurrentEligibilityEvidence,
  buildEffectiveWorkerEnv,
  defaultCanRunAcp,
  evaluateModelEligibility,
  formatWorkerModelError,
  getAcpSessionManager,
  isAcpSessionRuntimeError,
  listWorkersForRole,
  OPENCODE_ZEN_FREE_MODELS,
  probeWorkerHealth,
  readAuthProviderIds,
  readDisabledProviders,
  resolveEligibilityCandidates,
  selectWorkerByRole,
  type AcpSpawnConfig,
  type SessionEntryConfig,
} from '@swarmdesk-agent/adapters'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import {
  createId,
  getSharedStore,
  getWorkerModelCatalogStore,
  globalActivityLog,
  mapAcpPermissionToEnqueue,
  globalApprovalWaiters,
  decidePermission,
  loadWorkerSecretsSnapshotForSpawn,
  type AcpToolKind,
  type ApprovalWaitOutcome,
} from '@swarmdesk-agent/core'
import {
  isHealthReportFresh,
  isJobOpen,
  projectLegacyHealth,
  shouldSkipWorkerDispatch,
  type ApprovalItem,
  type ApprovalLocation,
  type JobSource,
  type JobStatus,
  type SessionApprovalPolicy,
  type WorkerJob,
  type WorkerRegistration,
  type WorkerRole,
  type WorkerRunEvent,
} from '@swarmdesk-agent/shared'
import {
  emitWorkerEvent,
  getWorkerEventEmitter,
  MAX_TIMER_DELAY_MS,
  resolveWorkerJobTimeoutMs,
} from './worker-events.js'
import { getWorkerCatalogForDispatch } from './worker-models.js'

function store() {
  return getSharedStore()
}

export interface PublicAcpFailure {
  error: string
  errorCode?: string
  recoveryError?: string
  canResetAcpContext?: boolean
}

export function toPublicAcpFailure(error: unknown): PublicAcpFailure {
  if (!isAcpSessionRuntimeError(error)) {
    return { error: 'ACP agent failed while processing the task.' }
  }
  const isRecovery =
    error.code === 'recovery_not_supported' ||
    error.code === 'session_not_found' ||
    error.code === 'recovery_failed'
  return {
    error: error.publicMessage,
    errorCode: error.code,
    ...(isRecovery
      ? {
          recoveryError: error.publicMessage,
          canResetAcpContext: error.canResetAcpContext,
        }
      : {}),
  }
}

/** Update worker acpHealth from a finished ACP job; preserves pin via worker spread. */
export function updateWorkerAcpHealthFromJob(
  workerId: string,
  status: 'succeeded' | 'failed',
  opts?: { error?: string; errorCode?: string },
): void {
  try {
    const current = store()
      .listWorkers()
      .find((w) => w.id === workerId)
    if (!current) return
    const acpHealth = acpHealthFromJobOutcome(status, {
      error: opts?.error,
      errorCode: opts?.errorCode,
      lastSuccessAt: current.acpHealth?.lastSuccessAt,
    })
    store().upsertWorker(
      projectLegacyHealth({
        ...current,
        acpHealth,
        lastSeenAt: acpHealth.checkedAt,
      }),
    )
  } catch {
    /* ignore health update failures */
  }
}

export function finalizeApprovalTimeout(input: {
  tryResolve: () => { resolved: boolean; item: ApprovalItem }
  abort: () => void
  emitApprovalResolved: (item: ApprovalItem) => void
  isJobOpen: () => boolean
  emitFailed: () => void
  finishFailed: () => void
}): { outcome: 'selected'; optionId: string } | { outcome: 'cancelled' } {
  const resolution = input.tryResolve()
  if (!resolution.resolved) {
    if (
      (resolution.item.status === 'allowed' || resolution.item.status === 'denied') &&
      resolution.item.selectedOptionId
    ) {
      return { outcome: 'selected', optionId: resolution.item.selectedOptionId }
    }
    return { outcome: 'cancelled' }
  }

  input.abort()
  input.emitApprovalResolved(resolution.item)
  if (input.isJobOpen()) {
    input.finishFailed()
    input.emitFailed()
  }
  return { outcome: 'cancelled' }
}

export interface ScheduleRequest {
  task: string
  role?: WorkerRole
  workerIdOrKind?: string
  cwd?: string
  sessionId?: string
  projectId?: string
  threadId?: string
  source?: JobSource
  /** If true, resolve when job finishes (sync). Default false = async. */
  wait?: boolean
  preferHealthy?: boolean
  /** Event callback registered before tick so started/delta are never missed. */
  onEvent?: (event: WorkerRunEvent) => void
}

export interface ScheduleResult {
  job: WorkerJob
  /** Present when wait=true or job finished before return */
  output?: string
}

type RuntimeEntry = {
  abort: AbortController
  config?: AcpSpawnConfig
  timeout?: ReturnType<typeof setTimeout>
}

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name])
  return Number.isFinite(n) && n > 0 ? Math.max(1, Math.floor(n)) : fallback
}

/** Non-secret Registry/session reuse boundary derived from the selected Worker. */
export function buildWorkerSessionBoundary(
  worker: WorkerRegistration,
  eligibilityRevision: string,
  workerSecretRevisionHmac?: string,
): Pick<
  SessionEntryConfig,
  | 'workerKind'
  | 'eligibilityRevision'
  | 'installationId'
  | 'manifestDigest'
  | 'runtimeProfile'
  | 'authRevision'
  | 'workerSecretRevisionHmac'
> {
  const registrySource = worker.source?.type === 'registry' ? worker.source : undefined
  return {
    workerKind: worker.kind,
    eligibilityRevision,
    ...(worker.installationId || registrySource?.installationId
      ? { installationId: worker.installationId ?? registrySource?.installationId }
      : {}),
    ...(registrySource?.manifestDigest ? { manifestDigest: registrySource.manifestDigest } : {}),
    ...(worker.runtimeProfile ? { runtimeProfile: worker.runtimeProfile } : {}),
    ...(worker.authRevision !== undefined ? { authRevision: worker.authRevision } : {}),
    ...(workerSecretRevisionHmac ? { workerSecretRevisionHmac } : {}),
  }
}

function attachWorkerSecretsForSpawn(
  config: SessionEntryConfig,
  secrets: Readonly<Record<string, string>>,
): SessionEntryConfig {
  Object.defineProperty(config, 'workerSecrets', {
    value: Object.freeze({ ...secrets }),
    enumerable: false,
    configurable: false,
    writable: false,
  })
  return config
}

export function resolveApprovalTimeoutMs(raw = process.env.APPROVAL_TIMEOUT_MS): number {
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return 120_000
  return Math.min(Math.floor(parsed), MAX_TIMER_DELAY_MS)
}

interface ApprovalWaiterPort {
  register(approvalId: string): Promise<ApprovalWaitOutcome>
  cancel(approvalId: string, reason?: string): boolean
}

/** Reserve the waiter before publishing a pending approval to close the resolve race. */
export function persistApprovalWithReservedWaiter<T>(input: {
  approvalId: string
  waiters: ApprovalWaiterPort
  persist: () => T
}): { item: T; waiterPromise: Promise<ApprovalWaitOutcome> } {
  const waiterPromise = input.waiters.register(input.approvalId)
  try {
    return { item: input.persist(), waiterPromise }
  } catch (error) {
    // Attach the rejection handler before cancel() rejects synchronously.
    void waiterPromise.catch(() => {})
    input.waiters.cancel(input.approvalId, 'Approval persistence failed')
    throw error
  }
}

export function capacityRetryDelay(
  error: string | undefined,
  raw = process.env.ACP_SESSION_RETRY_MS,
): number | null {
  if (error !== 'capacity_exhausted') return null
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return 250
  return Math.min(Math.max(1, Math.floor(parsed)), MAX_TIMER_DELAY_MS)
}

const ACP_TOOL_KIND_MAP: Record<string, AcpToolKind> = {
  read: 'read',
  search: 'search',
  grep: 'search',
  glob: 'search',
  think: 'think',
  delete: 'delete',
  remove: 'delete',
  edit: 'edit',
  write: 'edit',
  patch: 'edit',
  move: 'move',
  rename: 'move',
  execute: 'execute',
  bash: 'execute',
  exec: 'execute',
  run: 'execute',
  fetch: 'fetch',
  web: 'fetch',
  http: 'fetch',
  switch_mode: 'switch_mode',
}

function resolveAcpToolKind(kind: string | undefined): AcpToolKind {
  if (!kind) return 'other'
  const lower = kind.toLowerCase().trim()
  return ACP_TOOL_KIND_MAP[lower] ?? 'other'
}

function normalizePolicyForEngine(raw: string | undefined): SessionApprovalPolicy {
  if (!raw) return 'manual'
  const valid = new Set<string>([
    'manual',
    'allow_once',
    'allow_always',
    'reject_once',
    'reject_always',
  ])
  if (valid.has(raw)) return raw as SessionApprovalPolicy
  return 'manual' // unknown → safe default (manual requires human approval)
}

export class WorkerScheduler {
  private maxGlobal = envInt('WORKER_MAX_GLOBAL', 2)
  private maxPerWorker = envInt('WORKER_MAX_PER_WORKER', 1)
  private maxPerSession = envInt('WORKER_MAX_PER_SESSION', 2)
  private jobTimeoutMs = resolveWorkerJobTimeoutMs()
  private runtime = new Map<string, RuntimeEntry>()
  private capacityRetryTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private ticking = false
  private lifecycle: 'accepting' | 'shutting_down' | 'closed' = 'accepting'
  private shutdownPromise: Promise<void> | null = null
  private waiters = new Map<
    string,
    { resolve: (job: WorkerJob) => void; reject: (e: Error) => void }
  >()
  private reconciled = false

  /**
   * After process restart, in-memory runtime entries are gone but durable jobs may
   * still be `running` / `pending_approval`. Those must not occupy concurrency slots forever.
   * - running/pending_approval without a live runtime entry → failed (RUNTIME_RESTARTED)
   * - queued jobs remain queued (re-validated when admitted)
   *
   * Call once after owner lease is held and before opening HTTP ports.
   */
  reconcileOrphanJobs(): { failed: number; clearedApprovals: number } {
    if (this.reconciled) return { failed: 0, clearedApprovals: 0 }
    let failed = 0
    let clearedApprovals = 0
    try {
      const open = store().listJobs({
        status: ['running', 'pending_approval'],
        limit: 500,
      })
      for (const job of open) {
        if (this.runtime.has(job.id)) continue
        // Idempotent: skip already-terminal (race with concurrent reconcile)
        const latest = store().getJob(job.id)
        if (!latest || !isJobOpen(latest.status)) continue
        const errMsg = 'RUNTIME_RESTARTED: worker runtime restarted before job completed'
        try {
          const pending = store()
            .listApprovals('pending')
            .filter((a) => a.jobId === job.id)
          for (const a of pending) {
            try {
              // cancel must not pass optionId (core approvals invariant)
              const result = store().tryResolveApproval(a.id, 'cancel', undefined, {
                resolutionSource: 'system',
                resolutionReason: 'RUNTIME_RESTARTED',
              })
              if (result.resolved) clearedApprovals += 1
            } catch {
              /* best-effort per approval */
            }
          }
        } catch {
          /* store may not expose approvals in tests */
        }
        store().updateJob(job.id, {
          status: 'failed',
          error: errMsg,
          message: errMsg,
          finishedAt: new Date().toISOString(),
        })
        failed += 1
        try {
          emitWorkerEvent(job.id, {
            type: 'failed',
            jobId: job.id,
            output: job.output ?? '',
            error: errMsg,
            truncated: false,
            workerName: job.workerName,
            role: job.role,
          } as WorkerRunEvent)
        } catch {
          /* ok */
        }
      }
      if (failed > 0) {
        globalActivityLog.append(
          'system',
          `Reconciled ${failed} orphan job(s) after runtime restart`,
          { failed, clearedApprovals },
        )
      }
      // Only mark reconciled after full pass so crash mid-loop can retry
      this.reconciled = true
      return { failed, clearedApprovals }
    } catch (e) {
      // Do not set reconciled — next call may retry
      globalActivityLog.append(
        'system',
        `reconcileOrphanJobs failed: ${e instanceof Error ? e.message : String(e)}`,
      )
      throw e
    }
  }

  getLifecycleState(): 'accepting' | 'shutting_down' | 'closed' {
    return this.lifecycle
  }

  /** Stop admission synchronously, then terminalize open work on graceful shutdown. */
  shutdown(opts?: { deadlineMs?: number }): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise
    if (this.lifecycle === 'closed') return Promise.resolve()
    this.lifecycle = 'shutting_down'
    this.shutdownPromise = this.performShutdown(opts)
    return this.shutdownPromise
  }

  private async performShutdown(opts?: { deadlineMs?: number }): Promise<void> {
    const deadlineMs = opts?.deadlineMs ?? 8_000
    for (const [, timer] of this.capacityRetryTimers) clearTimeout(timer)
    this.capacityRetryTimers.clear()

    try {
      const open = store().listJobs({
        status: ['queued', 'running', 'pending_approval'],
        limit: 500,
      })
      for (const job of open) {
        if (job.status === 'queued') {
          this.terminalize(
            job.id,
            {
              status: 'cancelled',
              error: 'RUNTIME_SHUTDOWN',
              message: 'Runtime shutting down',
            },
            {
              type: 'cancelled',
              jobId: job.id,
              error: 'RUNTIME_SHUTDOWN',
              truncated: false,
              workerName: job.workerName,
              role: job.role,
            } as WorkerRunEvent,
          )
          continue
        }
        // running / pending_approval: cancel if we still hold runtime
        try {
          await this.cancel(job.id)
        } catch {
          this.terminalize(
            job.id,
            {
              status: 'failed',
              error: 'RUNTIME_SHUTDOWN',
              message: 'Runtime shutting down',
            },
            {
              type: 'failed',
              jobId: job.id,
              output: job.output ?? '',
              error: 'RUNTIME_SHUTDOWN',
              truncated: false,
              workerName: job.workerName,
              role: job.role,
            } as WorkerRunEvent,
          )
        }
      }

      const start = Date.now()
      while (this.runtime.size > 0 && Date.now() - start < deadlineMs) {
        await new Promise((r) => setTimeout(r, 50))
      }
      // Force-clear leftover waiters
      for (const [jobId, waiter] of this.waiters) {
        const j = store().getJob(jobId)
        if (j) waiter.resolve(j)
        else waiter.reject(new Error('RUNTIME_SHUTDOWN'))
      }
      this.waiters.clear()
      this.runtime.clear()
    } finally {
      this.lifecycle = 'closed'
    }
  }

  listJobs(filter?: {
    sessionId?: string
    workerId?: string
    status?: JobStatus | JobStatus[]
    limit?: number
  }): WorkerJob[] {
    return store().listJobs(filter)
  }

  getJob(id: string): WorkerJob | undefined {
    return store().getJob(id)
  }

  busyWorkerIds(): Set<string> {
    const ids = new Set<string>()
    for (const j of store().listJobs({
      status: ['queued', 'running', 'pending_approval'],
      limit: 500,
    })) {
      ids.add(j.workerId)
    }
    return ids
  }

  /**
   * Enqueue a job; starts when concurrency allows.
   * When wait=true, resolves with the terminal job.
   */
  async enqueue(req: ScheduleRequest): Promise<ScheduleResult> {
    const task = req.task?.trim()
    if (!task) throw new Error('task required')
    if (this.lifecycle !== 'accepting') {
      throw new Error(this.lifecycle === 'closed' ? 'RUNTIME_CLOSED' : 'RUNTIME_SHUTTING_DOWN')
    }

    const active = store().getActive()
    const sessionId = req.sessionId ?? active.session?.id ?? createId('sess-orphan')
    const projectId = req.projectId ?? active.project?.id ?? active.session?.projectId ?? 'unknown'
    const cwd = req.cwd ?? active.project?.rootPath ?? process.cwd()
    const threadId = req.threadId ?? active.session?.memoryThreadId
    const source = req.source ?? 'api'

    const resolved = await this.resolveWorker({
      role: req.role,
      workerIdOrKind: req.workerIdOrKind,
      preferHealthy: req.preferHealthy !== false,
      cwd,
    })
    if (this.lifecycle !== 'accepting') {
      throw new Error(this.lifecycle === 'closed' ? 'RUNTIME_CLOSED' : 'RUNTIME_SHUTTING_DOWN')
    }

    if (!resolved.ok || !resolved.worker) {
      const job = store().createJob({
        sessionId,
        projectId,
        threadId,
        workerId: resolved.worker?.id ?? 'none',
        workerName: resolved.worker?.name ?? req.workerIdOrKind ?? req.role ?? 'unknown',
        role: req.role,
        task,
        cwd,
        source,
        status: 'failed',
        finishedAt: new Date().toISOString(),
        message: resolved.message,
        error: resolved.message,
        errorCode: resolved.errorCode,
      })
      globalActivityLog.append('job', `Job failed (no worker): ${job.workerName}`, {
        jobId: job.id,
        error: resolved.message,
        errorCode: resolved.errorCode,
      })
      if (req.onEvent) {
        req.onEvent({
          type: 'failed',
          jobId: job.id,
          error: resolved.message,
          truncated: false,
          output: '',
          workerName: job.workerName,
          role: job.role,
        } as WorkerRunEvent)
      }
      return { job }
    }

    const worker = resolved.worker
    const job = store().createJob({
      sessionId,
      projectId,
      threadId,
      workerId: worker.id,
      workerName: worker.name,
      role: req.role,
      task,
      cwd,
      source,
      status: 'queued',
      message: `Queued for ${worker.name}`,
      meta: { forced: Boolean(req.workerIdOrKind?.trim()) },
    })

    // Register onEvent before tick so started/delta are never missed
    if (req.onEvent) {
      const emitter = getWorkerEventEmitter()
      emitter.subscribe(job.id, req.onEvent)
    }

    // kick loop
    void this.tick()

    if (req.wait) {
      const terminal = await this.waitForJob(job.id)
      return { job: terminal, output: terminal.output }
    }

    // return current snapshot (may already be running if slot free)
    return { job: store().getJob(job.id) ?? job }
  }

  async cancel(jobId: string): Promise<WorkerJob> {
    const job = store().getJob(jobId)
    if (!job) throw new Error(`Job not found: ${jobId}`)
    if (!isJobOpen(job.status)) return job

    if (job.status === 'queued') {
      const updated = this.terminalize(
        jobId,
        {
          status: 'cancelled',
          message: 'Cancelled while queued',
        },
        {
          type: 'cancelled',
          jobId,
          error: 'Cancelled while queued',
          truncated: false,
          workerName: job.workerName,
          role: job.role,
        } as WorkerRunEvent,
      )
      return updated ?? store().getJob(jobId) ?? job
    }

    // running / pending_approval
    const rt = this.runtime.get(jobId)
    try {
      const updated = this.terminalize(
        jobId,
        {
          status: 'cancelled',
          message: 'Cancel requested',
        },
        {
          type: 'cancelled',
          jobId,
          error: 'Cancel requested',
          truncated: false,
          workerName: job.workerName,
          role: job.role,
        } as WorkerRunEvent,
        { retainRuntime: Boolean(rt) },
      )
      return updated ?? store().getJob(jobId) ?? job
    } finally {
      // Persist cancellation before stopping the process; never publish a terminal
      // event for a job that is still durable-open.
      rt?.abort.abort()
    }
  }

  async retry(jobId: string, opts?: { wait?: boolean }): Promise<ScheduleResult> {
    const prev = store().getJob(jobId)
    if (!prev) throw new Error(`Job not found: ${jobId}`)
    return this.enqueue({
      task: prev.task,
      role: prev.role,
      workerIdOrKind: prev.workerId,
      cwd: prev.cwd,
      sessionId: prev.sessionId,
      projectId: prev.projectId,
      threadId: prev.threadId,
      source: prev.source,
      wait: opts?.wait,
    })
  }

  cancelApproval(approvalId: string, reason?: string): ApprovalItem | null {
    try {
      return store().resolveApproval(approvalId, 'cancel', undefined, {
        resolutionSource: 'system',
        resolutionReason: reason ?? 'Cancelled',
      })
    } catch {
      return null
    }
  }

  cleanupPendingApprovals(jobId: string, reason?: string): void {
    const job = store().getJob(jobId)
    if (!job?.approvalIds?.length) return
    for (const aid of job.approvalIds) {
      const resolved = this.cancelApproval(aid, reason)
      if (resolved) {
        emitWorkerEvent(jobId, {
          type: 'approval_resolved',
          jobId,
          approval: resolved,
        })
      }
    }
    globalApprovalWaiters.cancelMany(job.approvalIds, reason ?? 'cleanup')
  }

  resolveApproval(
    approvalId: string,
    decision: 'allow' | 'deny' | 'cancel',
    options: { optionId?: string; surface: 'chat' | 'panel' },
  ): ApprovalItem {
    if (!options?.surface || (options.surface !== 'chat' && options.surface !== 'panel')) {
      throw new Error('invalid surface')
    }
    const resolutionSource =
      options.surface === 'panel' ? ('manual_panel' as const) : ('manual_chat' as const)

    const restoreJobAfterResolution = (item: ApprovalItem): void => {
      if (!item.jobId) return
      const job = store().getJob(item.jobId)
      if (!job || job.status !== 'pending_approval') return
      const stillPending = store()
        .listPendingApprovals()
        .some((approval) => approval.jobId === item.jobId)
      if (!stillPending) {
        store().updateJob(item.jobId, {
          status: 'running',
          message: `Running on ${job.workerName}`,
        })
      }
    }

    if (decision === 'cancel') {
      if (options.optionId) {
        throw new Error('cancel must not specify optionId')
      }
      const item = store().resolveApproval(approvalId, 'cancel', undefined, {
        resolutionSource,
        resolutionReason: 'Cancelled by user',
      })
      restoreJobAfterResolution(item)
      const job = item.jobId ? store().getJob(item.jobId) : undefined
      if (job) {
        emitWorkerEvent(job.id, { type: 'approval_resolved', jobId: job.id, approval: item })
      }
      return item
    }

    if (!options.optionId) {
      throw new Error('optionId required for allow/deny')
    }

    const pending = store()
      .listApprovals()
      .find((a) => a.id === approvalId)
    if (!pending) throw new Error(`Approval not found: ${approvalId}`)
    if (pending.status !== 'pending')
      throw new Error(`Approval ${approvalId} is already ${pending.status}`)

    const option = pending.options.find((o) => o.optionId === options.optionId)
    if (!option)
      throw new Error(`optionId "${options.optionId}" does not belong to approval ${approvalId}`)

    if (decision === 'allow' && !(option.kind === 'allow_once' || option.kind === 'allow_always')) {
      throw new Error('allow decision requires allow_* option kind')
    }
    if (
      decision === 'deny' &&
      !(option.kind === 'reject_once' || option.kind === 'reject_always')
    ) {
      throw new Error('deny decision requires reject_* option kind')
    }

    const item = store().resolveApproval(approvalId, decision, options.optionId, {
      resolutionSource,
      resolutionReason: `Resolved in ${options.surface}`,
    })
    restoreJobAfterResolution(item)

    const job = item.jobId ? store().getJob(item.jobId) : undefined
    if (job) {
      emitWorkerEvent(job.id, { type: 'approval_resolved', jobId: job.id, approval: item })
    }

    return item
  }

  async waitForJob(jobId: string): Promise<WorkerJob> {
    const existing = store().getJob(jobId)
    if (existing && !isJobOpen(existing.status)) {
      return Promise.resolve(existing)
    }
    return new Promise((resolve, reject) => {
      this.waiters.set(jobId, { resolve, reject })
    })
  }

  private resolveWaiter(jobId: string, job: WorkerJob): void {
    const w = this.waiters.get(jobId)
    if (!w) return
    this.waiters.delete(jobId)
    w.resolve(job)
  }

  private scheduleCapacityRetry(jobId: string, delayMs: number): void {
    if (this.lifecycle !== 'accepting') return
    if (this.capacityRetryTimers.has(jobId)) return
    const timer = setTimeout(() => {
      this.capacityRetryTimers.delete(jobId)
      if (this.lifecycle === 'accepting') void this.tick()
    }, delayMs)
    timer.unref?.()
    this.capacityRetryTimers.set(jobId, timer)
  }

  private async resolveWorker(opts: {
    role?: WorkerRole
    workerIdOrKind?: string
    preferHealthy?: boolean
    cwd: string
  }): Promise<{
    ok: boolean
    worker?: WorkerRegistration
    message?: string
    errorCode?: string
  }> {
    const forced = Boolean(opts.workerIdOrKind?.trim())
    const workers = store().listWorkers()
    const busy = this.busyWorkerIds()

    // Prefer non-busy when selecting by role
    const available = forced
      ? workers
      : workers.map((w) => {
          const open = store().countOpenJobs({ workerId: w.id })
          if (open >= this.maxPerWorker) {
            return { ...w, health: w.health === 'healthy' ? ('unknown' as const) : w.health }
          }
          return w
        })

    let candidates: WorkerRegistration[] = []
    if (forced) {
      const w = selectWorkerByRole(workers, {
        workerIdOrKind: opts.workerIdOrKind,
        preferHealthy: false,
        enabledOnly: true,
      })
      if (w) candidates = [w]
    } else if (opts.role) {
      candidates = listWorkersForRole(available, opts.role, true)
    } else {
      const w = selectWorkerByRole(available, { preferHealthy: true })
      if (w) candidates = [w]
    }

    if (candidates.length === 0) {
      return {
        ok: false,
        message: `No enabled worker matched role=${opts.role ?? '—'} idOrKind=${opts.workerIdOrKind ?? '—'}`,
      }
    }

    const errors: string[] = []
    for (const cand of candidates) {
      // Refresh stale health
      let worker = cand
      if (!isHealthReportFresh(worker.healthReport) || worker.health === 'unknown') {
        try {
          const report = await probeWorkerHealth(worker, {
            level: 'presence',
            cwd: opts.cwd,
          })
          worker = applyHealthReport(worker, report)
          store().upsertWorker(worker)
        } catch (e) {
          errors.push(`${cand.name}: probe failed ${e instanceof Error ? e.message : e}`)
          continue
        }
      }

      // §7.1: skip fresh command missing/unhealthy; skip fresh acp unavailable
      if (!forced && shouldSkipWorkerDispatch(worker, { forced: false })) {
        const projected = projectLegacyHealth(worker)
        errors.push(
          `${worker.name}: ${projected.commandHealth.status}/${projected.acpHealth.status} — ${worker.healthReport?.message ?? ''}`,
        )
        continue
      }

      // Registry readiness gate: force cannot bypass auth/protocol hard gates
      {
        const { evaluateWorkerReadinessGate } = await import('./acp-worker-readiness.js')
        const gate = evaluateWorkerReadinessGate(worker, { force: forced })
        if (!gate.ok) {
          errors.push(`${worker.name}: ${gate.code} — ${gate.message}`)
          // Forced pick of auth_required worker still hard-fails (do not hang on OAuth)
          if (forced) {
            return {
              ok: false,
              message: gate.message,
              errorCode: gate.code,
            }
          }
          continue
        }
      }

      // Slot check for non-forced: skip if at max (queue will wait if we still pick)
      // For resolve we allow pick even if busy — job will stay queued.
      if (
        !busy.has(worker.id) ||
        forced ||
        store().countOpenJobs({ workerId: worker.id }) < this.maxPerWorker
      ) {
        // canRunAcp
        const config = {
          command: worker.command,
          args: worker.args,
          cwd: opts.cwd,
          env: { ...worker.env } as Record<string, string>,
          workerId: worker.id,
          workerName: worker.name,
          kind: worker.kind,
          primaryRole: worker.primaryRole,
          roles: worker.roles,
        }
        const can = await defaultCanRunAcp(config)
        if (!can && !forced) {
          errors.push(`${worker.name}: ACP command not runnable`)
          continue
        }
        return { ok: true, worker }
      }
    }

    // If all busy but healthy, still queue on first healthy
    const firstHealthy = candidates.find((c) => c.health === 'healthy' || c.health === 'unknown')
    if (firstHealthy) {
      return { ok: true, worker: firstHealthy }
    }

    return {
      ok: false,
      message:
        errors.length > 0
          ? `No runnable worker. ${errors.slice(0, 3).join('; ')}`
          : 'No runnable worker available',
    }
  }

  private canAdmit(job: WorkerJob): boolean {
    // Ensure restart orphans are not counting against capacity forever
    if (!this.reconciled) this.reconcileOrphanJobs()
    // Queued jobs do not consume run slots — only running + pending_approval do
    const runningLike = store().listJobs({
      status: ['running', 'pending_approval'],
      limit: 500,
    }).length
    if (runningLike >= this.maxGlobal) return false

    const perWorker = store().listJobs({
      workerId: job.workerId,
      status: ['running', 'pending_approval'],
      limit: 50,
    }).length
    if (perWorker >= this.maxPerWorker) return false

    const perSession = store().listJobs({
      sessionId: job.sessionId,
      status: ['running', 'pending_approval'],
      limit: 50,
    }).length
    if (perSession >= this.maxPerSession) return false

    return true
  }

  async tick(): Promise<void> {
    if (this.lifecycle !== 'accepting' || this.ticking) return
    this.ticking = true
    try {
      const queued = store()
        .listJobs({ status: 'queued', limit: 50 })
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))

      for (const job of queued) {
        if (this.lifecycle !== 'accepting') break
        if (!this.canAdmit(job)) continue
        // fire without awaiting whole queue
        this.launchJob(job.id)
        // one admit per tick loop iteration then recheck — allow parallel starts up to slots
      }
    } finally {
      this.ticking = false
    }
  }

  private launchJob(jobId: string): void {
    if (this.lifecycle !== 'accepting') return
    void this.runJob(jobId).catch((error) => {
      try {
        this.handleRunJobFailure(jobId, error)
      } catch (handlerError) {
        console.error('[worker-scheduler] failed to persist unexpected run failure', {
          jobId,
          error: handlerError instanceof Error ? handlerError.message : 'unknown_error',
        })
      }
    })
  }

  private handleRunJobFailure(jobId: string, error: unknown): void {
    const job = store().getJob(jobId)
    if (!job || !isJobOpen(job.status)) {
      this.runtime.delete(jobId)
      void this.tick()
      return
    }

    const failure = toPublicAcpFailure(error)
    this.terminalize(
      jobId,
      {
        status: 'failed',
        error: failure.error,
        message: failure.error,
        errorCode: failure.errorCode,
      },
      {
        type: 'failed',
        jobId,
        output: '',
        error: failure.recoveryError ? undefined : failure.error,
        errorCode: failure.errorCode,
        truncated: false,
        workerName: job.workerName,
        role: job.role,
        recoveryError: failure.recoveryError,
        canResetAcpContext: failure.canResetAcpContext,
      } as WorkerRunEvent,
    )
  }

  private async runJob(jobId: string): Promise<void> {
    if (this.lifecycle !== 'accepting') return
    const job = store().getJob(jobId)
    if (!job || job.status !== 'queued') return
    if (!this.canAdmit(job)) return

    // Claim: only one runner wins if status still queued
    if (this.runtime.has(jobId)) return
    const abort = new AbortController()
    this.runtime.set(jobId, { abort })

    const claimed = store().getJob(jobId)
    if (!claimed || claimed.status !== 'queued') {
      this.runtime.delete(jobId)
      return
    }

    const worker = store()
      .listWorkers()
      .find((w) => w.id === job.workerId)
    if (!worker) {
      this.terminalize(
        jobId,
        {
          status: 'failed',
          error: 'Worker no longer registered',
          message: 'Worker no longer registered',
        },
        {
          type: 'failed',
          jobId,
          output: '',
          error: 'Worker no longer registered',
          truncated: false,
          workerName: job.workerName,
          role: job.role,
        } as WorkerRunEvent,
      )
      return
    }

    const catalog = getWorkerCatalogForDispatch(worker.id, job.cwd, getWorkerModelCatalogStore())
    // Plaintext remains process-local and is attached only to this selected
    // Worker's SessionEntryConfig for target-process spawning.
    const workerSecretSnapshot = loadWorkerSecretsSnapshotForSpawn(worker.id)
    const workerSecrets = workerSecretSnapshot.secrets
    const eligibilityCandidates = resolveEligibilityCandidates(worker, catalog) ?? []
    const pin = worker.model?.trim() || undefined
    // Always re-merge evidence at dispatch (env + catalog providers). Empty catalog = fail-closed
    // for non-zen pins (same boundary as discovery/pin/execute).
    const providersFromCatalog: Record<string, 'free' | 'authenticated' | 'disabled' | 'unknown'> =
      {}
    for (const p of catalog?.providers ?? []) {
      providersFromCatalog[p.providerId] = p.state
    }
    const modelIdsForEvidence =
      eligibilityCandidates.length > 0
        ? eligibilityCandidates.map((m) => m.modelId)
        : pin
          ? [pin]
          : []
    // Prefer worker-specific HOME/XDG for OpenCode auth store (not global process only)
    const realHome =
      (worker.env?.HOME as string | undefined) ||
      process.env.HOME ||
      process.env.USERPROFILE ||
      homedir()
    const ocAuth =
      worker.kind === 'opencode'
        ? readAuthProviderIds(realHome, {
            xdgDataHome: worker.env?.XDG_DATA_HOME ?? process.env.XDG_DATA_HOME,
          })
        : undefined
    const ocDisabled =
      worker.kind === 'opencode'
        ? [
            ...readDisabledProviders(realHome, {
              xdgConfigHome: worker.env?.XDG_CONFIG_HOME ?? process.env.XDG_CONFIG_HOME,
            }),
          ]
        : undefined
    const providers = buildCurrentEligibilityEvidence({
      modelIds: modelIdsForEvidence,
      env: buildEffectiveWorkerEnv({
        ambientEnv: process.env,
        workerEnv: worker.env,
        workerSecrets,
        model: pin,
      }),
      zenFreeAllowlist: [...OPENCODE_ZEN_FREE_MODELS],
      catalogProviders: providersFromCatalog,
      authProviders: ocAuth,
      disabledProviders: ocDisabled,
    })
    // Include live evidence hash so auth/disabled file changes break reuse
    const liveEvidenceHash = createHash('sha256')
      .update(
        Object.entries(providers)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => `${k}:${v}`)
          .join('|'),
      )
      .digest('hex')
      .slice(0, 16)
    // Stable revision only — exclude catalog.fetchedAt timestamps so SWR refresh
    // does not thrash ACP reuse keys when model/evidence are unchanged.
    const candidatesHash = createHash('sha256')
      .update(
        eligibilityCandidates
          .map((m) => m.modelId)
          .sort()
          .join('|'),
      )
      .digest('hex')
      .slice(0, 16)
    const eligibilityRevision = [
      catalog?.evidenceRevision ?? '',
      liveEvidenceHash,
      candidatesHash,
      pin ?? '',
      worker.kind,
    ].join('|')

    if (pin) {
      const er = evaluateModelEligibility({
        modelId: pin,
        candidates: eligibilityCandidates,
        providers,
        zenFreeAllowlist: [...OPENCODE_ZEN_FREE_MODELS],
        purpose: 'execute',
      })
      if (!er.eligible) {
        const code = er.errorCode ?? 'MODEL_SELECTION_UNVERIFIED'
        const msg = formatWorkerModelError({
          workerName: worker.name,
          kind: worker.kind,
          model: pin,
          rawError: code,
          errorCode: code,
        })
        this.terminalize(
          jobId,
          {
            status: 'failed',
            error: code,
            message: msg,
            errorCode: code,
          },
          {
            type: 'failed',
            jobId,
            output: '',
            error: msg,
            errorCode: code,
            truncated: false,
            workerName: job.workerName,
            role: job.role,
            model: pin,
          } as WorkerRunEvent,
        )
        return
      }
    }
    const config: AcpSpawnConfig = {
      command: worker.command,
      args: [...worker.args],
      cwd: job.cwd,
      env: { ...worker.env },
      workerId: worker.id,
      workerName: worker.name,
      kind: worker.kind,
      primaryRole: worker.primaryRole,
      roles: [...worker.roles],
      model: pin,
      // Eligibility uses searchIndex (incl. OpenRouter); UI shortlist stays on worker row
      availableModels: eligibilityCandidates,
    }
    const rt = this.runtime.get(jobId)
    if (rt) rt.config = config

    // Build session reuse key for AcpSessionManager — pass same providers (no Manager recompute)
    const sessionConfig = attachWorkerSecretsForSpawn(
      {
        command: config.command,
        args: [...config.args],
        model: config.model,
        env: config.env,
        availableModels: config.availableModels,
        providers,
        ...buildWorkerSessionBoundary(
          worker,
          eligibilityRevision,
          workerSecretSnapshot.revisionHmac,
        ),
      },
      workerSecrets,
    )
    const sessionMgr = getAcpSessionManager()
    const reuseKey = sessionMgr.buildReuseKey({
      routerSessionId: job.sessionId,
      workerId: worker.id,
      cwd: job.cwd,
      config: sessionConfig,
    })
    const reuseKeyDigest = sessionMgr.digestReuseKey(reuseKey)
    sessionMgr.setSessionProject(job.sessionId, job.projectId)

    if (!sessionMgr.canAccept(reuseKey)) {
      this.runtime.delete(jobId)
      const delayMs = capacityRetryDelay('capacity_exhausted')!
      store().updateJob(jobId, {
        status: 'queued',
        message: `Waiting for ACP session capacity; retrying in ${delayMs}ms`,
      })
      this.scheduleCapacityRetry(jobId, delayMs)
      return
    }
    store().updateJob(jobId, {
      status: 'running',
      startedAt: new Date().toISOString(),
      message: `Running on ${job.workerName}`,
      // Persist opaque digest so later reset does not re-derive from drifted config
      reuseKeyDigest,
    })
    globalActivityLog.append('job', `Job running: ${job.workerName}`, {
      jobId,
      workerId: job.workerId,
    })

    const timeout = setTimeout(() => {
      const latest = store().getJob(jobId)
      if (!latest || !isJobOpen(latest.status)) return
      this.terminalize(
        jobId,
        {
          status: 'timed_out',
          error: `Timed out after ${this.jobTimeoutMs}ms`,
          message: `Timed out after ${this.jobTimeoutMs}ms`,
        },
        {
          type: 'timed_out',
          jobId,
          error: `Timed out after ${this.jobTimeoutMs}ms`,
          truncated: false,
          workerName: worker.name,
          workerKind: worker.kind,
          role: job.role,
          model: worker.model?.trim() || undefined,
        } as WorkerRunEvent,
        { retainRuntime: true },
      )
      abort.abort()
    }, this.jobTimeoutMs)
    const currentRt = this.runtime.get(jobId)
    if (currentRt) currentRt.timeout = timeout

    try {
      if (abort.signal.aborted) {
        this.finish(jobId, {
          status: 'cancelled',
          message: 'Cancelled before start',
        })
        return
      }

      const result = await sessionMgr.enqueuePrompt({
        key: reuseKey,
        config: sessionConfig,
        kind: worker.kind,
        task: job.task,
        binding: {
          jobId,
          signal: abort.signal,
          sequence: 0,
          onSessionReady: (disposition: string) => {
            const latest = store().getJob(jobId)
            if (!latest || !isJobOpen(latest.status)) return
            emitWorkerEvent(jobId, {
              type: 'started',
              jobId,
              workerId: worker.id,
              workerName: worker.name,
              workerKind: worker.kind,
              role: job.role,
              model: worker.model?.trim() || undefined,
              reusedSession: disposition !== 'new',
              sessionDisposition: disposition,
            } as WorkerRunEvent)
          },
          onPermissionRequest: async (request) => {
            const cur = store().getJob(jobId)
            if (!cur || !isJobOpen(cur.status)) {
              return { outcome: 'cancelled' as const }
            }

            const frozenPolicy = cur.approvalPolicy
            const enginePolicy = normalizePolicyForEngine(frozenPolicy)
            const toolKind = resolveAcpToolKind(request.kind)
            const decision = decidePermission({
              toolKind,
              options: request.options,
              sessionPolicy: enginePolicy,
            })

            if (decision.mode === 'automatic') {
              const locs: ApprovalLocation[] = (request.locations ?? []).map((l) => ({
                filePath: l.path,
                line: l.line,
              }))
              const resolved = store().createResolvedApproval({
                title: request.title ?? 'Permission required',
                detail: request.locations?.map((l) => l.path).join(', '),
                action: request.kind ?? 'other',
                pathOrTarget: request.locations?.[0]?.path,
                workerId: config.workerId,
                workerName: config.workerName,
                sessionId: job.sessionId,
                option: decision.option,
                decision: decision.decision,
                reason: decision.reason,
                jobId,
                toolCallId: request.toolCallId,
                toolKind: toolKind,
                locations: locs.length > 0 ? locs : undefined,
              })
              emitWorkerEvent(jobId, {
                type: 'approval_resolved',
                jobId,
                approval: resolved,
              })
              return {
                outcome: 'selected' as const,
                optionId: decision.option.optionId,
              }
            }

            // Manual path
            const locs: ApprovalLocation[] = (request.locations ?? []).map((l) => ({
              filePath: l.path,
              line: l.line,
            }))
            const approvalId = createId('appr')
            const { item, waiterPromise } = persistApprovalWithReservedWaiter({
              approvalId,
              waiters: globalApprovalWaiters,
              persist: () => {
                const approval = store().enqueueApproval({
                  ...mapAcpPermissionToEnqueue({
                    title: request.title ?? 'Permission required',
                    options: request.options,
                    workerId: config.workerId,
                    workerName: config.workerName,
                    sessionId: job.sessionId,
                    jobId,
                    toolCallId: request.toolCallId,
                    toolKind,
                    locations: locs.length > 0 ? locs : undefined,
                  }),
                  id: approvalId,
                })
                store().updateJob(jobId, {
                  status: 'pending_approval',
                  message: `Waiting for approval: ${request.title}`,
                  approvalIds: [...(cur.approvalIds ?? []), approval.id],
                })
                globalActivityLog.append('job', `Job pending approval: ${job.workerName}`, {
                  jobId,
                  approvalId: approval.id,
                })
                emitWorkerEvent(jobId, {
                  type: 'approval_requested',
                  jobId,
                  approval,
                })
                return approval
              },
            })

            const timeoutMs = resolveApprovalTimeoutMs()
            let timer: ReturnType<typeof setTimeout> | undefined
            const outcome = await Promise.race([
              waiterPromise.then((r) => {
                if (timer) clearTimeout(timer)
                return r
              }),
              new Promise<{ outcome: 'timeout' }>((resolve) => {
                timer = setTimeout(() => {
                  resolve({ outcome: 'timeout' })
                }, timeoutMs)
                timer.unref?.()
              }),
            ])

            if (outcome.outcome === 'timeout') {
              return finalizeApprovalTimeout({
                tryResolve: () =>
                  store().tryResolveApproval(item.id, 'cancel', undefined, {
                    resolutionSource: 'system',
                    resolutionReason: 'Approval timed out',
                  }),
                abort: () => abort.abort(),
                emitApprovalResolved: (approval) =>
                  emitWorkerEvent(jobId, {
                    type: 'approval_resolved',
                    jobId,
                    approval,
                  }),
                isJobOpen: () => {
                  const latest = store().getJob(jobId)
                  return Boolean(latest && isJobOpen(latest.status))
                },
                emitFailed: () => {
                  emitWorkerEvent(jobId, {
                    type: 'failed',
                    jobId,
                    output: '',
                    error: 'Approval timed out',
                    truncated: false,
                    workerName: worker.name,
                    workerKind: worker.kind,
                    role: job.role,
                    model: worker.model?.trim() || undefined,
                  } as WorkerRunEvent)
                },
                finishFailed: () => {
                  this.terminalize(
                    jobId,
                    {
                      status: 'failed',
                      error: 'Approval timed out',
                      message: 'Approval timed out',
                    },
                    undefined,
                    { retainRuntime: true },
                  )
                },
              })
            }

            if (outcome.outcome === 'selected') {
              if (!outcome.optionId) return { outcome: 'cancelled' as const }
              const after = store().getJob(jobId)
              if (!after || !isJobOpen(after.status)) return { outcome: 'cancelled' as const }
              return {
                outcome: 'selected' as const,
                optionId: outcome.optionId,
              }
            }

            return { outcome: 'cancelled' as const }
          },
          onOutputDelta: (sequence, delta) => {
            const latest = store().getJob(jobId)
            if (!latest || !isJobOpen(latest.status)) return
            emitWorkerEvent(jobId, { type: 'delta', jobId, sequence, delta })
          },
        },
        signal: abort.signal,
      })

      clearTimeout(timeout)

      const latest = store().getJob(jobId)
      if (!latest || !isJobOpen(latest.status)) {
        this.runtime.delete(jobId)
        void this.tick()
        return
      }

      if (!result.ok) {
        const retryDelay = capacityRetryDelay(result.error)
        if (retryDelay !== null) {
          store().updateJob(jobId, {
            status: 'queued',
            message: `Waiting for ACP session capacity; retrying in ${retryDelay}ms`,
          })
          this.runtime.delete(jobId)
          this.scheduleCapacityRetry(jobId, retryDelay)
          return
        }
        const truncated = (result.output?.length ?? 0) >= 32_000
        const err = formatWorkerModelError({
          workerName: worker.name,
          kind: worker.kind,
          model: worker.model,
          rawError: result.error ?? 'ACP failed',
        })
        updateWorkerAcpHealthFromJob(worker.id, 'failed', { error: result.error ?? err })
        this.terminalize(
          jobId,
          {
            status: 'failed',
            error: err,
            message: err,
            output: result.output?.slice(0, 32_000),
          },
          {
            type: 'failed',
            jobId,
            output: result.output?.slice(0, 32_000),
            error: result.error,
            truncated,
            workerName: worker.name,
            workerKind: worker.kind,
            role: job.role,
            model: worker.model?.trim() || undefined,
          } as WorkerRunEvent,
        )
        return
      }

      // touch worker health from job success (§7.1) + optional presence probe
      try {
        updateWorkerAcpHealthFromJob(worker.id, 'succeeded')
        const latest =
          store()
            .listWorkers()
            .find((w) => w.id === worker.id) ?? worker
        const report = await probeWorkerHealth(latest, { level: 'presence', cwd: job.cwd })
        if (report.status === 'healthy') {
          store().upsertWorker(applyHealthReport(latest, report))
        }
      } catch {
        /* ignore */
      }

      const afterHealth = store().getJob(jobId)
      if (!afterHealth || !isJobOpen(afterHealth.status)) {
        this.runtime.delete(jobId)
        void this.tick()
        return
      }

      const truncated = (result.output?.length ?? 0) >= 32_000
      // Persist terminal first, then emit — crash between must not leave running on disk
      // while clients already saw completed.
      this.terminalize(
        jobId,
        {
          status: 'succeeded',
          message: worker.model
            ? `Completed via ${job.workerName} (model=${worker.model}${result.reusedSession ? ', reused session' : ''})`
            : `Completed via ${job.workerName}${result.reusedSession ? ' (reused session)' : ''}`,
          output: result.output?.slice(0, 32_000),
        },
        {
          type: 'completed',
          jobId,
          output: result.output?.slice(0, 32_000) ?? '',
          truncated,
          workerName: worker.name,
          workerKind: worker.kind,
          role: job.role,
          model: worker.model?.trim() || undefined,
        } as WorkerRunEvent,
      )
    } catch (e) {
      clearTimeout(timeout)
      const latest = store().getJob(jobId)
      if (!latest || !isJobOpen(latest.status)) {
        this.runtime.delete(jobId)
        void this.tick()
        return
      }
      const failure = toPublicAcpFailure(e)
      const runtimeCode = isAcpSessionRuntimeError(e) ? e.code : undefined
      updateWorkerAcpHealthFromJob(worker.id, 'failed', {
        error: failure.error,
        errorCode: runtimeCode,
      })
      this.terminalize(
        jobId,
        {
          status: 'failed',
          error: failure.error,
          message: failure.error,
          errorCode: runtimeCode,
        },
        {
          type: 'failed',
          jobId,
          output: '',
          error: failure.recoveryError ? undefined : failure.error,
          errorCode: runtimeCode,
          truncated: false,
          workerName: worker.name,
          workerKind: worker.kind,
          role: job.role,
          model: worker.model?.trim() || undefined,
          recoveryError: failure.recoveryError,
          canResetAcpContext: failure.canResetAcpContext,
        } as WorkerRunEvent,
      )
    }
  }

  private finish(
    jobId: string,
    patch: {
      status: JobStatus
      message?: string
      error?: string
      errorCode?: string
      output?: string
    },
  ): void {
    this.terminalize(jobId, patch)
  }

  /** Persist terminal state before publishing it; optionally retain a live ACP runtime until unwind. */
  private terminalize(
    jobId: string,
    patch: {
      status: JobStatus
      message?: string
      error?: string
      errorCode?: string
      output?: string
    },
    event?: WorkerRunEvent,
    opts?: { retainRuntime?: boolean },
  ): WorkerJob | undefined {
    const retryTimer = this.capacityRetryTimers.get(jobId)
    if (retryTimer) {
      clearTimeout(retryTimer)
      this.capacityRetryTimers.delete(jobId)
    }
    const existing = store().getJob(jobId)
    if (!existing) return undefined
    if (!isJobOpen(existing.status)) {
      // already terminal (e.g. cancel() set it before ACP cleanup completed)
      if (!opts?.retainRuntime) {
        this.runtime.delete(jobId)
        if (this.lifecycle === 'accepting') void this.tick()
      }
      return existing
    }
    // Cancel remaining pending approvals
    this.cleanupPendingApprovals(jobId, `Job ${patch.status}`)
    // allow finish from running/pending/queued
    const updated = store().updateJob(jobId, {
      ...patch,
      finishedAt: new Date().toISOString(),
    })
    const rt = this.runtime.get(jobId)
    if (rt?.timeout) clearTimeout(rt.timeout)
    if (event) emitWorkerEvent(jobId, event)
    if (!opts?.retainRuntime) this.runtime.delete(jobId)
    this.resolveWaiter(jobId, updated)
    globalActivityLog.append('job', `Job ${patch.status}: ${existing.workerName}`, {
      jobId,
      status: patch.status,
    })
    if (!opts?.retainRuntime && this.lifecycle === 'accepting') void this.tick()
    return updated
  }
}

let singleton: WorkerScheduler | null = null

export function getWorkerScheduler(): WorkerScheduler {
  if (!singleton) singleton = new WorkerScheduler()
  return singleton
}
