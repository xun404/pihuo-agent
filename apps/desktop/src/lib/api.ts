import type {
  AppSnapshot,
  ApprovalDecision,
  ApprovalItem,
  LeaderMode,
  Locale,
  Project,
  Session,
  WorkerRegistration,
  WorkerRole,
} from '@router-agents/shared'

const BASE = import.meta.env.VITE_MASTRA_URL ?? 'http://localhost:4111'

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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${res.status} ${path}: ${text}`)
  }
  return res.json() as Promise<T>
}

export const api = {
  base: BASE,
  snapshot: () => request<AppSnapshot>('/api/snapshot'),
  /** Optional debug helper — primary path is createProject by rootPath */
  seedDemo: () =>
    request<{ project: Project; session: Session; snapshot: AppSnapshot }>(
      '/api/demo/seed',
      { method: 'POST' },
    ),
  createProject: (body: { name?: string; rootPath: string; defaultBranch?: string }) =>
    request<{ project: Project }>('/api/projects', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  createSession: (body: { projectId: string; title: string; mode?: LeaderMode }) =>
    request<{ session: Session }>('/api/sessions', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  activateSession: (id: string) =>
    request<{ session: Session }>(`/api/sessions/${id}/activate`, { method: 'POST' }),
  activateProject: (id: string) =>
    request<{ project: Project; snapshot: AppSnapshot }>(`/api/projects/${id}/activate`, {
      method: 'POST',
    }),
  setSessionMode: (id: string, mode: LeaderMode) =>
    request<{ session: Session }>(`/api/sessions/${id}/mode`, {
      method: 'POST',
      body: JSON.stringify({ mode }),
    }),
  deleteSession: (id: string) =>
    request<{ ok: boolean; snapshot: AppSnapshot }>(`/api/sessions/${id}`, {
      method: 'DELETE',
    }),
  deleteProject: (id: string) =>
    request<{ ok: boolean; snapshot: AppSnapshot }>(`/api/projects/${id}`, {
      method: 'DELETE',
    }),
  listWorkers: () => request<{ workers: WorkerRegistration[] }>('/api/workers'),
  toggleWorker: (id: string, enabled: boolean) =>
    request<{ worker: WorkerRegistration }>(`/api/workers/${id}/toggle`, {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    }),
  healthWorker: (id: string, depth: 'presence' | 'version' | 'acp' = 'version') =>
    request<{
      worker: WorkerRegistration
      report?: WorkerRegistration['healthReport']
      snapshot?: AppSnapshot
    }>(`/api/workers/${id}/health`, {
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
    }>('/api/workers/health', {
      method: 'POST',
      body: JSON.stringify(body ?? { onlyEnabled: true, depth: 'version' }),
    }),
  registerWorker: (body: Partial<WorkerRegistration>) =>
    request<{ worker: WorkerRegistration }>('/api/workers', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  setWorkerRoles: (id: string, body: { primaryRole: WorkerRole; roles: WorkerRole[] }) =>
    request<{ worker: WorkerRegistration }>(`/api/workers/${id}/roles`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  /** Fetch ACP available models (spawns agent briefly); caches on worker; updates health */
  fetchWorkerModels: (id: string) =>
    request<{
      ok: boolean
      models: { modelId: string; name: string; description?: string }[]
      error?: string
      worker?: WorkerRegistration
      snapshot?: AppSnapshot
      cached?: boolean
    }>(`/api/workers/${id}/models`),
  /** Persist preferred ACP model for worker (empty clears) */
  setWorkerModel: (id: string, model: string | null) =>
    request<{ worker: WorkerRegistration; snapshot?: AppSnapshot }>(
      `/api/workers/${id}/model`,
      {
        method: 'POST',
        body: JSON.stringify({ model }),
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
  resolveApproval: (id: string, decision: ApprovalDecision, optionId?: string) =>
    request<{ approval: ApprovalItem; snapshot: AppSnapshot }>(
      `/api/approvals/${id}/resolve`,
      {
        method: 'POST',
        body: JSON.stringify({ decision, optionId }),
      },
    ),
  /** Optional debug helper for approval UI */
  demoApproval: () =>
    request<{ approval: ApprovalItem; snapshot: AppSnapshot }>('/api/approvals/demo', {
      method: 'POST',
    }),
  gitStatus: (projectId?: string) =>
    request<GitStatusResponse>(
      projectId ? `/api/projects/${projectId}/git` : '/api/git',
    ),
  listFiles: (projectId?: string, depth = 3) =>
    request<FilesResponse>(
      projectId
        ? `/api/projects/${projectId}/files?depth=${depth}`
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
        thinkingIntensity?: 'off' | 'low' | 'medium' | 'high' | 'max'
        updatedAt?: string
        customProviders?: {
          id: string
          name: string
          apiKeyEnv: string
          docsUrl?: string
          models: { id: string; label: string }[]
        }[]
      }
      providers: {
        id: string
        name: string
        apiKeyEnv: string
        docsUrl: string
        models: { id: string; label: string; tag?: string }[]
        configured: boolean
        custom?: boolean
      }[]
      customProviders?: {
        id: string
        name: string
        apiKeyEnv: string
        docsUrl?: string
        models: { id: string; label: string }[]
      }[]
      storagePath?: string
    }>('/api/settings'),
  saveSettings: (body: {
    leaderModel?: string
    thinkingIntensity?: 'off' | 'low' | 'medium' | 'high' | 'max'
    secrets?: Record<string, string | null>
    customProviders?: {
      id: string
      name: string
      apiKeyEnv: string
      docsUrl?: string
      models: { id: string; label: string }[]
    }[]
  }) =>
    request<{
      ok: boolean
      configuredKeys: string[]
      settings: {
        leaderModel: string
        thinkingIntensity?: 'off' | 'low' | 'medium' | 'high' | 'max'
      }
      providers: {
        id: string
        name: string
        apiKeyEnv: string
        configured: boolean
        models: { id: string; label: string; tag?: string }[]
        docsUrl: string
        custom?: boolean
      }[]
    }>('/api/settings', { method: 'POST', body: JSON.stringify(body) }),
  deleteSecret: (key: string) =>
    request<{ ok: boolean }>('/api/settings/secrets', {
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
  setGoal: (body: { objective: string; threadId?: string; resourceId?: string; maxRuns?: number }) =>
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
      jobs: import('@router-agents/shared').WorkerJob[]
      busyWorkerIds: string[]
    }>(`/api/jobs${qs ? `?${qs}` : ''}`)
  },
  createJob: (body: {
    task: string
    role?: import('@router-agents/shared').WorkerRole
    workerIdOrKind?: string
    cwd?: string
    sessionId?: string
    wait?: boolean
  }) =>
    request<{
      job: import('@router-agents/shared').WorkerJob
      output?: string
      snapshot?: AppSnapshot
    }>('/api/jobs', { method: 'POST', body: JSON.stringify(body) }),
  getJob: (id: string) =>
    request<{ job: import('@router-agents/shared').WorkerJob }>(`/api/jobs/${id}`),
  cancelJob: (id: string) =>
    request<{ job: import('@router-agents/shared').WorkerJob; snapshot?: AppSnapshot }>(
      `/api/jobs/${id}/cancel`,
      { method: 'POST' },
    ),
  retryJob: (id: string, wait?: boolean) =>
    request<{
      job: import('@router-agents/shared').WorkerJob
      output?: string
      snapshot?: AppSnapshot
    }>(`/api/jobs/${id}/retry`, {
      method: 'POST',
      body: JSON.stringify({ wait }),
    }),
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

export function chatUrl(agentId = 'router-leader'): string {
  return `${BASE}/chat/${agentId}`
}
