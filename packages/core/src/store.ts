import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import type {
  AppSnapshot,
  Project,
  Session,
  WorkerRegistration,
  LeaderMode,
  Locale,
  WorkerRole,
  ApprovalItem,
  ApprovalDecision,
  WorkerJob,
  JobStatus,
} from '@router-agents/shared'
import {
  DEFAULT_WORKERS,
  JOB_HISTORY_LIMIT,
  JOB_OUTPUT_MAX_CHARS,
  isJobOpen,
  normalizeWorkerHealth,
  normalizeWorkerRoles,
} from '@router-agents/shared'
import { createId } from './id.js'
import {
  enqueueApproval,
  listPendingApprovals,
  resolveApprovalInQueue,
  type EnqueueApprovalInput,
} from './approvals.js'
import { globalApprovalWaiters } from './approval-wait.js'
import { globalActivityLog } from './activity.js'
import { dedupeProjectsByRoot, normalizeProjectRoot } from './path-normalize.js'

const DEFAULT_PATH = join(homedir(), '.router-agents', 'state.json')

function now(): string {
  return new Date().toISOString()
}

function emptySnapshot(): AppSnapshot {
  const workers: WorkerRegistration[] = DEFAULT_WORKERS.map((w) => ({
    ...w,
    id: createId('worker'),
    enabled: true,
    scope: 'global' as const,
    health: 'unknown' as const,
  }))

  return {
    projects: [],
    sessions: [],
    workers,
    approvals: [],
    jobs: [],
    activeProjectId: null,
    activeSessionId: null,
    locale: 'zh',
  }
}

function migrateSnapshot(raw: Partial<AppSnapshot>): AppSnapshot {
  const base = emptySnapshot()
  const workers = (raw.workers ?? base.workers).map((w) => {
    const n = normalizeWorkerRoles(w as WorkerRegistration)
    const withHealth = normalizeWorkerHealth({
      ...w,
      primaryRole: n.primaryRole,
      roles: n.roles,
      capabilities: w.capabilities ?? [],
      enabled: w.enabled ?? true,
      scope: w.scope ?? 'global',
      health: w.health ?? 'unknown',
      args: w.args ?? [],
      description: w.description ?? '',
    })
    return withHealth as WorkerRegistration
  })

  const projects = dedupeProjectsByRoot(
    (raw.projects ?? []).map((p) => ({
      ...p,
      rootPath: normalizeProjectRoot(p.rootPath),
    })),
  )
  const projectIds = new Set(projects.map((p) => p.id))
  const sessions = (raw.sessions ?? []).filter((s) => projectIds.has(s.projectId))
  let activeProjectId = raw.activeProjectId ?? null
  if (activeProjectId && !projectIds.has(activeProjectId)) {
    activeProjectId = projects[0]?.id ?? null
  }
  let activeSessionId = raw.activeSessionId ?? null
  if (activeSessionId && !sessions.some((s) => s.id === activeSessionId)) {
    activeSessionId = sessions[0]?.id ?? null
  }

  const jobs = Array.isArray(raw.jobs)
    ? (raw.jobs as WorkerJob[]).slice(0, JOB_HISTORY_LIMIT)
    : []

  return {
    projects,
    sessions,
    workers,
    approvals: Array.isArray(raw.approvals) ? raw.approvals : [],
    jobs,
    activeProjectId,
    activeSessionId,
    locale: raw.locale === 'en' || raw.locale === 'zh' ? raw.locale : 'zh',
  }
}

export class LocalStore {
  private path: string
  private data: AppSnapshot

  constructor(path = process.env.ROUTER_AGENTS_STATE ?? DEFAULT_PATH) {
    this.path = path
    this.data = this.load()
    // Persist migration (path normalize / project dedupe) so disk matches memory
    try {
      this.save()
    } catch {
      /* ignore first-run write issues */
    }
  }

  private load(): AppSnapshot {
    try {
      if (!existsSync(this.path)) return emptySnapshot()
      const raw = readFileSync(this.path, 'utf8')
      return migrateSnapshot(JSON.parse(raw) as Partial<AppSnapshot>)
    } catch {
      return emptySnapshot()
    }
  }

  save(): void {
    mkdirSync(dirname(this.path), { recursive: true })
    writeFileSync(this.path, JSON.stringify(this.data, null, 2), 'utf8')
  }

  snapshot(): AppSnapshot {
    return structuredClone(this.data)
  }

  listProjects(): Project[] {
    return this.data.projects
  }

  listSessions(projectId?: string): Session[] {
    if (!projectId) return this.data.sessions
    return this.data.sessions.filter((s) => s.projectId === projectId)
  }

  listWorkers(): WorkerRegistration[] {
    return this.data.workers.map((w) => {
      const n = normalizeWorkerRoles(w)
      return { ...w, primaryRole: n.primaryRole, roles: n.roles }
    })
  }

  listWorkersByRole(role: WorkerRole, enabledOnly = true): WorkerRegistration[] {
    return this.listWorkers().filter((w) => {
      if (enabledOnly && !w.enabled) return false
      return w.roles.includes(role) || w.primaryRole === role
    })
  }

  getActive(): { project: Project | null; session: Session | null } {
    const project =
      this.data.projects.find((p) => p.id === this.data.activeProjectId) ?? null
    const session =
      this.data.sessions.find((s) => s.id === this.data.activeSessionId) ?? null
    return { project, session }
  }

  getLocale(): Locale {
    return this.data.locale ?? 'zh'
  }

  setLocale(locale: Locale): Locale {
    this.data.locale = locale
    this.save()
    return locale
  }

  upsertProject(input: {
    name: string
    rootPath: string
    defaultBranch?: string
  }): Project {
    const rootPath = normalizeProjectRoot(input.rootPath)
    if (!rootPath) throw new Error('rootPath required')

    const existing = this.data.projects.find(
      (p) => normalizeProjectRoot(p.rootPath) === rootPath,
    )
    if (existing) {
      existing.rootPath = rootPath
      if (input.name) existing.name = input.name
      if (input.defaultBranch !== undefined) existing.defaultBranch = input.defaultBranch
      existing.updatedAt = now()
      this.data.activeProjectId = existing.id
      // collapse any accidental duplicates left in memory
      this.data.projects = dedupeProjectsByRoot(this.data.projects)
      this.save()
      return existing
    }

    const project: Project = {
      id: createId('proj'),
      name: input.name || rootPath.split(/[/\\]/).filter(Boolean).pop() || 'project',
      rootPath,
      defaultBranch: input.defaultBranch,
      workerIds: this.data.workers.filter((w) => w.enabled).map((w) => w.id),
      createdAt: now(),
      updatedAt: now(),
    }
    this.data.projects.unshift(project)
    this.data.projects = dedupeProjectsByRoot(this.data.projects)
    this.data.activeProjectId = project.id
    this.save()
    globalActivityLog.append('project', `Opened project ${project.name}`, {
      projectId: project.id,
      rootPath: project.rootPath,
    })
    return project
  }

  deleteProject(projectId: string): void {
    const before = this.data.projects.length
    this.data.projects = this.data.projects.filter((p) => p.id !== projectId)
    this.data.sessions = this.data.sessions.filter((s) => s.projectId !== projectId)
    if (this.data.activeProjectId === projectId) {
      this.data.activeProjectId = this.data.projects[0]?.id ?? null
    }
    if (
      this.data.activeSessionId &&
      !this.data.sessions.some((s) => s.id === this.data.activeSessionId)
    ) {
      this.data.activeSessionId = this.data.sessions[0]?.id ?? null
    }
    this.save()
    if (before !== this.data.projects.length) {
      globalActivityLog.append('project', `Deleted project ${projectId}`, { projectId })
    }
  }

  deleteSession(sessionId: string): void {
    this.data.sessions = this.data.sessions.filter((s) => s.id !== sessionId)
    if (this.data.activeSessionId === sessionId) {
      this.data.activeSessionId = this.data.sessions[0]?.id ?? null
    }
    this.save()
    globalActivityLog.append('session', `Deleted session ${sessionId}`, { sessionId })
  }

  updateSessionMode(sessionId: string, mode: LeaderMode): Session {
    const session = this.data.sessions.find((s) => s.id === sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    session.mode = mode
    session.updatedAt = now()
    this.save()
    return session
  }

  createSession(input: {
    projectId: string
    title: string
    mode?: LeaderMode
  }): Session {
    const project = this.data.projects.find((p) => p.id === input.projectId)
    if (!project) throw new Error(`Project not found: ${input.projectId}`)

    const session: Session = {
      id: createId('sess'),
      projectId: input.projectId,
      title: input.title,
      status: 'idle',
      mode: input.mode ?? 'build',
      activeWorkerIds: [...project.workerIds],
      memoryThreadId: createId('thread'),
      createdAt: now(),
      updatedAt: now(),
    }
    this.data.sessions.unshift(session)
    this.data.activeSessionId = session.id
    this.data.activeProjectId = project.id
    this.save()
    globalActivityLog.append('session', `Created session “${session.title}”`, {
      sessionId: session.id,
      projectId: project.id,
    })
    return session
  }

  setActiveSession(sessionId: string): Session {
    const session = this.data.sessions.find((s) => s.id === sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    this.data.activeSessionId = session.id
    this.data.activeProjectId = session.projectId
    session.updatedAt = now()
    this.save()
    return session
  }

  setActiveProject(projectId: string): Project {
    const project = this.data.projects.find((p) => p.id === projectId)
    if (!project) throw new Error(`Project not found: ${projectId}`)
    this.data.activeProjectId = project.id
    // Prefer a session under this project if current session is elsewhere
    const current = this.data.sessions.find((s) => s.id === this.data.activeSessionId)
    if (!current || current.projectId !== projectId) {
      const next = this.data.sessions.find((s) => s.projectId === projectId)
      this.data.activeSessionId = next?.id ?? null
    }
    project.updatedAt = now()
    this.save()
    return project
  }

  updateSessionStatus(sessionId: string, status: Session['status']): Session {
    const session = this.data.sessions.find((s) => s.id === sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    session.status = status
    session.updatedAt = now()
    this.save()
    return session
  }

  upsertWorker(worker: WorkerRegistration): WorkerRegistration {
    const idx = this.data.workers.findIndex((w) => w.id === worker.id)
    const existing = idx >= 0 ? this.data.workers[idx] : undefined
    // Merge onto existing so partial updates (health-only) don't wipe
    // availableModels / model / modelsFetchedAt that callers forgot to carry.
    const normalized: WorkerRegistration = {
      ...existing,
      ...worker,
      ...normalizeWorkerRoles(worker),
    }
    // null/undefined = caller didn't carry catalog (JSON may store null)
    if (worker.availableModels == null && existing?.availableModels?.length) {
      normalized.availableModels = existing.availableModels
      if (worker.modelsFetchedAt == null && existing.modelsFetchedAt) {
        normalized.modelsFetchedAt = existing.modelsFetchedAt
      }
    }
    if (worker.model == null && existing?.model) {
      normalized.model = existing.model
    }
    if (idx >= 0) this.data.workers[idx] = normalized
    else this.data.workers.push(normalized)
    this.save()
    return normalized
  }

  setWorkerEnabled(workerId: string, enabled: boolean): WorkerRegistration {
    const worker = this.data.workers.find((w) => w.id === workerId)
    if (!worker) throw new Error(`Worker not found: ${workerId}`)
    worker.enabled = enabled
    this.save()
    return normalizeWorkerRoles(worker) as WorkerRegistration
  }

  setWorkerRoles(
    workerId: string,
    input: { primaryRole: WorkerRole; roles: WorkerRole[] },
  ): WorkerRegistration {
    const worker = this.data.workers.find((w) => w.id === workerId)
    if (!worker) throw new Error(`Worker not found: ${workerId}`)
    const roles = input.roles.includes(input.primaryRole)
      ? input.roles
      : [input.primaryRole, ...input.roles]
    worker.primaryRole = input.primaryRole
    worker.roles = roles
    this.save()
    return worker
  }

  /**
   * Set preferred ACP model for a worker (session/set_config_option).
   * Pass empty string / null to clear.
   */
  setWorkerModel(
    workerId: string,
    model: string | null | undefined,
    availableModels?: WorkerRegistration['availableModels'],
  ): WorkerRegistration {
    const worker = this.data.workers.find((w) => w.id === workerId)
    if (!worker) throw new Error(`Worker not found: ${workerId}`)
    const trimmed = typeof model === 'string' ? model.trim() : ''
    if (trimmed) worker.model = trimmed
    else delete worker.model
    if (availableModels) {
      worker.availableModels = availableModels
      worker.modelsFetchedAt = now()
      worker.modelsState = 'fresh'
      delete worker.modelsError
    }
    this.save()
    return worker
  }

  setWorkerAvailableModels(
    workerId: string,
    models: NonNullable<WorkerRegistration['availableModels']>,
    state?: WorkerRegistration['modelsState'],
  ): WorkerRegistration {
    const worker = this.data.workers.find((w) => w.id === workerId)
    if (!worker) throw new Error(`Worker not found: ${workerId}`)
    worker.availableModels = models
    worker.modelsFetchedAt = now()
    worker.modelsState = state ?? 'fresh'
    delete worker.modelsError
    this.save()
    return worker
  }

  setWorkerModelsStale(
    workerId: string,
    error: string,
  ): WorkerRegistration {
    const worker = this.data.workers.find((w) => w.id === workerId)
    if (!worker) throw new Error(`Worker not found: ${workerId}`)
    worker.modelsState = 'stale'
    worker.modelsError = error.slice(0, 500)
    this.save()
    return worker
  }

  listApprovals(status?: ApprovalItem['status']): ApprovalItem[] {
    const all = this.data.approvals ?? []
    if (!status) return all
    return all.filter((a) => a.status === status)
  }

  listPendingApprovals(): ApprovalItem[] {
    return listPendingApprovals(this.data.approvals ?? [])
  }

  enqueueApproval(input: EnqueueApprovalInput): ApprovalItem {
    const { queue, item } = enqueueApproval(this.data.approvals ?? [], input)
    this.data.approvals = queue
    const sessionId = input.sessionId ?? this.data.activeSessionId
    if (sessionId) {
      const session = this.data.sessions.find((s) => s.id === sessionId)
      if (session) {
        session.status = 'needs_approval'
        session.updatedAt = now()
      }
    }
    this.save()
    globalActivityLog.append('approval', `Pending: ${item.title}`, {
      approvalId: item.id,
      workerName: item.workerName,
    })
    return item
  }

  resolveApproval(
    id: string,
    decision: ApprovalDecision,
    optionId?: string,
  ): ApprovalItem {
    const { queue, item } = resolveApprovalInQueue(
      this.data.approvals ?? [],
      id,
      decision,
      optionId,
    )
    this.data.approvals = queue
    if (item.sessionId) {
      this.recomputeSessionStatus(item.sessionId)
    }
    this.save()
    // Unblock ACP onPermissionRequest waiters (if any)
    globalApprovalWaiters.settle(id, decision, optionId ?? item.selectedOptionId)
    globalActivityLog.append('approval', `Resolved ${decision}: ${item.title}`, {
      approvalId: item.id,
      decision,
    })
    return item
  }

  upsertWorkerLogged(worker: WorkerRegistration): WorkerRegistration {
    const w = this.upsertWorker(worker)
    globalActivityLog.append('worker', `Registered/updated worker ${w.name}`, {
      workerId: w.id,
      primaryRole: w.primaryRole,
    })
    return w
  }

  // —— Worker jobs (scheduler) ——

  private ensureJobs(): WorkerJob[] {
    if (!this.data.jobs) this.data.jobs = []
    return this.data.jobs
  }

  private trimJobs(): void {
    const jobs = this.ensureJobs()
    if (jobs.length > JOB_HISTORY_LIMIT) {
      this.data.jobs = jobs.slice(0, JOB_HISTORY_LIMIT)
    }
  }

  listJobs(filter?: {
    sessionId?: string
    workerId?: string
    status?: JobStatus | JobStatus[]
    limit?: number
  }): WorkerJob[] {
    let jobs = [...this.ensureJobs()]
    if (filter?.sessionId) jobs = jobs.filter((j) => j.sessionId === filter.sessionId)
    if (filter?.workerId) jobs = jobs.filter((j) => j.workerId === filter.workerId)
    if (filter?.status) {
      const set = new Set(Array.isArray(filter.status) ? filter.status : [filter.status])
      jobs = jobs.filter((j) => set.has(j.status))
    }
    const limit = filter?.limit ?? 50
    return jobs.slice(0, limit)
  }

  getJob(jobId: string): WorkerJob | undefined {
    return this.ensureJobs().find((j) => j.id === jobId)
  }

  createJob(
    input: Omit<WorkerJob, 'id' | 'createdAt' | 'status'> & { status?: JobStatus },
  ): WorkerJob {
    const job: WorkerJob = {
      ...input,
      id: createId('job'),
      status: input.status ?? 'queued',
      createdAt: now(),
      task: input.task,
      output: input.output ? input.output.slice(0, JOB_OUTPUT_MAX_CHARS) : undefined,
    }
    this.ensureJobs().unshift(job)
    this.trimJobs()
    this.recomputeSessionStatus(job.sessionId)
    this.save()
    if (job.status === 'queued') {
      globalActivityLog.append('dispatch', `Job queued: ${job.workerName}`, {
        jobId: job.id,
        workerId: job.workerId,
        sessionId: job.sessionId,
        role: job.role,
      })
    }
    return job
  }

  updateJob(
    jobId: string,
    patch: Partial<
      Pick<
        WorkerJob,
        | 'status'
        | 'message'
        | 'output'
        | 'error'
        | 'startedAt'
        | 'finishedAt'
        | 'approvalIds'
        | 'workerId'
        | 'workerName'
        | 'meta'
      >
    >,
  ): WorkerJob {
    const jobs = this.ensureJobs()
    const idx = jobs.findIndex((j) => j.id === jobId)
    if (idx < 0) throw new Error(`Job not found: ${jobId}`)
    const prev = jobs[idx]!
    const next: WorkerJob = {
      ...prev,
      ...patch,
      output:
        patch.output !== undefined
          ? patch.output.slice(0, JOB_OUTPUT_MAX_CHARS)
          : prev.output,
    }
    jobs[idx] = next
    this.recomputeSessionStatus(next.sessionId)
    this.save()
    return next
  }

  countOpenJobs(filter?: { workerId?: string; sessionId?: string }): number {
    return this.listJobs({
      workerId: filter?.workerId,
      sessionId: filter?.sessionId,
      status: ['queued', 'running', 'pending_approval'],
      limit: 1000,
    }).length
  }

  /** Derive session status from open jobs + pending approvals */
  recomputeSessionStatus(sessionId: string): Session | undefined {
    const session = this.data.sessions.find((s) => s.id === sessionId)
    if (!session) return undefined
    const pendingApprovals = listPendingApprovals(this.data.approvals ?? []).filter(
      (a) => a.sessionId === sessionId,
    )
    const open = this.listJobs({
      sessionId,
      status: ['queued', 'running', 'pending_approval'],
      limit: 100,
    })
    let status: Session['status'] = 'idle'
    if (pendingApprovals.length > 0 || open.some((j) => j.status === 'pending_approval')) {
      status = 'needs_approval'
    } else if (open.some((j) => j.status === 'running' || j.status === 'queued')) {
      status = 'running'
    } else {
      // recent failure?
      const latest = this.listJobs({ sessionId, limit: 1 })[0]
      if (latest && (latest.status === 'failed' || latest.status === 'timed_out')) {
        const age = Date.now() - Date.parse(latest.finishedAt ?? latest.createdAt)
        if (Number.isFinite(age) && age < 60_000) status = 'error'
      }
    }
    session.status = status
    session.updatedAt = now()
    // Track active workers on session
    const runningWorkerIds = open
      .filter((j) => isJobOpen(j.status))
      .map((j) => j.workerId)
    session.activeWorkerIds = [...new Set(runningWorkerIds)]
    return session
  }
}
