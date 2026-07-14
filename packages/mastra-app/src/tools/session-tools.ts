import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { getSharedStore } from '@router-agents/core'
import { getWorkerScheduler } from '../scheduler.js'
import type { WorkerKind, WorkerRole, WorkerRunEvent } from '@router-agents/shared'
import {
  enrichTerminalWorkerEvent,
  raceWithTimeout,
  splitWorkerDeltaChunks,
  subscribeAbort,
  type WorkerEventIdentity,
} from '../worker-events.js'

const store = getSharedStore()
const scheduler = getWorkerScheduler()
const WORKER_JOB_TIMEOUT_MS = Number(process.env.WORKER_JOB_TIMEOUT_MS) || 600_000

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

export const listProjectsTool = createTool({
  id: 'list-projects',
  description: 'List local projects known to Router Agents.',
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
    const projects = store.listProjects().map((p) => ({
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
    'List registered CLI workers with roles, health, configured model, and available model catalog. Prefer healthy non-busy workers. For OpenCode, require a selected model (modelConfigured=true) before dispatch — default CLI models often fail with “Model is disabled”.',
  inputSchema: z.object({
    enabledOnly: z.boolean().optional().default(true),
    role: roleSchema.optional().describe('Only workers that can serve this role'),
  }),
  outputSchema: z.object({
    workers: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        kind: z.string(),
        primaryRole: z.string(),
        roles: z.array(z.string()),
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
        /** Cached catalog from last “fetch models” in Workers panel */
        availableModels: z.array(
          z.object({
            modelId: z.string(),
            name: z.string(),
          }),
        ),
        /** OpenCode without a pin is risky — ask user to pick a model in Workers */
        needsModelSelection: z.boolean(),
      }),
    ),
  }),
  execute: async ({ enabledOnly, role }) => {
    let workers = role ? store.listWorkersByRole(role, enabledOnly) : store.listWorkers()
    if (enabledOnly) workers = workers.filter((w) => w.enabled)
    workers = [...workers].sort((a, b) => {
      const rank = (s: string) =>
        s === 'healthy' ? 4 : s === 'unknown' ? 3 : s === 'unhealthy' ? 2 : 1
      return rank(b.health) - rank(a.health)
    })
    return {
      workers: workers.map((w) => {
        const openJobs = store.countOpenJobs({ workerId: w.id })
        const model = w.model?.trim() || undefined
        const availableModels = (w.availableModels ?? []).map((m) => ({
          modelId: m.modelId,
          name: m.name || m.modelId,
        }))
        const modelConfigured = Boolean(model)
        const needsModelSelection = w.kind === 'opencode' && !modelConfigured
        return {
          id: w.id,
          name: w.name,
          kind: w.kind,
          primaryRole: w.primaryRole,
          roles: w.roles,
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
          needsModelSelection,
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
    const { project, session } = store.getActive()
    return {
      project: project
        ? { id: project.id, name: project.name, rootPath: project.rootPath }
        : null,
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

/**
 * Schedule a worker job (ACP).
 * Default waits for terminal status so the Leader can relay worker output in the same turn.
 * Pass wait=false only for long fire-and-forget work (then poll get-job).
 */
export const dispatchWorkerTool = createTool({
  id: 'dispatch-worker',
  description:
    'Delegate a task to a CLI worker (Claude/Codex/OpenCode). Prefer role=plan|coder|review|test|research|general, or workerIdOrKind=codex|claude|opencode. By default waits until the job finishes and returns output — use this when the user wants to see the worker reply. Set wait=false only for long background work, then poll get-job. Never invent results: only trust status=succeeded + output. If error mentions Model is disabled / 【模型不可用】, tell the user to pick a model in the Workers panel (especially OpenCode).',
  inputSchema: z.object({
    role: roleSchema
      .optional()
      .describe('Desired worker role for this task'),
    workerIdOrKind: z
      .string()
      .optional()
      .describe('Optional worker id or kind override: claude, codex, opencode'),
    task: z.string().describe('Clear task prompt for the coding agent'),
    cwd: z.string().optional().describe('Working directory; defaults to active project root'),
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
    role: z.string().optional(),
    cwd: z.string(),
    task: z.string(),
    message: z.string(),
    output: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async (input, context) => {
    const { role, workerIdOrKind, task, cwd, wait } = input as {
      role?: WorkerRole; workerIdOrKind?: string; task: string; cwd?: string; wait?: boolean
    }
    const ctx = context as any
    const requestContext = ctx?.requestContext
    const routerSessionId = requestContext?.get?.('routerSessionId') as string | undefined
    const routerProjectId = requestContext?.get?.('routerProjectId') as string | undefined
    const routerProjectRoot = requestContext?.get?.('routerProjectRoot') as string | undefined
    const memoryThreadId = requestContext?.get?.('memoryThreadId') as string | undefined
    if (routerSessionId && memoryThreadId && ctx?.agent?.threadId !== memoryThreadId) {
      throw new Error(`Thread mismatch: agent thread ${ctx.agent?.threadId} vs session ${memoryThreadId}`)
    }
    if (!routerSessionId || !routerProjectId || !memoryThreadId) {
      throw new Error(
        `dispatchWorkerTool requires routerSessionId, routerProjectId, and memoryThreadId in RequestContext. Got: session=${routerSessionId}, project=${routerProjectId}, thread=${memoryThreadId}`
      )
    }
    const project = { id: routerProjectId, rootPath: routerProjectRoot }
    const session = { id: routerSessionId, projectId: routerProjectId, memoryThreadId }
    const workdir = cwd ?? project?.rootPath ?? process.cwd()
    const sync =
      process.env.DISPATCH_MODE === 'async'
        ? wait === true
        : wait !== false

    const writer = ctx?.writer as {
      custom?: (opts: { type: string; data: unknown; transient?: boolean; id?: string }) => Promise<void>
    } | undefined

    let onEvent: ((event: WorkerRunEvent) => void) | undefined
    const eventQueue: WorkerRunEvent[] = []
    let buf = ''
    let lastSeq = 0
    let pumpRunning = true
    let workerName: string | undefined
    let workerKind: WorkerKind | undefined
    let workerRole: WorkerRole | undefined
    let workerModel: string | undefined

    if (sync && writer?.custom) {
      onEvent = (event: WorkerRunEvent) => {
        eventQueue.push(event)
      }
    }

    const { job } = await scheduler.enqueue({
      task,
      role,
      workerIdOrKind,
      cwd: workdir,
      sessionId: session?.id,
      projectId: project?.id ?? session?.projectId,
      threadId: session?.memoryThreadId,
      source: 'leader',
      wait: false,
      onEvent,
    })

    const abortSignal = ctx?.abortSignal as AbortSignal | undefined
    const detachAbort = abortSignal
      ? subscribeAbort(abortSignal, () => {
        scheduler.cancel(job.id).catch(() => {})
      })
      : () => {}

    try {
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
            try {
              await writer!.custom!({ type: 'data-worker-run', data: event, transient: true })
            } catch (error) {
              console.error('[dispatchWorkerTool] delta writer failed for', jid, error)
            }
          }
        }

        while (pumpRunning || eventQueue.length > 0) {
          while (eventQueue.length > 0) {
            const event = eventQueue.shift()!
            if (event.type === 'delta') {
              const e = event as WorkerRunEvent & { delta: string; sequence: number }
              if (e.sequence > lastSeq) { lastSeq = e.sequence; buf += e.delta }
            } else if (event.type === 'started') {
              workerName = event.workerName
              workerKind = event.workerKind
              workerRole = event.role
              workerModel = event.model
              try { await writer!.custom!({ type: 'data-worker-run', id: jid, data: event, transient: true }) } catch {}
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
              try {
                await writer!.custom!({ type: 'data-worker-run', id: jid, data, transient: false })
              } catch (e) {
                console.error('[dispatchWorkerTool] terminal writer failed for', jid, e)
              }
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

      const SAFETY_MULTIPLIER = 1.2
      try {
        const terminalJob = await raceWithTimeout(
          scheduler.waitForJob(jid),
          Math.floor(WORKER_JOB_TIMEOUT_MS * SAFETY_MULTIPLIER),
          () => new Error(`Job ${jid} timed out waiting for terminal status`),
        )
        const ok = terminalJob.status === 'succeeded'
        return {
          ok,
          jobId: terminalJob.id,
          status: terminalJob.status,
          workerName: terminalJob.workerName,
          workerId: terminalJob.workerId,
          role: terminalJob.role,
          cwd: terminalJob.cwd,
          task: terminalJob.task,
          message: terminalJob.message ?? `Job ${terminalJob.status}`,
          output: terminalJob.output,
          error: terminalJob.error,
        }
      } catch (e) {
        await scheduler.cancel(jid).catch(() => {})
        return {
          ok: false,
          jobId: jid,
          status: 'failed' as const,
          workerName: job.workerName,
          workerId: job.workerId,
          role: job.role,
          cwd: job.cwd,
          task: job.task,
          message: e instanceof Error ? e.message : 'Job watcher timed out',
          error: e instanceof Error ? e.message : 'Job watcher timed out',
        }
      } finally {
        pumpRunning = false
        await pumpPromise
      }
      }

      // Non-streaming path (sync without writer, or async)
      if (sync) {
        const terminalJob = await scheduler.waitForJob(job.id)
        return {
          ok: terminalJob.status === 'succeeded',
          jobId: terminalJob.id,
          status: terminalJob.status,
          workerName: terminalJob.workerName,
          workerId: terminalJob.workerId,
          role: terminalJob.role,
          cwd: terminalJob.cwd,
          task: terminalJob.task,
          message: terminalJob.message ?? `Job ${terminalJob.status}`,
          output: terminalJob.output,
          error: terminalJob.error,
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
  description: 'Get status and output of a worker job by id (from dispatch-worker).',
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
  execute: async ({ jobId }) => {
    const job = scheduler.getJob(jobId)
    if (!job) return { found: false }
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
  description: 'List recent worker jobs for the active session (or all if no session).',
  inputSchema: z.object({
    sessionId: z.string().optional(),
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
  execute: async ({ sessionId, limit }) => {
    const active = store.getActive()
    const sid = sessionId ?? active.session?.id
    const jobs = scheduler.listJobs({
      sessionId: sid,
      limit: limit ?? 20,
    })
    return {
      jobs: jobs.map((j) => ({
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
  description: 'Cancel a queued or running worker job.',
  inputSchema: z.object({
    jobId: z.string(),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    jobId: z.string(),
    status: jobStatusSchema,
    message: z.string(),
  }),
  execute: async ({ jobId }) => {
    try {
      const job = await scheduler.cancel(jobId)
      return {
        ok: true,
        jobId: job.id,
        status: job.status,
        message: job.message ?? `Job ${job.status}`,
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

export { store as appStore }
export { store }
