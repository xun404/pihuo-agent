/**
 * Default desktop API server: REST + Leader chat on one process/port.
 * Shares LocalStore singleton with agent tools via getSharedStore().
 *
 * Usage: node --import tsx src/http-server.ts
 * Port: MASTRA_PORT or 4111
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { basename, resolve as pathResolve } from 'node:path'
import {
  getWorkerModelCatalogStore,
  getGitStatus,
  getGitFileDiff,
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
  applyCustomProviderEnv,
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
  parseWorkerTimeoutSettings,
  parseNpmRegistryInput,
  isConfigurableSecretEnvKey,
  getLeaderModelCatalog,
  getLeaderFeaturedCatalog,
  resolveRouterDataPaths,
  refreshModelsDevCatalog,
  installAndApplyModelsDevNpmSnapshot,
  listModelsDevProviders,
  buildCustomProviderFromModelsDev,
  loadModelsDevMeta,
  ensureProviderLogoCached,
  type CustomProviderSettings,
  type ThinkingIntensity,
  type WorkerTimeoutSettings,
  DangerZoneBusyError,
  dangerZoneStats,
  performDangerZoneAction,
  type DangerZoneAction,
} from '@swarmdesk-agent/core'
import {
  configureWorkerEnvDefaults,
  configureLoginShellPath,
  parseHealthDepth,
  formatPublicError,
  type SessionEntryConfig,
} from '@swarmdesk-agent/adapters'
import {
  apiGetRegistryCatalog,
  apiRegistryAgentIcon,
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
import { assertTeamMemberModelAccepted, assertTeamMemberReasoningAccepted } from './team-members.js'
import type {
  ApprovalDecision,
  LeaderMode,
  Locale,
  WorkerRole,
  CreateTeamMemberInput,
  UpdateTeamMemberInput,
  CreateTeamTemplateInput,
  UpdateTeamTemplateInput,
  ApplyTeamTemplateInput,
  CustomAcpRegistrationInput,
  PromptSettings,
  SessionPermissionMode,
  PermissionModeChangeSource,
} from '@swarmdesk-agent/shared'
import { handleChatStream } from '@mastra/ai-sdk'
import { toAISdkMessages } from '@mastra/ai-sdk/ui'
import {
  registerChatRun,
  getChatRun,
  attachChatRunSubscriber,
  abortChatRun,
} from './chat-run-hub.js'
import { buildLeaderRunMetaDbMessage, persistUserTurnUpFront } from './persist-user-turn.js'
import { coalesceAssistantTurns } from './coalesce-assistant-turns.js'
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
import { compressSessionContext } from './session-compressor.js'
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
import {
  isTerminalWorkerEvent,
  isValidSessionPermissionMode,
  isValidPromptSettings,
  normalizePromptSettings,
  permissionModeFromLegacyPolicy,
  type WorkerRunEvent,
} from '@swarmdesk-agent/shared'
import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash, randomBytes } from 'node:crypto'
import { HttpJsonBodyError, readJsonBody as readJson } from './http-json-body.js'
import { resolveHttpPort, resolveMemoryLastMessages } from './runtime-config.js'
import {
  CustomAcpRegistrationError,
  previewCustomAcpWorker,
  registerCustomAcpWorker,
} from './custom-acp-registration.js'
import { shouldMarkRoleReviewPrompted } from './role-review-prompt.js'
import { getTeamTemplateService, TeamTemplateServiceError } from './team-template-service.js'
import {
  isProjectMemoryEnabled,
  readProjectMemory,
  resolveProjectMemoryContext,
  resolveProjectMemoryOptions,
  updateProjectWorkingMemory,
} from './project-memory.js'

function parseSessionPermissionSource(
  value: unknown,
): Extract<PermissionModeChangeSource, 'manual_chat' | 'manual_panel'> {
  if (value === 'manual_chat' || value === 'manual_panel') return value
  if (value === undefined) return 'manual_chat'
  throw new Error('source must be manual_chat or manual_panel')
}

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
            teamMemberId?: string
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
            teamMemberId: body.teamMemberId,
            role: body.role,
            task: body.task,
            cwd: cwdAuth.cwd,
            source: body.source ?? 'api',
            wait: false,
          })
          send(res, 200, { job })
          return
        }

        if (method === 'GET' && path === '/internal/runtime/team') {
          const memoryThreadId = url.searchParams.get('memoryThreadId') ?? ''
          const context = await dispatchPort.resolveSessionContext(memoryThreadId)
          if (!context) {
            send(res, 403, { error: 'SWARMDESK_AGENT_SESSION_BINDING_REQUIRED' })
            return
          }
          const teamMembers = dispatchPort.listTeamMembers
            ? await dispatchPort.listTeamMembers(context)
            : []
          const teamRevision = dispatchPort.getTeamRevision
            ? await dispatchPort.getTeamRevision(context)
            : 1
          send(res, 200, { teamMembers, teamRevision })
          return
        }

        if (method === 'POST' && path === '/internal/runtime/team/members') {
          const body = (await readJson(req)) as {
            context?: { memoryThreadId?: string }
            input?: Omit<CreateTeamMemberInput, 'chatSessionId'>
          }
          const context = await dispatchPort.resolveSessionContext(
            body.context?.memoryThreadId ?? '',
          )
          if (!context || !body.input || !dispatchPort.createTeamMember) {
            send(res, 403, { error: 'SWARMDESK_AGENT_SESSION_BINDING_REQUIRED' })
            return
          }
          const teamMember = await dispatchPort.createTeamMember({
            context,
            input: body.input,
          })
          send(res, 201, { teamMember })
          return
        }

        const internalTeamMemberMatch = match(path, '/internal/runtime/team/members/:teamMemberId')
        if ((method === 'PATCH' || method === 'DELETE') && internalTeamMemberMatch) {
          const body = (await readJson(req)) as {
            context?: { memoryThreadId?: string }
            patch?: UpdateTeamMemberInput
            expectedRevision?: number
          }
          const context = await dispatchPort.resolveSessionContext(
            body.context?.memoryThreadId ?? '',
          )
          if (!context) {
            send(res, 403, { error: 'SWARMDESK_AGENT_SESSION_BINDING_REQUIRED' })
            return
          }
          if (method === 'PATCH' && dispatchPort.updateTeamMember && body.patch) {
            const teamMember = await dispatchPort.updateTeamMember({
              context,
              teamMemberId: internalTeamMemberMatch.teamMemberId!,
              patch: body.patch,
            })
            send(res, 200, { teamMember })
            return
          }
          if (method === 'DELETE' && dispatchPort.archiveTeamMember) {
            const teamMember = await dispatchPort.archiveTeamMember({
              context,
              teamMemberId: internalTeamMemberMatch.teamMemberId!,
              expectedRevision: body.expectedRevision,
            })
            send(res, 200, { teamMember })
            return
          }
          send(res, 400, { error: 'invalid Team member mutation' })
          return
        }

        const internalTeamMemberResetMatch = match(
          path,
          '/internal/runtime/team/members/:teamMemberId/reset-session',
        )
        if (method === 'POST' && internalTeamMemberResetMatch) {
          const body = (await readJson(req)) as { context?: { memoryThreadId?: string } }
          const context = await dispatchPort.resolveSessionContext(
            body.context?.memoryThreadId ?? '',
          )
          if (!context || !dispatchPort.resetTeamMemberSession) {
            send(res, 403, { error: 'SWARMDESK_AGENT_SESSION_BINDING_REQUIRED' })
            return
          }
          send(
            res,
            200,
            await dispatchPort.resetTeamMemberSession({
              context,
              teamMemberId: internalTeamMemberResetMatch.teamMemberId!,
            }),
          )
          return
        }

        if (method === 'GET' && path === '/internal/runtime/team-templates') {
          const templates = dispatchPort.listTeamTemplates
            ? await dispatchPort.listTeamTemplates()
            : []
          send(res, 200, { templates })
          return
        }

        if (method === 'POST' && path === '/internal/runtime/team-templates') {
          const body = (await readJson(req)) as {
            context?: { memoryThreadId?: string }
            name?: string
            description?: string
          }
          const context = await dispatchPort.resolveSessionContext(
            body.context?.memoryThreadId ?? '',
          )
          if (!context || !body.name || !dispatchPort.saveTeamTemplate) {
            send(res, 403, { error: 'SWARMDESK_AGENT_SESSION_BINDING_REQUIRED' })
            return
          }
          const template = await dispatchPort.saveTeamTemplate({
            context,
            name: body.name,
            description: body.description,
          })
          send(res, 201, { template })
          return
        }

        const internalTemplateMatch = match(path, '/internal/runtime/team-templates/:templateId')
        if (method === 'DELETE' && internalTemplateMatch) {
          if (!dispatchPort.deleteTeamTemplate) {
            send(res, 503, { error: 'Team template runtime is unavailable' })
            return
          }
          const template = await dispatchPort.deleteTeamTemplate(internalTemplateMatch.templateId!)
          send(res, 200, { template })
          return
        }

        if (method === 'POST' && path === '/internal/runtime/team/apply-template') {
          const body = (await readJson(req)) as {
            context?: { memoryThreadId?: string }
            templateId?: string
            expectedTeamRevision?: number
            mappings?: ApplyTeamTemplateInput['mappings']
          }
          const context = await dispatchPort.resolveSessionContext(
            body.context?.memoryThreadId ?? '',
          )
          if (
            !context ||
            !body.templateId ||
            !Number.isInteger(body.expectedTeamRevision) ||
            !dispatchPort.applyTeamTemplate
          ) {
            send(res, 400, { error: 'invalid Team template application' })
            return
          }
          const result = await dispatchPort.applyTeamTemplate({
            context,
            templateId: body.templateId,
            expectedTeamRevision: body.expectedTeamRevision!,
            mappings: body.mappings,
          })
          send(res, 200, result)
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

      // Resume an in-flight chat stream (AI SDK useChat resume contract):
      // 204 = no active run for this chat; 200 = SSE replay + live tail.
      const chatStreamMatch = match(path, '/chat/:agentId/:chatId/stream')
      if (method === 'GET' && chatStreamMatch) {
        const hub = getChatRun(chatStreamMatch.chatId!)
        if (!hub) {
          res.writeHead(204, corsFor())
          res.end()
          return
        }
        attachChatRunSubscriber(hub, res, corsFor())
        return
      }

      // Explicit stop for a running chat turn. useChat stop() only disconnects
      // the local fetch — the server run keeps going unless aborted here.
      const chatAbortMatch = match(path, '/chat/:agentId/:chatId/abort')
      if (method === 'POST' && chatAbortMatch) {
        send(res, 200, { aborted: abortChatRun(chatAbortMatch.chatId!) })
        return
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

          // Resolve the persisted Router tuple before applying any memory
          // options. The browser may request a thread, but it cannot choose a
          // different Project resource or override this project's switch.
          const routerSession = sessionByThread ?? null
          const routerProject = routerSession
            ? (store.listProjects().find((p) => p.id === routerSession.projectId) ?? null)
            : (active.project ?? null)
          const projectMemoryOptions = resolveProjectMemoryOptions(
            isProjectMemoryEnabled(routerProject),
          )

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

          let roleReviewPending = false
          if (routerSession) {
            requestContext.set('routerSessionId', routerSession.id)
            requestContext.set('routerProjectId', routerSession.projectId)
            requestContext.set('memoryThreadId', routerSession.memoryThreadId)
            requestContext.set('sessionTitle', routerSession.title)
            requestContext.set('sessionTitleSource', routerSession.titleSource ?? 'auto')
            roleReviewPending = routerSession.roleReviewState === 'pending'
            requestContext.set('roleReviewPending', roleReviewPending)
            requestContext.set(
              'bootstrappedRoleCount',
              store.listTeamMembers(routerSession.id).length,
            )
            if (routerProject) {
              requestContext.set('routerProjectRoot', routerProject.rootPath)
            }
          } else {
            requestContext.set('memoryThreadId', threadId)
          }

          // One controller per run: the chat-run-hub holds it so the explicit
          // abort endpoint (and same-thread re-registration) can cancel the
          // Mastra run. Client disconnects never abort — reload must not kill it.
          const abortController = new AbortController()

          // Ensure params carry memory even if client omitted it (goal-state processor)
          const paramsWithMemory = {
            ...params,
            maxSteps: leaderMaxSteps,
            abortSignal: abortController.signal,
            memory: {
              thread: threadId,
              resource: resourceId,
              options: projectMemoryOptions,
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
          const leaderRunStartedAt = new Date()
          const leaderRunMarkerId = randomUUID()
          let leaderRunMetaPersisted = false
          // untilIdle keeps the stream open across background tool tasks
          // @see https://mastra.ai/docs/long-running-agents/background-tasks

          // Persist the user turn up front: Mastra only saves input+output at
          // run finish, so a mid-run reload would otherwise drop the in-flight
          // user message from the chat UI until the run ends. Ids match the
          // client's UIMessages → the finish-save upserts, never duplicates.
          // Best-effort: a pre-save failure must not break the chat flow.
          try {
            await persistUserTurnUpFront(leaderMemory as never, {
              messages: params.messages,
              threadId,
              resourceId,
            })
          } catch (err) {
            console.error('[chat] user-turn pre-save failed (non-fatal)', err)
          }

          let streamBudgetEvent: LeaderStepBudgetEvent | null = null

          const stream = await handleChatStream({
            mastra,
            agentId,
            version: 'v6',
            params: {
              ...paramsWithMemory,
              untilIdle: true,
              onFinish: async (onFinishEvent: {
                steps?: readonly {
                  usage?: {
                    inputTokens?: number
                    cachedInputTokens?: number
                    outputTokens?: number
                  }
                }[]
                finishReason?: string
                runId?: string
              }) => {
                if (!onFinishEvent.finishReason) return

                if (!leaderRunMetaPersisted) {
                  leaderRunMetaPersisted = true
                  const completedAt = new Date()
                  try {
                    const marker = buildLeaderRunMetaDbMessage({
                      runId: onFinishEvent.runId ?? leaderRunMarkerId,
                      threadId,
                      resourceId,
                      model: leaderModel,
                      thinking: thinkingIntensity,
                      startedAt: leaderRunStartedAt,
                      completedAt,
                    })
                    await leaderMemory.saveMessages({ messages: [marker as never] })
                  } catch (err) {
                    console.error('[leader-run-meta] Failed to persist run metadata:', {
                      threadId,
                      error: String(err),
                    })
                  }
                }

                // Stamp the reply time so the sidebar can show "last reply X ago"
                // instead of the noisy session.updatedAt (which mode/rename/activate
                // also bump). No-op if the session was deleted mid-stream.
                if (routerSession) {
                  store.markSessionReply(routerSession.id)
                  if (
                    shouldMarkRoleReviewPrompted({
                      roleReviewPending,
                      finishReason: onFinishEvent.finishReason,
                    })
                  ) {
                    store.markSessionRoleReviewPrompted(routerSession.id)
                  }
                }

                // —— Cumulative token usage ——
                // Sum real model-reported usage across all steps of this turn and
                // accumulate into the session (for the context popup's cache-hit
                // rate + context size). Failures are swallowed: usage stats must
                // never break the chat flow (same contract as session-title).
                if (routerSession && onFinishEvent.steps?.length) {
                  try {
                    // Cumulative totals (for cache-hit-rate): sum across steps.
                    let inputTokens = 0
                    let cachedInputTokens = 0
                    let outputTokens = 0
                    // Track the LAST step's input separately: in a multi-step
                    // agentic loop, each step's inputTokens already includes all
                    // prior context (system + user + prior step outputs), so
                    // summing them double-counts. The last step's input is the
                    // best proxy for "current context occupancy" — it reflects
                    // the full prompt the model just saw.
                    let lastStepInputTokens = 0
                    for (const step of onFinishEvent.steps) {
                      const u = step?.usage
                      if (!u) continue
                      const stepInput = Math.max(0, Math.floor(u.inputTokens ?? 0))
                      inputTokens += stepInput
                      cachedInputTokens += Math.max(0, Math.floor(u.cachedInputTokens ?? 0))
                      outputTokens += Math.max(0, Math.floor(u.outputTokens ?? 0))
                      if (stepInput > 0) lastStepInputTokens = stepInput
                    }
                    store.markSessionUsage(routerSession.id, {
                      inputTokens,
                      cachedInputTokens,
                      outputTokens,
                      lastInputTokens: lastStepInputTokens,
                    })
                  } catch (err) {
                    console.error(
                      '[session-usage] onFinish usage accumulation failed',
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
              abortSignal: abortController.signal,
              memory: {
                thread: threadId,
                resource: resourceId,
                options: projectMemoryOptions,
              },
              requestContext,
              providerOptions,
              untilIdle: true,
            } as never,
          })
          // The hub drains the stream regardless of this response's lifetime and
          // buffers it for resume replay; this response is just the first subscriber.
          const hub = registerChatRun(threadId, stream, abortController)
          attachChatRunSubscriber(hub, res, corsFor())
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

      // —— Project-scoped working memory ————————————————————————————————
      // Project memory is bound to a persisted Session before its Project
      // resource is used. The browser may select a thread, but it cannot
      // forge a project/resource boundary.
      const projectMemoryMatch = match(path, '/api/projects/:id/memory')
      if ((method === 'GET' || method === 'PATCH') && projectMemoryMatch) {
        const projectId = projectMemoryMatch.id!
        const project = store.listProjects().find((candidate) => candidate.id === projectId)
        if (!project) {
          send(res, 404, {
            error: 'Project not found',
            code: 'PROJECT_NOT_FOUND',
            projectId,
          })
          return
        }

        if (method === 'PATCH') {
          const body = (await readJson(req)) as { enabled?: unknown }
          if (typeof body.enabled !== 'boolean') {
            send(res, 400, {
              error: 'enabled must be a boolean',
              code: 'PROJECT_MEMORY_ENABLED_REQUIRED',
            })
            return
          }
          try {
            const updatedProject = store.setProjectMemoryEnabled(projectId, body.enabled)
            send(res, 200, { project: updatedProject, snapshot: store.snapshot() })
          } catch (error) {
            console.error('[memory] project switch failed', error)
            send(res, 500, {
              error: 'Project memory switch failed',
              code: 'PROJECT_MEMORY_UPDATE_FAILED',
            })
          }
          return
        }

        const threadId = url.searchParams.get('threadId')?.trim()
        if (!threadId) {
          send(res, 400, {
            error: 'threadId required',
            code: 'PROJECT_MEMORY_SESSION_REQUIRED',
          })
          return
        }
        const context = resolveProjectMemoryContext(store, projectId, threadId)
        if (!context) {
          send(res, 404, {
            error: 'Project memory session not found',
            code: 'PROJECT_MEMORY_SESSION_NOT_FOUND',
          })
          return
        }
        try {
          send(res, 200, await readProjectMemory(context))
        } catch (error) {
          console.error('[memory] project read failed', error)
          send(res, 500, {
            error: 'Project memory unavailable',
            code: 'PROJECT_MEMORY_UNAVAILABLE',
          })
        }
        return
      }

      const projectMemoryWorkingMatch = match(path, '/api/projects/:id/memory/working')
      if (method === 'PUT' && projectMemoryWorkingMatch) {
        const projectId = projectMemoryWorkingMatch.id!
        const project = store.listProjects().find((candidate) => candidate.id === projectId)
        if (!project) {
          send(res, 404, {
            error: 'Project not found',
            code: 'PROJECT_NOT_FOUND',
            projectId,
          })
          return
        }
        const body = (await readJson(req)) as { threadId?: unknown; content?: unknown }
        const threadId = typeof body.threadId === 'string' ? body.threadId.trim() : ''
        if (!threadId) {
          send(res, 400, {
            error: 'threadId required',
            code: 'PROJECT_MEMORY_SESSION_REQUIRED',
          })
          return
        }
        if (typeof body.content !== 'string') {
          send(res, 400, {
            error: 'content must be a string',
            code: 'PROJECT_MEMORY_CONTENT_REQUIRED',
          })
          return
        }
        const context = resolveProjectMemoryContext(store, projectId, threadId)
        if (!context) {
          send(res, 404, {
            error: 'Project memory session not found',
            code: 'PROJECT_MEMORY_SESSION_NOT_FOUND',
          })
          return
        }
        try {
          send(res, 200, await updateProjectWorkingMemory(context, body.content))
        } catch (error) {
          if (error instanceof Error && error.message === 'PROJECT_MEMORY_CONTENT_TOO_LARGE') {
            send(res, 413, {
              error: 'Project memory content is too large',
              code: 'PROJECT_MEMORY_CONTENT_TOO_LARGE',
            })
            return
          }
          console.error('[memory] project working-memory update failed', error)
          send(res, 500, {
            error: 'Project memory update failed',
            code: 'PROJECT_MEMORY_UPDATE_FAILED',
          })
        }
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
          teamMemberId?: string
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

      // Per-file unified diff (OpenChamber-style changed-file viewer)
      const gitDiffMatch = match(path, '/api/projects/:id/git/diff')
      if (method === 'GET' && gitDiffMatch) {
        const project = store.listProjects().find((p) => p.id === gitDiffMatch.id)
        if (!project) {
          send(res, 404, { error: 'project not found' })
          return
        }
        const filePath = url.searchParams.get('path')?.trim() ?? ''
        const staged =
          url.searchParams.get('staged') === '1' || url.searchParams.get('staged') === 'true'
        const contextRaw = url.searchParams.get('contextLines')
        const contextLines =
          contextRaw != null && contextRaw !== '' ? Number(contextRaw) : undefined
        if (!filePath) {
          send(res, 400, { ok: false, error: 'path required' })
          return
        }
        const diff = await getGitFileDiff(project.rootPath, filePath, {
          staged,
          contextLines: Number.isFinite(contextLines) ? contextLines : undefined,
        })
        send(res, diff.ok ? 200 : 400, diff)
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

      if (method === 'POST' && path === '/api/demo/seed') {
        try {
          const body = (await readJson(req).catch(() => ({}))) as {
            rootPath?: string
            seedMemory?: boolean
          }
          const { seedDemoShowcase } = await import('./demo-seed.js')
          const result = await seedDemoShowcase(store, {
            rootPath: body.rootPath,
            seedMemory: body.seedMemory,
          })
          send(res, 200, { ...result, snapshot: store.snapshot() })
        } catch (e) {
          console.error('[http] demo seed failed', e)
          send(res, 500, { error: 'Demo seed failed' })
        }
        return
      }

      if (method === 'POST' && path === '/api/locale') {
        const body = (await readJson(req)) as { locale: Locale }
        if (body.locale !== 'zh' && body.locale !== 'zh-TW' && body.locale !== 'en') {
          send(res, 400, { error: 'locale must be zh, zh-TW, or en' })
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

      const registryIconMatch = match(path, '/api/registry/agents/:id/icon')
      if (method === 'GET' && registryIconMatch) {
        const result = await apiRegistryAgentIcon(registryIconMatch.id!)
        if (!result) {
          send(res, 404, { error: 'No icon for this agent', code: 'REGISTRY_ICON_MISSING' })
          return
        }
        res.writeHead(200, {
          'Content-Type': 'image/svg+xml',
          'Cache-Control': 'no-cache',
          ...corsFor(req),
        })
        res.end(result.svg)
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

      const iconMatch = match(path, '/api/workers/:id/icon')
      if (method === 'GET' && iconMatch) {
        const worker = store.listWorkers().find((w) => w.id === iconMatch.id)
        const iconPath = worker?.iconPath
        if (!iconPath) {
          send(res, 404, { error: 'No icon for this worker', code: 'WORKER_ICON_MISSING' })
          return
        }
        try {
          const buf = readFileSync(iconPath)
          res.writeHead(200, {
            'Content-Type': 'image/svg+xml',
            'Cache-Control': 'no-cache',
            ...corsFor(req),
          })
          res.end(buf)
        } catch {
          send(res, 404, { error: 'Icon file not found', code: 'WORKER_ICON_MISSING' })
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

      const defaultRoleMatch = match(path, '/api/workers/:id/default-role-type')
      if (method === 'PUT' && defaultRoleMatch) {
        try {
          const body = (await readJson(req)) as { roleType: WorkerRole }
          const worker = store.setWorkerDefaultRoleType(defaultRoleMatch.id!, body.roleType)
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

      // Get reasoning options for a worker/model
      const reasoningMatch = match(path, '/api/workers/:id/reasoning-options')
      if (method === 'GET' && reasoningMatch) {
        const worker = store.listWorkers().find((w) => w.id === reasoningMatch.id)
        if (!worker) {
          send(res, 404, { error: 'not found' })
          return
        }
        try {
          const model = url.searchParams.get('model')?.trim() || undefined
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

          const { getWorkerReasoningOptionsWithWorker } = await import('./worker-reasoning.js')
          const { resolveModelCatalogScopeKey } = await import('./worker-models.js')
          const scopeKey = resolveModelCatalogScopeKey(requestedProject?.rootPath)
          const result = await getWorkerReasoningOptionsWithWorker(worker, model, {
            cwd: requestedProject?.rootPath,
            force,
            scopeKey: scopeKey || undefined,
          })
          send(res, 200, result)
        } catch {
          send(res, 500, {
            error: 'Failed to load Worker reasoning options.',
            errorCode: 'ACP_REASONING_CONFIGURATION_FAILED',
          })
        }
        return
      }

      // Atomically set worker execution config (model + reasoning)
      const execMatch = match(path, '/api/workers/:id/execution-config')
      if (method === 'PUT' && execMatch) {
        const body = (await readJson(req)) as {
          model?: string | null
          reasoning?: string | null
          projectId?: string | null
        }
        try {
          const previous = store.listWorkers().find((candidate) => candidate.id === execMatch.id)
          if (!previous) {
            send(res, 404, { error: 'not found' })
            return
          }

          const requestedProjectId = body.projectId?.trim() || undefined
          const requestedProject = requestedProjectId
            ? store.listProjects().find((project) => project.id === requestedProjectId)
            : store.getActive().project
          if (requestedProjectId && !requestedProject) {
            send(res, 404, { error: 'project not found', projectId: requestedProjectId })
            return
          }

          if (typeof body.model === 'string' && body.model.trim()) {
            const pinCheck = evaluateWorkerModelPin(execMatch.id!, body.model, {
              cwd: requestedProject?.rootPath,
            })
            if (!pinCheck.ok) {
              send(res, 400, {
                error: formatPublicError(
                  pinCheck.errorCode,
                  pinCheck.error ?? 'Model pin rejected',
                ),
                errorCode: pinCheck.errorCode,
              })
              return
            }
          }

          // Validate final model/reasoning combination
          const effectiveModel =
            body.model !== undefined
              ? typeof body.model === 'string' && body.model.trim()
                ? body.model.trim()
                : undefined
              : previous.model
          const effectiveReasoning =
            body.reasoning !== undefined
              ? typeof body.reasoning === 'string' && body.reasoning.trim()
                ? body.reasoning.trim()
                : undefined
              : previous.reasoning
          if (effectiveReasoning) {
            const { ensureWorkerReasoningSelection } = await import('./worker-reasoning.js')
            const { resolveModelCatalogScopeKey } = await import('./worker-models.js')
            const scopeKey = resolveModelCatalogScopeKey(requestedProject?.rootPath)
            const reasoningCheck = await ensureWorkerReasoningSelection(
              previous,
              effectiveModel,
              effectiveReasoning,
              {
                cwd: requestedProject?.rootPath,
                scopeKey: scopeKey || undefined,
              },
            )
            if (!reasoningCheck.ok) {
              send(res, 400, {
                error: formatPublicError(
                  reasoningCheck.errorCode,
                  reasoningCheck.error ?? 'Reasoning rejected',
                ),
                errorCode: reasoningCheck.errorCode,
              })
              return
            }
          }

          reconcileWorkerRuntimeResources({
            before: previous,
            after: {
              ...previous,
              model: effectiveModel,
              reasoning: effectiveReasoning,
            },
            manager: sessionMgr,
            catalogStore: getWorkerModelCatalogStore(),
          })

          const worker = store.setWorkerExecutionConfig(execMatch.id!, {
            model: body.model,
            reasoning: body.reasoning,
          })
          globalActivityLog.append('worker', `Execution config set for ${worker.name}`, {
            workerId: worker.id,
            model: worker.model,
            reasoning: worker.reasoning,
          })
          send(res, 200, { worker, snapshot: store.snapshot() })
        } catch (e) {
          sendAcpOrUnexpectedFailure(res, e, 'worker execution config')
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

      // Custom ACP preview: probe + dedup detection, returns the agent identity for confirmation.
      // Never persists — the client re-POSTs to /register with force/duplicateDecision after the
      // user confirms in the dialog.
      if (method === 'POST' && path === '/api/workers/custom/preview') {
        const body = (await readJson(req)) as CustomAcpRegistrationInput
        try {
          const preview = await previewCustomAcpWorker(body, {
            store,
            cwd: store.getActive().project?.rootPath ?? process.cwd(),
          })
          send(res, 200, { preview })
        } catch (error) {
          if (error instanceof CustomAcpRegistrationError) {
            send(res, 400, { error: error.message, code: error.code })
          } else {
            sendUnexpectedFailure(res, error, 'custom ACP preview')
          }
        }
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
          const message = e instanceof Error ? e.message : String(e)
          const notFound = message.includes('not found')
          send(res, notFound ? 404 : 500, {
            error: notFound ? message : 'Internal server error',
          })
        }
        return
      }

      if (method === 'POST' && path === '/api/sessions') {
        const body = (await readJson(req)) as {
          projectId: string
          title?: string
          mode?: LeaderMode
          memoryThreadId?: string
          teamTemplateId?: string
          permissionMode?: SessionPermissionMode
        }
        if (!body.projectId) {
          send(res, 400, { error: 'projectId required' })
          return
        }
        if (
          body.permissionMode !== undefined &&
          !isValidSessionPermissionMode(body.permissionMode)
        ) {
          send(res, 400, { error: 'permissionMode must be default or auto' })
          return
        }
        // title is optional: when omitted the session is created with a placeholder
        // and auto-named by the Leader after the first task completes.
        try {
          const initialTeamMembers = body.teamTemplateId
            ? getTeamTemplateService().resolveForProject({
                projectId: body.projectId,
                templateId: body.teamTemplateId,
              })
            : undefined
          const session = store.createSession({
            projectId: body.projectId,
            title: body.title,
            mode: body.mode,
            permissionMode: body.permissionMode,
            memoryThreadId: body.memoryThreadId,
            rolePrompts: loadSettings().prompts.roles,
            initialTeamMembers,
          })
          send(res, 200, { session, snapshot: store.snapshot() })
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e)
          if (e instanceof TeamTemplateServiceError) {
            const status =
              e.code === 'TEAM_TEMPLATE_NOT_FOUND' || e.code === 'PROJECT_NOT_FOUND'
                ? 404
                : e.code === 'TEAM_TEMPLATE_MAPPING_REQUIRED'
                  ? 409
                  : 400
            send(res, status, { error: message, code: e.code })
            return
          }
          const status = message.includes('not found') ? 400 : 500
          send(res, status, { error: message })
        }
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
          const { session, approvals, failures } = getWorkerScheduler().setSessionPermissionMode(
            policyMatch.id!,
            permissionModeFromLegacyPolicy(body.approvalPolicy),
            {
              // The old five-state endpoint is a compatibility migration
              // boundary, so its audit provenance is explicit and stable.
              source: 'migration',
              approvalPolicy:
                body.approvalPolicy as import('@swarmdesk-agent/shared').SessionApprovalPolicy,
            },
          )
          send(res, 200, { session, approvals, failures, snapshot: store.snapshot() })
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e)
          const notFound = message.includes('not found')
          send(res, notFound ? 404 : 500, {
            error: notFound ? message : 'Internal server error',
          })
        }
        return
      }

      const permissionModeMatch = match(path, '/api/sessions/:id/permission-mode')
      if (method === 'POST' && permissionModeMatch) {
        const body = (await readJson(req)) as { permissionMode?: string; source?: unknown }
        if (!isValidSessionPermissionMode(body.permissionMode)) {
          send(res, 400, { error: 'permissionMode must be default or auto' })
          return
        }
        try {
          const source = parseSessionPermissionSource(body.source)
          const { session, approvals, failures } = getWorkerScheduler().setSessionPermissionMode(
            permissionModeMatch.id!,
            body.permissionMode,
            { source },
          )
          send(res, 200, { session, approvals, failures, snapshot: store.snapshot() })
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e)
          if (message.startsWith('source must be')) {
            send(res, 400, { error: message })
            return
          }
          if (message.includes('not found')) send(res, 404, { error: message })
          else sendUnexpectedFailure(res, e, 'update session permission mode')
        }
        return
      }

      const teamMatch = match(path, '/api/sessions/:sessionId/team')
      if (method === 'GET' && teamMatch) {
        const sessionId = teamMatch.sessionId!
        if (!store.listSessions().some((session) => session.id === sessionId)) {
          send(res, 404, { error: `Session not found: ${sessionId}` })
          return
        }
        send(res, 200, {
          teamMembers: store.listTeamMembers(sessionId, {
            includeArchived: url.searchParams.get('includeArchived') === '1',
          }),
        })
        return
      }
      const teamMembersMatch = match(path, '/api/sessions/:sessionId/team/members')
      if (method === 'POST' && teamMembersMatch) {
        const body = (await readJson(req)) as Omit<CreateTeamMemberInput, 'chatSessionId'>
        try {
          const session = store
            .listSessions()
            .find((candidate) => candidate.id === teamMembersMatch.sessionId)
          const projectRoot = session
            ? store.listProjects().find((project) => project.id === session.projectId)?.rootPath
            : undefined
          assertTeamMemberModelAccepted(body.workerId, body.model, projectRoot)
          assertTeamMemberReasoningAccepted(body.workerId, body.model, body.reasoning, {
            cwd: projectRoot,
          })
          const teamMember = store.createTeamMember({
            ...body,
            chatSessionId: teamMembersMatch.sessionId!,
          })
          send(res, 201, { teamMember, snapshot: store.snapshot() })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          send(res, message.includes('not found') ? 404 : 400, { error: message })
        }
        return
      }

      const teamMemberMatch = match(path, '/api/sessions/:sessionId/team/members/:teamMemberId')
      const teamMemberSessionResetMatch = match(
        path,
        '/api/sessions/:sessionId/team/members/:teamMemberId/reset-session',
      )
      if (method === 'POST' && teamMemberSessionResetMatch) {
        const roleDispatchPort = getRuntimeDispatchPort()
        const session = store
          .listSessions()
          .find((candidate) => candidate.id === teamMemberSessionResetMatch.sessionId)
        const role = store
          .listTeamMembers(teamMemberSessionResetMatch.sessionId!, { includeArchived: true })
          .find((candidate) => candidate.id === teamMemberSessionResetMatch.teamMemberId)
        if (!session || !role || !roleDispatchPort.resetTeamMemberSession) {
          send(res, 404, { error: 'Team member not found' })
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
          await roleDispatchPort.resetTeamMemberSession({
            context,
            teamMemberId: role.id,
          }),
        )
        return
      }
      if (method === 'PATCH' && teamMemberMatch) {
        const body = (await readJson(req)) as UpdateTeamMemberInput
        try {
          const current = store.getTeamMember(
            teamMemberMatch.sessionId!,
            teamMemberMatch.teamMemberId!,
          )
          if (!current) throw new Error(`Team member not found: ${teamMemberMatch.teamMemberId}`)
          const session = store
            .listSessions()
            .find((candidate) => candidate.id === teamMemberMatch.sessionId)
          const projectRoot = session
            ? store.listProjects().find((project) => project.id === session.projectId)?.rootPath
            : undefined
          if (body.workerId !== undefined || body.model !== undefined) {
            assertTeamMemberModelAccepted(
              body.workerId ?? current.workerId,
              body.model === undefined ? current.model : body.model,
              projectRoot,
            )
          }
          if (
            body.workerId !== undefined ||
            body.model !== undefined ||
            body.reasoning !== undefined
          ) {
            const effectiveWorkerId = body.workerId ?? current.workerId
            const effectiveModel =
              body.model === undefined
                ? current.model
                : typeof body.model === 'string' && body.model.trim()
                  ? body.model.trim()
                  : undefined
            const effectiveReasoning =
              body.reasoning === undefined
                ? current.reasoning
                : typeof body.reasoning === 'string' && body.reasoning.trim()
                  ? body.reasoning.trim()
                  : undefined
            assertTeamMemberReasoningAccepted(
              effectiveWorkerId,
              effectiveModel,
              effectiveReasoning,
              { cwd: projectRoot },
            )
          }
          const teamMember = store.updateTeamMember(
            teamMemberMatch.sessionId!,
            teamMemberMatch.teamMemberId!,
            body,
          )
          send(res, 200, { teamMember, snapshot: store.snapshot() })
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
      if (method === 'DELETE' && teamMemberMatch) {
        const body = (await readJson(req).catch(() => ({}))) as { expectedRevision?: number }
        try {
          const teamMember = store.archiveTeamMember(
            teamMemberMatch.sessionId!,
            teamMemberMatch.teamMemberId!,
            body.expectedRevision,
          )
          send(res, 200, { teamMember, snapshot: store.snapshot() })
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

      if (path === '/api/team-templates' && method === 'GET') {
        send(res, 200, { templates: store.listTeamTemplates() })
        return
      }
      if (path === '/api/team-templates' && method === 'POST') {
        try {
          const template = store.createTeamTemplate(
            (await readJson(req)) as CreateTeamTemplateInput,
          )
          send(res, 201, { template })
        } catch (error) {
          send(res, 400, { error: error instanceof Error ? error.message : String(error) })
        }
        return
      }
      const teamTemplateMatch = match(path, '/api/team-templates/:templateId')
      if (method === 'PUT' && teamTemplateMatch) {
        try {
          const template = store.updateTeamTemplate(
            teamTemplateMatch.templateId!,
            (await readJson(req)) as UpdateTeamTemplateInput,
          )
          send(res, 200, { template })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          send(res, message.includes('not found') ? 404 : 400, { error: message })
        }
        return
      }
      if (method === 'DELETE' && teamTemplateMatch) {
        try {
          send(res, 200, { template: store.deleteTeamTemplate(teamTemplateMatch.templateId!) })
        } catch (error) {
          send(res, 404, { error: error instanceof Error ? error.message : String(error) })
        }
        return
      }
      const previewTemplateMatch = match(path, '/api/sessions/:sessionId/team/preview-template')
      if (method === 'POST' && previewTemplateMatch) {
        try {
          const body = (await readJson(req)) as Pick<
            ApplyTeamTemplateInput,
            'templateId' | 'mappings'
          >
          send(
            res,
            200,
            getTeamTemplateService().preview({
              sessionId: previewTemplateMatch.sessionId!,
              templateId: body.templateId,
              mappings: body.mappings,
            }),
          )
        } catch (error) {
          send(res, error instanceof TeamTemplateServiceError ? 409 : 400, {
            error: error instanceof Error ? error.message : String(error),
            code: error instanceof TeamTemplateServiceError ? error.code : undefined,
          })
        }
        return
      }
      const applyTemplateMatch = match(path, '/api/sessions/:sessionId/team/apply-template')
      if (method === 'POST' && applyTemplateMatch) {
        try {
          const body = (await readJson(req)) as ApplyTeamTemplateInput
          const result = await getTeamTemplateService().apply({
            ...body,
            sessionId: applyTemplateMatch.sessionId!,
          })
          send(res, 200, { ...result, snapshot: store.snapshot() })
        } catch (error) {
          send(res, error instanceof TeamTemplateServiceError ? 409 : 400, {
            error: error instanceof Error ? error.message : String(error),
            code: error instanceof TeamTemplateServiceError ? error.code : undefined,
          })
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
        const disabled = new Set(status.settings.disabledProviderIds ?? [])
        return merged.map((p) => {
          const customEntry = status.settings.customProviders?.find((c) => c.id === p.id)
          const isCustom = Boolean(customEntry)
          const rawThinking = (p as { thinkingIntensities?: ThinkingIntensity[] })
            .thinkingIntensities
          // Single source of truth for the enable switch: disabledProviderIds
          // (customProviders.enabled still respected if explicitly false for legacy)
          const enabled =
            !disabled.has(p.id) && (isCustom ? customEntry?.enabled !== false : true)
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
            enabled,
            source: customEntry?.source,
            modelsDevSyncedAt: customEntry?.modelsDevSyncedAt,
            npm: customEntry?.npm,
          }
        })
      }

      // —— Settings / secrets ——
      if (method === 'GET' && path === '/api/settings/danger-zone') {
        send(res, 200, { stats: dangerZoneStats(store.snapshot()) })
        return
      }

      if (method === 'POST' && path === '/api/settings/danger-zone') {
        const body = (await readJson(req)) as { action?: DangerZoneAction }
        const action = body.action
        if (action === 'reset-settings') {
          const openJobs = store.countOpenJobs()
          if (openJobs > 0) {
            const error = new DangerZoneBusyError(openJobs)
            send(res, 409, { error: error.message, code: error.code, openJobs: error.openJobs })
            return
          }
          store.setLocale('zh')
          send(res, 200, {
            ok: true,
            action,
            stats: dangerZoneStats(store.snapshot()),
            snapshot: store.snapshot(),
          })
          return
        }
        if (
          action !== 'clear-workers-and-crews' &&
          action !== 'clear-sessions' &&
          action !== 'clear-cache' &&
          action !== 'reset-all'
        ) {
          send(res, 400, { error: 'Unsupported danger-zone action', code: 'DANGER_ZONE_ACTION' })
          return
        }
        try {
          const outcome = await performDangerZoneAction(action, {
            store,
            runtime: sessionMgr,
            deleteMemoryThreads: async (threadIds) => {
              for (const threadId of threadIds) {
                await leaderMemory.deleteThread(threadId)
              }
            },
          })
          send(res, 200, {
            ok: true,
            action,
            result: outcome.result,
            stats: dangerZoneStats(outcome.snapshot),
            snapshot: outcome.snapshot,
          })
        } catch (error) {
          if (error instanceof DangerZoneBusyError) {
            send(res, 409, { error: error.message, code: error.code, openJobs: error.openJobs })
            return
          }
          sendAcpOrUnexpectedFailure(res, error, `danger-zone ${action}`)
        }
        return
      }

      if (method === 'GET' && path === '/api/settings') {
        const status = getSecretsStatus(SECRET_ENV_KEYS)
        send(res, 200, {
          ...status,
          leaderMaxSteps: status.settings.leaderMaxSteps,
          providers: providersPayload(status),
          customProviders: status.settings.customProviders ?? [],
          storagePath: resolveRouterDataPaths().rootDir,
          modelsDevMeta: loadModelsDevMeta(),
        })
        return
      }

      // —— models.dev catalog (config LKG; not bundled) ——
      if (method === 'GET' && path === '/api/models-dev/providers') {
        const q = typeof url.searchParams.get('q') === 'string' ? url.searchParams.get('q')! : ''
        const status = getSecretsStatus(SECRET_ENV_KEYS)
        const builtinIds = MASTRA_PROVIDERS.map((p) => p.id)
        const customIds = (status.settings.customProviders ?? []).map((c) => c.id)
        const { providers, meta } = listModelsDevProviders({
          q,
          ownedIds: [...builtinIds, ...customIds],
        })
        send(res, 200, {
          providers,
          meta,
          catalogAvailable: Boolean(meta),
        })
        return
      }

      if (method === 'POST' && path === '/api/models-dev/refresh') {
        // Public catalog only (config models-dev/ LKG). Safe in Desktop API child
        // (SECRETS_PARENT_INJECTED) — does not touch secrets.enc.
        // body.source === 'npm-snapshot': hot-install @opencode-ai/models@latest via
        // configured npm registry and apply package snapshot (no models.dev HTTP).
        const body = (await readJson(req).catch(() => ({}))) as { source?: string }
        const source = typeof body?.source === 'string' ? body.source.trim() : ''

        if (source === 'npm-snapshot') {
          try {
            const settings = loadSettings()
            const registry =
              typeof settings.npmRegistry === 'string' && settings.npmRegistry.trim()
                ? settings.npmRegistry.trim()
                : undefined
            const result = await installAndApplyModelsDevNpmSnapshot({
              registry,
              timeoutMs: 180_000,
            })
            send(res, 200, { ok: true, ...result })
          } catch (e) {
            send(res, 502, {
              error:
                e instanceof Error
                  ? e.message
                  : 'Failed to install @opencode-ai/models snapshot',
              code: 'MODELS_DEV_NPM_SNAPSHOT_FAILED',
              npmSnapshotSuggested: true,
            })
          }
          return
        }

        try {
          const result = await refreshModelsDevCatalog()
          send(res, 200, { ok: true, via: 'models.dev', ...result })
        } catch (e) {
          send(res, 502, {
            error: e instanceof Error ? e.message : 'Failed to refresh models.dev catalog',
            code: 'MODELS_DEV_REFRESH_FAILED',
            /** Desktop should prompt to hot-install @opencode-ai/models snapshot. */
            npmSnapshotSuggested: true,
          })
        }
        return
      }

      if (method === 'POST' && path === '/api/models-dev/import') {
        // Writes settings.json customProviders only; keys still via Desktop secret path.
        // Allowed under SECRETS_PARENT_INJECTED (unlike bulk /api/settings which needs owner restart).
        const body = (await readJson(req)) as { providerId?: string }
        const providerId = typeof body.providerId === 'string' ? body.providerId.trim() : ''
        if (!providerId) {
          send(res, 400, { error: 'providerId required', code: 'PROVIDER_ID_REQUIRED' })
          return
        }
        const prev = loadSettings()
        const built = buildCustomProviderFromModelsDev({
          providerId,
          builtinIds: MASTRA_PROVIDERS.map((p) => p.id),
          existingCustomIds: (prev.customProviders ?? []).map((c) => c.id),
        })
        if (!built.ok) {
          const status =
            built.code === 'NOT_FOUND' || built.code === 'NO_CATALOG'
              ? 404
              : built.code === 'BUILTIN_CONFLICT' || built.code === 'ALREADY_ADDED'
                ? 409
                : 400
          send(res, status, { error: built.message, code: built.code })
          return
        }
        const nextList = [...(prev.customProviders ?? []), built.provider]
        const nextSettings = saveSettings({
          ...prev,
          customProviders: nextList,
        })
        applyCustomProviderEnv(nextSettings.customProviders, process.env)
        applySecretsToEnv(process.env)
        const status = getSecretsStatus([
          ...SECRET_ENV_KEYS,
          ...(nextSettings.customProviders ?? []).map((c) => c.apiKeyEnv),
        ])
        globalActivityLog.append('system', 'models.dev provider imported', {
          providerId: built.provider.id,
          models: built.provider.models.length,
        })
        send(res, 200, {
          ok: true,
          provider: built.provider,
          ...status,
          providers: providersPayload(status),
          customProviders: nextSettings.customProviders ?? [],
        })
        return
      }

      {
        const logoMatch = path.match(/^\/api\/provider-logos\/([^/]+)$/)
        if (method === 'GET' && logoMatch) {
          const providerId = decodeURIComponent(logoMatch[1] ?? '')
          if (!providerId) {
            send(res, 400, { error: 'provider id required' })
            return
          }
          const { svg } = await ensureProviderLogoCached({ providerId })
          if (!svg) {
            send(res, 404, { error: 'logo not available', code: 'LOGO_NOT_FOUND' })
            return
          }
          res.writeHead(200, {
            'Content-Type': 'image/svg+xml; charset=utf-8',
            'Cache-Control': 'private, max-age=86400',
            ...corsFor(req),
          })
          res.end(svg)
          return
        }
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
          prompts?: PromptSettings
          workerTimeouts?: WorkerTimeoutSettings
          npmRegistry?: string | null
          secrets?: Record<string, string | null>
          customProviders?: CustomProviderSettings[]
          disabledProviderIds?: string[]
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
        if (body.prompts !== undefined && !isValidPromptSettings(body.prompts)) {
          send(res, 400, { error: 'Complete non-empty prompt settings required' })
          return
        }
        const prev = loadSettings()
        let nextNpmRegistry: string | undefined = prev.npmRegistry
        if (body.npmRegistry !== undefined) {
          try {
            nextNpmRegistry = parseNpmRegistryInput(body.npmRegistry)
          } catch (e) {
            send(res, 400, {
              error: e instanceof Error ? e.message : 'Invalid npmRegistry',
            })
            return
          }
        }
        const nextSettings = saveSettings({
          leaderModel: body.leaderModel?.trim() || prev.leaderModel,
          thinkingIntensity:
            body.thinkingIntensity !== undefined
              ? normalizeThinkingIntensity(body.thinkingIntensity)
              : prev.thinkingIntensity,
          leaderMaxSteps: body.leaderMaxSteps ?? prev.leaderMaxSteps,
          prompts: normalizePromptSettings(body.prompts ?? prev.prompts),
          workerTimeouts:
            body.workerTimeouts !== undefined
              ? parseWorkerTimeoutSettings(body.workerTimeouts)
              : prev.workerTimeouts,
          // empty string clears override (saveSettings normalizes blank → omit)
          npmRegistry: body.npmRegistry !== undefined ? (nextNpmRegistry ?? '') : prev.npmRegistry,
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
          disabledProviderIds:
            body.disabledProviderIds !== undefined
              ? body.disabledProviderIds
              : prev.disabledProviderIds,
        })
        configureWorkerEnvDefaults({ npmRegistry: nextSettings.npmRegistry ?? null })
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
          // Coalesce consecutive assistant messages split by TaskSignalProvider
          // signal drain (each signal rotates the response messageId, creating
          // multiple persisted assistant messages per turn). The frontend expects
          // one bubble per turn; merge them back into a single UI message.
          const coalesced = coalesceAssistantTurns(messages)
          send(res, 200, {
            messages: coalesced,
            threadId,
            resourceId: resourceId ?? null,
            count: coalesced.length,
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

      // —— Compress session context (summarize early history → digest) ——
      // @see packages/mastra-app/src/session-compressor.ts
      const compressContextMatch = match(path, '/api/sessions/:id/compress-context')
      if (method === 'POST' && compressContextMatch) {
        const sessionId = compressContextMatch.id!
        const body = (await readJson(req).catch(() => ({}))) as { keepRecentTurns?: number }
        const session = store.listSessions().find((s) => s.id === sessionId)
        if (!session) {
          send(res, 404, { error: 'session not found', code: 'SESSION_NOT_FOUND' })
          return
        }
        const threadId = session.memoryThreadId
        const boundProjectId = session.projectId
        // Resolve leader model exactly like the chat handler so the summarizer
        // uses the same provider/model/secrets as a normal turn.
        const settings = loadSettings()
        const leaderModelRaw =
          settings.leaderModel || process.env.LEADER_MODEL || DEFAULT_LEADER_MODEL
        const leaderModel = normalizeLeaderModelForMastra(
          normalizeMastraModelId(leaderModelRaw),
          settings.customProviders,
        )
        applySecretsToEnv(process.env)
        const keyInfo = resolveApiKeyEnvsForModel(leaderModel, settings.customProviders)
        if (keyInfo && !hasAnyApiKey(keyInfo.envKeys, process.env)) {
          send(res, 400, {
            code: 'MISSING_API_KEY',
            error: `Missing API key for ${leaderModel}`,
            providerId: keyInfo.providerId,
            envKey: keyInfo.envKeys[0],
          })
          return
        }
        const thinkingIntensity = normalizeThinkingIntensity(
          settings.thinkingIntensity ?? process.env.THINKING_INTENSITY,
        )
        const requestContext = new RequestContext()
        requestContext.set('leaderModel', leaderModel)
        requestContext.set('thinkingIntensity', thinkingIntensity)
        requestContext.set('routerSessionId', session.id)
        requestContext.set('routerProjectId', boundProjectId)
        requestContext.set('memoryThreadId', threadId)
        const routerProject = store.listProjects().find((p) => p.id === boundProjectId)
        if (routerProject) {
          requestContext.set('routerProjectRoot', routerProject.rootPath)
        }
        try {
          const result = await compressSessionContext({
            threadId,
            resourceId: boundProjectId,
            requestContext,
            keepRecentTurns: body.keepRecentTurns,
          })
          if (!result) {
            // Nothing to compress (too few messages) or summarizer declined.
            send(res, 200, { ok: true, skipped: true, reason: 'nothing-to-compress' })
            return
          }
          send(res, 200, {
            ok: true,
            skipped: false,
            summary: result.summary,
            deletedCount: result.deletedMessageIds.length,
            keptRecent: result.keptRecent,
            // Token-footprint delta (estimated via tokenx). freedTokens is the
            // net context saving; the UI can show "freed ~N tokens".
            preCompactTokens: result.preCompactTokens,
            postCompactTokens: result.postCompactTokens,
            freedTokens: Math.max(0, result.preCompactTokens - result.postCompactTokens),
          })
        } catch (e) {
          console.error('[http] compress-context failed', e)
          send(res, 500, {
            error: 'Context compression failed.',
            code: 'COMPRESS_CONTEXT_FAILED',
            detail: e instanceof Error ? e.message : String(e),
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

// Apply Worker spawn defaults (npm registry, …) before accepting traffic.
configureWorkerEnvDefaults({ npmRegistry: loadSettings().npmRegistry ?? null })
// Harvest the user's login-shell PATH once so whichSync resolves binaries the user added in
// ~/.zshrc etc. (the server itself is a non-interactive process that did not source those files).
configureLoginShellPath()

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
