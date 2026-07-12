import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { getSharedStore } from '@router-agents/core'
import { getWorkerScheduler } from '../scheduler.js'

const store = getSharedStore()
const scheduler = getWorkerScheduler()

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
    'List registered CLI workers with roles, health, and busy status. Prefer healthy non-busy workers when dispatching.',
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
        model: z.string().optional(),
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
          model: w.model,
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
 * Schedule a worker job (ACP). Default is async: returns jobId immediately.
 * Pass wait=true to block until the job finishes (short tasks / debugging).
 * Poll with get-job for long-running work. Never claim success without job status.
 */
export const dispatchWorkerTool = createTool({
  id: 'dispatch-worker',
  description:
    'Delegate a coding task to a CLI worker via the job scheduler. Prefer role=plan|coder|review|test|research|general. Returns jobId + status. Default async (does not wait for ACP to finish); use wait=true to await completion, or call get-job later. Never invent file changes — only trust job output when status=succeeded.',
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
      .describe('If true, wait until job finishes before returning (default false)'),
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
  execute: async ({ role, workerIdOrKind, task, cwd, wait }) => {
    const { project, session } = store.getActive()
    const workdir = cwd ?? project?.rootPath ?? process.cwd()
    const sync =
      wait === true ||
      process.env.DISPATCH_MODE === 'sync'

    const { job, output } = await scheduler.enqueue({
      task,
      role,
      workerIdOrKind,
      cwd: workdir,
      sessionId: session?.id,
      projectId: project?.id ?? session?.projectId,
      threadId: session?.memoryThreadId,
      source: 'leader',
      wait: sync,
    })

    const ok = job.status === 'succeeded' || job.status === 'queued' || job.status === 'running' || job.status === 'pending_approval'
    return {
      ok: sync ? job.status === 'succeeded' : ok && job.status !== 'failed',
      jobId: job.id,
      status: job.status,
      workerName: job.workerName,
      workerId: job.workerId,
      role: job.role,
      cwd: job.cwd,
      task: job.task,
      message:
        job.message ??
        (sync
          ? `Job ${job.status}`
          : `Job ${job.id} ${job.status}. Poll get-job for result.`),
      output: output ?? job.output,
      error: job.error,
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
