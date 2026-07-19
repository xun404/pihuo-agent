import type {
  ApprovalItem,
  JobSource,
  WorkerJob,
  WorkerRole,
  WorkerRunEvent,
} from '@swarmdesk-agent/shared'
import { isTerminalWorkerEvent } from '@swarmdesk-agent/shared'
import type { LocalStore } from '@swarmdesk-agent/core'
import type { ScheduleRequest, ScheduleResult } from './scheduler.js'
import type { WorkerEventEmitter } from './worker-events.js'

export interface RouterSessionContext {
  routerSessionId: string
  routerProjectId: string
  routerProjectRoot?: string
  memoryThreadId: string
}

export interface TrustedDispatchInput {
  context: RouterSessionContext
  workerId?: string
  workerIdOrKind?: string
  role?: WorkerRole
  task: string
  cwd?: string
  source?: JobSource
  wait?: boolean
  onEvent?: (event: WorkerRunEvent) => void
}

export interface ResolveApprovalPortInput {
  approvalId: string
  optionId?: string
  decision?: 'allow' | 'deny' | 'cancel'
  surface?: 'chat' | 'panel'
}

type ValidatedRuntimeApprovalInput = Required<
  Pick<ResolveApprovalPortInput, 'approvalId' | 'decision' | 'surface'>
> &
  Pick<ResolveApprovalPortInput, 'optionId'>

export function validateRuntimeApprovalResolveInput(
  input: Partial<ResolveApprovalPortInput>,
): { ok: true; value: ValidatedRuntimeApprovalInput } | { ok: false; error: string } {
  const approvalId = input.approvalId?.trim()
  if (!approvalId) return { ok: false, error: 'approvalId required' }
  const decision = input.decision
  if (!decision || !['allow', 'deny', 'cancel'].includes(decision)) {
    return { ok: false, error: 'decision must be allow|deny|cancel' }
  }
  const surface = input.surface ?? 'panel'
  if (surface !== 'chat' && surface !== 'panel') {
    return { ok: false, error: 'surface must be chat|panel' }
  }
  const optionId = input.optionId?.trim()
  if (decision === 'cancel') {
    if (optionId) return { ok: false, error: 'optionId is not allowed for cancel' }
    return { ok: true, value: { approvalId, decision, surface } }
  }
  if (!optionId) return { ok: false, error: 'optionId required for allow|deny' }
  return { ok: true, value: { approvalId, optionId, decision, surface } }
}

export interface RuntimeDispatchPort {
  resolveSessionContext(memoryThreadId: string): Promise<RouterSessionContext | null>
  dispatch(input: TrustedDispatchInput): Promise<WorkerJob>
  events(
    jobId: string,
    signal?: AbortSignal,
    options?: { afterSequence?: number },
  ): AsyncIterable<WorkerRunEvent>
  cancel(jobId: string): Promise<void>
  resolveApproval(input: ResolveApprovalPortInput): Promise<void>
  getJob?(jobId: string): Promise<WorkerJob | null>
  listJobs?(filter?: { sessionId?: string; limit?: number }): Promise<WorkerJob[]>
}

export interface LocalDispatchScheduler {
  enqueue(req: ScheduleRequest): Promise<ScheduleResult>
  cancel(jobId: string): Promise<WorkerJob>
  resolveApproval(
    approvalId: string,
    decision: 'allow' | 'deny' | 'cancel',
    options: { optionId?: string; surface: 'chat' | 'panel' },
  ): ApprovalItem
  waitForJob(jobId: string): Promise<WorkerJob>
  getJob?(jobId: string): WorkerJob | undefined
  listJobs?(filter?: { sessionId?: string; limit?: number }): WorkerJob[]
}

export interface LocalRuntimeDispatchDeps {
  store: Pick<LocalStore, 'listSessions' | 'listProjects'>
  scheduler: LocalDispatchScheduler
  events: Pick<WorkerEventEmitter, 'subscribe' | 'isTerminal'>
}

export function createLocalRuntimeDispatchPort(
  deps: LocalRuntimeDispatchDeps,
): RuntimeDispatchPort {
  return {
    async resolveSessionContext(memoryThreadId: string): Promise<RouterSessionContext | null> {
      const threadId = memoryThreadId?.trim()
      if (!threadId) return null
      const session = deps.store.listSessions().find((s) => s.memoryThreadId === threadId)
      if (!session) return null
      const project = deps.store.listProjects().find((p) => p.id === session.projectId)
      return {
        routerSessionId: session.id,
        routerProjectId: session.projectId,
        routerProjectRoot: project?.rootPath,
        memoryThreadId: session.memoryThreadId,
      }
    },

    async dispatch(input: TrustedDispatchInput): Promise<WorkerJob> {
      const workerIdOrKind = input.workerIdOrKind ?? input.workerId
      const { job } = await deps.scheduler.enqueue({
        task: input.task,
        role: input.role,
        workerIdOrKind,
        cwd: input.cwd ?? input.context.routerProjectRoot,
        sessionId: input.context.routerSessionId,
        projectId: input.context.routerProjectId,
        threadId: input.context.memoryThreadId,
        source: input.source ?? 'leader',
        wait: input.wait === true,
        onEvent: input.onEvent,
      })
      return job
    },

    async *events(
      jobId: string,
      signal?: AbortSignal,
      options?: { afterSequence?: number },
    ): AsyncIterable<WorkerRunEvent> {
      const queue: WorkerRunEvent[] = []
      let done = false
      let wake: (() => void) | null = null

      const push = (event: WorkerRunEvent) => {
        queue.push(event)
        if (isTerminalWorkerEvent(event)) done = true
        wake?.()
      }

      // Atomic replay+subscribe: journal events are delivered synchronously in subscribe.
      const unsub = deps.events.subscribe(jobId, push, {
        afterSequence: options?.afterSequence,
      })
      // If job already terminal and journal empty/expired, close immediately (no hang).
      if (!done && deps.events.isTerminal?.(jobId)) {
        done = true
      }
      // Journal TTL expired: only synthesize when Job is already durable-terminal.
      // queued/running/pending_approval must keep waiting for live events.
      if (!done && queue.length === 0 && deps.scheduler.getJob) {
        const job = deps.scheduler.getJob(jobId)
        if (!job) {
          // Unknown job — do not hang forever
          done = true
        } else if (
          job.status === 'succeeded' ||
          job.status === 'failed' ||
          job.status === 'cancelled' ||
          job.status === 'timed_out'
        ) {
          const synthetic: WorkerRunEvent =
            job.status === 'succeeded'
              ? {
                  type: 'completed',
                  jobId,
                  output: job.output ?? '',
                  truncated: false,
                  workerName: job.workerName,
                  role: job.role,
                }
              : {
                  type:
                    job.status === 'cancelled'
                      ? 'cancelled'
                      : job.status === 'timed_out'
                        ? 'timed_out'
                        : 'failed',
                  jobId,
                  output: job.output,
                  error: job.error ?? job.message,
                  errorCode: job.errorCode,
                  truncated: false,
                  workerName: job.workerName,
                  role: job.role,
                }
          queue.push(synthetic)
          done = true
        }
        // open statuses: leave done=false and wait for subscribe pushes
      }
      const onAbort = () => {
        done = true
        wake?.()
      }
      if (signal) {
        if (signal.aborted) onAbort()
        else signal.addEventListener('abort', onAbort, { once: true })
      }

      try {
        while (true) {
          while (queue.length > 0) {
            const event = queue.shift()!
            yield event
            if (isTerminalWorkerEvent(event)) return
          }
          if (done) return
          await new Promise<void>((resolve) => {
            wake = resolve
          })
          wake = null
        }
      } finally {
        unsub()
        if (signal) signal.removeEventListener('abort', onAbort)
      }
    },

    async cancel(jobId: string): Promise<void> {
      await deps.scheduler.cancel(jobId)
    },

    async resolveApproval(input: ResolveApprovalPortInput): Promise<void> {
      const validated = validateRuntimeApprovalResolveInput(input)
      if (!validated.ok) throw new Error(validated.error)
      deps.scheduler.resolveApproval(validated.value.approvalId, validated.value.decision, {
        optionId: validated.value.optionId,
        surface: validated.value.surface,
      })
    },

    async getJob(jobId: string): Promise<WorkerJob | null> {
      if (deps.scheduler.getJob) {
        return deps.scheduler.getJob(jobId) ?? null
      }
      // Fallback: wait is wrong for status poll; use store via shared if needed.
      return null
    },

    async listJobs(filter?: { sessionId?: string; limit?: number }): Promise<WorkerJob[]> {
      if (deps.scheduler.listJobs) {
        return deps.scheduler.listJobs(filter)
      }
      return []
    },
  }
}

let portSingleton: RuntimeDispatchPort | null = null

export function setRuntimeDispatchPort(port: RuntimeDispatchPort | null): void {
  portSingleton = port
}

/**
 * Fail closed when port is not injected — client-only processes must not
 * silently create a second local executor.
 */
export function getRuntimeDispatchPort(): RuntimeDispatchPort {
  if (!portSingleton) {
    throw new Error(
      'RUNTIME_PORT_NOT_INJECTED: RuntimeDispatchPort is not configured. ' +
        'Owner runtime must call setRuntimeDispatchPort; client-only must use remote port.',
    )
  }
  return portSingleton
}

export function resetRuntimeDispatchPortForTests(): void {
  portSingleton = null
}
