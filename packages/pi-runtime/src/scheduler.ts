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
} from '@pihuo-agent/adapters'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import {
  createId,
  getSharedStore,
  getWorkerModelCatalogStore,
  globalActivityLog,
  mapAcpPermissionToEnqueue,
  globalApprovalWaiters,
  loadSettings,
  loadWorkerSecretsSnapshotForSpawn,
  resolveWorkerTimeoutSettings,
  type ApprovalWaitOutcome,
  type WorkerTimeoutSettings,
} from '@pihuo-agent/core'
import {
  isHealthReportFresh,
  isJobOpen,
  projectLegacyHealth,
  shouldSkipWorkerDispatch,
  type ApprovalItem,
  type ApprovalLocation,
  type JobSource,
  type JobStatus,
  type SessionPermissionMode,
  type PermissionModeChangeSource,
  type SessionApprovalPolicy,
  type TeamMember,
  type WorkerJob,
  type WorkerRegistration,
  type WorkerRole,
  type WorkerRunEvent,
} from '@pihuo-agent/shared'
import { emitWorkerEvent, getWorkerEventEmitter, MAX_TIMER_DELAY_MS } from './worker-events.js'
import { getWorkerCatalogForDispatch } from './worker-models.js'
import {
  decidePermissionForJobInStore,
  reconcileSessionPendingApprovalsInStore,
  setSessionPermissionModeInStore,
  type SetSessionPermissionModeResult,
} from './session-permission-mode.js'
export { decidePermissionForJobInStore, setSessionPermissionModeInStore }

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

export interface ScheduleRequest {
  task: string
  /** Preferred dispatch identity: a Chat-scoped Team member. */
  teamMemberId?: string
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

export function buildTeamMemberDispatchSnapshot(
  role: TeamMember,
  worker: WorkerRegistration,
  task: string,
): Pick<
  WorkerJob,
  | 'teamMemberId'
  | 'teamMemberName'
  | 'roleType'
  | 'teamMemberRevision'
  | 'effectiveModel'
  | 'effectiveReasoning'
  | 'instructionsSnapshot'
  | 'effectivePrompt'
> {
  const instructions = role.instructions.trim()
  const normalizedTask = task.trim()
  return {
    teamMemberId: role.id,
    teamMemberName: role.name,
    roleType: role.roleType,
    teamMemberRevision: role.revision,
    effectiveModel: role.model?.trim() || worker.model?.trim() || undefined,
    effectiveReasoning: role.reasoning?.trim() || worker.reasoning?.trim() || undefined,
    instructionsSnapshot: instructions,
    effectivePrompt: instructions ? `${instructions}\n\nTask:\n${normalizedTask}` : normalizedTask,
  }
}

export function buildWorkerExecutionSnapshot(
  worker: Pick<WorkerRegistration, 'model' | 'reasoning'>,
): Pick<WorkerJob, 'effectiveModel' | 'effectiveReasoning'> {
  return {
    effectiveModel: worker.model?.trim() || undefined,
    effectiveReasoning: worker.reasoning?.trim() || undefined,
  }
}

export function toPublicWorkerJobErrorCode(code: string | undefined): string | undefined {
  switch (code) {
    case 'acp_reasoning_unsupported':
      return 'ACP_REASONING_UNSUPPORTED'
    case 'acp_reasoning_value_unavailable':
      return 'ACP_REASONING_VALUE_UNAVAILABLE'
    case 'acp_reasoning_configuration_failed':
      return 'ACP_REASONING_CONFIGURATION_FAILED'
    default:
      return code
  }
}

type RuntimeEntry = {
  abort: AbortController
  config?: AcpSpawnConfig
  timeout?: ReturnType<typeof setTimeout>
  /** Monotonic token invalidating callbacks from a paused/replaced timer. */
  timeoutGeneration?: number
  /** Wall-clock deadline while the active Job timer is armed. */
  timeoutDeadlineMs?: number
  /**
   * Idle window for the Job timeout (jobTimeoutMs snapshot).
   * Timer is inactivity-based: any ACP activity re-arms a full window; the
   * clock only runs while the Job is running with no recent ACP updates and
   * no pending approval / terminal stop.
   */
  timeoutDurationMs?: number
  /** Remaining ms when the timer was last paused (approval); optional diagnostics. */
  timeoutRemainingMs?: number
  /** Explicit in-memory pause marker; the timer handle may be absent while paused. */
  timeoutPaused?: boolean
  /** Closure that applies the Job timeout terminal transition. */
  timeoutHandler?: () => void
}

export function workerTimeoutSnapshotFromJob(
  job: Pick<WorkerJob, 'meta'>,
  fallback: WorkerTimeoutSettings = resolveWorkerTimeoutSettings(loadSettings().workerTimeouts),
): WorkerTimeoutSettings {
  return resolveWorkerTimeoutSettings(job.meta?.workerTimeouts, {
    WORKER_JOB_TIMEOUT_MS: String(fallback.jobTimeoutMs),
    WORKER_QUEUE_TIMEOUT_MS: String(fallback.queueTimeoutMs),
  })
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

export class WorkerScheduler {
  private maxGlobal = envInt('WORKER_MAX_GLOBAL', 2)
  private maxPerWorker = envInt('WORKER_MAX_PER_WORKER', 1)
  private maxPerSession = envInt('WORKER_MAX_PER_SESSION', 2)
  private runtime = new Map<string, RuntimeEntry>()
  private capacityRetryTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private queueTimeoutTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private blockedSessionIds = new Set<string>()
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
    let cleanupFailed = false
    try {
      // Resolve orphan approvals before terminalizing their Job so the normal
      // event order remains approval_resolved -> failed. If a storage/CAS
      // operation fails, keep reconciliation open and retry the residual row
      // on the next invocation (including after the Job has become terminal).
      try {
        const pending = store().listApprovals('pending')
        for (const approval of pending) {
          if (!approval.jobId) continue
          const job = store().getJob(approval.jobId)
          // Queued Jobs are still eligible for admission and must not be
          // treated as restart orphans. A live runtime owns all other Jobs.
          if (job?.status === 'queued' || (job && this.runtime.has(job.id))) continue
          try {
            const result = store().tryResolveJobApproval(approval.id, 'cancel', undefined, {
              resolutionSource: 'system',
              resolutionReason: 'RUNTIME_RESTARTED',
            })
            if (!result.resolved) continue
            clearedApprovals += 1
            if (approval.jobId) {
              try {
                emitWorkerEvent(approval.jobId, {
                  type: 'approval_resolved',
                  jobId: approval.jobId,
                  approval: result.item,
                })
              } catch {
                /* Event delivery must not prevent orphan terminalization. */
              }
            }
          } catch (error) {
            cleanupFailed = true
            // Keep the orphan pass fail-closed without exposing storage paths
            // or internal error text to the event stream/API.
            globalActivityLog.append('approval', 'Orphan approval cleanup failed', {
              jobId: approval.jobId,
              approvalId: approval.id,
              errorType: error instanceof Error ? error.name : typeof error,
            })
          }
        }
      } catch (error) {
        cleanupFailed = true
        globalActivityLog.append('approval', 'Orphan approval listing failed', {
          errorType: error instanceof Error ? error.name : typeof error,
        })
      }

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
        // A concurrent cancel/reconcile may have terminalized the Job while
        // approval CAS cleanup was running. Do not overwrite its winner or
        // publish a duplicate restart failure in that case.
        const afterCleanup = store().getJob(job.id)
        if (!afterCleanup || !isJobOpen(afterCleanup.status)) continue
        store().updateJob(job.id, {
          status: 'failed',
          error: errMsg,
          message: errMsg,
          errorCode: 'RUNTIME_RESTARTED',
          finishedAt: new Date().toISOString(),
        })
        failed += 1
        try {
          emitWorkerEvent(job.id, {
            type: 'failed',
            jobId: job.id,
            output: job.output ?? '',
            error: errMsg,
            errorCode: 'RUNTIME_RESTARTED',
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
      // Only mark reconciled after the approval pass succeeds. A failed CAS
      // leaves the Job terminalized but the Approval durable; the next call
      // enters the same pass and repairs that residual row.
      this.reconciled = !cleanupFailed
      return { failed, clearedApprovals }
    } catch (e) {
      // Do not set reconciled — next call may retry
      globalActivityLog.append(
        'system',
        'reconcileOrphanJobs failed',
        { errorType: e instanceof Error ? e.name : typeof e },
      )
      throw e
    }
  }

  getLifecycleState(): 'accepting' | 'shutting_down' | 'closed' {
    return this.lifecycle
  }

  setSessionPermissionMode(
    sessionId: string,
    permissionMode: SessionPermissionMode,
    opts?: {
      source?: PermissionModeChangeSource
      approvalPolicy?: SessionApprovalPolicy
    },
  ): SetSessionPermissionModeResult {
    return setSessionPermissionModeInStore({
      store: store(),
      sessionId,
      permissionMode,
      source: opts?.source,
      approvalPolicy: opts?.approvalPolicy,
      onApprovalResolved: (approval) => {
        if (!approval.jobId) return
        this.resumeJobTimeout(approval.jobId)
        emitWorkerEvent(approval.jobId, {
          type: 'approval_resolved',
          jobId: approval.jobId,
          approval,
        })
      },
    })
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

  async withSessionAdmission<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    if (this.blockedSessionIds.has(sessionId)) throw new Error('TEAM_REPLACEMENT_IN_PROGRESS')
    this.blockedSessionIds.add(sessionId)
    try {
      return await operation()
    } finally {
      this.blockedSessionIds.delete(sessionId)
    }
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
    if (this.blockedSessionIds.has(sessionId)) throw new Error('TEAM_REPLACEMENT_IN_PROGRESS')
    const projectId = req.projectId ?? active.project?.id ?? active.session?.projectId ?? 'unknown'
    const cwd = req.cwd ?? active.project?.rootPath ?? process.cwd()
    const threadId = req.threadId ?? active.session?.memoryThreadId
    const source = req.source ?? 'api'

    const teamMember = req.teamMemberId
      ? store().getTeamMember(sessionId, req.teamMemberId)
      : undefined
    if (req.teamMemberId && (!teamMember || !teamMember.enabled || teamMember.archivedAt)) {
      throw new Error(`Team member not found or disabled: ${req.teamMemberId}`)
    }
    const roleWorker = teamMember
      ? store()
          .listWorkers()
          .find((worker) => worker.id === teamMember.workerId)
      : undefined
    if (teamMember && !roleWorker) {
      throw new Error(`Worker not found: ${teamMember.workerId}`)
    }
    const roleSnapshot =
      teamMember && roleWorker
        ? buildTeamMemberDispatchSnapshot(teamMember, roleWorker, task)
        : undefined

    const resolved = await this.resolveWorker({
      role: teamMember?.roleType ?? req.role,
      workerIdOrKind: teamMember?.workerId ?? req.workerIdOrKind,
      preferHealthy: req.preferHealthy !== false,
      cwd,
    })
    if (this.blockedSessionIds.has(sessionId)) throw new Error('TEAM_REPLACEMENT_IN_PROGRESS')
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
        role: teamMember?.roleType ?? req.role,
        ...roleSnapshot,
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
          reasoning: job.effectiveReasoning,
        } as WorkerRunEvent)
      }
      return { job }
    }

    const worker = resolved.worker
    const workerTimeouts = resolveWorkerTimeoutSettings(loadSettings().workerTimeouts)
    const job = store().createJob({
      sessionId,
      projectId,
      threadId,
      workerId: worker.id,
      workerName: worker.name,
      role: teamMember?.roleType ?? req.role,
      ...buildWorkerExecutionSnapshot(worker),
      ...roleSnapshot,
      task,
      cwd,
      source,
      status: 'queued',
      message: `Queued for ${worker.name}`,
      meta: {
        forced: Boolean(teamMember || req.workerIdOrKind?.trim()),
        workerTimeouts,
      },
    })

    // Register onEvent before tick so started/delta are never missed
    if (req.onEvent) {
      const emitter = getWorkerEventEmitter()
      emitter.subscribe(job.id, req.onEvent)
    }

    this.scheduleQueueTimeout(job)

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
      teamMemberId: prev.teamMemberId,
      role: prev.teamMemberId ? undefined : prev.role,
      workerIdOrKind: prev.teamMemberId ? undefined : prev.workerId,
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

    if (decision === 'cancel') {
      if (options.optionId) {
        throw new Error('cancel must not specify optionId')
      }
      const item = store().resolveApproval(approvalId, 'cancel', undefined, {
        resolutionSource,
        resolutionReason: 'Cancelled by user',
      })
      const job = item.jobId ? store().getJob(item.jobId) : undefined
      if (job) {
        this.resumeJobTimeout(job.id)
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

    const job = item.jobId ? store().getJob(item.jobId) : undefined
    if (job) {
      this.resumeJobTimeout(job.id)
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

  private clearQueueTimeout(jobId: string): void {
    const timer = this.queueTimeoutTimers.get(jobId)
    if (!timer) return
    clearTimeout(timer)
    this.queueTimeoutTimers.delete(jobId)
  }

  /**
   * Arm the idle Job timer for the supplied delay. Generation check makes a
   * callback that was already queued before pause/touch/resume harmless.
   */
  private armJobTimeout(jobId: string, delayMs: number): void {
    const runtime = this.runtime.get(jobId)
    if (!runtime || !runtime.timeoutHandler) return
    if (runtime.timeout) clearTimeout(runtime.timeout)

    const duration = Math.min(
      Math.max(1, Math.floor(Number.isFinite(delayMs) ? delayMs : 1)),
      MAX_TIMER_DELAY_MS,
    )
    const generation = (runtime.timeoutGeneration ?? 0) + 1
    runtime.timeoutGeneration = generation
    let timer!: ReturnType<typeof setTimeout>
    timer = setTimeout(() => {
      const current = this.runtime.get(jobId)
      if (
        !current ||
        current.timeoutGeneration !== generation ||
        current.timeout !== timer
      ) {
        return
      }
      current.timeout = undefined
      current.timeoutDeadlineMs = undefined
      current.timeoutRemainingMs = 0
      current.timeoutPaused = false
      current.timeoutHandler?.()
    }, duration)
    timer.unref?.()
    runtime.timeout = timer
    runtime.timeoutDeadlineMs = Date.now() + duration
    runtime.timeoutRemainingMs = duration
    runtime.timeoutPaused = false
  }

  /**
   * Start the idle Job timer once the Job has durably entered running.
   * Duration is an inactivity window: ACP updates re-arm a full window.
   */
  private startJobTimeout(jobId: string, durationMs: number, handler: () => void): void {
    const runtime = this.runtime.get(jobId)
    if (!runtime) return
    const duration = Math.min(
      Math.max(1, Math.floor(Number.isFinite(durationMs) ? durationMs : 0)),
      MAX_TIMER_DELAY_MS,
    )
    runtime.timeoutHandler = handler
    runtime.timeoutDurationMs = duration
    runtime.timeoutPaused = false
    this.armJobTimeout(jobId, duration)
  }

  /**
   * Re-arm a full idle window after ACP activity (message / thought / tool / plan).
   * No-op while paused for human approval or when the Job is no longer running.
   */
  private touchJobTimeout(jobId: string): void {
    const job = store().getJob(jobId)
    if (!job || job.status !== 'running') return
    const runtime = this.runtime.get(jobId)
    if (!runtime || !runtime.timeoutHandler || runtime.timeoutPaused) return
    const duration =
      runtime.timeoutDurationMs ??
      workerTimeoutSnapshotFromJob(job).jobTimeoutMs
    runtime.timeoutDurationMs = duration
    this.armJobTimeout(jobId, duration)
  }

  /**
   * Pause the idle Job timer while ACP waits for a permission decision.
   * Queue admission timeout is intentionally separate and is never touched.
   */
  private pauseJobTimeout(jobId: string): void {
    const runtime = this.runtime.get(jobId)
    if (!runtime) return
    if (runtime.timeout) {
      const deadline = runtime.timeoutDeadlineMs ?? Date.now()
      runtime.timeoutRemainingMs = Math.max(0, deadline - Date.now())
      clearTimeout(runtime.timeout)
      runtime.timeout = undefined
      runtime.timeoutDeadlineMs = undefined
    }
    runtime.timeoutPaused = true
    runtime.timeoutGeneration = (runtime.timeoutGeneration ?? 0) + 1
  }

  /** Pause before Approval persistence and restore on a failed create. */
  private pauseWhilePersistingApproval<T>(jobId: string, persist: () => T): T {
    this.pauseJobTimeout(jobId)
    try {
      return persist()
    } catch (error) {
      // No pending Approval was committed, so the Job remains running and its
      // idle timer must continue. If cancellation already won, resume is a
      // no-op and terminal cleanup has (or will) discard the runtime.
      this.resumeJobTimeout(jobId)
      throw error
    }
  }

  /**
   * Resume the idle Job timer after the final pending Approval resolves.
   * Starts a fresh full idle window (approval wait itself has no timeout).
   */
  private resumeJobTimeout(jobId: string): void {
    const job = store().getJob(jobId)
    if (!job || job.status !== 'running') return
    const runtime = this.runtime.get(jobId)
    if (!runtime || runtime.timeout || !runtime.timeoutHandler) return
    const duration =
      runtime.timeoutDurationMs ??
      workerTimeoutSnapshotFromJob(job).jobTimeoutMs
    runtime.timeoutDurationMs = duration
    this.armJobTimeout(jobId, duration)
  }

  /** Clear an active Job timer and discard its pause/resume state. */
  private clearJobTimeout(jobId: string): void {
    const runtime = this.runtime.get(jobId)
    if (!runtime) return
    if (runtime.timeout) clearTimeout(runtime.timeout)
    runtime.timeout = undefined
    runtime.timeoutDeadlineMs = undefined
    runtime.timeoutRemainingMs = undefined
    runtime.timeoutDurationMs = undefined
    runtime.timeoutPaused = false
    runtime.timeoutHandler = undefined
    runtime.timeoutGeneration = (runtime.timeoutGeneration ?? 0) + 1
  }

  private scheduleQueueTimeout(job: WorkerJob): void {
    this.clearQueueTimeout(job.id)
    const { queueTimeoutMs } = workerTimeoutSnapshotFromJob(job)
    const deadlineMs = Date.parse(job.createdAt) + queueTimeoutMs
    const delayMs = Math.max(1, deadlineMs - Date.now())
    const timer = setTimeout(() => {
      this.queueTimeoutTimers.delete(job.id)
      this.expireQueuedJobs(Date.now())
    }, delayMs)
    timer.unref?.()
    this.queueTimeoutTimers.set(job.id, timer)
  }

  private expireQueuedJobs(nowMs = Date.now()): void {
    for (const job of store().listJobs({ status: 'queued', limit: 500 })) {
      const { queueTimeoutMs } = workerTimeoutSnapshotFromJob(job)
      if (nowMs < Date.parse(job.createdAt) + queueTimeoutMs) continue
      this.runtime.get(job.id)?.abort.abort()
      this.terminalize(
        job.id,
        {
          status: 'timed_out',
          error: `Timed out after waiting ${queueTimeoutMs}ms`,
          message: `Timed out after waiting ${queueTimeoutMs}ms`,
          errorCode: 'WORKER_QUEUE_TIMEOUT',
        },
        {
          type: 'timed_out',
          jobId: job.id,
          error: `Timed out after waiting ${queueTimeoutMs}ms`,
          errorCode: 'WORKER_QUEUE_TIMEOUT',
          truncated: false,
          workerName: job.workerName,
          role: job.role,
        } as WorkerRunEvent,
      )
    }
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
      this.expireQueuedJobs()
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
        recoveryError: failure.recoveryError,
        canResetAcpContext: failure.canResetAcpContext,
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
    const workerTimeouts = workerTimeoutSnapshotFromJob(job)
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
    // Execution config is snapshotted at enqueue time; absent means ACP default for legacy jobs.
    const pin = job.effectiveModel?.trim() || undefined
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
        reasoning: job.effectiveReasoning,
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
      teamMemberId: job.teamMemberId,
      teamMemberRevision: job.teamMemberRevision,
      cwd: job.cwd,
      config: sessionConfig,
    })
    const reuseKeyDigest = sessionMgr.digestReuseKey(reuseKey)
    sessionMgr.setSessionProject(job.sessionId, job.projectId)

    const latestQueued = store().getJob(jobId)
    if (!latestQueued || latestQueued.status !== 'queued') {
      this.runtime.delete(jobId)
      return
    }
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
    this.clearQueueTimeout(jobId)
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

    this.startJobTimeout(jobId, workerTimeouts.jobTimeoutMs, () => {
      const latest = store().getJob(jobId)
      if (!latest || !isJobOpen(latest.status)) return
      // Idle timer must stay paused while waiting for human approval.
      if (latest.status === 'pending_approval') return
      const idleMs = workerTimeouts.jobTimeoutMs
      const idleError = `Timed out after ${idleMs}ms without ACP activity`
      this.terminalize(
        jobId,
        {
          status: 'timed_out',
          error: idleError,
          message: idleError,
        },
        {
          type: 'timed_out',
          jobId,
          error: idleError,
          truncated: false,
          workerName: worker.name,
          teamMemberName: job.teamMemberName,
          workerKind: worker.kind,
          role: job.role,
          model: job.effectiveModel,
        } as WorkerRunEvent,
        { retainRuntime: true },
      )
      abort.abort()
    })

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
        task: job.effectivePrompt ?? job.task,
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
              teamMemberName: job.teamMemberName,
              workerKind: worker.kind,
              role: job.role,
              model: job.effectiveModel,
              reasoning: job.effectiveReasoning,
              task: job.task,
              reusedSession: disposition !== 'new',
              sessionDisposition: disposition,
            } as WorkerRunEvent)
          },
          onPermissionRequest: async (request) => {
            const cur = store().getJob(jobId)
            if (!cur || !isJobOpen(cur.status)) {
              return { outcome: 'cancelled' as const }
            }

            const { decision, toolKind } = decidePermissionForJobInStore({
              store: store(),
              jobId,
              request,
            })

            if (decision.mode === 'cancelled') {
              return { outcome: 'cancelled' as const }
            }

            // Every requestPermission emitted by the Agent takes the same
            // durable Approval path. The Agent remains responsible for deciding
            // which safe operations need no request. Default leaves emitted
            // requests pending; auto resolves them through Session policy.
            const locs: ApprovalLocation[] = (request.locations ?? []).map((l) => ({
              filePath: l.path,
              line: l.line,
            }))
            const approvalId = createId('appr')
            const { item, waiterPromise } = this.pauseWhilePersistingApproval(
              jobId,
              () =>
                persistApprovalWithReservedWaiter({
                  approvalId,
                  waiters: globalApprovalWaiters,
                  persist: () => {
                    // createJobApproval persists the Approval and Job transition
                    // together. The waiter was reserved above, so a resolver can
                    // never observe an Approval that is missing its Job linkage.
                    return store().createJobApproval({
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
                      jobId,
                    })
                  },
                }),
            )

            // Publish the request before any policy reconciliation. This keeps
            // the event contract requested -> resolved even when the Session is
            // already in auto mode (the UI must see the Approval enter first).
            globalActivityLog.append('job', `Job pending approval: ${job.workerName}`, {
              jobId,
              approvalId: item.id,
            })
            emitWorkerEvent(jobId, {
              type: 'approval_requested',
              jobId,
              approval: item,
            })

            // The Session may have switched to auto after the first live-mode
            // decision but before this Approval committed. Reconcile again only
            // after persistence: either the shield's scan sees this item, or
            // this post-commit scan sees the shield, so no request can fall
            // through that boundary and remain pending.
            reconcileSessionPendingApprovalsInStore({
              store: store(),
              sessionId: job.sessionId,
              onApprovalResolved: (approval) => {
                if (!approval.jobId) return
                this.resumeJobTimeout(approval.jobId)
                emitWorkerEvent(approval.jobId, {
                  type: 'approval_resolved',
                  jobId: approval.jobId,
                  approval,
                })
              },
            })

            // Approval requests are user-driven and intentionally have no
            // business timeout. They stay pending until manual resolution,
            // Session auto-accept, explicit cancellation, or Job termination.
            const outcome = await waiterPromise

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
            // Any ACP message chunk proves the Agent is still working.
            this.touchJobTimeout(jobId)
            emitWorkerEvent(jobId, { type: 'delta', jobId, sequence, delta })
          },
          onSessionActivity: (sequence, activity) => {
            const latest = store().getJob(jobId)
            if (!latest || !isJobOpen(latest.status)) return
            if (activity.kind === 'message_delta') {
              // Already emitted via onOutputDelta (and idle timer touched there).
              return
            }
            // Thought / tool / plan updates also count as live ACP activity.
            this.touchJobTimeout(jobId)
            if (activity.kind === 'thought_delta') {
              emitWorkerEvent(jobId, {
                type: 'thought_delta',
                jobId,
                sequence,
                delta: activity.text,
              })
              return
            }
            if (activity.kind === 'tool_call' || activity.kind === 'tool_call_update') {
              const tc = activity.toolCall
              emitWorkerEvent(jobId, {
                type: activity.kind,
                jobId,
                sequence,
                toolCall: {
                  toolCallId: tc.toolCallId,
                  title: tc.title,
                  ...(tc.kind
                    ? {
                        kind: tc.kind as
                          | 'read'
                          | 'edit'
                          | 'delete'
                          | 'move'
                          | 'search'
                          | 'execute'
                          | 'think'
                          | 'fetch'
                          | 'switch_mode'
                          | 'other',
                      }
                    : {}),
                  ...(tc.status
                    ? {
                        status: tc.status as
                          | 'pending'
                          | 'in_progress'
                          | 'completed'
                          | 'failed',
                      }
                    : {}),
                  ...(tc.detail ? { detail: tc.detail } : {}),
                  ...(tc.locations ? { locations: tc.locations } : {}),
                },
              })
              return
            }
            if (activity.kind === 'plan') {
              emitWorkerEvent(jobId, {
                type: 'plan',
                jobId,
                sequence,
                entries: activity.entries,
              })
            }
          },
        },
        signal: abort.signal,
      })

      this.clearJobTimeout(jobId)

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
          model: job.effectiveModel,
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
            teamMemberName: job.teamMemberName,
            workerKind: worker.kind,
            role: job.role,
            model: job.effectiveModel,
            reasoning: job.effectiveReasoning,
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
          message: job.effectiveModel
            ? `Completed via ${job.workerName} (model=${job.effectiveModel}${result.reusedSession ? ', reused session' : ''})`
            : `Completed via ${job.workerName}${result.reusedSession ? ' (reused session)' : ''}`,
          output: result.output?.slice(0, 32_000),
        },
        {
          type: 'completed',
          jobId,
          output: result.output?.slice(0, 32_000) ?? '',
          truncated,
          workerName: worker.name,
          teamMemberName: job.teamMemberName,
          workerKind: worker.kind,
          role: job.role,
          model: job.effectiveModel,
          reasoning: job.effectiveReasoning,
        } as WorkerRunEvent,
      )
    } catch (e) {
      this.clearJobTimeout(jobId)
      const latest = store().getJob(jobId)
      if (!latest || !isJobOpen(latest.status)) {
        this.runtime.delete(jobId)
        void this.tick()
        return
      }
      const failure = toPublicAcpFailure(e)
      const runtimeCode = toPublicWorkerJobErrorCode(
        isAcpSessionRuntimeError(e) ? e.code : undefined,
      )
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
          recoveryError: failure.recoveryError,
          canResetAcpContext: failure.canResetAcpContext,
        },
        {
          type: 'failed',
          jobId,
          output: '',
          error: failure.recoveryError ? undefined : failure.error,
          errorCode: runtimeCode,
          truncated: false,
          workerName: worker.name,
          teamMemberName: job.teamMemberName,
          workerKind: worker.kind,
          role: job.role,
          model: job.effectiveModel,
          reasoning: job.effectiveReasoning,
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
      recoveryError?: string
      canResetAcpContext?: boolean
    },
    event?: WorkerRunEvent,
    opts?: { retainRuntime?: boolean },
  ): WorkerJob | undefined {
    this.clearQueueTimeout(jobId)
    const retryTimer = this.capacityRetryTimers.get(jobId)
    if (retryTimer) {
      clearTimeout(retryTimer)
      this.capacityRetryTimers.delete(jobId)
    }
    // Terminal transitions discard any paused or armed active Job timer before
    // cleanup resolves the remaining approvals. This prevents cleanup's CAS
    // from briefly re-arming a timer for a Job that is being closed.
    this.clearJobTimeout(jobId)
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
