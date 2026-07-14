/**
 * Worker job scheduler: queue, concurrency slots, ACP execution, cancel.
 * @see plan — Worker 调度能力
 */
import {
  applyHealthReport,
  buildSessionReuseKey,
  defaultCanRunAcp,
  formatWorkerModelError,
  getAcpSessionManager,
  listWorkersForRole,
  probeWorkerHealth,
  selectWorkerByRole,
  type AcpSpawnConfig,
  type SessionEntryConfig,
} from '@router-agents/adapters'
import {
  createId,
  getSharedStore,
  globalActivityLog,
  mapAcpPermissionToEnqueue,
  waitForApprovalDecision,
  globalApprovalWaiters,
} from '@router-agents/core'
import {
  isHealthReportFresh,
  isJobOpen,
  type JobSource,
  type JobStatus,
  type WorkerJob,
  type WorkerRegistration,
  type WorkerRole,
  type WorkerRunEvent,
} from '@router-agents/shared'
import { emitWorkerEvent, getWorkerEventEmitter } from './worker-events.js'

const store = getSharedStore()

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
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export function capacityRetryDelay(
  error: string | undefined,
  raw = process.env.ACP_SESSION_RETRY_MS,
): number | null {
  if (error !== 'capacity_exhausted') return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 250
}

export class WorkerScheduler {
  private maxGlobal = envInt('WORKER_MAX_GLOBAL', 2)
  private maxPerWorker = envInt('WORKER_MAX_PER_WORKER', 1)
  private maxPerSession = envInt('WORKER_MAX_PER_SESSION', 2)
  private jobTimeoutMs = envInt('WORKER_JOB_TIMEOUT_MS', 600_000)
  private runtime = new Map<string, RuntimeEntry>()
  private capacityRetryTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private ticking = false
  private waiters = new Map<
    string,
    { resolve: (job: WorkerJob) => void; reject: (e: Error) => void }
  >()

  listJobs(filter?: Parameters<typeof store.listJobs>[0]): WorkerJob[] {
    return store.listJobs(filter)
  }

  getJob(id: string): WorkerJob | undefined {
    return store.getJob(id)
  }

  busyWorkerIds(): Set<string> {
    const ids = new Set<string>()
    for (const j of store.listJobs({
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

    const active = store.getActive()
    const sessionId =
      req.sessionId ?? active.session?.id ?? createId('sess-orphan')
    const projectId =
      req.projectId ?? active.project?.id ?? active.session?.projectId ?? 'unknown'
    const cwd =
      req.cwd ??
      active.project?.rootPath ??
      process.cwd()
    const threadId = req.threadId ?? active.session?.memoryThreadId
    const source = req.source ?? 'api'

    const resolved = await this.resolveWorker({
      role: req.role,
      workerIdOrKind: req.workerIdOrKind,
      preferHealthy: req.preferHealthy !== false,
      cwd,
    })

    if (!resolved.ok || !resolved.worker) {
      const job = store.createJob({
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
      })
      globalActivityLog.append('job', `Job failed (no worker): ${job.workerName}`, {
        jobId: job.id,
        error: resolved.message,
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
    const job = store.createJob({
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
    return { job: store.getJob(job.id) ?? job }
  }

  async cancel(jobId: string): Promise<WorkerJob> {
    const job = store.getJob(jobId)
    if (!job) throw new Error(`Job not found: ${jobId}`)
    if (!isJobOpen(job.status)) return job

    if (job.status === 'queued') {
      const retryTimer = this.capacityRetryTimers.get(jobId)
      if (retryTimer) {
        clearTimeout(retryTimer)
        this.capacityRetryTimers.delete(jobId)
      }
      emitWorkerEvent(jobId, {
        type: 'cancelled', jobId, error: 'Cancelled while queued', truncated: false,
        workerName: job.workerName, role: job.role,
      } as WorkerRunEvent)
      const updated = store.updateJob(jobId, {
        status: 'cancelled',
        finishedAt: new Date().toISOString(),
        message: 'Cancelled while queued',
      })
      this.resolveWaiter(jobId, updated)
      globalActivityLog.append('job', `Job cancelled (queued): ${job.workerName}`, {
        jobId,
      })
      void this.tick()
      return updated
    }

    // running / pending_approval
    if (job.approvalIds?.length) {
      for (const aid of job.approvalIds) {
        try { store.resolveApproval(aid, 'cancel') } catch {}
      }
      globalApprovalWaiters.cancelMany(job.approvalIds)
    }
    const rt = this.runtime.get(jobId)
    if (rt?.timeout) { clearTimeout(rt.timeout); rt.timeout = undefined }
    emitWorkerEvent(jobId, {
      type: 'cancelled', jobId, error: 'Cancel requested', truncated: false,
      workerName: job.workerName, role: job.role,
    } as WorkerRunEvent)
    rt?.abort.abort()
    const updated = store.updateJob(jobId, {
      status: 'cancelled',
      finishedAt: new Date().toISOString(),
      message: 'Cancel requested',
    })
    this.resolveWaiter(jobId, updated)
    globalActivityLog.append('job', `Job cancelled: ${job.workerName}`, { jobId })
    // Don't delete runtime or tick here — finish() handles cleanup when ACP terminates
    return updated
  }

  async retry(jobId: string, opts?: { wait?: boolean }): Promise<ScheduleResult> {
    const prev = store.getJob(jobId)
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

  async waitForJob(jobId: string): Promise<WorkerJob> {
    const existing = store.getJob(jobId)
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
    if (this.capacityRetryTimers.has(jobId)) return
    const timer = setTimeout(() => {
      this.capacityRetryTimers.delete(jobId)
      void this.tick()
    }, delayMs)
    timer.unref?.()
    this.capacityRetryTimers.set(jobId, timer)
  }

  private async resolveWorker(opts: {
    role?: WorkerRole
    workerIdOrKind?: string
    preferHealthy?: boolean
    cwd: string
  }): Promise<{ ok: boolean; worker?: WorkerRegistration; message?: string }> {
    const forced = Boolean(opts.workerIdOrKind?.trim())
    const workers = store.listWorkers()
    const busy = this.busyWorkerIds()

    // Prefer non-busy when selecting by role
    const available = forced
      ? workers
      : workers.map((w) => {
          const open = store.countOpenJobs({ workerId: w.id })
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
          store.upsertWorker(worker)
        } catch (e) {
          errors.push(`${cand.name}: probe failed ${e instanceof Error ? e.message : e}`)
          continue
        }
      }

      if (!forced && (worker.health === 'missing' || worker.health === 'unhealthy')) {
        errors.push(
          `${worker.name}: ${worker.health} — ${worker.healthReport?.message ?? ''}`,
        )
        continue
      }

      // Slot check for non-forced: skip if at max (queue will wait if we still pick)
      // For resolve we allow pick even if busy — job will stay queued.
      if (!busy.has(worker.id) || forced || store.countOpenJobs({ workerId: worker.id }) < this.maxPerWorker) {
        // canRunAcp
        const config = {
          command: worker.command,
          args: worker.args,
          cwd: opts.cwd,
          env: { ...process.env, ...worker.env } as Record<string, string>,
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
    const firstHealthy = candidates.find(
      (c) => c.health === 'healthy' || c.health === 'unknown',
    )
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
    // Queued jobs do not consume run slots — only running + pending_approval do
    const runningLike = store.listJobs({
      status: ['running', 'pending_approval'],
      limit: 500,
    }).length
    if (runningLike >= this.maxGlobal) return false

    const perWorker = store.listJobs({
      workerId: job.workerId,
      status: ['running', 'pending_approval'],
      limit: 50,
    }).length
    if (perWorker >= this.maxPerWorker) return false

    const perSession = store.listJobs({
      sessionId: job.sessionId,
      status: ['running', 'pending_approval'],
      limit: 50,
    }).length
    if (perSession >= this.maxPerSession) return false

    return true
  }

  async tick(): Promise<void> {
    if (this.ticking) return
    this.ticking = true
    try {
      const queued = store
        .listJobs({ status: 'queued', limit: 50 })
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))

      for (const job of queued) {
        if (!this.canAdmit(job)) continue
        // fire without awaiting whole queue
        void this.runJob(job.id)
        // one admit per tick loop iteration then recheck — allow parallel starts up to slots
      }
    } finally {
      this.ticking = false
    }
  }

  private async runJob(jobId: string): Promise<void> {
    const job = store.getJob(jobId)
    if (!job || job.status !== 'queued') return
    if (!this.canAdmit(job)) return

    // Claim: only one runner wins if status still queued
    if (this.runtime.has(jobId)) return
    const abort = new AbortController()
    this.runtime.set(jobId, { abort })

    const claimed = store.getJob(jobId)
    if (!claimed || claimed.status !== 'queued') {
      this.runtime.delete(jobId)
      return
    }

    const worker = store.listWorkers().find((w) => w.id === job.workerId)
    if (!worker) {
      emitWorkerEvent(jobId, {
        type: 'failed', jobId, output: '', error: 'Worker no longer registered', truncated: false,
        workerName: job.workerName, role: job.role,
      } as WorkerRunEvent)
      this.finish(jobId, {
        status: 'failed',
        error: 'Worker no longer registered',
        message: 'Worker no longer registered',
      })
      return
    }

    const config: AcpSpawnConfig = {
      command: worker.command,
      args: [...worker.args],
      cwd: job.cwd,
      env: { ...process.env, ...worker.env } as Record<string, string>,
      workerId: worker.id,
      workerName: worker.name,
      kind: worker.kind,
      primaryRole: worker.primaryRole,
      roles: [...worker.roles],
      model: worker.model?.trim() || undefined,
    }
    const rt = this.runtime.get(jobId)
    if (rt) rt.config = config

    // Build session reuse key for AcpSessionManager
    const sessionConfig: SessionEntryConfig = {
      command: config.command,
      args: [...config.args],
      model: config.model,
      env: config.env,
    }
    const reuseKey = buildSessionReuseKey({
      routerSessionId: job.sessionId,
      workerId: worker.id,
      cwd: job.cwd,
      config: sessionConfig,
    })
    const sessionMgr = getAcpSessionManager()
    sessionMgr.setSessionProject(job.sessionId, job.projectId)

    if (!sessionMgr.canAccept(reuseKey)) {
      this.runtime.delete(jobId)
      const delayMs = capacityRetryDelay('capacity_exhausted')!
      store.updateJob(jobId, {
        status: 'queued',
        message: `Waiting for ACP session capacity; retrying in ${delayMs}ms`,
      })
      this.scheduleCapacityRetry(jobId, delayMs)
      return
    }
    const reusedSession = sessionMgr.willReuse(reuseKey)

    store.updateJob(jobId, {
      status: 'running',
      startedAt: new Date().toISOString(),
      message: `Running on ${job.workerName}`,
    })
    globalActivityLog.append('job', `Job running: ${job.workerName}`, {
      jobId,
      workerId: job.workerId,
    })

    const timeout = setTimeout(() => {
      const latestJob = store.getJob(jobId)
      if (latestJob?.approvalIds?.length) {
        for (const aid of latestJob.approvalIds) {
          try { store.resolveApproval(aid, 'cancel') } catch {}
        }
        globalApprovalWaiters.cancelMany(latestJob.approvalIds)
      }
      emitWorkerEvent(jobId, {
        type: 'timed_out', jobId, error: `Timed out after ${this.jobTimeoutMs}ms`, truncated: false,
        workerName: worker.name, workerKind: worker.kind, role: job.role, model: worker.model?.trim() || undefined,
      } as WorkerRunEvent)
      abort.abort()
      this.finish(jobId, {
        status: 'timed_out',
        error: `Timed out after ${this.jobTimeoutMs}ms`,
        message: `Timed out after ${this.jobTimeoutMs}ms`,
      })
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

      emitWorkerEvent(jobId, {
        type: 'started',
        jobId,
        workerId: worker.id,
        workerName: worker.name,
        workerKind: worker.kind,
        role: job.role,
        model: worker.model?.trim() || undefined,
        reusedSession,
      } as WorkerRunEvent)

      const result = await sessionMgr.enqueuePrompt({
        key: reuseKey,
        config: sessionConfig,
        kind: worker.kind,
        task: job.task,
        binding: {
          jobId,
          signal: abort.signal,
          sequence: 0,
          onPermissionRequest: async (request) => {
            const cur = store.getJob(jobId)
            if (!cur || cur.status === 'cancelled') {
              return { outcome: 'cancelled' as const }
            }
            const item = store.enqueueApproval(
              mapAcpPermissionToEnqueue({
                title: request.title,
                options: request.options,
                workerId: config.workerId,
                workerName: config.workerName,
                sessionId: job.sessionId,
              }),
            )
            store.updateJob(jobId, {
              status: 'pending_approval',
              message: `Waiting for approval: ${request.title}`,
              approvalIds: [...(cur.approvalIds ?? []), item.id],
            })
            globalActivityLog.append('job', `Job pending approval: ${job.workerName}`, {
              jobId,
              approvalId: item.id,
            })
            const timeoutMs = Number(process.env.APPROVAL_TIMEOUT_MS ?? 120_000)
            const waited = await waitForApprovalDecision(item.id, { timeoutMs })
            const after = store.getJob(jobId)
            if (after && after.status === 'pending_approval') {
              store.updateJob(jobId, {
                status: 'running',
                message: `Running on ${job.workerName}`,
              })
            }
            if (waited.outcome === 'selected') {
              return {
                outcome: 'selected' as const,
                optionId: waited.optionId ?? request.options.find((o) => /allow|yes|approve/i.test(o.name))?.optionId ?? request.options[0]?.optionId,
              }
            }
            return { outcome: 'cancelled' as const }
          },
          onOutputDelta: (sequence, delta) => {
            emitWorkerEvent(jobId, { type: 'delta', jobId, sequence, delta })
          },
        },
        signal: abort.signal,
      })

      clearTimeout(timeout)

      const latest = store.getJob(jobId)
      if (latest?.status === 'cancelled' || latest?.status === 'timed_out') {
        emitWorkerEvent(jobId, {
          type: 'cancelled', jobId, error: latest.message, truncated: false,
          workerName: worker.name, workerKind: worker.kind, role: job.role, model: worker.model?.trim() || undefined,
        } as WorkerRunEvent)
        this.runtime.delete(jobId)
        void this.tick()
        return
      }

      if (!result.ok) {
        const retryDelay = capacityRetryDelay(result.error)
        if (retryDelay !== null) {
          store.updateJob(jobId, {
            status: 'queued',
            message: `Waiting for ACP session capacity; retrying in ${retryDelay}ms`,
          })
          this.runtime.delete(jobId)
          this.scheduleCapacityRetry(jobId, retryDelay)
          return
        }
        const truncated = (result.output?.length ?? 0) >= 32_000
        emitWorkerEvent(jobId, {
          type: 'failed',
          jobId,
          output: result.output?.slice(0, 32_000),
          error: result.error,
          truncated,
          workerName: worker.name,
          workerKind: worker.kind,
          role: job.role,
          model: worker.model?.trim() || undefined,
        } as WorkerRunEvent)
        const err = formatWorkerModelError({
          workerName: worker.name,
          kind: worker.kind,
          model: worker.model,
          rawError: result.error ?? 'ACP failed',
        })
        this.finish(jobId, {
          status: 'failed',
          error: err,
          message: err,
          output: result.output?.slice(0, 32_000),
        })
        return
      }

      // touch worker health
      try {
        const report = await probeWorkerHealth(worker, { level: 'presence', cwd: job.cwd })
        if (report.status === 'healthy') {
          store.upsertWorker(applyHealthReport(worker, report))
        }
      } catch { /* ignore */ }

      const truncated = (result.output?.length ?? 0) >= 32_000
      emitWorkerEvent(jobId, {
        type: 'completed',
        jobId,
        output: result.output?.slice(0, 32_000) ?? '',
        truncated,
        workerName: worker.name,
        workerKind: worker.kind,
        role: job.role,
        model: worker.model?.trim() || undefined,
      } as WorkerRunEvent)

      this.finish(jobId, {
        status: 'succeeded',
        message: worker.model
          ? `Completed via ${job.workerName} (model=${worker.model}${result.reusedSession ? ', reused session' : ''})`
          : `Completed via ${job.workerName}${result.reusedSession ? ' (reused session)' : ''}`,
        output: result.output?.slice(0, 32_000),
      })
    } catch (e) {
      clearTimeout(timeout)
      const latest = store.getJob(jobId)
      if (latest?.status === 'cancelled' || latest?.status === 'timed_out') {
        this.runtime.delete(jobId)
        void this.tick()
        return
      }
      const msg = e instanceof Error ? e.message : String(e)
      emitWorkerEvent(jobId, {
        type: 'failed', jobId, output: '', error: msg, truncated: false,
        workerName: worker.name, workerKind: worker.kind, role: job.role, model: worker.model?.trim() || undefined,
      } as WorkerRunEvent)
      this.finish(jobId, {
        status: 'failed',
        error: msg,
        message: msg,
      })
    }
  }

  private finish(
    jobId: string,
    patch: {
      status: JobStatus
      message?: string
      error?: string
      output?: string
    },
  ): void {
    const retryTimer = this.capacityRetryTimers.get(jobId)
    if (retryTimer) {
      clearTimeout(retryTimer)
      this.capacityRetryTimers.delete(jobId)
    }
    const existing = store.getJob(jobId)
    if (!existing) return
    if (!isJobOpen(existing.status) && existing.status !== 'running') {
      // already terminal (e.g. cancel() set it before ACP cleanup completed)
      this.runtime.delete(jobId)
      void this.tick()
      return
    }
    // allow finish from running/pending/queued
    const updated = store.updateJob(jobId, {
      ...patch,
      finishedAt: new Date().toISOString(),
    })
    const rt = this.runtime.get(jobId)
    if (rt?.timeout) clearTimeout(rt.timeout)
    this.runtime.delete(jobId)
    this.resolveWaiter(jobId, updated)
    globalActivityLog.append(
      'job',
      `Job ${patch.status}: ${existing.workerName}`,
      { jobId, status: patch.status },
    )
    void this.tick()
  }
}

let singleton: WorkerScheduler | null = null

export function getWorkerScheduler(): WorkerScheduler {
  if (!singleton) singleton = new WorkerScheduler()
  return singleton
}
