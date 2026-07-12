import { registerApiRoute } from '@mastra/core/server'
import {
  createId,
  mapAcpPermissionToEnqueue,
  getGitStatus,
  listProjectFiles,
  waitForApprovalDecision,
  getSharedStore,
  globalActivityLog,
} from '@router-agents/core'
import { applyHealthReport, listAcpModels, parseHealthDepth } from '@router-agents/adapters'
import { checkOneWorker, checkWorkersBatch } from '../workers-health.js'
import { getWorkerScheduler } from '../scheduler.js'
import type {
  ApprovalDecision,
  LeaderMode,
  Locale,
  WorkerRegistration,
  WorkerRole,
} from '@router-agents/shared'
import { normalizeWorkerRoles } from '@router-agents/shared'
import { basename } from 'node:path'

const store = getSharedStore()

export { store as routeStore }

export const apiRoutes = [
  registerApiRoute('/api/snapshot', {
    method: 'GET',
    handler: async (c) => {
      return c.json(store.snapshot())
    },
  }),

  registerApiRoute('/api/activity', {
    method: 'GET',
    handler: async (c) => {
      const limit = Number(c.req.query('limit') ?? 50)
      return c.json({
        events: globalActivityLog.list(Number.isFinite(limit) ? limit : 50),
      })
    },
  }),

  registerApiRoute('/api/locale', {
    method: 'GET',
    handler: async (c) => {
      return c.json({ locale: store.getLocale() })
    },
  }),

  registerApiRoute('/api/locale', {
    method: 'POST',
    handler: async (c) => {
      const body = (await c.req.json()) as { locale: Locale }
      if (body.locale !== 'zh' && body.locale !== 'en') {
        return c.json({ error: 'locale must be zh or en' }, 400)
      }
      const locale = store.setLocale(body.locale)
      return c.json({ locale, snapshot: store.snapshot() })
    },
  }),

  registerApiRoute('/api/projects', {
    method: 'GET',
    handler: async (c) => {
      return c.json({ projects: store.listProjects() })
    },
  }),

  registerApiRoute('/api/projects', {
    method: 'POST',
    handler: async (c) => {
      const body = (await c.req.json()) as {
        name?: string
        rootPath: string
        defaultBranch?: string
      }
      if (!body.rootPath) return c.json({ error: 'rootPath required' }, 400)
      const project = store.upsertProject({
        name: body.name ?? basename(body.rootPath),
        rootPath: body.rootPath,
        defaultBranch: body.defaultBranch,
      })
      return c.json({ project })
    },
  }),

  registerApiRoute('/api/sessions', {
    method: 'GET',
    handler: async (c) => {
      const projectId = c.req.query('projectId')
      return c.json({ sessions: store.listSessions(projectId || undefined) })
    },
  }),

  registerApiRoute('/api/sessions', {
    method: 'POST',
    handler: async (c) => {
      const body = (await c.req.json()) as {
        projectId: string
        title: string
        mode?: LeaderMode
      }
      if (!body.projectId || !body.title) {
        return c.json({ error: 'projectId and title required' }, 400)
      }
      const session = store.createSession(body)
      return c.json({ session })
    },
  }),

  registerApiRoute('/api/sessions/:id/activate', {
    method: 'POST',
    handler: async (c) => {
      const id = c.req.param('id')
      const session = store.setActiveSession(id)
      return c.json({ session })
    },
  }),

  registerApiRoute('/api/workers', {
    method: 'GET',
    handler: async (c) => {
      const role = c.req.query('role') as WorkerRole | undefined
      const workers = role ? store.listWorkersByRole(role) : store.listWorkers()
      return c.json({ workers })
    },
  }),

  registerApiRoute('/api/workers/:id/toggle', {
    method: 'POST',
    handler: async (c) => {
      const id = c.req.param('id')
      const body = (await c.req.json()) as { enabled: boolean }
      const worker = store.setWorkerEnabled(id, Boolean(body.enabled))
      return c.json({ worker })
    },
  }),

  registerApiRoute('/api/workers/:id/roles', {
    method: 'POST',
    handler: async (c) => {
      const id = c.req.param('id')
      const body = (await c.req.json()) as {
        primaryRole: WorkerRole
        roles: WorkerRole[]
      }
      if (!body.primaryRole || !Array.isArray(body.roles)) {
        return c.json({ error: 'primaryRole and roles required' }, 400)
      }
      const worker = store.setWorkerRoles(id, body)
      return c.json({ worker })
    },
  }),

  registerApiRoute('/api/workers/:id/models', {
    method: 'GET',
    handler: async (c) => {
      const id = c.req.param('id')
      const worker = store.listWorkers().find((w) => w.id === id)
      if (!worker) return c.json({ error: 'not found' }, 404)
      const active = store.getActive()
      const result = await listAcpModels(worker, { cwd: active.project?.rootPath })
      const checkedAt = new Date().toISOString()
      if (result.ok && result.models.length > 0) {
        store.setWorkerAvailableModels(id, result.models)
        store.upsertWorker(
          applyHealthReport(worker, {
            status: 'healthy',
            level: 'acp_handshake',
            checkedAt,
            message: `ACP 可用 · ${result.models.length} 个模型`,
            hints: [],
          }),
        )
      } else {
        const msg = result.error ?? 'ACP 模型列表不可用'
        store.upsertWorker(
          applyHealthReport(worker, {
            status: 'unhealthy',
            level: 'acp_handshake',
            checkedAt,
            message: msg,
            hints: ['可稍后重试更新模型列表', '或手动填写 model id'],
            detail: { errorCode: 'ACP_MODELS' },
          }),
        )
      }
      const updated = store.listWorkers().find((w) => w.id === id) ?? worker
      return c.json({
        ok: result.ok,
        models: result.models.length ? result.models : updated.availableModels ?? [],
        error: result.error,
        worker: updated,
        snapshot: store.snapshot(),
        cached: !result.ok && Boolean(updated.availableModels?.length),
      })
    },
  }),

  registerApiRoute('/api/workers/:id/model', {
    method: 'POST',
    handler: async (c) => {
      const id = c.req.param('id')
      const body = (await c.req.json()) as { model?: string | null }
      try {
        const worker = store.setWorkerModel(id, body.model)
        return c.json({ worker, snapshot: store.snapshot() })
      } catch (e) {
        return c.json({ error: e instanceof Error ? e.message : String(e) }, 404)
      }
    },
  }),

  registerApiRoute('/api/workers/health', {
    method: 'POST',
    handler: async (c) => {
      const body = (await c.req.json().catch(() => ({}))) as {
        workerIds?: string[]
        depth?: string
        onlyEnabled?: boolean
      }
      const active = store.getActive()
      const batch = await checkWorkersBatch({
        workerIds: body.workerIds,
        depth: body.depth,
        onlyEnabled: body.onlyEnabled,
        cwd: active.project?.rootPath,
      })
      return c.json({
        ...batch,
        workers: store.listWorkers(),
        snapshot: store.snapshot(),
      })
    },
  }),

  registerApiRoute('/api/workers/:id/health', {
    method: 'POST',
    handler: async (c) => {
      const id = c.req.param('id')
      const workers = store.listWorkers()
      const worker = workers.find((w) => w.id === id)
      if (!worker) return c.json({ error: 'not found' }, 404)
      const body = (await c.req.json().catch(() => ({}))) as { depth?: string }
      const depth = parseHealthDepth(body.depth ?? c.req.query('depth'))
      const active = store.getActive()
      const { worker: updated, report } = await checkOneWorker(
        worker,
        depth,
        active.project?.rootPath,
      )
      return c.json({ worker: updated, report, snapshot: store.snapshot() })
    },
  }),

  registerApiRoute('/api/workers', {
    method: 'POST',
    handler: async (c) => {
      const body = (await c.req.json()) as Partial<WorkerRegistration>
      if (!body.name || !body.command) {
        return c.json({ error: 'name and command required' }, 400)
      }
      const draft = normalizeWorkerRoles({
        name: body.name,
        kind: body.kind ?? 'custom',
        primaryRole: body.primaryRole,
        roles: body.roles,
        capabilities: body.capabilities,
      })
      const worker: WorkerRegistration = {
        id: body.id ?? createId('worker'),
        name: body.name,
        kind: body.kind ?? 'custom',
        command: body.command,
        args: body.args ?? [],
        env: body.env,
        primaryRole: draft.primaryRole,
        roles: draft.roles,
        capabilities: body.capabilities ?? ['general'],
        enabled: body.enabled ?? true,
        scope: body.scope ?? 'global',
        projectId: body.projectId,
        description: body.description ?? 'Custom ACP/CLI worker',
        health: 'unknown',
      }
      store.upsertWorkerLogged(worker)
      return c.json({ worker })
    },
  }),

  registerApiRoute('/api/approvals', {
    method: 'GET',
    handler: async (c) => {
      const status = c.req.query('status')
      const pendingOnly = c.req.query('pending') === '1' || c.req.query('pending') === 'true'
      if (pendingOnly) {
        return c.json({ approvals: store.listPendingApprovals() })
      }
      if (status === 'pending' || status === 'allowed' || status === 'denied' || status === 'cancelled') {
        return c.json({ approvals: store.listApprovals(status) })
      }
      return c.json({ approvals: store.listApprovals() })
    },
  }),

  registerApiRoute('/api/approvals', {
    method: 'POST',
    handler: async (c) => {
      const body = (await c.req.json()) as {
        title: string
        detail?: string
        action?: string
        pathOrTarget?: string
        workerId?: string
        workerName?: string
        sessionId?: string | null
        options?: { optionId: string; name: string }[]
        source?: 'acp' | 'tool' | 'manual'
      }
      if (!body.title) return c.json({ error: 'title required' }, 400)
      const item = store.enqueueApproval({
        ...body,
        sessionId: body.sessionId ?? store.getActive().session?.id ?? null,
        source: body.source ?? 'manual',
      })
      return c.json({ approval: item, snapshot: store.snapshot() })
    },
  }),

  registerApiRoute('/api/approvals/:id/resolve', {
    method: 'POST',
    handler: async (c) => {
      const id = c.req.param('id')
      const body = (await c.req.json()) as {
        decision: ApprovalDecision
        optionId?: string
      }
      if (!body.decision || !['allow', 'deny', 'cancel'].includes(body.decision)) {
        return c.json({ error: 'decision must be allow|deny|cancel' }, 400)
      }
      try {
        const approval = store.resolveApproval(id, body.decision, body.optionId)
        return c.json({ approval, snapshot: store.snapshot() })
      } catch (e) {
        return c.json({ error: e instanceof Error ? e.message : String(e) }, 400)
      }
    },
  }),

  /** Seed a demo ACP-style permission for UI testing without a live agent. */
  registerApiRoute('/api/approvals/demo', {
    method: 'POST',
    handler: async (c) => {
      const { session } = store.getActive()
      const item = store.enqueueApproval(
        mapAcpPermissionToEnqueue({
          title: 'Write file',
          action: 'write',
          pathOrTarget: 'apps/desktop/src/components/SessionList.tsx',
          workerName: 'Claude Code',
          sessionId: session?.id ?? null,
          options: [
            { optionId: 'allow', name: 'Allow' },
            { optionId: 'deny', name: 'Deny' },
          ],
        }),
      )
      return c.json({ approval: item, snapshot: store.snapshot() })
    },
  }),

  registerApiRoute('/api/dispatch', {
    method: 'POST',
    handler: async (c) => {
      const body = (await c.req.json()) as {
        role?: WorkerRole
        workerIdOrKind?: string
        task: string
        cwd?: string
      }
      if (!body.task) return c.json({ error: 'task required' }, 400)
      try {
        const { job, output } = await getWorkerScheduler().enqueue({
          ...body,
          source: 'api',
          wait: true,
        })
        return c.json({
          result: {
            ok: job.status === 'succeeded',
            mode: job.status === 'succeeded' ? 'acp' : 'error',
            workerName: job.workerName,
            workerId: job.workerId,
            jobId: job.id,
            status: job.status,
            message: job.message ?? job.error ?? job.status,
            output,
            task: job.task,
            cwd: job.cwd,
          },
          job,
        })
      } catch (e) {
        return c.json({ error: e instanceof Error ? e.message : String(e) }, 400)
      }
    },
  }),

  registerApiRoute('/api/git', {
    method: 'GET',
    handler: async (c) => {
      const { project } = store.getActive()
      if (!project) return c.json({ error: 'no active project', ok: false, files: [] }, 400)
      return c.json(await getGitStatus(project.rootPath))
    },
  }),

  registerApiRoute('/api/projects/:id/git', {
    method: 'GET',
    handler: async (c) => {
      const id = c.req.param('id')
      const project = store.listProjects().find((p) => p.id === id)
      if (!project) return c.json({ error: 'project not found' }, 404)
      return c.json(await getGitStatus(project.rootPath))
    },
  }),

  registerApiRoute('/api/files', {
    method: 'GET',
    handler: async (c) => {
      const { project } = store.getActive()
      if (!project) return c.json({ error: 'no active project', ok: false, entries: [] }, 400)
      const depth = Number(c.req.query('depth') ?? 3)
      return c.json(
        listProjectFiles(project.rootPath, {
          maxDepth: Number.isFinite(depth) ? depth : 3,
        }),
      )
    },
  }),

  registerApiRoute('/api/projects/:id/files', {
    method: 'GET',
    handler: async (c) => {
      const id = c.req.param('id')
      const project = store.listProjects().find((p) => p.id === id)
      if (!project) return c.json({ error: 'project not found' }, 404)
      const depth = Number(c.req.query('depth') ?? 3)
      return c.json(
        listProjectFiles(project.rootPath, {
          maxDepth: Number.isFinite(depth) ? depth : 3,
        }),
      )
    },
  }),

  registerApiRoute('/api/demo/seed', {
    method: 'POST',
    handler: async (c) => {
      const rootPath = process.cwd()
      const project = store.upsertProject({
        name: 'router-agents',
        rootPath,
        defaultBranch: 'main',
      })
      const locale = store.getLocale()
      const session = store.createSession({
        projectId: project.id,
        title: locale === 'en' ? 'Implement session sidebar' : '实现 Session 侧栏',
        mode: 'build',
      })
      return c.json({ project, session, snapshot: store.snapshot() })
    },
  }),
]
