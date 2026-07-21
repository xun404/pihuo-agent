import type {
  AppSnapshot,
  ApprovalDecision,
  ApprovalItem,
  LeaderMode,
  Locale,
  Project,
  Session,
  SessionApprovalPolicy,
  WorkerRegistration,
  WorkerRole,
} from '@swarmdesk-agent/shared'
import type { WorkerRegistryCatalog } from './worker-registry'

// Prefer 127.0.0.1 over localhost: on macOS, localhost often resolves to ::1,
// and another process may already own *:4111 (IPv6), shadowing our IPv4 server.
const BASE =
  (typeof window !== 'undefined' && window.routerAgents?.apiBase) ||
  import.meta.env?.VITE_MASTRA_URL ||
  'http://127.0.0.1:4111'

/** Encode every opaque identifier before placing it in a URL path segment. */
export function encodePathSegment(value: string): string {
  return encodeURIComponent(value)
}

/** Desktop bearer — Electron IPC only (desktopToken from runtime.json). */
let desktopToken: string | null =
  (typeof window !== 'undefined' && window.routerAgents?.desktopToken) || null
let desktopTokenPromise: Promise<string | null> | null = null

export function clearDesktopToken(): void {
  desktopToken = null
  desktopTokenPromise = null
}

export async function ensureDesktopToken(force = false): Promise<string | null> {
  if (force) clearDesktopToken()
  if (desktopToken) return desktopToken
  if (typeof window !== 'undefined' && window.routerAgents?.getDesktopToken) {
    if (!desktopTokenPromise) {
      desktopTokenPromise = window.routerAgents
        .getDesktopToken()
        .then((t) => {
          desktopToken = t ?? null
          return desktopToken
        })
        .catch(() => null)
        .finally(() => {
          desktopTokenPromise = null
        })
    }
    return desktopTokenPromise
  }
  return null
}

export interface GitStatusResponse {
  ok: boolean
  isRepo: boolean
  rootPath: string
  branch?: string
  files: { path: string; status: string; index: string; worktree: string }[]
  insertions: number
  deletions: number
  error?: string
}

/** Mirror of @router-agents/core BranchInfo (kept inline to avoid pulling core source into desktop typecheck). */
export interface BranchInfo {
  name: string
  isCurrent: boolean
  upstreamName?: string
  commitHash?: string
  commitTimestampMs?: number
}

export interface BranchListResult {
  ok: boolean
  isRepo: boolean
  headRefType: 'branch' | 'detached'
  currentBranchName: string | null
  branches: BranchInfo[]
  dirtyFileCount: number
  error?: string
}

export type BranchSwitchIssueCode =
  | 'tracked-changes-would-be-overwritten'
  | 'untracked-changes-would-be-overwritten'
  | 'conflicts-present'
  | 'operation-in-progress'
  | 'branch-in-other-worktree'
  | 'target-branch-not-found'
  | 'request-failed'

export interface BranchSwitchIssue {
  code: BranchSwitchIssueCode
  message: string
  paths?: string[]
}

export interface BranchSwitchResult {
  ok: boolean
  action: 'switch' | 'create'
  branchName: string
  didChange: boolean
  issues: BranchSwitchIssue[]
  currentBranchName?: string
  error?: string
}

export interface FileEntryDto {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileEntryDto[]
}

export interface FilesResponse {
  ok: boolean
  rootPath: string
  entries: FileEntryDto[]
  truncated: boolean
  error?: string
}

export type RegistryOperationStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export interface RegistryPrepareResult {
  installationId: string
  installation: {
    installationId: string
    registryId: string
    registryVersion: string
    distribution: string
    status: string
    manifestDigest: string
    observedSha256?: string
    declaredSha256?: string
  }
  command: string
  args: string[]
  distribution: string
  observedSha256?: string
}

export interface RegistryAuthenticateResult {
  worker: WorkerRegistration
}

export interface RegistryOperationSnapshot<T = unknown> {
  operationId: string
  kind: 'prepare' | 'authenticate'
  status: RegistryOperationStatus
  createdAt: string
  updatedAt: string
  events: Array<{
    sequence: number
    at: string
    status: RegistryOperationStatus
    stage: string
    progress?: number
    code?: string
  }>
  result?: T
  code?: string
  error?: string
}

export interface TerminalAuthAttemptStatus {
  attemptId: string
  workerId: string
  methodId: string
  status: 'pending' | 'running' | 'exited' | 'cancelled' | 'failed'
  exitCode: number | null
  phase?: string
  startedAt?: number
  finishedAt?: number
}

function terminalAuthWebSocketUrl(workerId: string, attemptId: string): string {
  const url = new URL(
    `/api/workers/${encodePathSegment(workerId)}/auth-terminal/${encodePathSegment(attemptId)}/ws`,
    BASE,
  )
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}

function terminalAuthWebSocketProtocols(token: string): string[] {
  if (!/^[A-Za-z0-9_-]{32,256}$/u.test(token)) {
    throw new Error('Invalid terminal authentication token')
  }
  return ['ra-auth-v1', `ra-auth-token.${token}`]
}

function boundedRequestSignal(
  signal: AbortSignal | null | undefined,
  timeoutMs: number,
): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

async function request<T>(
  path: string,
  init?: RequestInit,
  retried = false,
  timeoutMs = 30_000,
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined),
  }
  const tok = await ensureDesktopToken()
  if (tok) {
    headers.Authorization = `Bearer ${tok}`
    headers['X-SwarmDesk-Agent-Desktop-Token'] = tok
  }
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers,
    signal: boundedRequestSignal(init?.signal, timeoutMs),
  })
  if (res.status === 401 && !retried) {
    clearDesktopToken()
    const again = await ensureDesktopToken(true)
    if (again) return request(path, init, true, timeoutMs)
  }
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${res.status} ${path}: ${text}`)
  }
  return res.json() as Promise<T>
}

export const api = {
  base: BASE,
  snapshot: (signal?: AbortSignal) =>
    request<AppSnapshot>('/api/snapshot', { signal }, false, 10_000),
  createProject: (body: { name?: string; rootPath: string; defaultBranch?: string }) =>
    request<{ project: Project }>('/api/projects', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  createSession: (body: { projectId: string; title?: string; mode?: LeaderMode; memoryThreadId?: string }) =>
    request<{ session: Session; snapshot: AppSnapshot }>('/api/sessions', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  renameSession: (id: string, title: string) =>
    request<{ session: Session; snapshot: AppSnapshot }>(
      `/api/sessions/${encodePathSegment(id)}/rename`,
      {
        method: 'POST',
        body: JSON.stringify({ title }),
      },
    ),
  activateSession: (id: string) =>
    request<{ session: Session }>(`/api/sessions/${encodePathSegment(id)}/activate`, {
      method: 'POST',
    }),
  activateProject: (id: string) =>
    request<{ project: Project; snapshot: AppSnapshot }>(
      `/api/projects/${encodePathSegment(id)}/activate`,
      {
        method: 'POST',
      },
    ),
  setSessionMode: (id: string, mode: LeaderMode) =>
    request<{ session: Session; snapshot: AppSnapshot }>(
      `/api/sessions/${encodePathSegment(id)}/mode`,
      {
        method: 'POST',
        body: JSON.stringify({ mode }),
      },
    ),
  setSessionStatus: (
    id: string,
    status: import('@swarmdesk-agent/shared').Session['status'],
    opts?: { lastChatError?: string | null },
  ) =>
    request<{ session: Session; snapshot: AppSnapshot }>(
      `/api/sessions/${encodePathSegment(id)}/status`,
      {
        method: 'POST',
        body: JSON.stringify({
          status,
          ...(opts && 'lastChatError' in opts ? { lastChatError: opts.lastChatError } : {}),
        }),
      },
    ),
  /** After API key rotation: clear sticky error lamps / lastChatError on all sessions */
  clearSessionChatErrors: () =>
    request<{ ok: boolean; clearedSessionErrors: number; snapshot: AppSnapshot }>(
      '/api/sessions/clear-chat-errors',
      { method: 'POST' },
    ),
  /** Stamp the sidebar lamp read watermark (extinguishes unread error/done lamps) */
  markSessionRead: (id: string, upTo?: string) =>
    request<{ session: Session; snapshot: AppSnapshot }>(
      `/api/sessions/${encodePathSegment(id)}/read`,
      { method: 'POST', body: JSON.stringify(upTo ? { upTo } : {}) },
    ),
  setSessionApprovalPolicy: (id: string, approvalPolicy: SessionApprovalPolicy) =>
    request<{ session: Session; snapshot: AppSnapshot }>(
      `/api/sessions/${encodePathSegment(id)}/approval-policy`,
      {
        method: 'POST',
        body: JSON.stringify({ approvalPolicy }),
      },
    ),
  deleteSession: (id: string) =>
    request<{ ok: boolean; snapshot: AppSnapshot }>(`/api/sessions/${encodePathSegment(id)}`, {
      method: 'DELETE',
    }),
  deleteProject: (id: string) =>
    request<{ ok: boolean; snapshot: AppSnapshot }>(`/api/projects/${encodePathSegment(id)}`, {
      method: 'DELETE',
    }),
  listWorkers: () => request<{ workers: WorkerRegistration[] }>('/api/workers'),
  getWorkerRegistry: (signal?: AbortSignal, refresh = false) =>
    request<WorkerRegistryCatalog>(`/api/workers/registry${refresh ? '?refresh=1' : ''}`, {
      signal,
    }),
  /** Owner prepare: download/materialize Registry agent (no client command). */
  prepareRegistryAgent: (
    body: {
      registryId: string
      version?: string
      distribution: 'npx' | 'uvx' | 'binary'
      manifestDigest: string
      trust?: { explicitNoSha?: boolean; acceptedAt?: string }
    },
    signal?: AbortSignal,
  ) =>
    request<RegistryOperationSnapshot<RegistryPrepareResult>>('/api/workers/registry/prepare', {
      method: 'POST',
      body: JSON.stringify(body),
      signal,
    }),
  getRegistryOperation: <T = RegistryPrepareResult>(operationId: string, signal?: AbortSignal) =>
    request<RegistryOperationSnapshot<T>>(
      `/api/workers/registry/operations/${encodePathSegment(operationId)}`,
      { signal },
    ),
  cancelRegistryOperation: <T = RegistryPrepareResult>(operationId: string, signal?: AbortSignal) =>
    request<RegistryOperationSnapshot<T>>(
      `/api/workers/registry/operations/${encodePathSegment(operationId)}`,
      { method: 'DELETE', signal },
    ),
  /** Owner register: materialize Worker from installation + catalog only. */
  registerRegistryWorker: (
    body: {
      registryId: string
      version: string
      distribution: 'npx' | 'uvx' | 'binary'
      manifestDigest: string
      installationId: string
      name?: string
      primaryRole?: WorkerRole
      roles?: WorkerRole[]
      enabled?: boolean
    },
    signal?: AbortSignal,
  ) =>
    request<{ worker: WorkerRegistration; snapshot?: AppSnapshot }>(
      '/api/workers/registry/register',
      {
        method: 'POST',
        body: JSON.stringify(body),
        signal,
      },
    ),
  getWorkerReadiness: (id: string, signal?: AbortSignal) =>
    request<{
      workerId: string
      readiness: WorkerRegistration['readiness']
      capabilitySummary: WorkerRegistration['capabilitySummary']
      authRevision: number
      secretKeys: string[]
      dispatchable: boolean
      gate: { ok: boolean; code?: string; message?: string; nextAction?: string }
    }>(`/api/workers/${encodePathSegment(id)}/readiness`, { signal }),
  getWorkerAuthMethods: (id: string, signal?: AbortSignal) =>
    request<{
      workerId: string
      methods: Array<{
        id: string
        name: string
        type: 'agent' | 'terminal' | 'env_var' | 'unsupported'
        description?: string
        envVarNames?: string[]
        terminalEnvNames?: string[]
      }>
    }>(`/api/workers/${encodePathSegment(id)}/auth-methods`, { signal }),
  authenticateRegistryWorker: (id: string, methodId: string, signal?: AbortSignal) =>
    request<RegistryOperationSnapshot<RegistryAuthenticateResult>>(
      `/api/workers/${encodePathSegment(id)}/authenticate`,
      {
        method: 'POST',
        body: JSON.stringify({ methodId }),
        signal,
      },
    ),
  probeRegistryWorker: (id: string, signal?: AbortSignal) =>
    request<{ worker: WorkerRegistration }>(
      `/api/workers/${encodePathSegment(id)}/probe`,
      { method: 'POST', signal },
      false,
      60_000,
    ),
  setWorkerSecret: (id: string, envName: string, value: string, signal?: AbortSignal) =>
    request<{
      workerId: string
      configuredKeys: string[]
      revision: number
      authRevision?: number
    }>(`/api/workers/${encodePathSegment(id)}/secrets`, {
      method: 'POST',
      body: JSON.stringify({ envName, value }),
      signal,
    }),
  createTerminalAuthAttempt: (id: string, methodId: string, signal?: AbortSignal) =>
    request<{
      attemptId: string
      token: string
      expiresAt: string
      commandPreview: { command: string; args: string[] }
      ptyReady: boolean
    }>(`/api/workers/${encodePathSegment(id)}/auth-terminal`, {
      method: 'POST',
      body: JSON.stringify({ methodId }),
      signal,
    }),
  getTerminalAuthAttemptStatus: (id: string, attemptId: string, signal?: AbortSignal) =>
    request<TerminalAuthAttemptStatus>(
      `/api/workers/${encodePathSegment(id)}/auth-terminal/${encodePathSegment(attemptId)}`,
      { signal },
    ),
  terminalAuthWebSocketUrl,
  terminalAuthWebSocketProtocols,
  toggleWorker: (id: string, enabled: boolean) =>
    request<{ worker: WorkerRegistration }>(`/api/workers/${encodePathSegment(id)}/toggle`, {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    }),
  healthWorker: (id: string, depth: 'presence' | 'version' | 'acp' = 'version') =>
    request<{
      worker: WorkerRegistration
      report?: WorkerRegistration['healthReport']
      snapshot?: AppSnapshot
    }>(`/api/workers/${encodePathSegment(id)}/health`, {
      method: 'POST',
      body: JSON.stringify({ depth }),
    }),
  healthWorkers: (body?: {
    workerIds?: string[]
    depth?: 'presence' | 'version' | 'acp'
    onlyEnabled?: boolean
  }) =>
    request<{
      results: { workerId: string; report: NonNullable<WorkerRegistration['healthReport']> }[]
      summary: Record<string, number>
      workers: WorkerRegistration[]
      snapshot?: AppSnapshot
    }>(
      '/api/workers/health',
      {
        method: 'POST',
        body: JSON.stringify(body ?? { onlyEnabled: true, depth: 'version' }),
      },
      false,
      120_000,
    ),
  registerWorker: (body: Partial<WorkerRegistration>) =>
    request<{ worker: WorkerRegistration }>('/api/workers', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  /** Detect ACP CLIs on this machine; apply=true enables/updates workers */
  detectWorkers: (body?: { apply?: boolean; autoDisableMissing?: boolean }) =>
    request<{
      candidates: {
        kind: string
        name: string
        installed: boolean
        detectVia: string
        command: string
        args: string[]
        installHint: string
        docsUrl?: string
      }[]
      recommended: { kind: string; name: string; installed: boolean; installHint: string }[]
      enabled?: string[]
      applied?: boolean
      firstRun?: boolean
      snapshot?: AppSnapshot
      workers?: WorkerRegistration[]
    }>('/api/workers/detect', {
      method: 'POST',
      body: JSON.stringify(body ?? { apply: true }),
    }),
  getWorkerDetect: () =>
    request<{
      candidates: {
        kind: string
        name: string
        installed: boolean
        installHint: string
        docsUrl?: string
      }[]
      recommended: { kind: string; name: string; installed: boolean }[]
      firstRun: boolean
    }>('/api/workers/detect'),
  setWorkerRoles: (id: string, body: { primaryRole: WorkerRole; roles: WorkerRole[] }) =>
    request<{ worker: WorkerRegistration }>(`/api/workers/${encodePathSegment(id)}/roles`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  /** Fetch ACP available models (spawns agent briefly); caches on worker; updates health */
  fetchWorkerModels: (
    id: string,
    opts?: { q?: string; force?: boolean; limit?: number; projectId?: string | null },
  ) => {
    const params = new URLSearchParams()
    if (opts?.q?.trim()) params.set('q', opts.q.trim())
    if (opts?.force) params.set('force', '1')
    if (opts?.limit != null) params.set('limit', String(opts.limit))
    if (opts?.projectId) params.set('projectId', opts.projectId)
    const qs = params.toString()
    return request<{
      ok: boolean
      models: { modelId: string; name: string; description?: string }[]
      error?: string
      errorCode?: string
      worker?: WorkerRegistration
      snapshot?: AppSnapshot
      cached?: boolean
      stale?: boolean
      catalogState?: 'empty' | 'fresh' | 'stale'
      search?: boolean
      currentPinState?: {
        modelId: string
        status: 'available' | 'unavailable' | 'unknown'
        reasonCode?: string
      }
    }>(
      `/api/workers/${encodePathSegment(id)}/models${qs ? `?${qs}` : ''}`,
      undefined,
      false,
      310_000,
    )
  },
  /** Persist preferred ACP model for worker (empty clears) */
  setWorkerModel: (id: string, model: string | null, projectId?: string | null) =>
    request<{ worker: WorkerRegistration; snapshot?: AppSnapshot }>(
      `/api/workers/${encodePathSegment(id)}/model`,
      {
        method: 'POST',
        body: JSON.stringify({ model, projectId: projectId || undefined }),
      },
    ),
  setLocale: (locale: Locale) =>
    request<{ locale: Locale; snapshot: AppSnapshot }>('/api/locale', {
      method: 'POST',
      body: JSON.stringify({ locale }),
    }),
  listApprovals: (pendingOnly = false) =>
    request<{ approvals: ApprovalItem[] }>(
      pendingOnly ? '/api/approvals?pending=1' : '/api/approvals',
    ),
  resolveApproval: (
    id: string,
    decision: ApprovalDecision,
    optionId?: string,
    surface?: 'chat' | 'panel',
  ) =>
    request<{ approval: ApprovalItem; snapshot: AppSnapshot }>(
      `/api/approvals/${encodePathSegment(id)}/resolve`,
      {
        method: 'POST',
        body: JSON.stringify({ decision, optionId, surface }),
      },
    ),
  resetAcpContext: (jobId: string) =>
    request<{ ok: boolean; snapshot: AppSnapshot; deleted?: boolean }>(
      `/api/jobs/${encodePathSegment(jobId)}/acp-context/reset`,
      { method: 'POST' },
    ),
  getModelsCatalog: (opts?: { featured?: boolean; current?: string; refresh?: boolean }) => {
    // refresh=true is admin write path — use POST /api/models/catalog/refresh
    if (opts?.refresh) {
      return request<{
        providers?: unknown[]
        catalogMode?: string
        featured?: Array<{ id: string; label?: string; sort?: number; tag?: string }>
        currentSelection?: {
          id: string
          status: 'featured' | 'not_featured' | 'registry_unknown'
        } | null
        ok?: boolean
        synced?: boolean
        source?: string
      }>('/api/models/catalog/refresh', { method: 'POST' })
    }
    const params = new URLSearchParams()
    if (opts?.featured) params.set('featured', '1')
    if (opts?.current) params.set('current', opts.current)
    const qs = params.toString()
    return request<{
      providers?: unknown[]
      catalogMode?: string
      featured?: Array<{ id: string; label?: string; sort?: number; tag?: string }>
      currentSelection?: {
        id: string
        status: 'featured' | 'not_featured' | 'registry_unknown'
      } | null
    }>(`/api/models/catalog${qs ? `?${qs}` : ''}`)
  },
  refreshModelsCatalog: () =>
    request<{
      ok: boolean
      synced: boolean
      source: string
      providers: unknown[]
    }>('/api/models/catalog/refresh', { method: 'POST' }),
  gitStatus: (projectId?: string) =>
    request<GitStatusResponse>(
      projectId ? `/api/projects/${encodePathSegment(projectId)}/git` : '/api/git',
    ),
  listBranches: (projectId: string) =>
    request<BranchListResult>(
      `/api/projects/${encodePathSegment(projectId)}/branches`,
    ),
  switchBranch: (projectId: string, targetBranchName: string) =>
    request<BranchSwitchResult>(
      `/api/projects/${encodePathSegment(projectId)}/branches/switch`,
      { method: 'POST', body: JSON.stringify({ targetBranchName }) },
    ),
  createBranchAndSwitch: (projectId: string, branchName: string, startPoint?: string) =>
    request<BranchSwitchResult>(
      `/api/projects/${encodePathSegment(projectId)}/branches/create`,
      { method: 'POST', body: JSON.stringify({ branchName, startPoint }) },
    ),
  commitAndSwitch: (projectId: string, targetBranchName: string, message: string) =>
    request<BranchSwitchResult>(
      `/api/projects/${encodePathSegment(projectId)}/branches/commit-and-switch`,
      { method: 'POST', body: JSON.stringify({ targetBranchName, message }) },
    ),
  listFiles: (projectId?: string, depth = 3) =>
    request<FilesResponse>(
      projectId
        ? `/api/projects/${encodePathSegment(projectId)}/files?depth=${depth}`
        : `/api/files?depth=${depth}`,
    ),
  activity: (limit = 50) =>
    request<{
      events: {
        id: string
        at: string
        kind: string
        message: string
        meta?: Record<string, unknown>
      }[]
    }>(`/api/activity?limit=${limit}`),
  getSettings: () =>
    request<{
      configuredKeys: string[]
      storage: string
      settings: {
        leaderModel: string
        thinkingIntensity?: 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
        leaderMaxSteps?: number
        updatedAt?: string
        customProviders?: {
          id: string
          name: string
          apiKeyEnv: string
          docsUrl?: string
          baseURL?: string
          apiStyle?: 'openai' | 'anthropic' | 'google' | 'custom'
          thinkingIntensities?: ('off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max')[]
          models: {
            id: string
            label: string
            contextWindow?: number
            thinkingIntensities?: ('off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max')[]
          }[]
        }[]
      }
      leaderMaxSteps?: number
      providers: {
        id: string
        name: string
        apiKeyEnv: string
        docsUrl: string
        models: {
          id: string
          label: string
          tag?: string
          contextWindow?: number
          thinkingIntensities?: ('off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max')[]
        }[]
        configured: boolean
        custom?: boolean
        thinkingIntensities?: ('off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max')[]
      }[]
      customProviders?: {
        id: string
        name: string
        apiKeyEnv: string
        docsUrl?: string
        baseURL?: string
        apiStyle?: 'openai' | 'anthropic' | 'google' | 'custom'
        thinkingIntensities?: ('off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max')[]
        models: {
          id: string
          label: string
          contextWindow?: number
          thinkingIntensities?: ('off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max')[]
        }[]
      }[]
      storagePaths?: { root: string; data: string; cache: string }
    }>('/api/settings'),
  saveSettings: (body: {
    leaderModel?: string
    thinkingIntensity?: 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
    leaderMaxSteps?: number
    secrets?: Record<string, string | null>
    customProviders?: {
      id: string
      name: string
      apiKeyEnv: string
      docsUrl?: string
      baseURL?: string
      apiStyle?: 'openai' | 'anthropic' | 'google' | 'custom'
      thinkingIntensities?: ('off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max')[]
      models: {
        id: string
        label: string
        contextWindow?: number
        thinkingIntensities?: ('off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max')[]
      }[]
    }[]
  }) =>
    request<{
      ok: boolean
      configuredKeys: string[]
      settings: {
        leaderModel: string
        thinkingIntensity?: 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
        leaderMaxSteps?: number
      }
      providers: {
        id: string
        name: string
        apiKeyEnv: string
        configured: boolean
        models: {
          id: string
          label: string
          tag?: string
          contextWindow?: number
          thinkingIntensities?: ('off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max')[]
        }[]
        docsUrl: string
        custom?: boolean
        thinkingIntensities?: ('off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max')[]
      }[]
      clearedSessionErrors?: number
      snapshot?: AppSnapshot
    }>('/api/settings', { method: 'POST', body: JSON.stringify(body) }),
  deleteSecret: (key: string) =>
    request<{
      ok: boolean
      clearedSessionErrors?: number
      snapshot?: AppSnapshot
    }>('/api/settings/secrets', {
      method: 'DELETE',
      body: JSON.stringify({ key }),
    }),
  getGoal: (threadId?: string) =>
    request<{
      objective: {
        objective?: string
        status?: string
        runsUsed?: number
        maxRuns?: number
      } | null
      threadId: string | null
      error?: string
    }>(threadId ? `/api/goals?threadId=${encodeURIComponent(threadId)}` : '/api/goals'),
  setGoal: (body: {
    objective: string
    threadId?: string
    resourceId?: string
    maxRuns?: number
  }) =>
    request<{ ok: boolean; objective: unknown; threadId: string }>('/api/goals', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  clearGoal: (threadId?: string) =>
    request<{ ok: boolean; threadId: string }>('/api/goals', {
      method: 'DELETE',
      body: JSON.stringify({ threadId }),
    }),
  controllerStatus: () =>
    request<{
      id: string
      modes: { id: string; name: string; default?: boolean }[]
      agentId: string
      storage: string
      docs: string
    }>('/api/controller'),
  memoryStatus: () =>
    request<{
      lastMessages: number
      workingMemory: boolean
      semanticRecall: boolean
      observationalMemory: boolean
      storage: string
      docs: string
    }>('/api/memory/status'),
  listJobs: (opts?: { sessionId?: string; status?: string; limit?: number }) => {
    const q = new URLSearchParams()
    if (opts?.sessionId) q.set('sessionId', opts.sessionId)
    if (opts?.status) q.set('status', opts.status)
    if (opts?.limit) q.set('limit', String(opts.limit))
    const qs = q.toString()
    return request<{
      jobs: import('@swarmdesk-agent/shared').WorkerJob[]
      busyWorkerIds: string[]
    }>(`/api/jobs${qs ? `?${qs}` : ''}`)
  },
  createJob: (body: {
    task: string
    role?: import('@swarmdesk-agent/shared').WorkerRole
    workerIdOrKind?: string
    cwd?: string
    sessionId?: string
    wait?: boolean
  }) =>
    request<{
      job: import('@swarmdesk-agent/shared').WorkerJob
      output?: string
      snapshot?: AppSnapshot
    }>('/api/jobs', { method: 'POST', body: JSON.stringify(body) }, false, 600_000),
  getJob: (id: string) =>
    request<{ job: import('@swarmdesk-agent/shared').WorkerJob }>(
      `/api/jobs/${encodePathSegment(id)}`,
    ),
  cancelJob: (id: string) =>
    request<{ job: import('@swarmdesk-agent/shared').WorkerJob; snapshot?: AppSnapshot }>(
      `/api/jobs/${encodePathSegment(id)}/cancel`,
      { method: 'POST' },
    ),
  retryJob: (id: string, wait?: boolean) =>
    request<{
      job: import('@swarmdesk-agent/shared').WorkerJob
      output?: string
      snapshot?: AppSnapshot
    }>(
      `/api/jobs/${encodePathSegment(id)}/retry`,
      {
        method: 'POST',
        body: JSON.stringify({ wait }),
      },
      false,
      600_000,
    ),
  /** Load Mastra Memory history as AI SDK UI messages for a session thread */
  getThreadMessages: (threadId: string, resourceId?: string) => {
    const q = new URLSearchParams({ threadId })
    if (resourceId) q.set('resourceId', resourceId)
    return request<{
      messages: Array<{
        id: string
        role: string
        parts: Array<{ type: string; [k: string]: unknown }>
      }>
      threadId: string
      resourceId: string | null
      count?: number
      error?: string
    }>(`/api/memory/messages?${q.toString()}`)
  },
}

export function chatUrl(agentId = 'swarmdesk-leader'): string {
  return `${BASE}/chat/${encodePathSegment(agentId)}`
}
