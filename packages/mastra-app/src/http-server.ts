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
  getWorkerModelCatalogStore,
  getGitStatus,
  listProjectFiles,
  listLocalBranches,
  switchBranch,
  createBranchAndSwitch,
  commitAndSwitch,
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
  DEFAULT_LEADER_MODEL,
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
  isConfigurableSecretEnvKey,
  getLeaderModelCatalog,
  getLeaderFeaturedCatalog,
  resolveRouterDataPaths,
  type CustomProviderSettings,
  type ThinkingIntensity,
} from '@swarmdesk-agent/core'
import {
  parseHealthDepth,
  formatPublicError,
  type SessionEntryConfig,
} from '@swarmdesk-agent/adapters'
import {
  apiGetRegistryCatalog,
  apiCheckRegistryUpdate,
  apiStartPrepareRegistry,
  apiGetRegistryOperation,
  apiCancelRegistryOperation,
  apiRegisterRegistry,
  apiDeleteWorker,
  apiWorkerReadinessStatus,
  apiGetWorkerAuthMethods,
  apiProbeWorker,
  apiStartAuthenticateRegistry,
  apiSetWorkerSecret,
  apiListWorkerSecretStatus,
  apiClearWorkerSecrets,
  apiLogoutWorker,
  apiUpgradeRegistryWorker,
  apiAdoptRegistryManagement,
  apiListCleanupCandidates,
  apiMarkInstallationRemoved,
  registryApiPublicError,
  registryCatalogApiPublicError,
} from './acp-registry-api.js'
import {
  createTerminalAuthAttempt,
  drainTerminalAuthAttemptsForShutdown,
  TerminalAuthError,
  isTerminalAuthFeatureEnabled,
  isPtyFeatureReady,
  terminalAuthAttemptPublicStatus,
} from './acp-auth-terminal.js'
import { getWorkerModels, evaluateWorkerModelPin, applyWorkerModelPin } from './worker-models.js'
import { assertRoleModelAccepted } from './role-definitions.js'
import type {
  ApprovalDecision,
  LeaderMode,
  Locale,
  WorkerRole,
  WorkerDefaultRole,
  CreateRoleDefinitionInput,
  UpdateRoleDefinitionInput,
  CustomAcpRegistrationInput,
} from '@swarmdesk-agent/shared'
import { handleChatStream } from '@mastra/ai-sdk'
import { toAISdkMessages } from '@mastra/ai-sdk/ui'
import { pipeUIMessageStreamToResponse } from 'ai'
import { RequestContext } from '@mastra/core/request-context'
import { leaderAgent } from './agents/leader-agent.js'
import { leaderMemory } from './agents/leader-agent.js'
import { controllerStatusSnapshot, getLeaderController } from './agents/controller.js'
import { checkOneWorker, checkWorkersBatch, scheduleAutoWorkerHealth } from './workers-health.js'
import { getWorkerScheduler } from './scheduler.js'
import {
  detectLeaderStepBudgetExhaustion,
  createBudgetMarkerMessage,
} from './leader-step-budget.js'
import { generateSessionTitle, extractFirstUserText } from './session-title-generator.js'
import { isPlaceholderSessionTitle } from '@swarmdesk-agent/core'
import type { LeaderStepBudgetEvent } from '@swarmdesk-agent/shared'
import { initializeAcpRuntime } from './acp-runtime.js'
import { asAcpHttpFailure } from './acp-http-error.js'
import {
  deleteRouterProjectResource,
  deleteRouterSessionResource,
  reconcileWorkerRuntimeResources,
} from './acp-resource-lifecycle.js'
import {
  writeRuntimeDiscovery,
  clearRuntimeDiscovery,
  defaultRuntimeDiscoveryPath,
} from './runtime-discovery.js'
import {
  getRuntimeDispatchPort,
  validateRuntimeApprovalResolveInput,
} from './runtime-dispatch-port.js'
import { getWorkerEventEmitter } from './worker-events.js'
import { createMastra } from './mastra/create-mastra.js'
import {
  authorizeDesktopRequest,
  desktopCorsHeaders,
  extractBearerToken,
  tokenMatches,
} from './desktop-auth.js'
import { isTerminalWorkerEvent, type WorkerRunEvent } from '@swarmdesk-agent/shared'
import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash, randomBytes } from 'node:crypto'
import { HttpJsonBodyError, readJsonBody as readJson } from './http-json-body.js'
import { resolveHttpPort, resolveMemoryLastMessages } from './runtime-config.js'
import { CustomAcpRegistrationError, registerCustomAcpWorker } from './custom-acp-registration.js'

const port = resolveHttpPort()
const runtimeWorkspaceRoot = pathResolve(
  process.env.SWARMDESK_AGENT_WORKSPACE_ROOT?.trim() ||
    (basename(process.cwd()) === 'mastra-app'
      ? pathResolve(process.cwd(), '../..')
      : process.cwd()),
)
const runtimeWorkspaceId = createHash('sha256').update(runtimeWorkspaceRoot).digest('hex')
const studioApiToken =
  process.env.SWARMDESK_AGENT_STUDIO_TOKEN?.trim() || randomBytes(32).toString('hex')
/** Request-scoped so every send()/CORS path echoes the correct Origin. */
const requestAls = new AsyncLocalStorage<IncomingMessage>()

// Owner runtime MUST be initialized before Store/Scheduler/createMastra.
// Do not import ./mastra/index.js here — that entry is Studio client-only.
let acpRuntime: ReturnType<typeof initializeAcpRuntime>
try {
  acpRuntime = initializeAcpRuntime({ role: 'owner' })
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
}
if (acpRuntime.mode !== 'owner' || !acpRuntime.manager) {
  console.error(
    'ACP runtime owner lease not acquired (RUNTIME_OWNER_EXISTS). ' +
      'Another process owns the catalog; refuse to start main HTTP server.',
  )
  process.exit(1)
}

// Only after lease: create writable Store and rest of composition
const store = getSharedStore({ mode: 'owner' })
// Re-derive persisted lamp statuses (running/needs_approval) from durable
// jobs + approvals — a crashed run must not light the sidebar forever.
store.reconcileSessionStatuses()
// Owner serves REST via this http-server; Mastra only needs chat/agent surface.
const mastra = createMastra({
  includeAdminApi: false,
  port,
  studioToken: studioApiToken,
})
const sessionMgr = acpRuntime.manager

/** Internal remote-runtime token — never expose to browser/renderer. */
let internalRuntimeToken: string | null = null
/** Desktop Electron API token — only via preload IPC from runtime.json desktopToken. */
let desktopApiToken: string | null = null
const runtimeDiscoveryPath =
  process.env.SWARMDESK_AGENT_RUNTIME_PATH ?? defaultRuntimeDiscoveryPath()
const runtimeStartedAt = new Date().toISOString()

function currentReq(): IncomingMessage | undefined {
  return requestAls.getStore()
}

function corsFor(req?: IncomingMessage): Record<string, string> {
  const r = req ?? currentReq()
  if (r) return desktopCorsHeaders(r)
  return {
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS,PUT,PATCH',
    'Access-Control-Allow-Headers':
      'Content-Type, Authorization, X-SwarmDesk-Agent-Desktop-Token, Last-Event-ID',
    Vary: 'Origin',
  }
}

function authorizeInternalRuntime(req: IncomingMessage): boolean {
  if (!internalRuntimeToken) return false
  const provided = extractBearerToken(req)
  if (!provided) return false
  return tokenMatches(provided, internalRuntimeToken)
}

function sendAuthFailed(res: ServerResponse): void {
  send(res, 401, { error: 'RUNTIME_AUTH_FAILED', code: 'RUNTIME_AUTH_FAILED' })
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    ...corsFor(),
  })
  res.end(json)
}

function sendUnexpectedFailure(res: ServerResponse, error: unknown, context: string): void {
  console.error(`[http] ${context} failed`, error)
  send(res, 500, { error: 'Internal server error', code: 'INTERNAL_ERROR' })
}

function sendAcpOrUnexpectedFailure(res: ServerResponse, error: unknown, context: string): void {
  const failure = asAcpHttpFailure(error)
  if (failure) {
    send(res, failure.status, failure.body)
    return
  }
  sendUnexpectedFailure(res, error, context)
}

function match(path: string, pattern: string): Record<string, string> | null {
  const pp = pattern.split('/').filter(Boolean)
  const sp = path.split('/').filter(Boolean)
  if (pp.length !== sp.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < pp.length; i++) {
    const a = pp[i]!
    const b = sp[i]!
    if (a.startsWith(':')) {
      try {
        params[a.slice(1)] = decodeURIComponent(b)
      } catch {
        // A malformed percent escape is not a server failure and must not
        // escape route matching as a 500 response.
        return null
      }
    } else if (a !== b) return null
  }
  return params
}

const server = createServer(async (req, res) => {
  await requestAls.run(req, async () => {
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, corsFor())
        res.end()
        return
      }

      const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
      const path = url.pathname
      const method = req.method ?? 'GET'

      // —— Internal runtime APIs (loopback + internal token only) ——
      if (path.startsWith('/internal/runtime/')) {
        if (!authorizeInternalRuntime(req)) {
          sendAuthFailed(res)
          return
        }
        const dispatchPort = getRuntimeDispatchPort()

        if (method === 'GET' && path === '/internal/runtime/session-by-thread') {
          const memoryThreadId = url.searchParams.get('memoryThreadId') ?? ''
          const context = await dispatchPort.resolveSessionContext(memoryThreadId)
          send(res, 200, { context })
          return
        }

        if (method === 'POST' && path === '/internal/runtime/dispatch') {
          const body = (await readJson(req)) as {
            context?: {
              routerSessionId?: string
              routerProjectId?: string
              routerProjectRoot?: string
              memoryThreadId?: string
            }
            workerId?: string
            workerIdOrKind?: string
            roleDefinitionId?: string
            role?: WorkerRole
            task?: string
            cwd?: string
            source?: 'leader' | 'api' | 'ui'
          }
          if (!body.task?.trim() || !body.context?.memoryThreadId) {
            send(res, 400, { error: 'task and memoryThreadId required' })
            return
          }
          // Owner re-resolves trusted tuple — never trust client-supplied session/project alone
          const resolved = await dispatchPort.resolveSessionContext(body.context.memoryThreadId)
          if (!resolved) {
            send(res, 403, {
              error: 'SWARMDESK_AGENT_SESSION_BINDING_REQUIRED',
              code: 'SWARMDESK_AGENT_SESSION_BINDING_REQUIRED',
            })
            return
          }
          if (
            body.context.routerSessionId &&
            body.context.routerSessionId !== resolved.routerSessionId
          ) {
            send(res, 403, {
              error: 'context session mismatch',
              code: 'SWARMDESK_AGENT_SESSION_MISMATCH',
            })
            return
          }
          if (
            body.context.routerProjectId &&
            body.context.routerProjectId !== resolved.routerProjectId
          ) {
            send(res, 403, {
              error: 'context project mismatch',
              code: 'SWARMDESK_AGENT_SESSION_MISMATCH',
            })
            return
          }
          const { authorizeDispatchCwd } = await import('./dispatch-context.js')
          const cwdAuth = authorizeDispatchCwd(resolved.routerProjectRoot, body.cwd)
          if (!cwdAuth.ok) {
            send(res, 403, { error: cwdAuth.error, code: cwdAuth.code })
            return
          }
          const job = await dispatchPort.dispatch({
            context: resolved,
            workerId: body.workerId,
            workerIdOrKind: body.workerIdOrKind,
            roleDefinitionId: body.roleDefinitionId,
            role: body.role,
            task: body.task,
            cwd: cwdAuth.cwd,
            source: body.source ?? 'api',
            wait: false,
          })
          send(res, 200, { job })
          return
        }

        if (method === 'GET' && path === '/internal/runtime/role-definitions') {
          const memoryThreadId = url.searchParams.get('memoryThreadId') ?? ''
          const context = await dispatchPort.resolveSessionContext(memoryThreadId)
          if (!context) {
            send(res, 403, { error: 'SWARMDESK_AGENT_SESSION_BINDING_REQUIRED' })
            return
          }
          const roleDefinitions = dispatchPort.listRoleDefinitions
            ? await dispatchPort.listRoleDefinitions(context)
            : []
          send(res, 200, { roleDefinitions })
          return
        }

        if (method === 'POST' && path === '/internal/runtime/role-definitions') {
          const body = (await readJson(req)) as {
            context?: { memoryThreadId?: string }
            input?: Omit<CreateRoleDefinitionInput, 'chatSessionId'>
          }
          const context = await dispatchPort.resolveSessionContext(
            body.context?.memoryThreadId ?? '',
          )
          if (!context || !body.input || !dispatchPort.createRoleDefinition) {
            send(res, 403, { error: 'SWARMDESK_AGENT_SESSION_BINDING_REQUIRED' })
            return
          }
          const roleDefinition = await dispatchPort.createRoleDefinition({
            context,
            input: body.input,
          })
          send(res, 201, { roleDefinition })
          return
        }

        const internalRoleMatch = match(
          path,
          '/internal/runtime/role-definitions/:roleDefinitionId',
        )
        if ((method === 'PATCH' || method === 'DELETE') && internalRoleMatch) {
          const body = (await readJson(req)) as {
            context?: { memoryThreadId?: string }
            patch?: UpdateRoleDefinitionInput
            expectedRevision?: number
          }
          const context = await dispatchPort.resolveSessionContext(
            body.context?.memoryThreadId ?? '',
          )
          if (!context) {
            send(res, 403, { error: 'SWARMDESK_AGENT_SESSION_BINDING_REQUIRED' })
            return
          }
          if (method === 'PATCH' && dispatchPort.updateRoleDefinition && body.patch) {
            const roleDefinition = await dispatchPort.updateRoleDefinition({
              context,
              roleDefinitionId: internalRoleMatch.roleDefinitionId!,
              patch: body.patch,
            })
            send(res, 200, { roleDefinition })
            return
          }
          if (method === 'DELETE' && dispatchPort.archiveRoleDefinition) {
            const roleDefinition = await dispatchPort.archiveRoleDefinition({
              context,
              roleDefinitionId: internalRoleMatch.roleDefinitionId!,
              expectedRevision: body.expectedRevision,
            })
            send(res, 200, { roleDefinition })
            return
          }
          send(res, 400, { error: 'invalid role-definition mutation' })
          return
        }

        const internalRoleResetMatch = match(
          path,
          '/internal/runtime/role-definitions/:roleDefinitionId/reset-session',
        )
        if (method === 'POST' && internalRoleResetMatch) {
          const body = (await readJson(req)) as { context?: { memoryThreadId?: string } }
          const context = await dispatchPort.resolveSessionContext(
            body.context?.memoryThreadId ?? '',
          )
          if (!context || !dispatchPort.resetRoleSession) {
            send(res, 403, { error: 'SWARMDESK_AGENT_SESSION_BINDING_REQUIRED' })
            return
          }
          send(
            res,
            200,
            await dispatchPort.resetRoleSession({
              context,
              roleDefinitionId: internalRoleResetMatch.roleDefinitionId!,
            }),
          )
          return
        }

        if (method === 'POST' && path === '/internal/runtime/cancel') {
          const body = (await readJson(req)) as { jobId?: string }
          if (!body.jobId?.trim()) {
            send(res, 400, { error: 'jobId required' })
            return
          }
          await dispatchPort.cancel(body.jobId)
          send(res, 200, { ok: true })
          return
        }

        if (method === 'POST' && path === '/internal/runtime/approvals/resolve') {
          const body = (await readJson(req)) as {
            approvalId?: string
            optionId?: string
            decision?: 'allow' | 'deny' | 'cancel'
            surface?: 'chat' | 'panel'
          }
          const validated = validateRuntimeApprovalResolveInput(body)
          if (!validated.ok) {
            send(res, 400, { error: validated.error })
            return
          }
          await dispatchPort.resolveApproval(validated.value)
          send(res, 200, { ok: true })
          return
        }

        const eventsMatch = match(path, '/internal/runtime/events/:jobId')
        if (method === 'GET' && eventsMatch) {
          const jobId = eventsMatch.jobId!
          // Prefer Last-Event-ID (SSE style) then query afterSequence
          const lastEventId = req.headers['last-event-id']
          const lastEventIdStr = Array.isArray(lastEventId) ? lastEventId[0] : lastEventId
          const afterSequenceRaw =
            lastEventIdStr?.trim() || url.searchParams.get('afterSequence') || ''
          const afterSequence = afterSequenceRaw !== '' ? Number(afterSequenceRaw) : 0
          const durableJob = getWorkerScheduler().getJob(jobId)
          const emitter = getWorkerEventEmitter()
          if (!durableJob && !emitter.isTerminal(jobId) && emitter.getJournal(jobId).length === 0) {
            send(res, 404, { error: 'job not found', code: 'JOB_NOT_FOUND' })
            return
          }
          res.writeHead(200, {
            'Content-Type': 'application/x-ndjson',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            ...corsFor(),
          })
          let closed = false
          let unsub: () => void = () => {}
          let poll: ReturnType<typeof setInterval> | undefined
          const finish = (destroy = false) => {
            if (closed) return
            closed = true
            unsub()
            if (poll) {
              clearInterval(poll)
              poll = undefined
            }
            try {
              if (destroy) res.destroy()
              else res.end()
            } catch {
              /* ok */
            }
          }
          // Protocol: { emitSequence, event, gap?, ownerEpoch } for reconnect + journal truncation
          const ownerEpoch = `${process.pid}:${runtimeStartedAt}`
          const writeEnvelope = (
            event: WorkerRunEvent | null,
            emitSequence: number,
            extra?: { gap?: boolean; retainedFrom?: number; retainedTo?: number },
          ) => {
            if (closed) return
            const body: Record<string, unknown> = { emitSequence, ownerEpoch }
            if (event) body.event = event
            if (extra?.gap) {
              body.gap = true
              if (extra.retainedFrom != null) body.retainedFrom = extra.retainedFrom
              if (extra.retainedTo != null) body.retainedTo = extra.retainedTo
            }
            try {
              // Event callbacks are synchronous, so we cannot await socket drain.
              // Close on backpressure; the remote observer reconnects from its cursor
              // and the bounded journal/durable Job provides lossless recovery.
              if (!res.write(`${JSON.stringify(body)}\n`)) {
                finish(true)
                return
              }
            } catch {
              finish(true)
              return
            }
            if (event && isTerminalWorkerEvent(event)) finish()
          }
          let wroteAny = false
          const cursor = Number.isFinite(afterSequence) ? Math.max(0, Math.floor(afterSequence)) : 0
          // Immediate owner handshake lets clients detect a process epoch change
          // before accepting journal events from a replacement owner.
          writeEnvelope(null, cursor)
          if (closed) return
          const gapInfo = emitter.detectGap?.(jobId, cursor)
          if (gapInfo) {
            wroteAny = true
            writeEnvelope(null, gapInfo.afterSequence, {
              gap: true,
              retainedFrom: gapInfo.retainedFrom,
              retainedTo: gapInfo.retainedTo,
            })
          }
          if (closed) return
          unsub = emitter.subscribe(
            jobId,
            (event, meta) => {
              wroteAny = true
              writeEnvelope(event, meta?.emitSequence ?? 0)
            },
            { afterSequence: cursor },
          )
          if (closed) {
            unsub()
            return
          }
          const isTerminalStatus = (s: string) =>
            s === 'succeeded' || s === 'failed' || s === 'cancelled' || s === 'timed_out'
          /** Always re-read Job — never use request-start snapshot for terminalization. */
          const synthesizeTerminalFromJob = (): boolean => {
            const job = getWorkerScheduler().getJob(jobId)
            if (!job || !isTerminalStatus(job.status)) return false
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
            const journal = emitter.getJournal(jobId, 0)
            const maxSeq = journal.length ? journal[journal.length - 1]!.seq : cursor
            writeEnvelope(synthetic, maxSeq)
            return true
          }

          // Only close immediately when job is already durable-terminal (or emitter tombstone)
          // with nothing left to stream. Open jobs must keep the connection even if journal is empty.
          if (!closed && !wroteAny) {
            if (emitter.isTerminal(jobId)) {
              if (!synthesizeTerminalFromJob()) finish()
            } else {
              const jobNow = getWorkerScheduler().getJob(jobId)
              if (jobNow && isTerminalStatus(jobNow.status)) {
                synthesizeTerminalFromJob()
              }
              // queued/running/pending_approval: stay open and wait for live events
            }
          }
          // Periodic re-check: journal expired mid-flight while job already terminalized on disk.
          // finish() owns cleanup even when journal replay terminals before this assignment.
          poll = setInterval(() => {
            if (closed) return
            const jobNow = getWorkerScheduler().getJob(jobId)
            if (!jobNow) return
            if (isTerminalStatus(jobNow.status) && !emitter.isTerminal(jobId)) {
              // Prefer waiting for emitter terminal if subscribers still attached; only synthesize
              // when journal has nothing more for this cursor.
              if (emitter.getJournal(jobId, cursor).length === 0) {
                synthesizeTerminalFromJob()
              }
            }
          }, 1000)
          poll.unref?.()
          // If journal already finished synchronously before poll was created, clear it now
          if (closed) {
            clearInterval(poll)
            poll = undefined
          }
          req.on('close', () => {
            finish()
          })
          return
        }

        const getJobMatch = match(path, '/internal/runtime/jobs/:jobId')
        if (method === 'GET' && getJobMatch) {
          const job = getWorkerScheduler().getJob(getJobMatch.jobId!)
          send(res, 200, { job: job ?? null })
          return
        }

        if (method === 'GET' && path === '/internal/runtime/jobs') {
          const sessionId = url.searchParams.get('sessionId') ?? undefined
          const limit = Number(url.searchParams.get('limit') ?? 50)
          const jobs = getWorkerScheduler().listJobs({
            sessionId,
            limit: Number.isFinite(limit) ? limit : 50,
          })
          send(res, 200, { jobs })
          return
        }

        send(res, 404, { error: 'not found', path })
        return
      }

      // No browser bootstrap of tokens — Electron reads desktopToken from runtime.json via IPC only.

      // —— Public Desktop /api and /chat: Origin allowlist + desktop token ——
      if (path.startsWith('/api/') || path.startsWith('/chat/') || path === '/health') {
        const desk = authorizeDesktopRequest(req, desktopApiToken, { path })
        if (!desk.ok) {
          send(res, desk.status, { error: desk.error, code: desk.code })
          return
        }
      }

      // Leader chat (AI SDK useChat) — same origin as REST for desktop default base URL
      const chatMatch = match(path, '/chat/:agentId')
      if (method === 'POST' && chatMatch) {
        const agentId = chatMatch.agentId!
        const params = (await readJson(req)) as Record<string, unknown>
        try {
          // Goals + Memory processors require an active resourceId + threadId on every run.
          // Prefer client-provided memory (session-scoped); fall back to active project/session.
          const active = store.getActive()
          const clientMemory = (params.memory ?? null) as {
            thread?: string | { id?: string }
            resource?: string
          } | null
          const threadFromClient =
            typeof clientMemory?.thread === 'string'
              ? clientMemory.thread
              : clientMemory?.thread && typeof clientMemory.thread === 'object'
                ? clientMemory.thread.id
                : undefined
          const resourceFromClient =
            typeof clientMemory?.resource === 'string' ? clientMemory.resource : undefined

          // Resolve session from memoryThreadId first — never trust client resourceId alone.
          const threadId =
            threadFromClient ||
            active.session?.memoryThreadId ||
            active.session?.id ||
            'router-default-thread'
          const sessionByThread =
            store.listSessions().find((s) => s.memoryThreadId === threadId || s.id === threadId) ??
            (active.session?.memoryThreadId === threadId || active.session?.id === threadId
              ? active.session
              : undefined)
          const boundProjectId =
            sessionByThread?.projectId ||
            active.project?.id ||
            active.session?.projectId ||
            'router-default-resource'
          if (resourceFromClient && resourceFromClient !== boundProjectId) {
            send(res, 403, {
              error: 'resourceId does not match session project',
              code: 'SWARMDESK_AGENT_RESOURCE_MISMATCH',
            })
            return
          }
          const resourceId = boundProjectId

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
            clientModel || settings.leaderModel || process.env.LEADER_MODEL || DEFAULT_LEADER_MODEL
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
          const providerOptions = thinkingIntensityToProviderOptions(thinkingIntensity) as never

          const requestContext = new RequestContext()
          requestContext.set('leaderModel', leaderModel)
          requestContext.set('thinkingIntensity', thinkingIntensity)

          const routerSession =
            store.listSessions().find((s) => s.memoryThreadId === threadId) ?? null
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
            version: 'v6',
            params: {
              ...paramsWithMemory,
              untilIdle: true,
              onFinish: async (onFinishEvent: {
                steps?: readonly unknown[]
                finishReason?: string
                runId?: string
              }) => {
                if (!onFinishEvent.finishReason) return

                // Stamp the reply time so the sidebar can show "last reply X ago"
                // instead of the noisy session.updatedAt (which mode/rename/activate
                // also bump). No-op if the session was deleted mid-stream.
                if (routerSession) {
                  store.markSessionReply(routerSession.id)
                }

                // —— Delayed session naming ——
                // After the first task completion, ask the leader model for a
                // short title and persist it via store.autoTitleSession (which is
                // a no-op for user-renamed sessions). Only fires while the title
                // is still the placeholder, so second-turn runs are skipped.
                // Failures are swallowed: naming must never break the chat flow.
                if (routerSession && isPlaceholderSessionTitle(routerSession.title)) {
                  try {
                    const firstUserText = extractFirstUserText(
                      (params as { messages?: unknown[] }).messages,
                    )
                    if (firstUserText) {
                      const generated = await generateSessionTitle({
                        firstUserText,
                        requestContext,
                      })
                      if (generated) {
                        store.autoTitleSession(routerSession.id, generated)
                      }
                    }
                  } catch (err) {
                    console.error(
                      '[session-title] onFinish hook failed',
                      err instanceof Error ? err.message : err,
                    )
                  }
                }

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
            messageMetadata: () =>
              streamBudgetEvent ? { leaderStepBudget: streamBudgetEvent.data } : undefined,
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
          for (const [k, v] of Object.entries(corsFor())) {
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

          const missingKey =
            /Could not find API key|Missing API key|process\.env\.\w*API_KEY/i.test(msg)
          // Prefer provider-facing first line (billing, quota, model) so the UI can map it;
          // never ship stacks.
          const shortMsg = msg
            .replace(/\n[\s\S]*/, '')
            .trim()
            .slice(0, 280)
          send(res, missingKey ? 400 : 500, {
            code: missingKey ? 'MISSING_API_KEY' : 'CHAT_ERROR',
            error: shortMsg || 'Chat failed. See API terminal for details.',
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

      if (method === 'GET' && path === '/api/models/catalog') {
        // GET is read-only — never write disk. Use POST /api/models/catalog/refresh for admin sync.
        const featured =
          url.searchParams.get('featured') === '1' || url.searchParams.get('featured') === 'true'
        if (featured) {
          const current =
            url.searchParams.get('current') ??
            url.searchParams.get('model') ??
            loadSettings().leaderModel
          const result = getLeaderFeaturedCatalog(current)
          send(res, 200, {
            catalogMode: 'featured',
            featured: result.featured,
            currentSelection: result.currentSelection,
          })
          return
        }
        const catalog = getLeaderModelCatalog(false)
        send(res, 200, { providers: catalog })
        return
      }

      if (method === 'POST' && path === '/api/models/catalog/refresh') {
        // Admin refresh — may write models-cache + registry snapshot (desktop-auth required)
        const { syncLeaderModelCatalog } = await import('@swarmdesk-agent/core')
        const result = syncLeaderModelCatalog()
        send(res, 200, {
          ok: true,
          synced: result.synced,
          source: result.source,
          providers: result.catalog,
        })
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
          options: Array<{
            optionId: string
            name: string
            kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always'
          }>
          source?: 'acp' | 'tool' | 'manual'
        }
        if (!body.title) {
          send(res, 400, { error: 'title required' })
          return
        }
        try {
          const item = store.enqueueApproval({
            ...body,
            sessionId: body.sessionId ?? store.getActive().session?.id ?? null,
            source: body.source ?? 'manual',
          })
          send(res, 200, { approval: item, snapshot: store.snapshot() })
        } catch (error) {
          send(res, 400, { error: error instanceof Error ? error.message : 'Invalid approval' })
        }
        return
      }

      const resolveMatch = match(path, '/api/approvals/:id/resolve')
      if (method === 'POST' && resolveMatch) {
        const body = (await readJson(req)) as {
          decision: ApprovalDecision
          optionId?: string
          surface?: 'chat' | 'panel'
        }
        if (!body.decision || !['allow', 'deny', 'cancel'].includes(body.decision)) {
          send(res, 400, { error: 'decision must be allow|deny|cancel' })
          return
        }
        if (body.surface !== 'chat' && body.surface !== 'panel') {
          send(res, 400, { error: 'surface must be chat|panel' })
          return
        }
        try {
          const scheduler = getWorkerScheduler()
          const approval = scheduler.resolveApproval(resolveMatch.id!, body.decision, {
            optionId: body.optionId,
            surface: body.surface,
          })
          send(res, 200, { approval, snapshot: store.snapshot() })
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          const status = /already/i.test(msg) ? 409 : 400
          send(res, status, { error: msg })
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
          roleDefinitionId?: string
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

      const jobReset = match(path, '/api/jobs/:id/acp-context/reset')
      if (method === 'POST' && jobReset) {
        try {
          const body = (await readJson(req).catch(() => ({}))) as Record<string, unknown>
          if (typeof body.agentSessionId === 'string') {
            send(res, 400, { error: 'agentSessionId must not be provided in body' })
            return
          }

          const job = store.getJob(jobReset.id!)
          if (!job) {
            send(res, 404, { error: 'Job not found' })
            return
          }

          const activeSessionId = store.getActive().session?.id
          if (!activeSessionId || job.sessionId !== activeSessionId) {
            send(res, 400, { error: 'Job does not belong to active session' })
            return
          }

          const manager = sessionMgr
          // Prefer opaque digest captured at job start — never re-derive from drifted config
          let deleted = false
          if (job.reuseKeyDigest) {
            const r = manager.deleteContextByDigest(job.reuseKeyDigest)
            deleted = r.deleted
          } else {
            // Legacy jobs without digest: best-effort rebuild (may miss after config drift)
            const worker = store.listWorkers().find((w) => w.id === job.workerId)
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
          store.updateJob(job.id, {
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
            deleted,
          })

          send(res, 200, {
            ok: true,
            jobId: job.id,
            deleted,
            message: deleted
              ? 'ACP context reset. Retry the dispatch to create a fresh session.'
              : 'No live/catalog context found for this job digest (already clean).',
            snapshot: store.snapshot(),
          })
        } catch (e) {
          sendAcpOrUnexpectedFailure(res, e, 'ACP context reset')
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

      // —— Git branches (list / switch / create / commit-and-switch) ——
      const branchesListMatch = match(path, '/api/projects/:id/branches')
      if (method === 'GET' && branchesListMatch) {
        const project = store.listProjects().find((p) => p.id === branchesListMatch.id)
        if (!project) {
          send(res, 404, { error: 'project not found' })
          return
        }
        const result = await listLocalBranches(project.rootPath)
        send(res, 200, result)
        return
      }

      const branchesSwitchMatch = match(path, '/api/projects/:id/branches/switch')
      if (method === 'POST' && branchesSwitchMatch) {
        const project = store.listProjects().find((p) => p.id === branchesSwitchMatch.id)
        if (!project) {
          send(res, 404, { error: 'project not found' })
          return
        }
        const body = (await readJson(req)) as { targetBranchName?: string }
        const target = String(body?.targetBranchName ?? '').trim()
        if (!target) {
          send(res, 400, { error: 'targetBranchName required' })
          return
        }
        const result = await switchBranch(project.rootPath, target)
        send(res, 200, result)
        return
      }

      const branchesCreateMatch = match(path, '/api/projects/:id/branches/create')
      if (method === 'POST' && branchesCreateMatch) {
        const project = store.listProjects().find((p) => p.id === branchesCreateMatch.id)
        if (!project) {
          send(res, 404, { error: 'project not found' })
          return
        }
        const body = (await readJson(req)) as { branchName?: string; startPoint?: string }
        const name = String(body?.branchName ?? '').trim()
        if (!name) {
          send(res, 400, { error: 'branchName required' })
          return
        }
        const startPoint = body?.startPoint ? String(body.startPoint).trim() : undefined
        const result = await createBranchAndSwitch(project.rootPath, name, startPoint)
        send(res, 200, result)
        return
      }

      const branchesCommitMatch = match(path, '/api/projects/:id/branches/commit-and-switch')
      if (method === 'POST' && branchesCommitMatch) {
        const project = store.listProjects().find((p) => p.id === branchesCommitMatch.id)
        if (!project) {
          send(res, 404, { error: 'project not found' })
          return
        }
        const body = (await readJson(req)) as { targetBranchName?: string; message?: string }
        const target = String(body?.targetBranchName ?? '').trim()
        const message = String(body?.message ?? '').trim()
        if (!target) {
          send(res, 400, { error: 'targetBranchName required' })
          return
        }
        if (!message) {
          send(res, 400, { error: 'message required' })
          return
        }
        const result = await commitAndSwitch(project.rootPath, target, message)
        send(res, 200, result)
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
          process.env.SWARMDESK_AGENT_AGENTS_ROOT ??
          (process.cwd().endsWith('mastra-app')
            ? pathResolve(process.cwd(), '../..')
            : process.cwd())
        const project = store.upsertProject({
          name: 'swarmdesk-agent',
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

      if (method === 'GET' && path === '/api/workers/registry') {
        try {
          send(res, 200, await apiGetRegistryCatalog())
        } catch (error) {
          const p = registryCatalogApiPublicError(error)
          send(res, p.status, { error: p.error, code: p.code })
        }
        return
      }

      // Registry manual update: the only runtime path allowed to contact the official catalog.
      if (method === 'POST' && path === '/api/workers/registry/check-update') {
        try {
          send(res, 200, await apiCheckRegistryUpdate())
        } catch (error) {
          const p = registryCatalogApiPublicError(error)
          send(res, p.status, { error: p.error, code: p.code })
        }
        return
      }

      // Registry prepare: Owner downloads/materializes; no client command
      if (method === 'POST' && path === '/api/workers/registry/prepare') {
        try {
          const body = (await readJson(req)) as {
            registryId?: string
            version?: string
            distribution?: string
            manifestDigest?: string
            trust?: { explicitNoSha?: boolean; acceptedAt?: string }
          }
          if (!body.registryId || !body.distribution || !body.manifestDigest) {
            send(res, 400, {
              error: 'registryId, distribution, manifestDigest required',
              code: 'ACP_REGISTRY_ENTRY_INVALID',
            })
            return
          }
          if (!['npx', 'uvx', 'binary'].includes(body.distribution)) {
            send(res, 400, {
              error: 'distribution must be npx|uvx|binary',
              code: 'ACP_REGISTRY_ENTRY_INVALID',
            })
            return
          }
          send(
            res,
            202,
            apiStartPrepareRegistry({
              registryId: body.registryId,
              version: body.version,
              distribution: body.distribution as 'npx' | 'uvx' | 'binary',
              manifestDigest: body.manifestDigest,
              trust: body.trust,
            }),
          )
        } catch (error) {
          const p = registryApiPublicError(error)
          send(res, p.status, { error: p.error, code: p.code })
        }
        return
      }

      const registryOperationMatch = match(path, '/api/workers/registry/operations/:operationId')
      if (method === 'GET' && registryOperationMatch) {
        try {
          send(res, 200, apiGetRegistryOperation(registryOperationMatch.operationId!))
        } catch (error) {
          const p = registryApiPublicError(error)
          send(res, p.status, { error: p.error, code: p.code })
        }
        return
      }
      if (method === 'DELETE' && registryOperationMatch) {
        try {
          send(res, 200, apiCancelRegistryOperation(registryOperationMatch.operationId!))
        } catch (error) {
          const p = registryApiPublicError(error)
          send(res, p.status, { error: p.error, code: p.code })
        }
        return
      }

      // Registry register: materialize Worker from installation + catalog only
      if (method === 'POST' && path === '/api/workers/registry/register') {
        try {
          const body = (await readJson(req)) as {
            registryId?: string
            version?: string
            distribution?: string
            manifestDigest?: string
            installationId?: string
            name?: string
            primaryRole?: string
            roles?: string[]
            enabled?: boolean
            command?: unknown
            args?: unknown
            env?: unknown
          }
          if (
            !body.registryId ||
            !body.version ||
            !body.distribution ||
            !body.manifestDigest ||
            !body.installationId
          ) {
            send(res, 400, {
              error: 'registryId, version, distribution, manifestDigest, installationId required',
              code: 'ACP_REGISTRY_ENTRY_INVALID',
            })
            return
          }
          send(
            res,
            200,
            await apiRegisterRegistry({
              registryId: body.registryId,
              version: body.version,
              distribution: body.distribution as 'npx' | 'uvx' | 'binary',
              manifestDigest: body.manifestDigest,
              installationId: body.installationId,
              name: body.name,
              primaryRole: body.primaryRole as
                import('@swarmdesk-agent/shared').WorkerRole | undefined,
              roles: body.roles as import('@swarmdesk-agent/shared').WorkerRole[] | undefined,
              enabled: body.enabled,
              command: body.command,
              args: body.args,
              env: body.env,
            }),
          )
        } catch (error) {
          const p = registryApiPublicError(error)
          send(res, p.status, { error: p.error, code: p.code })
        }
        return
      }

      if (method === 'GET' && path === '/api/workers/registry/cleanup-candidates') {
        send(res, 200, apiListCleanupCandidates())
        return
      }

      const readinessMatch = match(path, '/api/workers/:id/readiness')
      if (method === 'GET' && readinessMatch) {
        try {
          send(res, 200, apiWorkerReadinessStatus(readinessMatch.id!))
        } catch (error) {
          const p = registryApiPublicError(error)
          send(res, p.status, { error: p.error, code: p.code })
        }
        return
      }

      const authMethodsMatch = match(path, '/api/workers/:id/auth-methods')
      if (method === 'GET' && authMethodsMatch) {
        try {
          send(res, 200, apiGetWorkerAuthMethods(authMethodsMatch.id!))
        } catch (error) {
          const p = registryApiPublicError(error)
          send(res, p.status, { error: p.error, code: p.code })
        }
        return
      }

      const probeMatch = match(path, '/api/workers/:id/probe')
      if (method === 'POST' && probeMatch) {
        try {
          send(res, 200, await apiProbeWorker(probeMatch.id!))
        } catch (error) {
          const p = registryApiPublicError(error)
          send(res, p.status, { error: p.error, code: p.code })
        }
        return
      }

      const authenticateMatch = match(path, '/api/workers/:id/authenticate')
      if (method === 'POST' && authenticateMatch) {
        try {
          const body = (await readJson(req)) as { methodId?: string }
          if (!body.methodId) {
            send(res, 400, {
              error: 'methodId required',
              code: 'ACP_REGISTRY_ENTRY_INVALID',
            })
            return
          }
          send(
            res,
            202,
            apiStartAuthenticateRegistry({
              workerId: authenticateMatch.id!,
              methodId: body.methodId,
            }),
          )
        } catch (error) {
          const p = registryApiPublicError(error)
          send(res, p.status, { error: p.error, code: p.code })
        }
        return
      }

      const secretsMatch = match(path, '/api/workers/:id/secrets')
      if (secretsMatch) {
        try {
          if (method === 'GET') {
            send(res, 200, apiListWorkerSecretStatus(secretsMatch.id!))
            return
          }
          if (method === 'POST') {
            const body = (await readJson(req)) as { envName?: string; value?: string }
            if (!body.envName || typeof body.value !== 'string') {
              send(res, 400, {
                error: 'envName and value required',
                code: 'ACP_REGISTRY_ENTRY_INVALID',
              })
              return
            }
            send(
              res,
              200,
              apiSetWorkerSecret({
                workerId: secretsMatch.id!,
                envName: body.envName,
                value: body.value,
              }),
            )
            return
          }
          if (method === 'DELETE') {
            send(res, 200, apiClearWorkerSecrets(secretsMatch.id!))
            return
          }
        } catch (error) {
          const p = registryApiPublicError(error)
          send(res, p.status, { error: p.error, code: p.code })
          return
        }
      }

      const logoutMatch = match(path, '/api/workers/:id/logout')
      if (method === 'POST' && logoutMatch) {
        try {
          send(res, 200, await apiLogoutWorker(logoutMatch.id!))
        } catch (error) {
          const p = registryApiPublicError(error)
          send(res, p.status, { error: p.error, code: p.code })
        }
        return
      }

      const authTermStatusMatch = match(path, '/api/workers/:id/auth-terminal/:attemptId')
      if (method === 'GET' && authTermStatusMatch) {
        const status = terminalAuthAttemptPublicStatus(
          authTermStatusMatch.id!,
          authTermStatusMatch.attemptId!,
        )
        if (!status) {
          send(res, 404, { error: 'Terminal auth attempt not found', code: 'WORKER_AUTH_FAILED' })
        } else {
          send(res, 200, status)
        }
        return
      }

      const authTermMatch = match(path, '/api/workers/:id/auth-terminal')
      if (method === 'POST' && authTermMatch) {
        try {
          const body = (await readJson(req)) as Record<string, unknown>
          if (
            Object.keys(body).length !== 1 ||
            typeof body.methodId !== 'string' ||
            !body.methodId.trim()
          ) {
            send(res, 400, { error: 'methodId required', code: 'ACP_REGISTRY_ENTRY_INVALID' })
            return
          }
          if (!isTerminalAuthFeatureEnabled()) {
            send(res, 409, {
              error: 'Terminal auth disabled',
              code: 'WORKER_NOT_READY',
              unsupported: true,
            })
            return
          }
          const worker = store.listWorkers().find((w) => w.id === authTermMatch.id)
          if (!worker) {
            send(res, 404, { error: 'Worker not found', code: 'WORKER_NOT_READY' })
            return
          }
          if (!desktopApiToken) {
            send(res, 503, {
              error: 'Desktop authentication unavailable',
              code: 'WORKER_AUTH_FAILED',
            })
            return
          }
          const created = createTerminalAuthAttempt({
            workerId: authTermMatch.id!,
            methodId: body.methodId,
            worker,
            ...(typeof req.headers.origin === 'string' ? { origin: req.headers.origin } : {}),
            desktopToken: desktopApiToken,
          })
          send(res, 200, {
            attemptId: created.attemptId,
            token: created.token,
            expiresAt: created.expiresAt,
            commandPreview: created.commandPreview,
            ptyReady: isPtyFeatureReady(),
          })
        } catch (error) {
          if (error instanceof TerminalAuthError) {
            send(res, error.httpStatus, { error: error.message, code: error.code })
            return
          }
          const p = registryApiPublicError(error)
          send(res, p.status, { error: p.error, code: p.code })
        }
        return
      }

      const delWorkerMatch = match(path, '/api/workers/:id')
      if (method === 'DELETE' && delWorkerMatch) {
        try {
          send(
            res,
            200,
            apiDeleteWorker({
              workerId: delWorkerMatch.id!,
              removeUnreferencedInstallation: url.searchParams.get('removeInstallation') === '1',
            }),
          )
        } catch (error) {
          const p = registryApiPublicError(error)
          send(res, p.status, { error: p.error, code: p.code })
        }
        return
      }

      const upgradeMatch = match(path, '/api/workers/:id/upgrade')
      if (method === 'POST' && upgradeMatch) {
        try {
          const body = (await readJson(req)) as {
            version: string
            distribution: 'npx' | 'uvx' | 'binary'
            manifestDigest: string
            trust?: { explicitNoSha?: boolean; acceptedAt?: string }
          }
          send(
            res,
            200,
            await apiUpgradeRegistryWorker({
              workerId: upgradeMatch.id!,
              version: body.version,
              distribution: body.distribution,
              manifestDigest: body.manifestDigest,
              trust: body.trust,
            }),
          )
        } catch (error) {
          const p = registryApiPublicError(error)
          send(res, p.status, { error: p.error, code: p.code })
        }
        return
      }

      const adoptMatch = match(path, '/api/workers/:id/adopt-registry')
      if (method === 'POST' && adoptMatch) {
        try {
          const body = (await readJson(req)) as {
            registryId: string
            version: string
            distribution: 'npx' | 'uvx' | 'binary'
            manifestDigest: string
            trust?: { explicitNoSha?: boolean; acceptedAt?: string }
          }
          send(
            res,
            200,
            await apiAdoptRegistryManagement({
              workerId: adoptMatch.id!,
              ...body,
            }),
          )
        } catch (error) {
          const p = registryApiPublicError(error)
          send(res, p.status, { error: p.error, code: p.code })
        }
        return
      }

      const instDelMatch = match(path, '/api/workers/registry/installations/:installationId')
      if (method === 'DELETE' && instDelMatch) {
        try {
          send(res, 200, apiMarkInstallationRemoved(instDelMatch.installationId!))
        } catch (error) {
          const p = registryApiPublicError(error)
          send(res, p.status, { error: p.error, code: p.code })
        }
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

      const defaultRoleMatch = match(path, '/api/workers/:id/default-role')
      if (method === 'PUT' && defaultRoleMatch) {
        try {
          const body = (await readJson(req)) as WorkerDefaultRole
          const worker = store.setWorkerDefaultRole(defaultRoleMatch.id!, body)
          send(res, 200, { worker, snapshot: store.snapshot() })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          send(res, message.startsWith('Worker not found:') ? 404 : 400, { error: message })
        }
        return
      }

      const toggleMatch = match(path, '/api/workers/:id/toggle')
      if (method === 'POST' && toggleMatch) {
        const body = (await readJson(req)) as { enabled: boolean }
        const previous = store.listWorkers().find((candidate) => candidate.id === toggleMatch.id)
        const nextEnabled = Boolean(body.enabled)
        if (previous) {
          reconcileWorkerRuntimeResources({
            before: previous,
            after: { ...previous, enabled: nextEnabled },
            manager: sessionMgr,
            catalogStore: getWorkerModelCatalogStore(),
          })
        }
        const worker = store.setWorkerEnabled(toggleMatch.id!, nextEnabled)
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
          const q = url.searchParams.get('q')?.trim() ?? ''
          const limit = Number(url.searchParams.get('limit') ?? 50)
          const force =
            url.searchParams.get('force') === '1' || url.searchParams.get('force') === 'true'
          const requestedProjectId = url.searchParams.get('projectId')?.trim() || undefined
          const requestedProject = requestedProjectId
            ? store.listProjects().find((project) => project.id === requestedProjectId)
            : store.getActive().project
          if (requestedProjectId && !requestedProject) {
            send(res, 404, { error: 'project not found', projectId: requestedProjectId })
            return
          }
          if (q) {
            // Always go through SWR controller (empty/stale refresh + backoff)
            const refResult = await getWorkerModels({
              workerId: worker.id,
              cwd: requestedProject?.rootPath,
              q,
              limit,
              force,
            })
            send(res, 200, {
              ok: refResult.ok,
              models: refResult.models ?? [],
              worker: refResult.worker,
              snapshot: store.snapshot(),
              cached: refResult.cached,
              stale: refResult.stale,
              catalogState: refResult.catalogState,
              currentPinState: refResult.currentPinState,
              search: true,
              error: refResult.error,
              errorCode: refResult.errorCode,
            })
            return
          }

          const refResult = await getWorkerModels({
            workerId: worker.id,
            cwd: requestedProject?.rootPath,
            force,
          })
          send(res, 200, {
            ok: refResult.ok,
            models: refResult.models ?? [],
            error: refResult.error,
            errorCode: refResult.errorCode,
            worker: refResult.worker,
            snapshot: store.snapshot(),
            cached: refResult.cached,
            stale: refResult.stale,
            catalogState: refResult.catalogState,
            currentPinState: refResult.currentPinState,
          })
        } catch (e) {
          sendAcpOrUnexpectedFailure(res, e, 'worker model discovery')
        }
        return
      }

      // Set preferred ACP model for worker
      const modelMatch = match(path, '/api/workers/:id/model')
      if (method === 'POST' && modelMatch) {
        const body = (await readJson(req)) as { model?: string | null; projectId?: string | null }
        try {
          const previous = store.listWorkers().find((candidate) => candidate.id === modelMatch.id)
          if (!previous) {
            send(res, 404, { error: 'worker not found' })
            return
          }
          const nextModel =
            typeof body.model === 'string' && body.model.trim() ? body.model.trim() : undefined
          const requestedProjectId = body.projectId?.trim() || undefined
          const requestedProject = requestedProjectId
            ? store.listProjects().find((project) => project.id === requestedProjectId)
            : store.getActive().project
          if (requestedProjectId && !requestedProject) {
            send(res, 404, { error: 'project not found', projectId: requestedProjectId })
            return
          }
          const pinCheck = evaluateWorkerModelPin(modelMatch.id!, body.model, {
            cwd: requestedProject?.rootPath,
          })
          if (!pinCheck.ok) {
            send(res, 400, {
              error: formatPublicError(pinCheck.errorCode, pinCheck.error ?? 'Model pin rejected'),
              errorCode: pinCheck.errorCode,
            })
            return
          }
          reconcileWorkerRuntimeResources({
            before: previous,
            after: { ...previous, model: nextModel },
            manager: sessionMgr,
            catalogStore: getWorkerModelCatalogStore(),
          })
          const worker = applyWorkerModelPin(modelMatch.id!, body.model)
          globalActivityLog.append(
            'worker',
            `Model set for ${worker.name}: ${worker.model ?? '(default)'}`,
            {
              workerId: worker.id,
              model: worker.model,
            },
          )
          send(res, 200, { worker, snapshot: store.snapshot() })
        } catch (e) {
          sendAcpOrUnexpectedFailure(res, e, 'worker model pin')
        }
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

      if (method === 'POST' && path === '/api/workers/custom/register') {
        const body = (await readJson(req)) as CustomAcpRegistrationInput
        try {
          const worker = await registerCustomAcpWorker(body, {
            store,
            cwd: store.getActive().project?.rootPath ?? process.cwd(),
          })
          send(res, 201, { worker, snapshot: store.snapshot() })
        } catch (error) {
          if (error instanceof CustomAcpRegistrationError) {
            send(res, 400, { error: error.message, code: error.code })
          } else {
            sendUnexpectedFailure(res, error, 'custom ACP registration')
          }
        }
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
          title?: string
          mode?: LeaderMode
          memoryThreadId?: string
        }
        if (!body.projectId) {
          send(res, 400, { error: 'projectId required' })
          return
        }
        // title is optional: when omitted the session is created with a placeholder
        // and auto-named by the Leader after the first task completes.
        const session = store.createSession({
          projectId: body.projectId,
          title: body.title,
          mode: body.mode,
          memoryThreadId: body.memoryThreadId,
        })
        send(res, 200, { session, snapshot: store.snapshot() })
        return
      }

      // After API key / subscription rotation: drop sticky error lamps on open sessions
      if (method === 'POST' && path === '/api/sessions/clear-chat-errors') {
        let cleared = 0
        try {
          cleared = store.clearAllSessionChatErrors()
        } catch (e) {
          send(res, 500, { error: e instanceof Error ? e.message : String(e) })
          return
        }
        if (cleared > 0) {
          globalActivityLog.append('system', 'Cleared sticky session chat errors', {
            cleared,
          })
        }
        send(res, 200, {
          ok: true,
          clearedSessionErrors: cleared,
          snapshot: store.snapshot(),
        })
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
          send(res, 200, { session, snapshot: store.snapshot() })
        } catch (e) {
          send(res, 404, { error: e instanceof Error ? e.message : String(e) })
        }
        return
      }

      const statusMatch = match(path, '/api/sessions/:id/status')
      if (method === 'POST' && statusMatch) {
        const body = (await readJson(req)) as {
          status?: string
          lastChatError?: string | null
        }
        const valid = new Set(['idle', 'running', 'needs_approval', 'error'])
        if (!body.status || !valid.has(body.status)) {
          send(res, 400, {
            error: `Invalid status. Must be one of: ${[...valid].join(', ')}`,
          })
          return
        }
        try {
          const session = store.updateSessionStatus(
            statusMatch.id!,
            body.status as import('@swarmdesk-agent/shared').SessionStatus,
            body.lastChatError !== undefined
              ? { lastChatError: body.lastChatError }
              : body.status === 'error'
                ? undefined
                : { lastChatError: null },
          )
          send(res, 200, { session, snapshot: store.snapshot() })
        } catch (e) {
          send(res, 404, { error: e instanceof Error ? e.message : String(e) })
        }
        return
      }

      const readMatch = match(path, '/api/sessions/:id/read')
      if (method === 'POST' && readMatch) {
        const body = (await readJson(req).catch(() => ({}))) as { upTo?: string }
        const session = store.markSessionRead(
          readMatch.id!,
          typeof body.upTo === 'string' ? body.upTo : undefined,
        )
        if (!session) {
          send(res, 404, { error: `Session not found: ${readMatch.id}` })
          return
        }
        send(res, 200, { session, snapshot: store.snapshot() })
        return
      }

      const policyMatch = match(path, '/api/sessions/:id/approval-policy')
      if (method === 'POST' && policyMatch) {
        const body = (await readJson(req)) as { approvalPolicy?: string }
        const validPolicies = new Set([
          'manual',
          'allow_once',
          'allow_always',
          'reject_once',
          'reject_always',
        ])
        if (!body.approvalPolicy || !validPolicies.has(body.approvalPolicy)) {
          send(res, 400, {
            error: `Invalid approvalPolicy. Must be one of: ${[...validPolicies].join(', ')}`,
          })
          return
        }
        try {
          const session = store.updateSessionApprovalPolicy(
            policyMatch.id!,
            body.approvalPolicy as import('@swarmdesk-agent/shared').SessionApprovalPolicy,
          )
          send(res, 200, { session, snapshot: store.snapshot() })
        } catch (e) {
          send(res, 404, { error: e instanceof Error ? e.message : String(e) })
        }
        return
      }

      const roleDefinitionsMatch = match(path, '/api/sessions/:sessionId/role-definitions')
      if (method === 'GET' && roleDefinitionsMatch) {
        const sessionId = roleDefinitionsMatch.sessionId!
        if (!store.listSessions().some((session) => session.id === sessionId)) {
          send(res, 404, { error: `Session not found: ${sessionId}` })
          return
        }
        send(res, 200, {
          roleDefinitions: store.listRoleDefinitions(sessionId, {
            includeArchived: url.searchParams.get('includeArchived') === '1',
          }),
        })
        return
      }
      if (method === 'POST' && roleDefinitionsMatch) {
        const body = (await readJson(req)) as Omit<CreateRoleDefinitionInput, 'chatSessionId'>
        try {
          const session = store
            .listSessions()
            .find((candidate) => candidate.id === roleDefinitionsMatch.sessionId)
          const projectRoot = session
            ? store.listProjects().find((project) => project.id === session.projectId)?.rootPath
            : undefined
          assertRoleModelAccepted(body.workerId, body.model, projectRoot)
          const roleDefinition = store.createRoleDefinition({
            ...body,
            chatSessionId: roleDefinitionsMatch.sessionId!,
          })
          send(res, 201, { roleDefinition, snapshot: store.snapshot() })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          send(res, message.includes('not found') ? 404 : 400, { error: message })
        }
        return
      }

      const roleDefinitionMatch = match(
        path,
        '/api/sessions/:sessionId/role-definitions/:roleDefinitionId',
      )
      const roleSessionResetMatch = match(
        path,
        '/api/sessions/:sessionId/role-definitions/:roleDefinitionId/reset-session',
      )
      if (method === 'POST' && roleSessionResetMatch) {
        const roleDispatchPort = getRuntimeDispatchPort()
        const session = store
          .listSessions()
          .find((candidate) => candidate.id === roleSessionResetMatch.sessionId)
        const role = store
          .listRoleDefinitions(roleSessionResetMatch.sessionId!, { includeArchived: true })
          .find((candidate) => candidate.id === roleSessionResetMatch.roleDefinitionId)
        if (!session || !role || !roleDispatchPort.resetRoleSession) {
          send(res, 404, { error: 'Role definition not found' })
          return
        }
        const context = await roleDispatchPort.resolveSessionContext(session.memoryThreadId)
        if (!context) {
          send(res, 409, { error: 'Role session context is unavailable' })
          return
        }
        send(
          res,
          200,
          await roleDispatchPort.resetRoleSession({
            context,
            roleDefinitionId: role.id,
          }),
        )
        return
      }
      if (method === 'PATCH' && roleDefinitionMatch) {
        const body = (await readJson(req)) as UpdateRoleDefinitionInput
        try {
          const current = store.getRoleDefinition(
            roleDefinitionMatch.sessionId!,
            roleDefinitionMatch.roleDefinitionId!,
          )
          if (!current)
            throw new Error(`Role definition not found: ${roleDefinitionMatch.roleDefinitionId}`)
          const session = store
            .listSessions()
            .find((candidate) => candidate.id === roleDefinitionMatch.sessionId)
          const projectRoot = session
            ? store.listProjects().find((project) => project.id === session.projectId)?.rootPath
            : undefined
          if (body.workerId !== undefined || body.model !== undefined) {
            assertRoleModelAccepted(
              body.workerId ?? current.workerId,
              body.model === undefined ? current.model : body.model,
              projectRoot,
            )
          }
          const roleDefinition = store.updateRoleDefinition(
            roleDefinitionMatch.sessionId!,
            roleDefinitionMatch.roleDefinitionId!,
            body,
          )
          send(res, 200, { roleDefinition, snapshot: store.snapshot() })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          const status = message.includes('revision conflict')
            ? 409
            : message.includes('not found')
              ? 404
              : 400
          send(res, status, { error: message })
        }
        return
      }
      if (method === 'DELETE' && roleDefinitionMatch) {
        const body = (await readJson(req).catch(() => ({}))) as { expectedRevision?: number }
        try {
          const roleDefinition = store.archiveRoleDefinition(
            roleDefinitionMatch.sessionId!,
            roleDefinitionMatch.roleDefinitionId!,
            body.expectedRevision,
          )
          send(res, 200, { roleDefinition, snapshot: store.snapshot() })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          const status = message.includes('revision conflict')
            ? 409
            : message.includes('not found')
              ? 404
              : 400
          send(res, status, { error: message })
        }
        return
      }

      const renameMatch = match(path, '/api/sessions/:id/rename')
      if (method === 'POST' && renameMatch) {
        const body = (await readJson(req)) as { title?: string }
        if (!body.title?.trim()) {
          send(res, 400, { error: 'title required' })
          return
        }
        try {
          const session = store.renameSession(renameMatch.id!, body.title)
          globalActivityLog.append('session', `Renamed to “${session.title}”`, {
            sessionId: session.id,
            projectId: session.projectId,
          })
          send(res, 200, { session, snapshot: store.snapshot() })
        } catch (e) {
          send(res, 404, { error: e instanceof Error ? e.message : String(e) })
        }
        return
      }

      const delSession = match(path, '/api/sessions/:id')
      if (method === 'DELETE' && delSession) {
        deleteRouterSessionResource({
          manager: sessionMgr,
          store,
          sessionId: delSession.id!,
        })
        send(res, 200, { ok: true, snapshot: store.snapshot() })
        return
      }

      const delProject = match(path, '/api/projects/:id')
      if (method === 'DELETE' && delProject) {
        deleteRouterProjectResource({
          manager: sessionMgr,
          store,
          projectId: delProject.id!,
        })
        send(res, 200, { ok: true, snapshot: store.snapshot() })
        return
      }

      if (method === 'GET' && path === '/health') {
        // Identity fields let Electron verify discovery matches this process before reusing.
        send(res, 200, {
          ok: true,
          service: 'swarmdesk-agent-api',
          pid: process.pid,
          startedAt: runtimeStartedAt,
          ownerEpoch: `${process.pid}:${runtimeStartedAt}`,
          port,
          workspaceId: runtimeWorkspaceId,
        })
        return
      }

      function providersPayload(status: ReturnType<typeof getSecretsStatus>) {
        const merged = mergeProvidersWithCustom(MASTRA_PROVIDERS, status.settings.customProviders)
        const secretKeys = [...SECRET_ENV_KEYS, ...merged.map((p) => p.apiKeyEnv)]
        const configured = getSecretsStatus([...new Set(secretKeys)]).configuredKeys
        return merged.map((p) => {
          const isCustom = Boolean(status.settings.customProviders?.some((c) => c.id === p.id))
          const rawThinking = (p as { thinkingIntensities?: ThinkingIntensity[] })
            .thinkingIntensities
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
          storagePath: resolveRouterDataPaths().rootDir,
        })
        return
      }

      if (method === 'POST' && path === '/api/settings') {
        if (process.env.SWARMDESK_AGENT_SECRETS_PARENT_INJECTED === '1') {
          send(res, 409, {
            error: 'Settings mutations must be performed by the Desktop owner.',
            code: 'SETTINGS_OWNER_REQUIRED',
          })
          return
        }
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
              error:
                e instanceof Error
                  ? e.message
                  : `leaderMaxSteps must be an integer between 10 and 1000`,
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

        let secretsTouched = false
        if (body.secrets && typeof body.secrets === 'object') {
          const allowed = new Set([
            ...SECRET_ENV_KEYS,
            ...(nextSettings.customProviders ?? []).map((c) => c.apiKeyEnv),
          ])
          for (const [k, v] of Object.entries(body.secrets)) {
            if (!isConfigurableSecretEnvKey(k) || !allowed.has(k)) continue
            if (v === null || v === undefined || v === '') {
              deleteSecret(k)
              delete process.env[k]
              secretsTouched = true
            } else if (typeof v === 'string' && !v.includes('••••')) {
              setSecret(k, v)
              process.env[k] = v.trim()
              secretsTouched = true
            }
          }
        }
        applySecretsToEnv(process.env)
        // Sticky chat errors stay until the next user message (not on key save).
        const status = getSecretsStatus([
          ...SECRET_ENV_KEYS,
          ...(nextSettings.customProviders ?? []).map((c) => c.apiKeyEnv),
        ])
        globalActivityLog.append('system', 'Settings updated', {
          leaderModel: status.settings.leaderModel,
          keys: status.configuredKeys,
          secretsTouched,
        })
        send(res, 200, {
          ok: true,
          ...status,
          leaderMaxSteps: status.settings.leaderMaxSteps,
          providers: providersPayload(status),
          customProviders: status.settings.customProviders ?? [],
          snapshot: secretsTouched ? store.snapshot() : undefined,
        })
        return
      }

      if (method === 'DELETE' && path === '/api/settings/secrets') {
        if (process.env.SWARMDESK_AGENT_SECRETS_PARENT_INJECTED === '1') {
          send(res, 409, {
            error: 'Settings mutations must be performed by the Desktop owner.',
            code: 'SETTINGS_OWNER_REQUIRED',
          })
          return
        }
        const body = (await readJson(req)) as { key?: string }
        const settings = loadSettings()
        const allowed = new Set([
          ...SECRET_ENV_KEYS,
          ...(settings.customProviders ?? []).map((provider) => provider.apiKeyEnv),
        ])
        if (!body.key || !isConfigurableSecretEnvKey(body.key) || !allowed.has(body.key)) {
          send(res, 400, { error: 'configurable key required' })
          return
        }
        deleteSecret(body.key)
        delete process.env[body.key]
        // Sticky chat errors remain until the next user message
        send(res, 200, {
          ok: true,
          status: getSecretsStatus(SECRET_ENV_KEYS),
          snapshot: store.snapshot(),
        })
        return
      }

      // —— Memory context status ——
      if (method === 'GET' && path === '/api/memory/status') {
        send(res, 200, {
          lastMessages: resolveMemoryLastMessages(),
          workingMemory: true,
          semanticRecall: false,
          observationalMemory: process.env.MASTRA_OM === '1' || process.env.MASTRA_OM === 'true',
          storage: resolveRouterDataPaths().memoryDbPath,
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
          // NOTE: resourceId is intentionally NOT forwarded to memory.recall().
          // Passing it triggers validateThreadIsOwnedByResource, which calls
          // getThreadById — and under SQLite WAL concurrency (another session
          // streaming writes), that read can transiently return null even for
          // a thread that exists, throwing "No thread found" → 500. Our endpoint
          // only needs message history by threadId; the ownership check is an
          // unnecessary gate for this read-only path.
          const { messages: stored } = await memory.recall({
            threadId,
            perPage: false,
          })
          const messages = toAISdkMessages(stored ?? [], { version: 'v6' })
          send(res, 200, {
            messages,
            threadId,
            resourceId: resourceId ?? null,
            count: messages.length,
          })
        } catch (e) {
          console.error('[http] memory history recall failed', e)
          send(res, 500, {
            error: 'Memory history is unavailable.',
            code: 'MEMORY_HISTORY_UNAVAILABLE',
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
          console.error('[http] goal read failed', e)
          send(res, 200, {
            objective: null,
            threadId,
            error: 'Goal state is unavailable.',
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
          sendUnexpectedFailure(res, e, 'goal update')
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
          sendUnexpectedFailure(res, e, 'goal clear')
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
          sendUnexpectedFailure(res, e, 'controller status')
        }
        return
      }

      send(res, 404, { error: 'not found', path })
    } catch (e) {
      if (e instanceof HttpJsonBodyError) {
        send(res, e.status, { error: e.message, code: e.code })
        return
      }
      sendAcpOrUnexpectedFailure(res, e, 'request')
    }
  }) // requestAls.run
})

server.on('upgrade', (req, socket, head) => {
  void (async () => {
    try {
      const { handleTerminalAuthUpgrade } = await import('./acp-auth-terminal-ws.js')
      const handled = await handleTerminalAuthUpgrade(req, socket, head, {
        desktopToken: desktopApiToken,
        owner: {
          findWorker: (workerId) => store.listWorkers().find((worker) => worker.id === workerId),
        },
      })
      if (!handled) {
        socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n')
        socket.destroy()
      }
    } catch {
      try {
        socket.destroy()
      } catch {
        /* */
      }
    }
  })()
})

server.listen(port, '127.0.0.1', () => {
  scheduleAutoWorkerHealth()
  const discovery = writeRuntimeDiscovery({
    path: runtimeDiscoveryPath,
    port,
    pid: process.pid,
    startedAt: runtimeStartedAt,
    studioToken: studioApiToken,
    workspaceId: runtimeWorkspaceId,
  })
  internalRuntimeToken = discovery.internalToken ?? discovery.token
  desktopApiToken = discovery.desktopToken ?? discovery.token
  console.log(`swarmdesk-agent API+chat listening on http://127.0.0.1:${port}`)
  console.log(`  REST  /api/*`)
  console.log(`  Chat  POST /chat/:agentId  (e.g. /chat/swarmdesk-leader)`)
  console.log(`  WS    /api/workers/:id/auth-terminal/:attemptId/ws (Sec-WebSocket-Protocol token)`)
  console.log(`  Internal runtime APIs ready (bearer auth)`)
  globalActivityLog.append('system', `API server started on :${port}`)
})

let shuttingDown = false
const shutdown = async (signal: string) => {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[shutdown] ${signal} — closing ACP sessions...`)
  // Scheduler gets 8s to quiesce, then ACP cleanup still needs time to close
  // sessions and release the owner lease. Keep the outer deadline strictly larger.
  const forceExitTimer = setTimeout(() => {
    process.exit(1)
  }, 20_000)
  forceExitTimer.unref?.()
  await drainTerminalAuthAttemptsForShutdown({
    stopAdmission: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
      }),
  })
  try {
    clearRuntimeDiscovery(runtimeDiscoveryPath, process.pid)
  } catch {
    /* ok */
  }
  internalRuntimeToken = null
  desktopApiToken = null
  try {
    await acpRuntime.close()
  } catch (e) {
    console.error('[shutdown] closeAll failed:', e)
  }
  clearTimeout(forceExitTimer)
  process.exit(0)
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
