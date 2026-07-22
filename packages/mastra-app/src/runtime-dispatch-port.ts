import type {
  ApprovalItem,
  JobSource,
  RoleDefinition,
  CreateRoleDefinitionInput,
  UpdateRoleDefinitionInput,
  WorkerJob,
  WorkerRole,
  WorkerRunEvent,
} from '@swarmdesk-agent/shared'
import { isTerminalWorkerEvent } from '@swarmdesk-agent/shared'
import type { LocalStore } from '@swarmdesk-agent/core'
import type { ScheduleRequest, ScheduleResult } from './scheduler.js'
import type { WorkerEventEmitter } from './worker-events.js'
import { getAcpSessionManager } from '@swarmdesk-agent/adapters'

export interface RouterSessionContext {
  routerSessionId: string
  routerProjectId: string
  routerProjectRoot?: string
  memoryThreadId: string
}

export interface TrustedDispatchInput {
  context: RouterSessionContext
  roleDefinitionId?: string
  workerId?: string
  workerIdOrKind?: string
  role?: WorkerRole
  task: string
  cwd?: string
  source?: JobSource
  wait?: boolean
  onEvent?: (event: WorkerRunEvent) => void
}

export interface RoleDefinitionMutationInput {
  context: RouterSessionContext
  roleDefinitionId: string
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
  listRoleDefinitions?(context: RouterSessionContext): Promise<RoleDefinition[]>
  createRoleDefinition?(input: {
    context: RouterSessionContext
    input: Omit<CreateRoleDefinitionInput, 'chatSessionId'>
  }): Promise<RoleDefinition>
  updateRoleDefinition?(
    input: RoleDefinitionMutationInput & {
      patch: UpdateRoleDefinitionInput
    },
  ): Promise<RoleDefinition>
  archiveRoleDefinition?(
    input: RoleDefinitionMutationInput & {
      expectedRevision?: number
    },
  ): Promise<RoleDefinition>
  resetRoleSession?(input: RoleDefinitionMutationInput): Promise<{ deleted: boolean }>
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
  store: Pick<
    LocalStore,
    | 'listSessions'
    | 'listProjects'
    | 'listRoleDefinitions'
    | 'createRoleDefinition'
    | 'updateRoleDefinition'
    | 'archiveRoleDefinition'
    | 'countOpenJobs'
    | 'listJobs'
  >
  scheduler: LocalDispatchScheduler
  events: Pick<WorkerEventEmitter, 'subscribe' | 'isTerminal'>
  assertRoleModel?: (workerId: string, model: string | null | undefined, cwd?: string) => void
}

export function createLocalRuntimeDispatchPort(
  deps: LocalRuntimeDispatchDeps,
): RuntimeDispatchPort {
  const assertContext = (context: RouterSessionContext) => {
    const session = deps.store
      .listSessions()
      .find(
        (candidate) =>
          candidate.id === context.routerSessionId &&
          candidate.memoryThreadId === context.memoryThreadId &&
          candidate.projectId === context.routerProjectId,
      )
    if (!session) throw new Error('SWARMDESK_AGENT_SESSION_MISMATCH')
  }

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
        roleDefinitionId: input.roleDefinitionId,
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

    async listRoleDefinitions(context: RouterSessionContext): Promise<RoleDefinition[]> {
      assertContext(context)
      return deps.store.listRoleDefinitions(context.routerSessionId)
    },

    async createRoleDefinition(input): Promise<RoleDefinition> {
      assertContext(input.context)
      deps.assertRoleModel?.(
        input.input.workerId,
        input.input.model,
        input.context.routerProjectRoot,
      )
      return deps.store.createRoleDefinition({
        ...input.input,
        chatSessionId: input.context.routerSessionId,
      })
    },

    async updateRoleDefinition(input): Promise<RoleDefinition> {
      assertContext(input.context)
      const current = deps.store
        .listRoleDefinitions(input.context.routerSessionId)
        .find((role) => role.id === input.roleDefinitionId)
      if (!current) throw new Error(`Role definition not found: ${input.roleDefinitionId}`)
      if (input.patch.workerId !== undefined || input.patch.model !== undefined) {
        deps.assertRoleModel?.(
          input.patch.workerId ?? current.workerId,
          input.patch.model === undefined ? current.model : input.patch.model,
          input.context.routerProjectRoot,
        )
      }
      return deps.store.updateRoleDefinition(
        input.context.routerSessionId,
        input.roleDefinitionId,
        input.patch,
      )
    },

    async archiveRoleDefinition(input): Promise<RoleDefinition> {
      assertContext(input.context)
      return deps.store.archiveRoleDefinition(
        input.context.routerSessionId,
        input.roleDefinitionId,
        input.expectedRevision,
      )
    },

    async resetRoleSession(input): Promise<{ deleted: boolean }> {
      assertContext(input.context)
      const role = deps.store
        .listRoleDefinitions(input.context.routerSessionId, { includeArchived: true })
        .find((candidate) => candidate.id === input.roleDefinitionId)
      if (!role) throw new Error(`Role definition not found: ${input.roleDefinitionId}`)
      if (deps.store.countOpenJobs({ sessionId: input.context.routerSessionId }) > 0) {
        const hasOpenRoleJob = deps.store
          .listJobs({
            sessionId: input.context.routerSessionId,
            status: ['queued', 'running', 'pending_approval'],
            limit: 500,
          })
          .some((job) => job.roleDefinitionId === input.roleDefinitionId)
        if (hasOpenRoleJob) {
          throw new Error('ROLE_CONTEXT_HAS_OPEN_JOBS')
        }
      }
      const result = getAcpSessionManager().deleteContextsByRole(
        input.context.routerSessionId,
        input.roleDefinitionId,
      )
      return { deleted: result.deleted > 0 }
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
