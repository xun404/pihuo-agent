import { registerApiRoute } from '@mastra/core/server'
import {
  createId,
  getGitStatus,
  listProjectFiles,
  getSharedStore,
  getWorkerModelCatalogStore,
  globalActivityLog,
} from '@swarmdesk-agent/core'
import {
  applyHealthReport,
  parseHealthDepth,
  getAcpSessionManager,
  formatPublicError,
  type SessionEntryConfig,
} from '@swarmdesk-agent/adapters'
import {
  apiGetRegistryCatalog,
  apiDeleteWorker,
  apiWorkerReadinessStatus,
  apiListWorkerSecretStatus,
  apiGetWorkerAuthMethods,
  apiListCleanupCandidates,
  registryApiPublicError,
  registryCatalogApiPublicError,
} from '../acp-registry-api.js'
import { getWorkerModels, evaluateWorkerModelPin, applyWorkerModelPin } from '../worker-models.js'
import { checkOneWorker, checkWorkersBatch } from '../workers-health.js'
import { getWorkerScheduler } from '../scheduler.js'
import type {
  ApprovalDecision,
  LeaderMode,
  Locale,
  WorkerRegistration,
  WorkerRole,
} from '@swarmdesk-agent/shared'
import { normalizeWorkerRoles } from '@swarmdesk-agent/shared'
import { basename } from 'node:path'
import { asAcpHttpFailure } from '../acp-http-error.js'
import {
  deleteRouterProjectResource,
  deleteRouterSessionResource,
  reconcileWorkerRuntimeResources,
} from '../acp-resource-lifecycle.js'

/** Lazy — avoid constructing owner Store at module import (Studio client-only path). */
function store() {
  return getSharedStore()
}

const REGISTRY_OWNER_REQUIRED = {
  error: 'Registry mutations are available only through the Owner API',
  code: 'WORKER_NOT_READY',
} as const

/** Lazy accessor for tests/helpers that previously imported a module-level store. */
export function routeStore() {
  return store()
}

export const apiRoutes = [
  registerApiRoute('/api/snapshot', {
    method: 'GET',
    handler: async (c) => {
      return c.json(store().snapshot())
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
      return c.json({ locale: store().getLocale() })
    },
  }),

  registerApiRoute('/api/locale', {
    method: 'POST',
    handler: async (c) => {
      const body = (await c.req.json()) as { locale: Locale }
      if (body.locale !== 'zh' && body.locale !== 'en') {
        return c.json({ error: 'locale must be zh or en' }, 400)
      }
      const locale = store().setLocale(body.locale)
      return c.json({ locale, snapshot: store().snapshot() })
    },
  }),

  registerApiRoute('/api/projects', {
    method: 'GET',
    handler: async (c) => {
      return c.json({ projects: store().listProjects() })
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
      const project = store().upsertProject({
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
      return c.json({ sessions: store().listSessions(projectId || undefined) })
    },
  }),

  registerApiRoute('/api/sessions/:id', {
    method: 'DELETE',
    handler: async (c) => {
      const id = c.req.param('id')
      try {
        deleteRouterSessionResource({
          manager: getAcpSessionManager(),
          store: store(),
          sessionId: id,
        })
      } catch (error) {
        const failure = asAcpHttpFailure(error)
        if (failure) return c.json(failure.body, failure.status)
        throw error
      }
      return c.json({ ok: true, snapshot: store().snapshot() })
    },
  }),

  registerApiRoute('/api/projects/:id', {
    method: 'DELETE',
    handler: async (c) => {
      const id = c.req.param('id')
      try {
        deleteRouterProjectResource({
          manager: getAcpSessionManager(),
          store: store(),
          projectId: id,
        })
      } catch (error) {
        const failure = asAcpHttpFailure(error)
        if (failure) return c.json(failure.body, failure.status)
        throw error
      }
      return c.json({ ok: true, snapshot: store().snapshot() })
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
      const session = store().createSession(body)
      return c.json({ session })
    },
  }),

  registerApiRoute('/api/sessions/:id/activate', {
    method: 'POST',
    handler: async (c) => {
      const id = c.req.param('id')
      const session = store().setActiveSession(id)
      return c.json({ session })
    },
  }),

  registerApiRoute('/api/sessions/:id/approval-policy', {
    method: 'POST',
    handler: async (c) => {
      const id = c.req.param('id')
      const body = (await c.req.json()) as { approvalPolicy?: string }
      const validPolicies = new Set([
        'manual',
        'allow_once',
        'allow_always',
        'reject_once',
        'reject_always',
      ])
      if (!body.approvalPolicy || !validPolicies.has(body.approvalPolicy)) {
        return c.json(
          {
            error: `Invalid approvalPolicy. Must be one of: ${[...validPolicies].join(', ')}`,
          },
          400,
        )
      }
      try {
        const session = store().updateSessionApprovalPolicy(
          id,
          body.approvalPolicy as import('@swarmdesk-agent/shared').SessionApprovalPolicy,
        )
        return c.json({ session, snapshot: store().snapshot() })
      } catch (e) {
        return c.json({ error: e instanceof Error ? e.message : String(e) }, 404)
      }
    },
  }),

  registerApiRoute('/api/workers', {
    method: 'GET',
    handler: async (c) => {
      const role = c.req.query('role') as WorkerRole | undefined
      const workers = role ? store().listWorkersByRole(role) : store().listWorkers()
      return c.json({ workers })
    },
  }),

  registerApiRoute('/api/workers/registry', {
    method: 'GET',
    handler: async (c) => {
      try {
        return c.json(await apiGetRegistryCatalog({ refresh: false }))
      } catch (error) {
        const p = registryCatalogApiPublicError(error)
        return c.json({ error: p.error, code: p.code }, p.status as 502)
      }
    },
  }),

  registerApiRoute('/api/workers/registry/prepare', {
    method: 'POST',
    handler: async (c) => {
      return c.json(REGISTRY_OWNER_REQUIRED, 409)
    },
  }),

  registerApiRoute('/api/workers/registry/register', {
    method: 'POST',
    handler: async (c) => {
      return c.json(REGISTRY_OWNER_REQUIRED, 409)
    },
  }),

  registerApiRoute('/api/workers/registry/cleanup-candidates', {
    method: 'GET',
    handler: async (c) => c.json(apiListCleanupCandidates()),
  }),

  registerApiRoute('/api/workers/registry/installations/:installationId', {
    method: 'DELETE',
    handler: async (c) => {
      return c.json(REGISTRY_OWNER_REQUIRED, 409)
    },
  }),

  registerApiRoute('/api/workers/:id/readiness', {
    method: 'GET',
    handler: async (c) => {
      try {
        return c.json(apiWorkerReadinessStatus(c.req.param('id')))
      } catch (error) {
        const p = registryApiPublicError(error)
        return c.json({ error: p.error, code: p.code }, p.status as 400 | 404 | 409 | 500)
      }
    },
  }),

  registerApiRoute('/api/workers/:id/auth-methods', {
    method: 'GET',
    handler: async (c) => {
      try {
        return c.json(apiGetWorkerAuthMethods(c.req.param('id')))
      } catch (error) {
        const p = registryApiPublicError(error)
        return c.json({ error: p.error, code: p.code }, p.status as 400 | 404 | 409 | 500)
      }
    },
  }),

  registerApiRoute('/api/workers/:id/probe', {
    method: 'POST',
    handler: async (c) => c.json(REGISTRY_OWNER_REQUIRED, 409),
  }),

  registerApiRoute('/api/workers/:id/authenticate', {
    method: 'POST',
    handler: async (c) => c.json(REGISTRY_OWNER_REQUIRED, 409),
  }),

  registerApiRoute('/api/workers/:id/secrets', {
    method: 'GET',
    handler: async (c) => {
      try {
        return c.json(apiListWorkerSecretStatus(c.req.param('id')))
      } catch (error) {
        const p = registryApiPublicError(error)
        return c.json({ error: p.error, code: p.code }, p.status as 400 | 404 | 409 | 500)
      }
    },
  }),

  registerApiRoute('/api/workers/:id/secrets', {
    method: 'POST',
    handler: async (c) => {
      return c.json(REGISTRY_OWNER_REQUIRED, 409)
    },
  }),

  registerApiRoute('/api/workers/:id/secrets', {
    method: 'DELETE',
    handler: async (c) => {
      return c.json(REGISTRY_OWNER_REQUIRED, 409)
    },
  }),

  registerApiRoute('/api/workers/:id/logout', {
    method: 'POST',
    handler: async (c) => {
      return c.json(REGISTRY_OWNER_REQUIRED, 409)
    },
  }),

  registerApiRoute('/api/workers/:id', {
    method: 'DELETE',
    handler: async (c) => {
      try {
        const worker = store()
          .listWorkers()
          .find((candidate) => candidate.id === c.req.param('id'))
        if (worker?.source?.type === 'registry') {
          return c.json(REGISTRY_OWNER_REQUIRED, 409)
        }
        const remove = c.req.query('removeInstallation') === '1'
        return c.json(
          apiDeleteWorker({
            workerId: c.req.param('id'),
            removeUnreferencedInstallation: remove,
          }),
        )
      } catch (error) {
        const p = registryApiPublicError(error)
        return c.json({ error: p.error, code: p.code }, p.status as 400 | 404 | 409 | 500)
      }
    },
  }),

  registerApiRoute('/api/workers/:id/upgrade', {
    method: 'POST',
    handler: async (c) => {
      return c.json(REGISTRY_OWNER_REQUIRED, 409)
    },
  }),

  registerApiRoute('/api/workers/:id/adopt-registry', {
    method: 'POST',
    handler: async (c) => {
      return c.json(REGISTRY_OWNER_REQUIRED, 409)
    },
  }),

  registerApiRoute('/api/workers/:id/auth-terminal', {
    method: 'POST',
    handler: async (c) => {
      return c.json(REGISTRY_OWNER_REQUIRED, 409)
    },
  }),

  registerApiRoute('/api/workers/:id/toggle', {
    method: 'POST',
    handler: async (c) => {
      const id = c.req.param('id')
      const body = (await c.req.json()) as { enabled: boolean }
      const previous = store()
        .listWorkers()
        .find((candidate) => candidate.id === id)
      const nextEnabled = Boolean(body.enabled)
      if (previous) {
        try {
          reconcileWorkerRuntimeResources({
            before: previous,
            after: { ...previous, enabled: nextEnabled },
            manager: getAcpSessionManager(),
            catalogStore: getWorkerModelCatalogStore(),
          })
        } catch (error) {
          const failure = asAcpHttpFailure(error)
          if (failure) return c.json(failure.body, failure.status)
          throw error
        }
      }
      const worker = store().setWorkerEnabled(id, nextEnabled)
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
      const worker = store().setWorkerRoles(id, body)
      return c.json({ worker })
    },
  }),

  registerApiRoute('/api/workers/:id/models', {
    method: 'GET',
    handler: async (c) => {
      const id = c.req.param('id')
      const worker = store()
        .listWorkers()
        .find((w) => w.id === id)
      if (!worker) return c.json({ error: 'not found' }, 404)
      try {
        const q = c.req.query('q')?.trim() ?? ''
        const limit = Number(c.req.query('limit') ?? 50)
        const force = c.req.query('force') === '1' || c.req.query('force') === 'true'
        const requestedProjectId = c.req.query('projectId')?.trim() || undefined
        const requestedProject = requestedProjectId
          ? store()
              .listProjects()
              .find((project) => project.id === requestedProjectId)
          : store().getActive().project
        if (requestedProjectId && !requestedProject) {
          return c.json({ error: 'project not found', projectId: requestedProjectId }, 404)
        }
        // All paths (including q=) go through SWR controller
        const refResult = await getWorkerModels({
          workerId: id,
          cwd: requestedProject?.rootPath,
          force,
          q: q || undefined,
          limit,
        })
        return c.json({
          ok: refResult.ok,
          models: refResult.models ?? [],
          error: refResult.error,
          errorCode: refResult.errorCode,
          worker: refResult.worker,
          snapshot: store().snapshot(),
          cached: refResult.cached,
          stale: refResult.stale,
          catalogState: refResult.catalogState,
          currentPinState: refResult.currentPinState,
          search: Boolean(q),
        })
      } catch (e) {
        const failure = asAcpHttpFailure(e)
        return failure
          ? c.json(failure.body, failure.status)
          : c.json({ error: e instanceof Error ? e.message : String(e) }, 500)
      }
    },
  }),

  registerApiRoute('/api/workers/:id/model', {
    method: 'POST',
    handler: async (c) => {
      const id = c.req.param('id')
      const body = (await c.req.json()) as { model?: string | null; projectId?: string | null }
      try {
        const previous = store()
          .listWorkers()
          .find((candidate) => candidate.id === id)
        const nextModel =
          typeof body.model === 'string' && body.model.trim() ? body.model.trim() : undefined
        const requestedProjectId = body.projectId?.trim() || undefined
        const requestedProject = requestedProjectId
          ? store()
              .listProjects()
              .find((project) => project.id === requestedProjectId)
          : store().getActive().project
        if (requestedProjectId && !requestedProject) {
          return c.json({ error: 'project not found', projectId: requestedProjectId }, 404)
        }
        const pinCheck = evaluateWorkerModelPin(id, body.model, {
          cwd: requestedProject?.rootPath,
        })
        if (!pinCheck.ok) {
          return c.json(
            {
              error: formatPublicError(pinCheck.errorCode, pinCheck.error ?? 'Model pin rejected'),
              errorCode: pinCheck.errorCode,
            },
            400,
          )
        }
        if (previous) {
          reconcileWorkerRuntimeResources({
            before: previous,
            after: { ...previous, model: nextModel },
            manager: getAcpSessionManager(),
            catalogStore: getWorkerModelCatalogStore(),
          })
        }
        const worker = applyWorkerModelPin(id, body.model)
        return c.json({ worker, snapshot: store().snapshot() })
      } catch (e) {
        const failure = asAcpHttpFailure(e)
        return failure
          ? c.json(failure.body, failure.status)
          : c.json({ error: e instanceof Error ? e.message : String(e) }, 404)
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
      const active = store().getActive()
      const batch = await checkWorkersBatch({
        workerIds: body.workerIds,
        depth: body.depth,
        onlyEnabled: body.onlyEnabled,
        cwd: active.project?.rootPath,
      })
      return c.json({
        ...batch,
        workers: store().listWorkers(),
        snapshot: store().snapshot(),
      })
    },
  }),

  registerApiRoute('/api/workers/:id/health', {
    method: 'POST',
    handler: async (c) => {
      const id = c.req.param('id')
      const workers = store().listWorkers()
      const worker = workers.find((w) => w.id === id)
      if (!worker) return c.json({ error: 'not found' }, 404)
      const body = (await c.req.json().catch(() => ({}))) as { depth?: string }
      const depth = parseHealthDepth(body.depth ?? c.req.query('depth'))
      const active = store().getActive()
      const { worker: updated, report } = await checkOneWorker(
        worker,
        depth,
        active.project?.rootPath,
      )
      return c.json({ worker: updated, report, snapshot: store().snapshot() })
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
      const previous = body.id
        ? store()
            .listWorkers()
            .find((candidate) => candidate.id === body.id)
        : undefined
      if (previous) {
        try {
          reconcileWorkerRuntimeResources({
            before: previous,
            after: worker,
            manager: getAcpSessionManager(),
            catalogStore: getWorkerModelCatalogStore(),
          })
        } catch (error) {
          const failure = asAcpHttpFailure(error)
          if (failure) return c.json(failure.body, failure.status)
          throw error
        }
      }
      store().upsertWorkerLogged(worker)
      return c.json({ worker })
    },
  }),

  registerApiRoute('/api/approvals', {
    method: 'GET',
    handler: async (c) => {
      const status = c.req.query('status')
      const pendingOnly = c.req.query('pending') === '1' || c.req.query('pending') === 'true'
      if (pendingOnly) {
        return c.json({ approvals: store().listPendingApprovals() })
      }
      if (
        status === 'pending' ||
        status === 'allowed' ||
        status === 'denied' ||
        status === 'cancelled'
      ) {
        return c.json({ approvals: store().listApprovals(status) })
      }
      return c.json({ approvals: store().listApprovals() })
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
        options: Array<{
          optionId: string
          name: string
          kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always'
        }>
        source?: 'acp' | 'tool' | 'manual'
      }
      if (!body.title) return c.json({ error: 'title required' }, 400)
      try {
        const item = store().enqueueApproval({
          ...body,
          sessionId: body.sessionId ?? store().getActive().session?.id ?? null,
          source: body.source ?? 'manual',
        })
        return c.json({ approval: item, snapshot: store().snapshot() })
      } catch (error) {
        return c.json({ error: error instanceof Error ? error.message : 'Invalid approval' }, 400)
      }
    },
  }),

  registerApiRoute('/api/approvals/:id/resolve', {
    method: 'POST',
    handler: async (c) => {
      const id = c.req.param('id')
      const body = (await c.req.json()) as {
        decision: ApprovalDecision
        optionId?: string
        surface?: 'chat' | 'panel'
      }
      if (!body.decision || !['allow', 'deny', 'cancel'].includes(body.decision)) {
        return c.json({ error: 'decision must be allow|deny|cancel' }, 400)
      }
      if (body.surface !== 'chat' && body.surface !== 'panel') {
        return c.json({ error: 'surface must be chat|panel' }, 400)
      }
      try {
        const approval = getWorkerScheduler().resolveApproval(id, body.decision, {
          optionId: body.optionId,
          surface: body.surface,
        })
        return c.json({ approval, snapshot: store().snapshot() })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        const status = /already/i.test(msg) ? 409 : 400
        return c.json({ error: msg }, status as 400 | 409)
      }
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

  registerApiRoute('/api/jobs/:id/acp-context/reset', {
    method: 'POST',
    handler: async (c) => {
      const id = c.req.param('id')
      const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
      if (typeof body.agentSessionId === 'string') {
        return c.json({ error: 'agentSessionId must not be provided in body' }, 400)
      }

      const job = store().getJob(id)
      if (!job) {
        return c.json({ error: 'Job not found' }, 404)
      }

      const activeSessionId = store().getActive().session?.id
      if (!activeSessionId || job.sessionId !== activeSessionId) {
        return c.json({ error: 'Job does not belong to active session' }, 400)
      }

      const manager = getAcpSessionManager()
      let deleted = false
      try {
        if (job.reuseKeyDigest) {
          deleted = manager.deleteContextByDigest(job.reuseKeyDigest).deleted
        } else {
          const worker = store()
            .listWorkers()
            .find((w) => w.id === job.workerId)
          if (worker) {
            const sessionConfig: SessionEntryConfig = {
              command: worker.command,
              args: [...worker.args],
              model: worker.model?.trim() || undefined,
              env: { ...worker.env },
            }
            const reuseKey = manager.buildReuseKey({
              routerSessionId: job.sessionId,
              workerId: worker.id,
              cwd: job.cwd,
              config: sessionConfig,
            })
            manager.deleteContextByReuseKey(reuseKey)
            deleted = true
          }
        }
      } catch (error) {
        const failure = asAcpHttpFailure(error)
        if (failure) return c.json(failure.body, failure.status)
        throw error
      }
      store().updateJob(job.id, {
        meta: {
          ...job.meta,
          acpContextResetAt: new Date().toISOString(),
          acpContextResetDeleted: deleted,
        },
      })

      globalActivityLog.append('job', `ACP context reset for job ${job.id}`, {
        jobId: job.id,
        workerId: job.workerId,
        sessionId: job.sessionId,
      })

      return c.json({
        ok: true,
        jobId: job.id,
        deleted,
        message: deleted
          ? 'ACP context reset. Retry the dispatch to create a fresh session.'
          : 'No live/catalog context found for this job digest (already clean).',
        snapshot: store().snapshot(),
      })
    },
  }),

  registerApiRoute('/api/git', {
    method: 'GET',
    handler: async (c) => {
      const { project } = store().getActive()
      if (!project) return c.json({ error: 'no active project', ok: false, files: [] }, 400)
      return c.json(await getGitStatus(project.rootPath))
    },
  }),

  registerApiRoute('/api/projects/:id/git', {
    method: 'GET',
    handler: async (c) => {
      const id = c.req.param('id')
      const project = store()
        .listProjects()
        .find((p) => p.id === id)
      if (!project) return c.json({ error: 'project not found' }, 404)
      return c.json(await getGitStatus(project.rootPath))
    },
  }),

  registerApiRoute('/api/files', {
    method: 'GET',
    handler: async (c) => {
      const { project } = store().getActive()
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
      const project = store()
        .listProjects()
        .find((p) => p.id === id)
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
      const project = store().upsertProject({
        name: 'swarmdesk-agent',
        rootPath,
        defaultBranch: 'main',
      })
      const locale = store().getLocale()
      const session = store().createSession({
        projectId: project.id,
        title: locale === 'en' ? 'Implement session sidebar' : '实现 Session 侧栏',
        mode: 'build',
      })
      return c.json({ project, session, snapshot: store().snapshot() })
    },
  }),
]
