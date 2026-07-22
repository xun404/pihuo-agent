import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { getSharedStore } from '@swarmdesk-agent/core'
import { getWorkerScheduler } from '../scheduler.js'
import { getRuntimeDispatchPort } from '../runtime-dispatch-port.js'
import type { RuntimeDispatchPort } from '../runtime-dispatch-port.js'
import type { WorkerJob, WorkerKind, WorkerRole, WorkerRunEvent } from '@swarmdesk-agent/shared'
import { isJobOpen, isTerminalWorkerEvent } from '@swarmdesk-agent/shared'
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
    roleDefinitionId: job.roleDefinitionId,
    roleName: job.roleName,
    role: job.role,
    cwd: job.cwd,
    task: job.task,
    message: job.message ?? `Job ${job.status}`,
    output: job.output,
    error: job.error,
    errorCode: job.errorCode,
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

async function waitForTerminalWithDeadline(
  port: RuntimeDispatchPort,
  jobId: string,
  externalSignal: AbortSignal | undefined,
  onEvent?: (event: WorkerRunEvent) => void,
): Promise<WorkerRunEvent | null> {
  const observer = new AbortController()
  const signal = externalSignal
    ? AbortSignal.any([externalSignal, observer.signal])
    : observer.signal
  const timeoutMs = Math.min(MAX_TIMER_DELAY_MS, Math.floor(resolveWorkerJobTimeoutMs() * 1.2))
  try {
    return await raceWithTimeout(
      waitForTerminalEvent(port, jobId, signal, onEvent),
      timeoutMs,
      () => {
        observer.abort()
        return new WorkerJobWaitTimeoutError(jobId)
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

const roleDefinitionOutputSchema = z.object({
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

function boundRoleContext(context: unknown) {
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
    'Read the globally installed Registry/custom ACP Worker roster so the current Chat can choose a Worker when creating a role definition. This tool cannot install, authenticate, update, or remove Workers.',
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

export const listRoleDefinitionsTool = createTool({
  id: 'list-role-definitions',
  description:
    'List role definitions for the current Chat. Roles are Chat-scoped personas bound to installed ACP Workers; each role has an independent ACP session.',
  inputSchema: z.object({}),
  outputSchema: z.object({ roleDefinitions: z.array(roleDefinitionOutputSchema) }),
  execute: async (_input, context) => {
    const port = getRuntimeDispatchPort()
    if (!port.listRoleDefinitions) throw new Error('Role-definition runtime is unavailable')
    return { roleDefinitions: await port.listRoleDefinitions(boundRoleContext(context)) }
  },
})

export const createRoleDefinitionTool = createTool({
  id: 'create-role-definition',
  description:
    'Create a role definition in the current Chat using an already installed Worker. Omit model to inherit the Worker default model.',
  inputSchema: z.object({
    workerId: z.string(),
    name: z.string(),
    roleType: roleSchema,
    instructions: z.string(),
    model: z.string().optional(),
    enabled: z.boolean().optional(),
  }),
  outputSchema: z.object({ roleDefinition: roleDefinitionOutputSchema }),
  execute: async (input, context) => {
    const port = getRuntimeDispatchPort()
    if (!port.createRoleDefinition) throw new Error('Role-definition runtime is unavailable')
    return {
      roleDefinition: await port.createRoleDefinition({
        context: boundRoleContext(context),
        input,
      }),
    }
  },
})

export const updateRoleDefinitionTool = createTool({
  id: 'update-role-definition',
  description:
    'Update a role definition in the current Chat. Changing Worker, type, instructions, or model increments its execution revision and starts a distinct ACP session on next dispatch.',
  inputSchema: z.object({
    roleDefinitionId: z.string(),
    workerId: z.string().optional(),
    name: z.string().optional(),
    roleType: roleSchema.optional(),
    instructions: z.string().optional(),
    model: z.string().nullable().optional(),
    enabled: z.boolean().optional(),
    expectedRevision: z.number().optional(),
  }),
  outputSchema: z.object({ roleDefinition: roleDefinitionOutputSchema }),
  execute: async ({ roleDefinitionId, ...patch }, context) => {
    const port = getRuntimeDispatchPort()
    if (!port.updateRoleDefinition) throw new Error('Role-definition runtime is unavailable')
    return {
      roleDefinition: await port.updateRoleDefinition({
        context: boundRoleContext(context),
        roleDefinitionId,
        patch,
      }),
    }
  },
})

export const archiveRoleDefinitionTool = createTool({
  id: 'archive-role-definition',
  description: 'Archive a role definition in the current Chat so it can no longer be dispatched.',
  inputSchema: z.object({
    roleDefinitionId: z.string(),
    expectedRevision: z.number().optional(),
  }),
  outputSchema: z.object({ roleDefinition: roleDefinitionOutputSchema }),
  execute: async (input, context) => {
    const port = getRuntimeDispatchPort()
    if (!port.archiveRoleDefinition) throw new Error('Role-definition runtime is unavailable')
    return {
      roleDefinition: await port.archiveRoleDefinition({
        context: boundRoleContext(context),
        ...input,
      }),
    }
  },
})

export const resetRoleSessionTool = createTool({
  id: 'reset-role-session',
  description:
    'Reset only the ACP session context owned by one role definition in the current Chat.',
  inputSchema: z.object({ roleDefinitionId: z.string() }),
  outputSchema: z.object({ deleted: z.boolean() }),
  execute: async (input, context) => {
    const port = getRuntimeDispatchPort()
    if (!port.resetRoleSession) throw new Error('Role-definition runtime is unavailable')
    return port.resetRoleSession({ context: boundRoleContext(context), ...input })
  },
})

/**
 * Schedule a worker job (ACP).
 * Default waits for terminal status so the Leader can relay worker output in the same turn.
 * Pass wait=false only for long fire-and-forget work (then poll get-job).
 */
export const dispatchRoleTool = createTool({
  id: 'dispatch-role',
  description:
    'Delegate a task through one role definition from list-role-definitions. The role selects its bound Worker, instructions, model inheritance/override, and independent ACP session. By default waits for completion. Never invent results: only trust status=succeeded + output.',
  inputSchema: z.object({
    roleDefinitionId: z.string().describe('Exact role id from list-role-definitions'),
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
    roleDefinitionId: z.string().optional(),
    roleName: z.string().optional(),
    role: z.string().optional(),
    cwd: z.string(),
    task: z.string(),
    message: z.string(),
    output: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async (input, context) => {
    const { roleDefinitionId, task, cwd, wait } = input as {
      roleDefinitionId: string
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
        roleDefinitionId,
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
        console.error(`[dispatchRoleTool] ${phase} writer failed`, result.error)
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
      roleDefinitionId,
      cwd: workdir,
      source: 'leader',
      wait: false,
    })

    // Chat/observer abort must NOT cancel the agent job — only explicit cancel-job does.
    // We still stop waiting/streaming when abort fires (via port.events signal).
    const abortSignal = ctx?.abortSignal as AbortSignal | undefined
    const detachAbort = abortSignal
      ? subscribeAbort(abortSignal, () => {
          /* observer disconnect: do not port.cancel */
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
            jid,
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
          // Only cancel on total deadline. Chat/observer abort stops observation only —
          // explicit cancel-job / UI cancel terminates the agent.
          const msg = e instanceof Error ? e.message : String(e)
          const isDeadline = e instanceof WorkerJobWaitTimeoutError
          if (isDeadline) {
            await port.cancel(jid).catch(() => {})
          }
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
          }
        } finally {
          pumpRunning = false
          await pumpPromise
        }
      }

      // Non-streaming sync wait via port.events (Local or Remote)
      if (sync) {
        try {
          const terminalEvent = await waitForTerminalWithDeadline(port, job.id, abortSignal)
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
          if (isDeadline) await port.cancel(job.id).catch(() => {})
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
    }
  },
})

export const getJobTool = createTool({
  id: 'get-job',
  description:
    'Get status and output of a worker job by id (from dispatch-role) for the bound session.',
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

export const appStore = {
  get snapshot() {
    return store().snapshot()
  },
  listProjects: () => store().listProjects(),
  listWorkers: () => store().listWorkers(),
  getActive: () => store().getActive(),
}
export { store }
