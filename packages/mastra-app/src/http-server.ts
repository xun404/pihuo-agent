/**
 * Default desktop API server: REST + Leader chat on one process/port.
 * Shares LocalStore singleton with agent tools via getSharedStore().
 *
 * Usage: node --import tsx src/http-server.ts
 * Port: MASTRA_PORT or 4111
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { basename, resolve as pathResolve } from 'node:path'
import {
  createId,
  mapAcpPermissionToEnqueue,
  getGitStatus,
  listProjectFiles,
  waitForApprovalDecision,
  getSharedStore,
  globalActivityLog,
  applySecretsToEnv,
  getSecretsStatus,
  setSecret,
  deleteSecret,
  loadSettings,
  saveSettings,
  resolveLeaderMaxSteps,
  mergeProvidersWithCustom,
  MASTRA_PROVIDERS,
  SECRET_ENV_KEYS,
  normalizeThinkingIntensity,
  thinkingIntensityToProviderOptions,
  resolveSupportedThinkingIntensities,
  normalizeThinkingIntensityList,
  resolveApiKeyEnvsForModel,
  hasAnyApiKey,
  normalizeLeaderModelForMastra,
  normalizeMastraModelId,
  parseLeaderMaxStepsInput,
  type CustomProviderSettings,
  type ThinkingIntensity,
} from '@router-agents/core'
// mapAcpPermission / waitForApproval still used by approval routes
import {
  applyHealthReport,
  parseHealthDepth,
  detectAcpWorkers,
  applyDetectionToWorkers,
  workerExecutionConfigChanged,
} from '@router-agents/adapters'
import { refreshWorkerModels } from './worker-models.js'
import { getAcpSessionManager } from '@router-agents/adapters'
import type {
  ApprovalDecision,
  LeaderMode,
  Locale,
  WorkerRegistration,
  WorkerRole,
} from '@router-agents/shared'
import { normalizeWorkerRoles } from '@router-agents/shared'
import { handleChatStream } from '@mastra/ai-sdk'
import { toAISdkV5Messages } from '@mastra/ai-sdk/ui'
import { pipeUIMessageStreamToResponse } from 'ai'
import { RequestContext } from '@mastra/core/request-context'
import { mastra } from './mastra/index.js'
import { leaderAgent } from './agents/leader-agent.js'
import { leaderMemory } from './agents/leader-agent.js'
import { controllerStatusSnapshot, getLeaderController } from './agents/controller.js'
import {
  checkOneWorker,
  checkWorkersBatch,
  scheduleAutoWorkerHealth,
} from './workers-health.js'
import { getWorkerScheduler } from './scheduler.js'
import { detectLeaderStepBudgetExhaustion, createBudgetMarkerMessage } from './leader-step-budget.js'
import type { LeaderStepBudgetEvent } from '@router-agents/shared'

// Load encrypted secrets + model settings into process.env before agents run
applySecretsToEnv(process.env)

const store = getSharedStore()
const port = Number(process.env.MASTRA_PORT ?? 4111)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

function send(res: ServerResponse, status: number, body: unknown) {
  const json = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    ...CORS,
  })
  res.end(json)
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw) return {}
  return JSON.parse(raw)
}

function match(path: string, pattern: string): Record<string, string> | null {
  const pp = pattern.split('/').filter(Boolean)
  const sp = path.split('/').filter(Boolean)
  if (pp.length !== sp.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < pp.length; i++) {
    const a = pp[i]!
    const b = sp[i]!
    if (a.startsWith(':')) params[a.slice(1)] = decodeURIComponent(b)
    else if (a !== b) return null
  }
  return params
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS)
      res.end()
      return
    }

    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
    const path = url.pathname
    const method = req.method ?? 'GET'

    // Leader chat (AI SDK useChat) — same origin as REST for desktop default base URL
    const chatMatch = match(path, '/chat/:agentId')
    if (method === 'POST' && chatMatch) {
      const agentId = chatMatch.agentId!
      const params = (await readJson(req)) as Record<string, unknown>
      try {
        // Goals + Memory processors require an active resourceId + threadId on every run.
        // Prefer client-provided memory (session-scoped); fall back to active project/session.
        const active = store.getActive()
        const clientMemory = (params.memory ?? null) as
          | { thread?: string | { id?: string }; resource?: string }
          | null
        const threadFromClient =
          typeof clientMemory?.thread === 'string'
            ? clientMemory.thread
            : clientMemory?.thread && typeof clientMemory.thread === 'object'
              ? clientMemory.thread.id
              : undefined
        const resourceFromClient =
          typeof clientMemory?.resource === 'string' ? clientMemory.resource : undefined

        const threadId =
          threadFromClient ||
          active.session?.memoryThreadId ||
          active.session?.id ||
          'router-default-thread'
        const resourceId =
          resourceFromClient ||
          active.project?.id ||
          active.session?.projectId ||
          'router-default-resource'

        // Per-chat model from UI picker (provider/model), else settings leaderModel
        const settings = loadSettings()
        const leaderMaxSteps = resolveLeaderMaxSteps(settings.leaderMaxSteps)
        const clientModel =
          typeof params.model === 'string' && params.model.includes('/')
            ? params.model.trim()
            : typeof (params as { leaderModel?: string }).leaderModel === 'string' &&
                (params as { leaderModel: string }).leaderModel.includes('/')
              ? (params as { leaderModel: string }).leaderModel.trim()
              : undefined
        const leaderModelRaw =
          clientModel || settings.leaderModel || process.env.LEADER_MODEL || 'openai/gpt-5.5'
        // Map slug typos (opencodego → opencode-go) so Mastra models.dev can resolve
        const leaderModel = normalizeLeaderModelForMastra(
          normalizeMastraModelId(leaderModelRaw),
          settings.customProviders,
        )

        // Ensure secrets are on process.env before Mastra resolves the model
        applySecretsToEnv(process.env)

        const keyInfo = resolveApiKeyEnvsForModel(leaderModel, settings.customProviders)
        if (keyInfo && !hasAnyApiKey(keyInfo.envKeys, process.env)) {
          const detail = {
            code: 'MISSING_API_KEY',
            model: leaderModel,
            providerId: keyInfo.providerId,
            envKeys: keyInfo.envKeys,
          }
          console.error('[chat] missing API key — configure in Settings', detail)
          globalActivityLog.append(
            'chat',
            `Missing API key for ${leaderModel} (${keyInfo.envKeys[0] ?? '?'})`,
            { agentId, ...detail },
          )
          send(res, 400, {
            code: 'MISSING_API_KEY',
            error: `Missing API key for ${leaderModel}`,
            providerId: keyInfo.providerId,
            envKey: keyInfo.envKeys[0],
          })
          return
        }

        // Thinking intensity: per-request body > settings > env
        const clientThinking = (params as { thinkingIntensity?: unknown }).thinkingIntensity
        const thinkingIntensity = normalizeThinkingIntensity(
          clientThinking ?? settings.thinkingIntensity ?? process.env.THINKING_INTENSITY,
        )
        // Cast: Mastra ProviderOptions is a branded union; our map is intentionally broad
        const providerOptions = thinkingIntensityToProviderOptions(
          thinkingIntensity,
        ) as never

        const requestContext = new RequestContext()
        requestContext.set('leaderModel', leaderModel)
        requestContext.set('thinkingIntensity', thinkingIntensity)

        const routerSession = store.listSessions().find((s) => s.memoryThreadId === threadId) ?? null
        if (routerSession) {
          requestContext.set('routerSessionId', routerSession.id)
          requestContext.set('routerProjectId', routerSession.projectId)
          requestContext.set('memoryThreadId', routerSession.memoryThreadId)
          const routerProject = store.listProjects().find((p) => p.id === routerSession.projectId)
          if (routerProject) {
            requestContext.set('routerProjectRoot', routerProject.rootPath)
          }
        } else {
          requestContext.set('memoryThreadId', threadId)
        }

        // Ensure params carry memory even if client omitted it (goal-state processor)
        const paramsWithMemory = {
          ...params,
          maxSteps: leaderMaxSteps,
          memory: {
            thread: threadId,
            resource: resourceId,
            ...(typeof clientMemory === 'object' && clientMemory && 'options' in clientMemory
              ? { options: (clientMemory as { options?: unknown }).options }
              : {}),
          },
          requestContext,
          providerOptions,
        }

        globalActivityLog.append('chat', `Chat → ${agentId}`, {
          agentId,
          threadId,
          resourceId,
          model: leaderModel,
          thinkingIntensity,
          messageCount: Array.isArray(params.messages) ? params.messages.length : 0,
        })
        // untilIdle keeps the stream open across background tool tasks
        // @see https://mastra.ai/docs/long-running-agents/background-tasks

        let streamBudgetEvent: LeaderStepBudgetEvent | null = null

        const stream = await handleChatStream({
          mastra,
          agentId,
          params: {
            ...paramsWithMemory,
            untilIdle: true,
            onFinish: async (onFinishEvent: {
              steps?: readonly unknown[];
              finishReason?: string;
              runId?: string;
            }) => {
              if (!onFinishEvent.finishReason) return
              const event = detectLeaderStepBudgetExhaustion({
                maxSteps: leaderMaxSteps,
                steps: onFinishEvent.steps ?? [],
                finishReason: onFinishEvent.finishReason,
                runId: onFinishEvent.runId ?? `${threadId}/${Date.now()}`,
              })
              if (!event) return
              streamBudgetEvent = event
              try {
                const marker = createBudgetMarkerMessage({
                  threadId,
                  resourceId,
                  event,
                })
                await leaderMemory.saveMessages({ messages: [marker as never] })
              } catch (err) {
                console.error('[step-budget] Failed to persist budget marker:', {
                  threadId,
                  runId: event.data.runId,
                  error: String(err),
                })
              }
            },
          } as never,
          sendReasoning: true,
          messageMetadata: () => streamBudgetEvent ? { leaderStepBudget: streamBudgetEvent.data } : undefined,
          defaultOptions: {
            maxSteps: leaderMaxSteps,
            memory: {
              thread: threadId,
              resource: resourceId,
            },
            requestContext,
            providerOptions,
            untilIdle: true,
          } as never,
        })
        for (const [k, v] of Object.entries(CORS)) {
          res.setHeader(k, v)
        }
        pipeUIMessageStreamToResponse({
          response: res,
          stream,
        })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        const stack = e instanceof Error ? e.stack : undefined
        // Full detail only in the API process terminal / activity log
        console.error('[chat] stream failed', msg)
        if (stack) console.error(stack)
        globalActivityLog.append('chat', `Chat error: ${msg.slice(0, 160)}`, { agentId })

        const missingKey = /Could not find API key|Missing API key|process\.env\.\w*API_KEY/i.test(
          msg,
        )
        send(res, missingKey ? 400 : 500, {
          code: missingKey ? 'MISSING_API_KEY' : 'CHAT_ERROR',
          // Short machine message — UI maps this; never include stack
          error: missingKey
            ? msg.replace(/\n[\s\S]*/, '').slice(0, 200)
            : 'Chat failed. See API terminal for details.',
        })
      }
      return
    }

    if (method === 'GET' && path === '/api/activity') {
      const limit = Number(url.searchParams.get('limit') ?? 50)
      send(res, 200, {
        events: globalActivityLog.list(Number.isFinite(limit) ? limit : 50),
      })
      return
    }

    if (method === 'GET' && path === '/api/snapshot') {
      send(res, 200, store.snapshot())
      return
    }

    if (method === 'GET' && path === '/api/approvals') {
      const pending = url.searchParams.get('pending')
      if (pending === '1' || pending === 'true') {
        send(res, 200, { approvals: store.listPendingApprovals() })
        return
      }
      send(res, 200, { approvals: store.listApprovals() })
      return
    }

    if (method === 'POST' && path === '/api/approvals') {
      const body = (await readJson(req)) as {
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
      if (!body.title) {
        send(res, 400, { error: 'title required' })
        return
      }
      const item = store.enqueueApproval({
        ...body,
        sessionId: body.sessionId ?? store.getActive().session?.id ?? null,
        source: body.source ?? 'manual',
      })
      send(res, 200, { approval: item, snapshot: store.snapshot() })
      return
    }

    if (method === 'POST' && path === '/api/approvals/demo') {
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
      send(res, 200, { approval: item, snapshot: store.snapshot() })
      return
    }

    const resolveMatch = match(path, '/api/approvals/:id/resolve')
    if (method === 'POST' && resolveMatch) {
      const body = (await readJson(req)) as {
        decision: ApprovalDecision
        optionId?: string
      }
      try {
        const approval = store.resolveApproval(
          resolveMatch.id!,
          body.decision,
          body.optionId,
        )
        send(res, 200, { approval, snapshot: store.snapshot() })
      } catch (e) {
        send(res, 400, { error: e instanceof Error ? e.message : String(e) })
      }
      return
    }

    // —— Worker jobs (scheduler) ——
    if (method === 'GET' && path === '/api/jobs') {
      const sessionId = url.searchParams.get('sessionId') ?? undefined
      const status = url.searchParams.get('status') ?? undefined
      const limit = Number(url.searchParams.get('limit') ?? 40)
      const scheduler = getWorkerScheduler()
      const jobs = scheduler.listJobs({
        sessionId,
        status: status as never,
        limit: Number.isFinite(limit) ? limit : 40,
      })
      send(res, 200, { jobs, busyWorkerIds: [...scheduler.busyWorkerIds()] })
      return
    }

    if (method === 'POST' && path === '/api/jobs') {
      const body = (await readJson(req)) as {
        role?: WorkerRole
        workerIdOrKind?: string
        task: string
        cwd?: string
        sessionId?: string
        projectId?: string
        wait?: boolean
      }
      if (!body.task?.trim()) {
        send(res, 400, { error: 'task required' })
        return
      }
      try {
        const { job, output } = await getWorkerScheduler().enqueue({
          ...body,
          source: 'api',
          wait: body.wait === true,
        })
        send(res, 200, { job, output, snapshot: store.snapshot() })
      } catch (e) {
        send(res, 400, { error: e instanceof Error ? e.message : String(e) })
      }
      return
    }

    const jobMatch = match(path, '/api/jobs/:id')
    if (method === 'GET' && jobMatch) {
      const job = getWorkerScheduler().getJob(jobMatch.id!)
      if (!job) {
        send(res, 404, { error: 'not found' })
        return
      }
      send(res, 200, { job })
      return
    }

    const jobCancel = match(path, '/api/jobs/:id/cancel')
    if (method === 'POST' && jobCancel) {
      try {
        const job = await getWorkerScheduler().cancel(jobCancel.id!)
        send(res, 200, { job, snapshot: store.snapshot() })
      } catch (e) {
        send(res, 400, { error: e instanceof Error ? e.message : String(e) })
      }
      return
    }

    const jobRetry = match(path, '/api/jobs/:id/retry')
    if (method === 'POST' && jobRetry) {
      try {
        const body = (await readJson(req).catch(() => ({}))) as { wait?: boolean }
        const result = await getWorkerScheduler().retry(jobRetry.id!, {
          wait: body.wait === true,
        })
        send(res, 200, { ...result, snapshot: store.snapshot() })
      } catch (e) {
        send(res, 400, { error: e instanceof Error ? e.message : String(e) })
      }
      return
    }

    // Legacy dispatch → scheduler with wait=true
    if (method === 'POST' && path === '/api/dispatch') {
      const body = (await readJson(req)) as {
        role?: WorkerRole
        workerIdOrKind?: string
        task: string
        cwd?: string
      }
      if (!body.task) {
        send(res, 400, { error: 'task required' })
        return
      }
      try {
        const { job, output } = await getWorkerScheduler().enqueue({
          ...body,
          source: 'api',
          wait: true,
        })
        send(res, 200, {
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
          snapshot: store.snapshot(),
        })
      } catch (e) {
        send(res, 400, { error: e instanceof Error ? e.message : String(e) })
      }
      return
    }

    // Git status for active project or :id
    if (method === 'GET' && path === '/api/git') {
      const { project } = store.getActive()
      if (!project) {
        send(res, 400, { error: 'no active project', ok: false, files: [] })
        return
      }
      const git = await getGitStatus(project.rootPath)
      send(res, 200, git)
      return
    }

    const gitMatch = match(path, '/api/projects/:id/git')
    if (method === 'GET' && gitMatch) {
      const project = store.listProjects().find((p) => p.id === gitMatch.id)
      if (!project) {
        send(res, 404, { error: 'project not found' })
        return
      }
      const git = await getGitStatus(project.rootPath)
      send(res, 200, git)
      return
    }

    // Files listing
    if (method === 'GET' && path === '/api/files') {
      const { project } = store.getActive()
      if (!project) {
        send(res, 400, { error: 'no active project', ok: false, entries: [] })
        return
      }
      const depth = Number(url.searchParams.get('depth') ?? 3)
      const files = listProjectFiles(project.rootPath, {
        maxDepth: Number.isFinite(depth) ? depth : 3,
      })
      send(res, 200, files)
      return
    }

    const filesMatch = match(path, '/api/projects/:id/files')
    if (method === 'GET' && filesMatch) {
      const project = store.listProjects().find((p) => p.id === filesMatch.id)
      if (!project) {
        send(res, 404, { error: 'project not found' })
        return
      }
      const depth = Number(url.searchParams.get('depth') ?? 3)
      const files = listProjectFiles(project.rootPath, {
        maxDepth: Number.isFinite(depth) ? depth : 3,
      })
      send(res, 200, files)
      return
    }

    if (method === 'POST' && path === '/api/demo/seed') {
      // Prefer monorepo root when API runs from packages/mastra-app
      const rootPath =
        process.env.ROUTER_AGENTS_ROOT ??
        (process.cwd().endsWith('mastra-app')
          ? pathResolve(process.cwd(), '../..')
          : process.cwd())
      const project = store.upsertProject({
        name: 'router-agents',
        rootPath: pathResolve(rootPath),
        defaultBranch: 'main',
      })
      const locale = store.getLocale()
      const session = store.createSession({
        projectId: project.id,
        title: locale === 'en' ? 'Implement session sidebar' : '实现 Session 侧栏',
        mode: 'build',
      })
      send(res, 200, { project, session, snapshot: store.snapshot() })
      return
    }

    if (method === 'POST' && path === '/api/locale') {
      const body = (await readJson(req)) as { locale: Locale }
      if (body.locale !== 'zh' && body.locale !== 'en') {
        send(res, 400, { error: 'locale must be zh or en' })
        return
      }
      const locale = store.setLocale(body.locale)
      send(res, 200, { locale, snapshot: store.snapshot() })
      return
    }

    if (method === 'GET' && path === '/api/workers') {
      const role = url.searchParams.get('role') as WorkerRole | null
      const workers = role ? store.listWorkersByRole(role) : store.listWorkers()
      send(res, 200, { workers })
      return
    }

    const rolesMatch = match(path, '/api/workers/:id/roles')
    if (method === 'POST' && rolesMatch) {
      const body = (await readJson(req)) as {
        primaryRole: WorkerRole
        roles: WorkerRole[]
      }
      const worker = store.setWorkerRoles(rolesMatch.id!, body)
      send(res, 200, { worker })
      return
    }

    const toggleMatch = match(path, '/api/workers/:id/toggle')
    if (method === 'POST' && toggleMatch) {
      const body = (await readJson(req)) as { enabled: boolean }
      const previous = store.listWorkers().find((candidate) => candidate.id === toggleMatch.id)
      const worker = store.setWorkerEnabled(toggleMatch.id!, Boolean(body.enabled))
      if (previous && workerExecutionConfigChanged(previous, worker)) {
        getAcpSessionManager().invalidateWorker(worker.id)
      }
      send(res, 200, { worker })
      return
    }

    // List ACP models for a worker (spawns agent briefly, resolves from configOptions)
    const modelsMatch = match(path, '/api/workers/:id/models')
    if (method === 'GET' && modelsMatch) {
      const worker = store.listWorkers().find((w) => w.id === modelsMatch.id)
      if (!worker) {
        send(res, 404, { error: 'not found' })
        return
      }
      try {
        const active = store.getActive()
        const refResult = await refreshWorkerModels(worker.id, active.project?.rootPath)
        send(res, 200, {
          ok: refResult.ok,
          models: refResult.models ?? [],
          error: refResult.error,
          worker: refResult.worker,
          snapshot: store.snapshot(),
          cached: refResult.cached,
          stale: refResult.stale,
        })
      } catch (e) {
        send(res, 500, { error: e instanceof Error ? e.message : String(e) })
      }
      return
    }

    // Set preferred ACP model for worker
    const modelMatch = match(path, '/api/workers/:id/model')
    if (method === 'POST' && modelMatch) {
      const body = (await readJson(req)) as { model?: string | null }
      try {
        const previous = store.listWorkers().find((candidate) => candidate.id === modelMatch.id)
        const worker = store.setWorkerModel(modelMatch.id!, body.model)
        if (previous && workerExecutionConfigChanged(previous, worker)) {
          getAcpSessionManager().invalidateWorker(worker.id)
        }
        globalActivityLog.append('worker', `Model set for ${worker.name}: ${worker.model ?? '(default)'}`, {
          workerId: worker.id,
          model: worker.model,
        })
        send(res, 200, { worker, snapshot: store.snapshot() })
      } catch (e) {
        send(res, 404, { error: e instanceof Error ? e.message : String(e) })
      }
      return
    }

    // Batch health check (must be before :id route)
    // Auto-detect ACP CLIs on this machine (Claude / Codex / OpenCode …)
    if (method === 'GET' && path === '/api/workers/detect') {
      const candidates = await detectAcpWorkers()
      send(res, 200, {
        candidates,
        recommended: candidates.filter((c) => c.installed),
        firstRun: store.listWorkers().every((w) => w.health === 'unknown' || !w.lastSeenAt),
      })
      return
    }

    if (method === 'POST' && path === '/api/workers/detect') {
      let apply = true
      let autoDisableMissing = false
      try {
        const body = (await readJson(req)) as {
          apply?: boolean
          autoDisableMissing?: boolean
        }
        if (body.apply === false) apply = false
        if (body.autoDisableMissing === true) autoDisableMissing = true
      } catch {
        /* empty body = apply defaults */
      }
      const candidates = await detectAcpWorkers()
      if (!apply) {
        send(res, 200, {
          candidates,
          recommended: candidates.filter((c) => c.installed),
          applied: false,
          snapshot: store.snapshot(),
        })
        return
      }

      const existing = store.listWorkers()
      const existingById = new Map(existing.map((worker) => [worker.id, worker]))
      const merged = applyDetectionToWorkers(existing, candidates, {
        autoDisableMissing,
        createMissing: true,
      })

      // Persist: update by kind, create new rows with real ids
      for (const w of merged.workers) {
        if (w.id.startsWith('detect-')) {
          const real = { ...w, id: createId('worker') }
          store.upsertWorkerLogged(real)
        } else {
          store.upsertWorker(w)
          const previous = existingById.get(w.id)
          if (previous && workerExecutionConfigChanged(previous, w)) {
            getAcpSessionManager().invalidateWorker(w.id)
          }
        }
      }

      // Refresh health for enabled workers (async batch)
      void checkWorkersBatch({ onlyEnabled: true, depth: 'version' }).catch(() => null)

      globalActivityLog.append(
        'system',
        `Worker detect: ${merged.recommended.map((c) => c.name).join(', ') || 'none'} installed`,
        {
          enabled: merged.enabled,
          recommended: merged.recommended.map((c) => c.kind),
        },
      )

      send(res, 200, {
        candidates,
        recommended: merged.recommended,
        enabled: merged.enabled,
        disabled: merged.disabled,
        applied: true,
        snapshot: store.snapshot(),
        workers: store.listWorkers(),
      })
      return
    }

    if (method === 'POST' && path === '/api/workers/health') {
      const body = (await readJson(req).catch(() => ({}))) as {
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
      send(res, 200, {
        ...batch,
        workers: store.listWorkers(),
        snapshot: store.snapshot(),
      })
      return
    }

    const healthMatch = match(path, '/api/workers/:id/health')
    if (method === 'POST' && healthMatch) {
      const workers = store.listWorkers()
      const worker = workers.find((w) => w.id === healthMatch.id)
      if (!worker) {
        send(res, 404, { error: 'not found' })
        return
      }
      let depth = parseHealthDepth(url.searchParams.get('depth'))
      try {
        const body = (await readJson(req).catch(() => ({}))) as { depth?: string }
        if (body.depth) depth = parseHealthDepth(body.depth)
      } catch {
        /* empty body ok */
      }
      const active = store.getActive()
      const { worker: updated, report } = await checkOneWorker(
        worker,
        depth,
        active.project?.rootPath,
      )
      send(res, 200, { worker: updated, report, snapshot: store.snapshot() })
      return
    }

    if (method === 'POST' && path === '/api/workers') {
      const body = (await readJson(req)) as Partial<WorkerRegistration>
      if (!body.name || !body.command) {
        send(res, 400, { error: 'name and command required' })
        return
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
        ? store.listWorkers().find((candidate) => candidate.id === body.id)
        : undefined
      store.upsertWorkerLogged(worker)
      if (previous && workerExecutionConfigChanged(previous, worker)) {
        getAcpSessionManager().invalidateWorker(worker.id)
      }
      // Async presence check for newly registered workers
      void checkOneWorker(worker, 'version').catch(() => null)
      send(res, 200, { worker })
      return
    }

    if (method === 'POST' && path === '/api/projects') {
      const body = (await readJson(req)) as {
        name?: string
        rootPath: string
        defaultBranch?: string
      }
      if (!body.rootPath) {
        send(res, 400, { error: 'rootPath required' })
        return
      }
      const project = store.upsertProject({
        name: body.name ?? basename(body.rootPath),
        rootPath: body.rootPath,
        defaultBranch: body.defaultBranch,
      })
      send(res, 200, { project })
      return
    }

    const activateProjectMatch = match(path, '/api/projects/:id/activate')
    if (method === 'POST' && activateProjectMatch) {
      try {
        const project = store.setActiveProject(activateProjectMatch.id!)
        send(res, 200, { project, snapshot: store.snapshot() })
      } catch (e) {
        send(res, 404, { error: e instanceof Error ? e.message : String(e) })
      }
      return
    }

    if (method === 'POST' && path === '/api/sessions') {
      const body = (await readJson(req)) as {
        projectId: string
        title: string
        mode?: LeaderMode
      }
      if (!body.projectId || !body.title) {
        send(res, 400, { error: 'projectId and title required' })
        return
      }
      const session = store.createSession(body)
      send(res, 200, { session })
      return
    }

    const activateMatch = match(path, '/api/sessions/:id/activate')
    if (method === 'POST' && activateMatch) {
      const session = store.setActiveSession(activateMatch.id!)
      send(res, 200, { session })
      return
    }

    const modeMatch = match(path, '/api/sessions/:id/mode')
    if (method === 'POST' && modeMatch) {
      const body = (await readJson(req)) as { mode?: string }
      const mode = body.mode as 'ask' | 'plan' | 'build' | 'review'
      if (!['ask', 'plan', 'build', 'review'].includes(mode)) {
        send(res, 400, { error: 'invalid mode' })
        return
      }
      try {
        const session = store.updateSessionMode(modeMatch.id!, mode)
        send(res, 200, { session })
      } catch (e) {
        send(res, 404, { error: e instanceof Error ? e.message : String(e) })
      }
      return
    }

    const delSession = match(path, '/api/sessions/:id')
    if (method === 'DELETE' && delSession) {
      store.deleteSession(delSession.id!)
      getAcpSessionManager().closeByRouterSession(delSession.id!)
      send(res, 200, { ok: true, snapshot: store.snapshot() })
      return
    }

    const delProject = match(path, '/api/projects/:id')
    if (method === 'DELETE' && delProject) {
      store.deleteProject(delProject.id!)
      getAcpSessionManager().closeByProject(delProject.id!)
      send(res, 200, { ok: true, snapshot: store.snapshot() })
      return
    }

    if (method === 'GET' && path === '/health') {
      send(res, 200, { ok: true, service: 'router-agents-api' })
      return
    }

    function providersPayload(status: ReturnType<typeof getSecretsStatus>) {
      const merged = mergeProvidersWithCustom(
        MASTRA_PROVIDERS,
        status.settings.customProviders,
      )
      const secretKeys = [
        ...SECRET_ENV_KEYS,
        ...merged.map((p) => p.apiKeyEnv),
      ]
      const configured = getSecretsStatus([...new Set(secretKeys)]).configuredKeys
      return merged.map((p) => {
        const isCustom = Boolean(status.settings.customProviders?.some((c) => c.id === p.id))
        const rawThinking = (p as { thinkingIntensities?: ThinkingIntensity[] }).thinkingIntensities
        return {
          id: p.id,
          name: p.name,
          apiKeyEnv: p.apiKeyEnv,
          docsUrl: p.docsUrl,
          models: p.models,
          baseURL: (p as { baseURL?: string }).baseURL,
          apiStyle: (p as { apiStyle?: string }).apiStyle,
          contextWindow: (p as { contextWindow?: number }).contextWindow,
          thinkingIntensities: resolveSupportedThinkingIntensities({
            custom: isCustom,
            thinkingIntensities: rawThinking,
          }),
          configured: configured.includes(p.apiKeyEnv),
          custom: isCustom,
        }
      })
    }

    // —— Settings / secrets ——
    if (method === 'GET' && path === '/api/settings') {
      const status = getSecretsStatus(SECRET_ENV_KEYS)
      send(res, 200, {
        ...status,
        leaderMaxSteps: status.settings.leaderMaxSteps,
        providers: providersPayload(status),
        customProviders: status.settings.customProviders ?? [],
        storagePath: process.env.HOME
          ? `${process.env.HOME}/.router-agents`
          : '~/.router-agents',
      })
      return
    }

    if (method === 'POST' && path === '/api/settings') {
      const body = (await readJson(req)) as {
        leaderModel?: string
        thinkingIntensity?: ThinkingIntensity
        leaderMaxSteps?: number
        secrets?: Record<string, string | null>
        customProviders?: CustomProviderSettings[]
      }
      if (body.leaderMaxSteps !== undefined && body.leaderMaxSteps !== null) {
        try {
          parseLeaderMaxStepsInput(body.leaderMaxSteps)
        } catch (e) {
          send(res, 400, {
            error: e instanceof Error ? e.message : `leaderMaxSteps must be an integer between 10 and 1000`,
          })
          return
        }
      }
      const prev = loadSettings()
      const nextSettings = saveSettings({
        leaderModel: body.leaderModel?.trim() || prev.leaderModel,
        thinkingIntensity:
          body.thinkingIntensity !== undefined
            ? normalizeThinkingIntensity(body.thinkingIntensity)
            : prev.thinkingIntensity,
        leaderMaxSteps: body.leaderMaxSteps ?? prev.leaderMaxSteps,
        customProviders:
          body.customProviders !== undefined
            ? body.customProviders.map((c) => ({
                ...c,
                thinkingIntensities:
                  c.thinkingIntensities !== undefined
                    ? normalizeThinkingIntensityList(c.thinkingIntensities)
                    : c.thinkingIntensities,
              }))
            : prev.customProviders,
      })
      process.env.LEADER_MODEL = nextSettings.leaderModel
      if (nextSettings.thinkingIntensity) {
        process.env.THINKING_INTENSITY = nextSettings.thinkingIntensity
      }

      if (body.secrets && typeof body.secrets === 'object') {
        const allowed = new Set([
          ...SECRET_ENV_KEYS,
          ...(nextSettings.customProviders ?? []).map((c) => c.apiKeyEnv),
        ])
        for (const [k, v] of Object.entries(body.secrets)) {
          if (!allowed.has(k) && k !== 'OPENAI_API_KEY') continue
          if (v === null || v === undefined || v === '') {
            deleteSecret(k)
            delete process.env[k]
          } else if (typeof v === 'string' && !v.includes('••••')) {
            setSecret(k, v)
            process.env[k] = v.trim()
          }
        }
      }
      applySecretsToEnv(process.env)
      const status = getSecretsStatus([
        ...SECRET_ENV_KEYS,
        ...(nextSettings.customProviders ?? []).map((c) => c.apiKeyEnv),
      ])
      globalActivityLog.append('system', 'Settings updated', {
        leaderModel: status.settings.leaderModel,
        keys: status.configuredKeys,
      })
      send(res, 200, {
        ok: true,
        ...status,
        leaderMaxSteps: status.settings.leaderMaxSteps,
        providers: providersPayload(status),
        customProviders: status.settings.customProviders ?? [],
      })
      return
    }

    if (method === 'DELETE' && path === '/api/settings/secrets') {
      const body = (await readJson(req)) as { key?: string }
      if (!body.key) {
        send(res, 400, { error: 'key required' })
        return
      }
      deleteSecret(body.key)
      delete process.env[body.key]
      send(res, 200, { ok: true, status: getSecretsStatus(SECRET_ENV_KEYS) })
      return
    }

    // —— Memory context status ——
    if (method === 'GET' && path === '/api/memory/status') {
      send(res, 200, {
        lastMessages: Number(process.env.MASTRA_LAST_MESSAGES ?? '40'),
        workingMemory: true,
        semanticRecall: false,
        observationalMemory:
          process.env.MASTRA_OM === '1' || process.env.MASTRA_OM === 'true',
        storage: process.env.MASTRA_MEMORY_URL ?? '~/.router-agents/mastra-memory.db',
        docs: 'https://mastra.ai/docs/memory/overview',
      })
      return
    }

    // —— Message history for UI (Mastra Memory recall → AI SDK UI messages) ——
    // @see https://mastra.ai/docs/memory/message-history
    if (method === 'GET' && path === '/api/memory/messages') {
      const threadId = url.searchParams.get('threadId')?.trim()
      const resourceId = url.searchParams.get('resourceId')?.trim()
      if (!threadId) {
        send(res, 400, { error: 'threadId required' })
        return
      }
      try {
        const memory = await leaderAgent.getMemory()
        if (!memory) {
          send(res, 200, { messages: [], threadId, resourceId: resourceId ?? null })
          return
        }
        const { messages: stored } = await memory.recall({
          threadId,
          ...(resourceId ? { resourceId } : {}),
          perPage: false,
        })
        const messages = toAISdkV5Messages(stored ?? [])
        send(res, 200, {
          messages,
          threadId,
          resourceId: resourceId ?? null,
          count: messages.length,
        })
      } catch (e) {
        send(res, 500, {
          error: e instanceof Error ? e.message : String(e),
          messages: [],
          threadId,
        })
      }
      return
    }

    // —— Goals (durable objectives on session thread) ——
    // @see https://mastra.ai/docs/long-running-agents/goals
    if (method === 'GET' && path === '/api/goals') {
      const threadId =
        url.searchParams.get('threadId') ||
        store.getActive().session?.memoryThreadId ||
        store.snapshot().sessions.find((s) => s.id === store.snapshot().activeSessionId)
          ?.memoryThreadId
      if (!threadId) {
        send(res, 200, { objective: null, threadId: null })
        return
      }
      try {
        const record = await leaderAgent.getObjective({ threadId })
        send(res, 200, { objective: record ?? null, threadId })
      } catch (e) {
        send(res, 200, {
          objective: null,
          threadId,
          error: e instanceof Error ? e.message : String(e),
        })
      }
      return
    }

    if (method === 'POST' && path === '/api/goals') {
      const body = (await readJson(req)) as {
        objective?: string
        threadId?: string
        resourceId?: string
        maxRuns?: number
      }
      const session = store.getActive().session
      const threadId = body.threadId || session?.memoryThreadId
      const resourceId = body.resourceId || session?.projectId || session?.id || 'default'
      if (!body.objective?.trim()) {
        send(res, 400, { error: 'objective required' })
        return
      }
      if (!threadId) {
        send(res, 400, { error: 'threadId required (open a session first)' })
        return
      }
      try {
        await leaderAgent.setObjective(body.objective.trim(), {
          threadId,
          resourceId,
          ...(body.maxRuns != null ? { maxRuns: body.maxRuns } : {}),
        })
        const record = await leaderAgent.getObjective({ threadId })
        globalActivityLog.append('system', `Goal set: ${body.objective.trim().slice(0, 80)}`, {
          threadId,
        })
        send(res, 200, { ok: true, objective: record ?? null, threadId })
      } catch (e) {
        send(res, 500, { error: e instanceof Error ? e.message : String(e) })
      }
      return
    }

    if (method === 'DELETE' && path === '/api/goals') {
      const body = (await readJson(req)) as { threadId?: string }
      const threadId = body.threadId || store.getActive().session?.memoryThreadId
      if (!threadId) {
        send(res, 400, { error: 'threadId required' })
        return
      }
      try {
        await leaderAgent.clearObjective({ threadId })
        send(res, 200, { ok: true, threadId })
      } catch (e) {
        send(res, 500, { error: e instanceof Error ? e.message : String(e) })
      }
      return
    }

    // —— AgentController status ——
    // @see https://mastra.ai/docs/agent-controller/overview
    if (method === 'GET' && path === '/api/controller') {
      try {
        // ensure controller can init (lazy)
        void getLeaderController().catch(() => null)
        send(res, 200, controllerStatusSnapshot())
      } catch (e) {
        send(res, 500, { error: e instanceof Error ? e.message : String(e) })
      }
      return
    }

    send(res, 404, { error: 'not found', path })
  } catch (e) {
    send(res, 500, { error: e instanceof Error ? e.message : String(e) })
  }
})

server.listen(port, '127.0.0.1', () => {
  scheduleAutoWorkerHealth()
  console.log(`router-agents API+chat listening on http://127.0.0.1:${port}`)
  console.log(`  REST  /api/*`)
  console.log(`  Chat  POST /chat/:agentId  (e.g. /chat/router-leader)`)
  globalActivityLog.append('system', `API server started on :${port}`)
})

let shuttingDown = false
const shutdown = async (signal: string) => {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[shutdown] ${signal} — closing ACP sessions...`)
  const forceExitTimer = setTimeout(() => { process.exit(1) }, 5000)
  forceExitTimer.unref?.()
  const serverClosed = new Promise<void>((resolve) => {
    // Stop accepting new requests before draining worker sessions.
    server.close(() => resolve())
  })
  try { await getAcpSessionManager().closeAll() } catch (e) { console.error('[shutdown] closeAll failed:', e) }
  await serverClosed
  clearTimeout(forceExitTimer)
  process.exit(0)
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
