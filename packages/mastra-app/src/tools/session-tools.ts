import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { getSharedStore } from '@swarmdesk-agent/core'
import {
  getWorkerScheduler,
  toPublicAcpFailure,
  workerTimeoutSnapshotFromJob,
} from '../scheduler.js'
import { getRuntimeDispatchPort } from '../runtime-dispatch-port.js'
import type { RuntimeDispatchPort } from '../runtime-dispatch-port.js'
import type { WorkerJob, WorkerKind, WorkerRole, WorkerRunEvent } from '@swarmdesk-agent/shared'
import {
  isJobOpen,
  isPlaceholderSessionTitle,
  isTerminalWorkerEvent,
} from '@swarmdesk-agent/shared'
import {
  enrichTerminalWorkerEvent,
  MAX_TIMER_DELAY_MS,
  raceWithTimeout,
  resolveWorkerJobTimeoutMs,
  splitWorkerDeltaChunks,
  subscribeAbort,
  writeWorkerEventWithDeadline,
  type WorkerEventIdentity,
  type WorkerEventWriter,
} from '../worker-events.js'
import { authorizeDispatchCwd, resolveDispatchContext } from '../dispatch-context.js'

export function applyTerminalEventToJob(job: WorkerJob, event: WorkerRunEvent): WorkerJob {
  if (!isTerminalWorkerEvent(event)) return job
  if (event.type === 'completed') {
    return {
      ...job,
      status: 'succeeded',
      output: event.output,
      workerName: event.workerName ?? job.workerName,
      role: event.role ?? job.role,
      finishedAt: job.finishedAt ?? new Date().toISOString(),
      message: job.message ?? 'Job succeeded',
      error: undefined,
      errorCode: undefined,
    }
  }
  const status =
    event.type === 'timed_out' ? 'timed_out' : event.type === 'cancelled' ? 'cancelled' : 'failed'
  return {
    ...job,
    status,
    output: event.output ?? job.output,
    error: event.error,
    errorCode: event.errorCode,
    // Propagate recovery fields so the persisted tool-part output (read on
    // page refresh / session switch) carries them — otherwise the "Reset ACP
    // context" button disappears after hydration.
    recoveryError: event.recoveryError,
    canResetAcpContext: event.canResetAcpContext,
    workerName: event.workerName ?? job.workerName,
    role: event.role ?? job.role,
    finishedAt: job.finishedAt ?? new Date().toISOString(),
    message: event.error ?? `Job ${status}`,
  }
}

export function jobToToolResult(job: WorkerJob) {
  return {
    ok: job.status === 'succeeded',
    jobId: job.id,
    status: job.status,
    workerName: job.workerName,
    workerId: job.workerId,
    teamMemberId: job.teamMemberId,
    teamMemberName: job.teamMemberName,
    role: job.role,
    model: job.effectiveModel,
    reasoning: job.effectiveReasoning,
    cwd: job.cwd,
    task: job.task,
    message: job.message ?? `Job ${job.status}`,
    output: job.output,
    error: job.error,
    errorCode: job.errorCode,
    // Recovery fields so the "Reset ACP context" button survives a page
    // refresh / session switch when the card is re-hydrated from job state.
    recoveryError: job.recoveryError,
    canResetAcpContext: job.canResetAcpContext,
    // For UI duration (WorkerRunCard) when hydrating from tool parts / history
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    createdAt: job.createdAt,
  }
}

export function jobToTerminalEvent(job: WorkerJob): WorkerRunEvent {
  if (job.status === 'succeeded') {
    return {
      type: 'completed',
      jobId: job.id,
      output: job.output ?? '',
      truncated: false,
      workerName: job.workerName,
      role: job.role,
      model: job.effectiveModel,
      reasoning: job.effectiveReasoning,
    }
  }
  const type =
    job.status === 'cancelled' ? 'cancelled' : job.status === 'timed_out' ? 'timed_out' : 'failed'
  return {
    type,
    jobId: job.id,
    output: job.output,
    error: job.error ?? job.message,
    errorCode: job.errorCode,
    truncated: false,
    workerName: job.workerName,
    role: job.role,
    model: job.effectiveModel,
    reasoning: job.effectiveReasoning,
    recoveryError: job.recoveryError,
    canResetAcpContext: job.canResetAcpContext,
  }
}

/** Wait for a terminal WorkerRunEvent via port.events (works for Local and Remote). */
async function waitForTerminalEvent(
  port: RuntimeDispatchPort,
  jobId: string,
  signal: AbortSignal | undefined,
  onEvent?: (event: WorkerRunEvent) => void,
): Promise<WorkerRunEvent | null> {
  for await (const event of port.events(jobId, signal)) {
    onEvent?.(event)
    if (isTerminalWorkerEvent(event)) return event
  }
  return null
}

class WorkerJobWaitTimeoutError extends Error {
  constructor(jobId: string) {
    super(`Job ${jobId} timed out waiting for terminal status`)
    this.name = 'WorkerJobWaitTimeoutError'
  }
}

let workerObservationTimeoutMsForTests: number | undefined

/** @internal Test seam for bounding a never-ending event stream without weakening production limits. */
export function setWorkerObservationTimeoutForTests(timeoutMs?: number): void {
  workerObservationTimeoutMsForTests = timeoutMs
}

async function waitForTerminalWithDeadline(
  port: RuntimeDispatchPort,
  job: WorkerJob,
  externalSignal: AbortSignal | undefined,
  onEvent?: (event: WorkerRunEvent) => void,
): Promise<WorkerRunEvent | null> {
  const observer = new AbortController()
  const signal = externalSignal
    ? AbortSignal.any([externalSignal, observer.signal])
    : observer.signal
  const workerTimeouts = workerTimeoutSnapshotFromJob(job)
  const timeoutMs =
    workerObservationTimeoutMsForTests === undefined
      ? Math.min(
          MAX_TIMER_DELAY_MS,
          Math.floor(
            (resolveWorkerJobTimeoutMs(workerTimeouts.jobTimeoutMs) +
              workerTimeouts.queueTimeoutMs) *
              1.2,
          ),
        )
      : Math.max(1, Math.floor(workerObservationTimeoutMsForTests))
  try {
    return await raceWithTimeout(
      waitForTerminalEvent(port, job.id, signal, onEvent),
      timeoutMs,
      () => {
        observer.abort()
        return new WorkerJobWaitTimeoutError(job.id)
      },
    )
  } finally {
    // Release fetch readers/subscriptions even when the timeout race wins.
    observer.abort()
  }
}

/** Lazy accessors — avoid forcing Store/Scheduler construction at import time on client-only. */
function store() {
  return getSharedStore()
}
function scheduler() {
  return getWorkerScheduler()
}
const roleSchema = z.enum(['plan', 'coder', 'review', 'test', 'research', 'general'])
const jobStatusSchema = z.enum([
  'queued',
  'running',
  'pending_approval',
  'succeeded',
  'failed',
  'cancelled',
  'timed_out',
])

const teamMemberOutputSchema = z.object({
  id: z.string(),
  chatSessionId: z.string(),
  workerId: z.string(),
  name: z.string(),
  roleType: roleSchema,
  instructions: z.string(),
  model: z.string().optional(),
  enabled: z.boolean(),
  revision: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  archivedAt: z.string().optional(),
})

const teamTemplateMemberSchema = z.object({
  preferredWorkerId: z.string(),
  name: z.string(),
  roleType: roleSchema,
  instructions: z.string(),
  model: z.string().optional(),
})

const teamTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  members: z.array(teamTemplateMemberSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
})

function boundTeamContext(context: unknown) {
  const { routerSessionId, routerProjectId, routerProjectRoot, memoryThreadId } =
    resolveDispatchContext(context as any)
  return {
    routerSessionId,
    routerProjectId,
    routerProjectRoot,
    memoryThreadId,
  }
}

export const listProjectsTool = createTool({
  id: 'list-projects',
  description: 'List local projects known to SwarmDesk.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    projects: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        rootPath: z.string(),
        defaultBranch: z.string().optional(),
      }),
    ),
  }),
  execute: async () => {
    const projects = store()
      .listProjects()
      .map((p) => ({
        id: p.id,
        name: p.name,
        rootPath: p.rootPath,
        defaultBranch: p.defaultBranch,
      }))
    return { projects }
  },
})

export const listWorkersTool = createTool({
  id: 'list-workers',
  description:
    'Read the globally installed Registry/custom ACP Worker roster so the current Chat can choose a Worker for a Team member. This tool cannot install, authenticate, update, or remove Workers.',
  inputSchema: z.object({
    enabledOnly: z.boolean().optional().default(true),
  }),
  outputSchema: z.object({
    workers: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        kind: z.string(),
        capabilities: z.array(z.string()),
        enabled: z.boolean(),
        description: z.string(),
        health: z.string(),
        healthMessage: z.string().optional(),
        healthHints: z.array(z.string()).optional(),
        busy: z.boolean(),
        openJobs: z.number(),
        /** Pinned ACP model id for session/set_config_option (empty = CLI default) */
        model: z.string().optional(),
        modelConfigured: z.boolean(),
        /** Shortlist only (Worker.availableModels) — not full search index */
        availableModels: z.array(
          z.object({
            modelId: z.string(),
            name: z.string(),
          }),
        ),
        modelsState: z.string().optional(),
        modelCatalogState: z.string().optional(),
        /** OpenCode without a pin is risky — ask user to pick a model in Workers */
        needsModelSelection: z.boolean(),
        /** CLI binary presence/version health */
        commandHealth: z.string().optional(),
        /** ACP session boundary health */
        acpHealth: z.string().optional(),
        /** Registry identity (no archive URLs or secrets) */
        registryId: z.string().optional(),
        registryVersion: z.string().optional(),
        sourceType: z.string().optional(),
        runtimeProfile: z.string().optional(),
        readinessStatus: z.string().optional(),
        readinessCode: z.string().optional(),
        nextAction: z.string().optional(),
        dispatchable: z.boolean(),
      }),
    ),
  }),
  execute: async ({ enabledOnly }) => {
    const { evaluateWorkerReadinessGate } = await import('../acp-worker-readiness.js')
    let workers = store().listWorkers()
    if (enabledOnly) workers = workers.filter((w) => w.enabled)
    workers = [...workers].sort((a, b) => {
      const rank = (s: string) =>
        s === 'healthy' ? 4 : s === 'unknown' ? 3 : s === 'unhealthy' ? 2 : 1
      return rank(b.health) - rank(a.health)
    })
    return {
      workers: workers.map((w) => {
        const openJobs = store().countOpenJobs({ workerId: w.id })
        const model = w.model?.trim() || undefined
        // Shortlist only — never expose full OpenRouter search index here
        const availableModels = (w.availableModels ?? []).map((m) => ({
          modelId: m.modelId,
          name: m.name || m.modelId,
        }))
        const modelConfigured = Boolean(model)
        const needsModelSelection =
          (w.kind === 'opencode' || w.runtimeProfile === 'opencode') && !modelConfigured
        const commandHealth = w.commandHealth?.status ?? w.cliHealth ?? undefined
        const acpHealth = w.acpHealth?.status ?? w.acpSessionHealth ?? undefined
        const gate = evaluateWorkerReadinessGate(w)
        const source = w.source
        return {
          id: w.id,
          name: w.name,
          kind: w.kind,
          capabilities: w.capabilities,
          enabled: w.enabled,
          description: w.description,
          health: w.health,
          healthMessage: w.healthReport?.message,
          healthHints: w.healthReport?.hints,
          busy: openJobs > 0,
          openJobs,
          model,
          modelConfigured,
          availableModels,
          modelsState: w.modelsState,
          modelCatalogState: w.modelCatalogState ?? w.modelsState,
          needsModelSelection,
          commandHealth,
          acpHealth,
          registryId: source?.type === 'registry' ? source.registryId : undefined,
          registryVersion: source?.type === 'registry' ? source.registryVersion : undefined,
          sourceType: source?.type,
          runtimeProfile: w.runtimeProfile,
          readinessStatus: w.readiness?.status,
          readinessCode: w.readiness?.code,
          nextAction: w.readiness?.nextAction,
          dispatchable: gate.ok,
        }
      }),
    }
  },
})

export const getActiveContextTool = createTool({
  id: 'get-active-context',
  description: 'Get the currently active project and session context for this desktop session.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    project: z
      .object({
        id: z.string(),
        name: z.string(),
        rootPath: z.string(),
      })
      .nullable(),
    session: z
      .object({
        id: z.string(),
        title: z.string(),
        mode: z.string(),
        status: z.string(),
        memoryThreadId: z.string(),
      })
      .nullable(),
  }),
  execute: async () => {
    const { project, session } = store().getActive()
    return {
      project: project ? { id: project.id, name: project.name, rootPath: project.rootPath } : null,
      session: session
        ? {
            id: session.id,
            title: session.title,
            mode: session.mode,
            status: session.status,
            memoryThreadId: session.memoryThreadId,
          }
        : null,
    }
  },
})

export const listTeamTool = createTool({
  id: 'list-team',
  description:
    'List the current Chat Team and its optimistic revision. Team members are bound to installed ACP Workers and each owns an independent ACP session.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    teamRevision: z.number(),
    teamMembers: z.array(teamMemberOutputSchema),
  }),
  execute: async (_input, context) => {
    const port = getRuntimeDispatchPort()
    if (!port.listTeamMembers || !port.getTeamRevision) {
      throw new Error('Team runtime is unavailable')
    }
    const bound = boundTeamContext(context)
    return {
      teamRevision: await port.getTeamRevision(bound),
      teamMembers: await port.listTeamMembers(bound),
    }
  },
})

export const addTeamMemberTool = createTool({
  id: 'add-team-member',
  description:
    'Add a Team member to the current Chat using an installed Worker. Omit model to inherit the Worker default model.',
  inputSchema: z.object({
    workerId: z.string(),
    name: z.string(),
    roleType: roleSchema,
    instructions: z.string(),
    model: z.string().optional(),
    enabled: z.boolean().optional(),
  }),
  outputSchema: z.object({ teamMember: teamMemberOutputSchema }),
  execute: async (input, context) => {
    const port = getRuntimeDispatchPort()
    if (!port.createTeamMember) throw new Error('Team runtime is unavailable')
    return {
      teamMember: await port.createTeamMember({
        context: boundTeamContext(context),
        input,
      }),
    }
  },
})

export const updateTeamMemberTool = createTool({
  id: 'update-team-member',
  description:
    'Update a Team member in the current Chat. Changing Worker, type, instructions, or model increments its execution revision and starts a distinct ACP session on next dispatch.',
  inputSchema: z.object({
    teamMemberId: z.string(),
    workerId: z.string().optional(),
    name: z.string().optional(),
    roleType: roleSchema.optional(),
    instructions: z.string().optional(),
    model: z.string().nullable().optional(),
    enabled: z.boolean().optional(),
    expectedRevision: z.number().optional(),
  }),
  outputSchema: z.object({ teamMember: teamMemberOutputSchema }),
  execute: async ({ teamMemberId, ...patch }, context) => {
    const port = getRuntimeDispatchPort()
    if (!port.updateTeamMember) throw new Error('Team runtime is unavailable')
    return {
      teamMember: await port.updateTeamMember({
        context: boundTeamContext(context),
        teamMemberId,
        patch,
      }),
    }
  },
})

export const archiveTeamMemberTool = createTool({
  id: 'archive-team-member',
  description: 'Archive a Team member in the current Chat so it can no longer be dispatched.',
  inputSchema: z.object({
    teamMemberId: z.string(),
    expectedRevision: z.number().optional(),
  }),
  outputSchema: z.object({ teamMember: teamMemberOutputSchema }),
  execute: async (input, context) => {
    const port = getRuntimeDispatchPort()
    if (!port.archiveTeamMember) throw new Error('Team runtime is unavailable')
    return {
      teamMember: await port.archiveTeamMember({
        context: boundTeamContext(context),
        ...input,
      }),
    }
  },
})

export const resetTeamMemberSessionTool = createTool({
  id: 'reset-team-member-session',
  description: 'Reset only the ACP session context owned by one Team member in this Chat.',
  inputSchema: z.object({ teamMemberId: z.string() }),
  outputSchema: z.object({ deleted: z.boolean() }),
  execute: async (input, context) => {
    const port = getRuntimeDispatchPort()
    if (!port.resetTeamMemberSession) throw new Error('Team runtime is unavailable')
    return port.resetTeamMemberSession({ context: boundTeamContext(context), ...input })
  },
})

export const listTeamTemplatesTool = createTool({
  id: 'list-team-templates',
  description: 'List reusable global Team templates available to every Project and Chat.',
  inputSchema: z.object({}),
  outputSchema: z.object({ templates: z.array(teamTemplateSchema) }),
  execute: async () => {
    const port = getRuntimeDispatchPort()
    if (!port.listTeamTemplates) throw new Error('Team template runtime is unavailable')
    return { templates: await port.listTeamTemplates() }
  },
})

export const saveTeamTemplateTool = createTool({
  id: 'save-team-template',
  description:
    'Save the current Chat Team as a new reusable global template, including each member prompt, preferred Worker, role type, and model override.',
  inputSchema: z.object({
    name: z.string().min(1),
    description: z.string().optional(),
  }),
  outputSchema: z.object({ template: teamTemplateSchema }),
  execute: async (input, context) => {
    const port = getRuntimeDispatchPort()
    if (!port.saveTeamTemplate) throw new Error('Team template runtime is unavailable')
    return {
      template: await port.saveTeamTemplate({ context: boundTeamContext(context), ...input }),
    }
  },
})

export const deleteTeamTemplateTool = createTool({
  id: 'delete-team-template',
  description: 'Delete one reusable global Team template. This does not change any Chat Team.',
  inputSchema: z.object({ templateId: z.string() }),
  outputSchema: z.object({ template: teamTemplateSchema }),
  execute: async ({ templateId }) => {
    const port = getRuntimeDispatchPort()
    if (!port.deleteTeamTemplate) throw new Error('Team template runtime is unavailable')
    return { template: await port.deleteTeamTemplate(templateId) }
  },
})

export const applyTeamTemplateTool = createTool({
  id: 'apply-team-template',
  description:
    'Replace the current Chat Team with a saved template. First call list-team and list-team-templates. Replacement is blocked while any Team job is open; missing Workers or models require explicit mappings.',
  inputSchema: z.object({
    templateId: z.string(),
    expectedTeamRevision: z.number().int().positive(),
    mappings: z
      .array(
        z.object({
          memberIndex: z.number().int().nonnegative(),
          workerId: z.string(),
          model: z.string().nullable().optional(),
        }),
      )
      .optional(),
  }),
  outputSchema: z.object({
    members: z.array(teamMemberOutputSchema),
    teamRevision: z.number(),
  }),
  execute: async (input, context) => {
    const port = getRuntimeDispatchPort()
    if (!port.applyTeamTemplate) throw new Error('Team template runtime is unavailable')
    return port.applyTeamTemplate({ context: boundTeamContext(context), ...input })
  },
})

/**
 * Schedule a worker job (ACP).
 * Default waits for terminal status so the Leader can relay worker output in the same turn.
 * Pass wait=false only for long fire-and-forget work (then poll get-job).
 */
export const dispatchTeamMemberTool = createTool({
  id: 'dispatch-team-member',
  description:
    'Delegate a task through one Team member from list-team. The member selects its Worker, prompt, model inheritance/override, and independent ACP session. By default waits for completion. Never invent results: only trust status=succeeded + output.',
  inputSchema: z.object({
    teamMemberId: z.string().describe('Exact member id from list-team'),
    task: z.string().describe('Clear task prompt for the coding agent'),
    cwd: z
      .string()
      .optional()
      .describe('Working directory under the bound project root; defaults to project root'),
    wait: z
      .boolean()
      .optional()
      .describe(
        'Wait for job completion before returning. Default true. Set false only for long fire-and-forget jobs.',
      ),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    jobId: z.string(),
    status: jobStatusSchema,
    workerName: z.string(),
    workerId: z.string().optional(),
    teamMemberId: z.string().optional(),
    teamMemberName: z.string().optional(),
    role: z.string().optional(),
    cwd: z.string(),
    task: z.string(),
    message: z.string(),
    output: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async (input, context) => {
    const { teamMemberId, task, cwd, wait } = input as {
      teamMemberId: string
      task: string
      cwd?: string
      wait?: boolean
    }
    const ctx = context as any
    const { routerSessionId, routerProjectId, routerProjectRoot, memoryThreadId } =
      resolveDispatchContext(ctx)
    const cwdAuth = authorizeDispatchCwd(routerProjectRoot, cwd)
    if (!cwdAuth.ok) {
      return {
        ok: false,
        jobId: '',
        status: 'failed' as const,
        workerName: '',
        teamMemberId,
        cwd: cwd ?? routerProjectRoot ?? '',
        task,
        message: cwdAuth.error,
        error: cwdAuth.error,
      }
    }
    const workdir = cwdAuth.cwd
    const sync = process.env.DISPATCH_MODE === 'async' ? wait === true : wait !== false

    const writer = ctx?.writer as Partial<WorkerEventWriter> | undefined
    let writerTimedOut = false
    const writeEvent = async (
      options: Parameters<WorkerEventWriter['custom']>[0],
      phase: string,
    ): Promise<boolean> => {
      if (!writer?.custom || writerTimedOut) return false
      const result = await writeWorkerEventWithDeadline(
        { custom: writer.custom.bind(writer) },
        options,
      )
      if (!result.ok) {
        if (result.timedOut) writerTimedOut = true
        console.error(`[dispatchTeamMemberTool] ${phase} writer failed`, result.error)
      }
      return result.ok
    }

    // Bounded queue: drop oldest deltas when backpressured (keep started/approval/terminal)
    const EVENT_QUEUE_MAX = 256
    const eventQueue: WorkerRunEvent[] = []
    const pushEvent = (event: WorkerRunEvent) => {
      eventQueue.push(event)
      while (eventQueue.length > EVENT_QUEUE_MAX) {
        const idx = eventQueue.findIndex((e) => e.type === 'delta')
        if (idx >= 0) eventQueue.splice(idx, 1)
        else break // only non-deltas left — keep them
      }
    }
    let buf = ''
    let lastSeq = 0
    let pumpRunning = true
    let workerName: string | undefined
    let workerKind: WorkerKind | undefined
    let workerRole: WorkerRole | undefined
    let workerModel: string | undefined

    const port = getRuntimeDispatchPort()
    const job = await port.dispatch({
      context: {
        routerSessionId: routerSessionId,
        routerProjectId: routerProjectId,
        routerProjectRoot: routerProjectRoot,
        memoryThreadId,
      },
      task,
      teamMemberId,
      cwd: workdir,
      source: 'leader',
      wait: false,
    })

    // Idempotent cancel shared by chat abort and deadline timeout.
    // Both paths call the same function so only one port.cancel fires.
    let cancelPromise: Promise<void> | undefined
    const requestJobCancel = (): Promise<void> => {
      cancelPromise ??= Promise.resolve()
        .then(() => port.cancel(job.id))
        .catch((error) => {
          console.error(`[dispatchTeamMemberTool] failed to cancel ${job.id}`, error)
        })
      return cancelPromise
    }

    const abortSignal = ctx?.abortSignal as AbortSignal | undefined
    const detachAbort =
      sync && abortSignal
        ? subscribeAbort(abortSignal, () => {
            void requestJobCancel()
          })
        : () => {}

    try {
      // Preflight / already-terminal from dispatch — no events stream needed.
      if (sync && !isJobOpen(job.status)) {
        if (writer?.custom) {
          const terminal = jobToTerminalEvent(job)
          await writeEvent(
            { type: 'data-worker-run', id: job.id, data: terminal, transient: false },
            'preflight terminal',
          )
        }
        return jobToToolResult(job)
      }

      // Stream worker events via Mastra writer for wait=true
      if (sync && writer?.custom) {
        const jid = job.id
        workerName ??= job.workerName
        workerRole ??= job.role

        async function pump() {
          let lastFlush = Date.now()
          let writerSequence = 0
          const FLUSH_MS = 50
          const MAX_CHUNK = 8192

          async function drainBuf() {
            const text = buf
            buf = ''
            const split = splitWorkerDeltaChunks(jid, text, writerSequence, MAX_CHUNK)
            writerSequence = split.nextSequence
            for (const event of split.events) {
              await writeEvent(
                { type: 'data-worker-run', data: event, transient: true },
                `delta for ${jid}`,
              )
            }
          }

          while (pumpRunning || eventQueue.length > 0) {
            while (eventQueue.length > 0) {
              const event = eventQueue.shift()!
              if (event.type === 'delta') {
                const e = event as WorkerRunEvent & { delta: string; sequence: number }
                if (e.sequence > lastSeq) {
                  lastSeq = e.sequence
                  buf += e.delta
                }
              } else if (event.type === 'started') {
                workerName = event.workerName
                workerKind = event.workerKind
                workerRole = event.role
                workerModel = event.model
                await writeEvent(
                  { type: 'data-worker-run', id: jid, data: event, transient: true },
                  `started for ${jid}`,
                )
                lastFlush = Date.now()
              } else if (
                event.type === 'approval_requested' ||
                event.type === 'approval_resolved'
              ) {
                await writeEvent(
                  { type: 'data-worker-run', id: jid, data: event, transient: true },
                  `approval for ${jid}`,
                )
                lastFlush = Date.now()
              } else {
                await drainBuf()
                const identity: WorkerEventIdentity = {
                  workerName,
                  workerKind,
                  role: workerRole,
                  model: workerModel,
                }
                const data = enrichTerminalWorkerEvent(event, identity)
                await writeEvent(
                  { type: 'data-worker-run', id: jid, data, transient: false },
                  `terminal for ${jid}`,
                )
                lastFlush = Date.now()
              }
            }

            if (buf.length > 0 && Date.now() - lastFlush >= FLUSH_MS) {
              await drainBuf()
              lastFlush = Date.now()
            }

            if (pumpRunning || eventQueue.length > 0) {
              await new Promise((resolve) => setTimeout(resolve, 10))
            }
          }
          await drainBuf()
        }

        const pumpPromise = pump()

        try {
          const terminalEvent = await waitForTerminalWithDeadline(
            port,
            job,
            abortSignal,
            (event) => {
              pushEvent(event)
            },
          )
          if (!terminalEvent) {
            return {
              ...jobToToolResult(job),
              ok: false,
              status: 'failed' as const,
              message: 'No terminal event',
              error: 'No terminal event',
            }
          }
          return jobToToolResult(applyTerminalEventToJob(job, terminalEvent))
        } catch (e) {
          // Deadline cancels the job. Chat abort is handled by the subscribeAbort
          // handler above (which also calls requestJobCancel for wait=true).
          const msg = e instanceof Error ? e.message : String(e)
          const isDeadline = e instanceof WorkerJobWaitTimeoutError
          if (isDeadline) {
            await requestJobCancel()
          }
          // Recovery failures (session_not_found / recovery_failed thrown by
          // enqueuePrompt) must surface recoveryError + canResetAcpContext so
          // the "Reset ACP context" button renders in the chat card.
          const failure = toPublicAcpFailure(e)
          return {
            ok: false,
            jobId: jid,
            status: isDeadline ? ('timed_out' as const) : ('failed' as const),
            workerName: job.workerName,
            workerId: job.workerId,
            role: job.role,
            cwd: job.cwd,
            task: job.task,
            message: msg,
            error: msg,
            errorCode: failure.errorCode,
            recoveryError: failure.recoveryError,
            canResetAcpContext: failure.canResetAcpContext,
          }
        } finally {
          pumpRunning = false
          await pumpPromise
        }
      }

      // Non-streaming sync wait via port.events (Local or Remote)
      if (sync) {
        try {
          const terminalEvent = await waitForTerminalWithDeadline(port, job, abortSignal)
          if (!terminalEvent) {
            return {
              ...jobToToolResult(job),
              ok: false,
              status: 'failed' as const,
              message: 'No terminal event',
              error: 'No terminal event',
            }
          }
          return jobToToolResult(applyTerminalEventToJob(job, terminalEvent))
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          const isDeadline = e instanceof WorkerJobWaitTimeoutError
          if (isDeadline) await requestJobCancel()
          const failure = toPublicAcpFailure(e)
          return {
            ok: false,
            jobId: job.id,
            status: isDeadline ? ('timed_out' as const) : ('failed' as const),
            workerName: job.workerName,
            workerId: job.workerId,
            role: job.role,
            cwd: job.cwd,
            task: job.task,
            message: msg,
            error: msg,
            errorCode: failure.errorCode,
            recoveryError: failure.recoveryError,
            canResetAcpContext: failure.canResetAcpContext,
          }
        }
      }

      return {
        ok: true,
        jobId: job.id,
        status: job.status,
        workerName: job.workerName,
        workerId: job.workerId,
        role: job.role,
        cwd: job.cwd,
        task: job.task,
        message: `Job ${job.id} ${job.status}. Poll get-job for result.`,
        output: job.output,
        error: job.error,
      }
    } finally {
      detachAbort()
      if (cancelPromise) await cancelPromise
    }
  },
})

export const getJobTool = createTool({
  id: 'get-job',
  description:
    'Get status and output of a worker job by id (from dispatch-team-member) for the bound session.',
  inputSchema: z.object({
    jobId: z.string(),
  }),
  outputSchema: z.object({
    found: z.boolean(),
    job: z
      .object({
        id: z.string(),
        status: jobStatusSchema,
        workerName: z.string(),
        workerId: z.string(),
        role: z.string().optional(),
        task: z.string(),
        cwd: z.string(),
        message: z.string().optional(),
        output: z.string().optional(),
        error: z.string().optional(),
        createdAt: z.string(),
        startedAt: z.string().optional(),
        finishedAt: z.string().optional(),
      })
      .optional(),
  }),
  execute: async ({ jobId }, context) => {
    const { routerSessionId } = resolveDispatchContext(context as any)
    // Prefer RuntimeDispatchPort so remote-client (Studio) hits owner RPC, not local Scheduler.
    const port = getRuntimeDispatchPort()
    const job = port.getJob ? await port.getJob(jobId) : (scheduler().getJob(jobId) ?? null)
    if (!job || job.sessionId !== routerSessionId) return { found: false }
    return {
      found: true,
      job: {
        id: job.id,
        status: job.status,
        workerName: job.workerName,
        workerId: job.workerId,
        role: job.role,
        task: job.task,
        cwd: job.cwd,
        message: job.message,
        output: job.output,
        error: job.error,
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
      },
    }
  },
})

export const listJobsTool = createTool({
  id: 'list-jobs',
  description: 'List recent worker jobs for the bound Router session only.',
  inputSchema: z.object({
    limit: z.number().optional().default(20),
  }),
  outputSchema: z.object({
    jobs: z.array(
      z.object({
        id: z.string(),
        status: jobStatusSchema,
        workerName: z.string(),
        role: z.string().optional(),
        task: z.string(),
        createdAt: z.string(),
        finishedAt: z.string().optional(),
      }),
    ),
  }),
  execute: async ({ limit }, context) => {
    const { routerSessionId } = resolveDispatchContext(context as any)
    const port = getRuntimeDispatchPort()
    const jobs = port.listJobs
      ? await port.listJobs({ sessionId: routerSessionId, limit: limit ?? 20 })
      : scheduler().listJobs({ sessionId: routerSessionId, limit: limit ?? 20 })
    return {
      jobs: jobs
        .filter((j) => j.sessionId === routerSessionId)
        .map((j) => ({
          id: j.id,
          status: j.status,
          workerName: j.workerName,
          role: j.role,
          task: j.task.slice(0, 200),
          createdAt: j.createdAt,
          finishedAt: j.finishedAt,
        })),
    }
  },
})

export const cancelJobTool = createTool({
  id: 'cancel-job',
  description: 'Cancel a queued or running worker job owned by the bound session.',
  inputSchema: z.object({
    jobId: z.string(),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    jobId: z.string(),
    status: jobStatusSchema,
    message: z.string(),
  }),
  execute: async ({ jobId }, context) => {
    try {
      const { routerSessionId } = resolveDispatchContext(context as any)
      const port = getRuntimeDispatchPort()
      const existing = port.getJob ? await port.getJob(jobId) : (scheduler().getJob(jobId) ?? null)
      if (!existing || existing.sessionId !== routerSessionId) {
        return {
          ok: false,
          jobId,
          status: 'failed' as const,
          message: 'Job not found for this session',
        }
      }
      await port.cancel(jobId)
      const job = port.getJob ? await port.getJob(jobId) : (scheduler().getJob(jobId) ?? null)
      const status = job?.status ?? 'cancelled'
      return {
        ok: true,
        jobId,
        status,
        message: job?.message ?? `Job ${status}`,
      }
    } catch (e) {
      return {
        ok: false,
        jobId,
        status: 'failed' as const,
        message: e instanceof Error ? e.message : String(e),
      }
    }
  },
})

function cleanSessionTitle(raw: string): string {
  return raw
    .replace(/[\n\r\t]/g, ' ')
    .replace(/^["'“”«»]+|["'“”«»]+$/g, '')
    .replace(/^(title|标题)\s*[:：]\s*/i, '')
    .replace(/\s+/g, ' ')
    .replace(/[.。]$/, '')
    .trim()
    .slice(0, 80)
}

export const setSessionTitleTool = createTool({
  id: 'set-session-title',
  description:
    'Set the title of the current chat session. Call this once in your first response if the session is unnamed. Summarize the user task into 4-8 words, then pass it as title. Do not call if the session already has a real title — the tool will reject duplicates.',
  inputSchema: z.object({
    title: z
      .string()
      .min(1)
      .max(100)
      .describe('A 4-8 word concise title summarizing the user task'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    title: z.string().optional(),
    message: z.string().optional(),
  }),
  execute: async ({ title }, context) => {
    const { routerSessionId } = resolveDispatchContext(context as never)
    const trimmed = title.trim()
    if (!trimmed) {
      return { ok: false, message: 'Title cannot be empty.' }
    }
    const cleaned = cleanSessionTitle(trimmed)
    if (!cleaned) {
      return { ok: false, message: 'Title is empty after cleaning. Use plain text only.' }
    }

    const s = store()
      .listSessions()
      .find((x) => x.id === routerSessionId)
    if (!s) {
      return { ok: false, message: 'Session not found.' }
    }
    if (s.titleSource === 'user') {
      return {
        ok: false,
        message: 'Session title was set by user and cannot be auto-changed.',
      }
    }
    if (!isPlaceholderSessionTitle(s.title)) {
      return {
        ok: false,
        message: `Session already has a title: "${s.title}". No action needed.`,
      }
    }

    const updated = store().autoTitleSession(routerSessionId, cleaned)
    if (!updated) {
      return { ok: false, message: 'Failed to update session title.' }
    }
    return { ok: true, title: updated.title }
  },
})

export const appStore = {
  get snapshot() {
    return store().snapshot()
  },
  listProjects: () => store().listProjects(),
  listWorkers: () => store().listWorkers(),
  getActive: () => store().getActive(),
}
export { store }
