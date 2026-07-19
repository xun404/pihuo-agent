import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  renameSync,
  openSync,
  closeSync,
  fsyncSync,
  unlinkSync,
  chmodSync,
} from 'node:fs'
import { dirname, join } from 'node:path'

import { randomBytes } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
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
  ApprovalOption,
  ApprovalLocation,
  AcpToolKind,
  WorkerJob,
  JobStatus,
  SessionApprovalPolicy,
  WorkerSource,
  WorkerRuntimeProfile,
} from '@router-agents/shared'
import {
  DEFAULT_SESSION_TITLE,
  isPlaceholderSessionTitle,
  DEFAULT_WORKERS,
  JOB_HISTORY_LIMIT,
  JOB_OUTPUT_MAX_CHARS,
  isJobOpen,
  normalizeWorkerHealth,
  normalizeWorkerRoles,
  isValidSessionApprovalPolicy,
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
import { resolveRouterDataPaths } from './router-data-paths.js'

function defaultStatePath(): string {
  return resolveRouterDataPaths().statePath
}

function now(): string {
  return new Date().toISOString()
}

// Title helpers live in @router-agents/shared so the desktop renderer (which
// depends only on shared, not core) can import them too. Re-exported here for
// back-compat with the http-server import path.
export { DEFAULT_SESSION_TITLE, isPlaceholderSessionTitle }

const APPROVAL_OPTION_KINDS = new Set([
  'allow_once',
  'allow_always',
  'reject_once',
  'reject_always',
])

function migrateApprovalItem(value: unknown): ApprovalItem | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (typeof raw.id !== 'string' || typeof raw.title !== 'string') return null

  let hasInvalidOption = !Array.isArray(raw.options) || raw.options.length === 0
  const seenOptionIds = new Set<string>()
  const options: ApprovalOption[] = Array.isArray(raw.options)
    ? raw.options.flatMap((candidate) => {
        if (!candidate || typeof candidate !== 'object') {
          hasInvalidOption = true
          return []
        }
        const option = candidate as Record<string, unknown>
        const optionId = typeof option.optionId === 'string' ? option.optionId.trim() : ''
        if (
          !optionId ||
          typeof option.name !== 'string' ||
          !option.name.trim() ||
          typeof option.kind !== 'string' ||
          !APPROVAL_OPTION_KINDS.has(option.kind) ||
          seenOptionIds.has(optionId)
        ) {
          hasInvalidOption = true
          return []
        }
        seenOptionIds.add(optionId)
        return [
          {
            optionId,
            name: option.name.trim(),
            kind: option.kind as ApprovalOption['kind'],
          },
        ]
      })
    : []

  const currentStatus = ['pending', 'allowed', 'denied', 'cancelled'].includes(String(raw.status))
    ? (raw.status as ApprovalItem['status'])
    : 'cancelled'
  const mustCancel = currentStatus === 'pending' && hasInvalidOption
  const status = mustCancel ? 'cancelled' : currentStatus
  const selectedOptionId =
    typeof raw.selectedOptionId === 'string' ? raw.selectedOptionId : undefined
  const selectedOption = selectedOptionId
    ? options.find((option) => option.optionId === selectedOptionId)
    : undefined

  return {
    ...(raw as unknown as ApprovalItem),
    status,
    options,
    selectedOption: selectedOption ? { ...selectedOption } : undefined,
    ...(mustCancel
      ? {
          decision: 'cancel' as const,
          resolutionSource: 'system' as const,
          resolutionReason: 'Legacy approval had invalid options',
          resolvedAt: typeof raw.resolvedAt === 'string' ? raw.resolvedAt : now(),
        }
      : {}),
  }
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
    revision: 0,
  }
}

/**
 * Backfill source/runtimeProfile for pre-Registry workers.
 * Never auto-bind legacy workers to Registry IDs from command/name.
 */
export function migrateWorkerSourceFields(worker: WorkerRegistration): WorkerRegistration {
  const source: WorkerSource =
    worker.source ??
    (worker.kind === 'claude' || worker.kind === 'codex' || worker.kind === 'opencode'
      ? { type: 'builtin' }
      : { type: 'custom' })
  const runtimeProfile: WorkerRuntimeProfile =
    worker.runtimeProfile ??
    (worker.kind === 'claude' || worker.kind === 'codex' || worker.kind === 'opencode'
      ? worker.kind
      : 'generic-acp')
  return { ...worker, source, runtimeProfile }
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
    return migrateWorkerSourceFields(withHealth as WorkerRegistration)
  })

  const projects = dedupeProjectsByRoot(
    (raw.projects ?? []).map((p) => ({
      ...p,
      rootPath: normalizeProjectRoot(p.rootPath),
    })),
  )
  const projectIds = new Set(projects.map((p) => p.id))
  const sessions = (raw.sessions ?? [])
    .filter((s) => projectIds.has(s.projectId))
    .map((s) => ({
      ...s,
      approvalPolicy: isValidSessionApprovalPolicy((s as Partial<Session>).approvalPolicy)
        ? (s as Partial<Session>).approvalPolicy
        : 'manual',
    })) as Session[]
  let activeProjectId = raw.activeProjectId ?? null
  if (activeProjectId && !projectIds.has(activeProjectId)) {
    activeProjectId = projects[0]?.id ?? null
  }
  let activeSessionId = raw.activeSessionId ?? null
  if (activeSessionId && !sessions.some((s) => s.id === activeSessionId)) {
    activeSessionId = sessions[0]?.id ?? null
  }

  const jobs = Array.isArray(raw.jobs)
    ? ((raw.jobs as Partial<WorkerJob>[]).slice(0, JOB_HISTORY_LIMIT).map((j) => ({
        ...j,
        approvalPolicy: isValidSessionApprovalPolicy(j.approvalPolicy)
          ? j.approvalPolicy
          : 'manual',
      })) as WorkerJob[])
    : []

  return {
    projects,
    sessions,
    workers,
    approvals: Array.isArray(raw.approvals)
      ? raw.approvals.map(migrateApprovalItem).filter((item): item is ApprovalItem => item !== null)
      : [],
    jobs,
    activeProjectId,
    activeSessionId,
    locale: raw.locale === 'en' || raw.locale === 'zh' ? raw.locale : 'zh',
    revision: typeof raw.revision === 'number' && Number.isFinite(raw.revision) ? raw.revision : 0,
  }
}

export type LocalStoreMode = 'owner' | 'readOnly'

export class WorkerStoreConflictError extends Error {
  readonly code = 'WORKER_STORE_CONFLICT'

  constructor(readonly workerId: string) {
    super(`Worker changed during lifecycle operation: ${workerId}`)
    this.name = 'WorkerStoreConflictError'
  }
}

export class LocalStore {
  private path: string
  private data: AppSnapshot
  /** When true, refuse writes after isolating a corrupt on-disk snapshot. */
  private readonly corrupt: boolean
  private readonly mode: LocalStoreMode
  /** In-memory monotonic revision for client race protection (not durability-critical). */
  private revision = 0

  constructor(
    path = process.env.ROUTER_AGENTS_STATE ?? defaultStatePath(),
    opts?: { mode?: LocalStoreMode },
  ) {
    this.path = path
    this.mode = opts?.mode ?? 'owner'
    const loaded = this.load()
    this.data = loaded.data
    this.corrupt = loaded.corrupt
    this.revision = typeof this.data.revision === 'number' ? this.data.revision : 0
    // readOnly never writes (Studio client-only must not create/mutate state.json)
    if (this.mode === 'readOnly') return
    // Persist migration / first create. Owner startup must fail if durability is unavailable.
    if (!this.corrupt) {
      this.save()
    }
  }

  private isolatePath(reason: string): void {
    if (this.mode !== 'owner' || !existsSync(this.path)) return
    try {
      const isolated = `${this.path}.corrupt.${reason}.${Date.now()}.${randomBytes(3).toString('hex')}`
      renameSync(this.path, isolated)
    } catch {
      /* best effort */
    }
  }

  private load(): { data: AppSnapshot; corrupt: boolean } {
    try {
      if (!existsSync(this.path)) return { data: emptySnapshot(), corrupt: false }
      const raw = readFileSync(this.path, 'utf8')
      if (!raw.trim()) {
        // Zero-length / mid-write: isolate so we are not stuck permanently refuse-to-write
        if (this.mode === 'readOnly') return { data: emptySnapshot(), corrupt: true }
        this.isolatePath('empty')
        // Fresh empty after isolation — writable again
        return { data: emptySnapshot(), corrupt: false }
      }
      return {
        data: migrateSnapshot(JSON.parse(raw) as Partial<AppSnapshot>),
        corrupt: false,
      }
    } catch {
      // Isolate corrupt file; fail closed for writes so we never clobber with empty snapshot
      try {
        this.isolatePath('parse')
      } catch {
        /* best effort */
      }
      return { data: emptySnapshot(), corrupt: true }
    }
  }

  /**
   * Copy-on-write transaction: clone → mutator → atomic persist → swap.
   * On persist failure memory is unchanged (draft discarded).
   */
  private commit(mutator: (draft: AppSnapshot) => void): void {
    if (this.mode === 'readOnly') {
      throw new Error('STORE_READ_ONLY: client-only process must not write LocalStore')
    }
    if (this.corrupt) {
      throw new Error('STORE_CORRUPT: refusing to write after isolating a corrupt state file')
    }
    const draft = structuredClone(this.data)
    mutator(draft)
    // Isolate any nested object/array references captured from mutator inputs.
    const candidate = structuredClone(draft)
    const nextRevision = this.revision + 1
    candidate.revision = nextRevision
    this.persistSnapshot(candidate)
    this.data = candidate
    this.revision = nextRevision
  }

  /** Atomic fsync + rename of an explicit snapshot (does not touch this.data). */
  private persistSnapshot(snapshot: AppSnapshot): void {
    const dir = dirname(this.path)
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    const tmp = `${this.path}.tmp.${process.pid}.${randomBytes(4).toString('hex')}`
    const body = JSON.stringify(snapshot, null, 2)
    let fd: number | undefined
    try {
      fd = openSync(tmp, 'w', 0o600)
      writeFileSync(fd, body)
      fsyncSync(fd)
      closeSync(fd)
      fd = undefined
      renameSync(tmp, this.path)
      try {
        const dirFd = openSync(dir, 'r')
        try {
          fsyncSync(dirFd)
        } finally {
          closeSync(dirFd)
        }
      } catch {
        /* windows / unsupported */
      }
      try {
        chmodSync(this.path, 0o600)
      } catch {
        /* best effort */
      }
    } finally {
      if (fd !== undefined) {
        try {
          closeSync(fd)
        } catch {
          /* best effort */
        }
      }
      if (existsSync(tmp)) {
        try {
          unlinkSync(tmp)
        } catch {
          /* best effort */
        }
      }
    }
  }

  /**
   * Persist current in-memory state. Prefer `commit()` for mutations so failed
   * writes do not leave dirty memory. On failure, reloads disk into memory.
   */
  save(): void {
    if (this.mode === 'readOnly') {
      throw new Error('STORE_READ_ONLY: client-only process must not write LocalStore')
    }
    if (this.corrupt) {
      throw new Error('STORE_CORRUPT: refusing to write after isolating a corrupt state file')
    }
    const candidate = structuredClone(this.data)
    const nextRevision = this.revision + 1
    candidate.revision = nextRevision
    this.persistSnapshot(candidate)
    this.data = candidate
    this.revision = nextRevision
  }

  snapshot(): AppSnapshot {
    const snap = structuredClone(this.data)
    snap.revision = this.revision
    return snap
  }

  listProjects(): Project[] {
    return structuredClone(this.data.projects)
  }

  listSessions(projectId?: string): Session[] {
    const all = this.data.sessions
    const filtered = projectId ? all.filter((s) => s.projectId === projectId) : all
    return structuredClone(filtered)
  }

  listWorkers(): WorkerRegistration[] {
    return this.data.workers.map((w) => {
      const n = normalizeWorkerRoles(w)
      return structuredClone({ ...w, primaryRole: n.primaryRole, roles: n.roles })
    })
  }

  listWorkersByRole(role: WorkerRole, enabledOnly = true): WorkerRegistration[] {
    return this.listWorkers().filter((w) => {
      if (enabledOnly && !w.enabled) return false
      return w.roles.includes(role) || w.primaryRole === role
    })
  }

  getActive(): { project: Project | null; session: Session | null } {
    const project = this.data.projects.find((p) => p.id === this.data.activeProjectId) ?? null
    const session = this.data.sessions.find((s) => s.id === this.data.activeSessionId) ?? null
    return {
      project: project ? structuredClone(project) : null,
      session: session ? structuredClone(session) : null,
    }
  }

  getLocale(): Locale {
    return this.data.locale ?? 'zh'
  }

  setLocale(locale: Locale): Locale {
    this.commit((d) => {
      d.locale = locale
    })
    return locale
  }

  upsertProject(input: { name: string; rootPath: string; defaultBranch?: string }): Project {
    const rootPath = normalizeProjectRoot(input.rootPath)
    if (!rootPath) throw new Error('rootPath required')
    let result!: Project
    this.commit((d) => {
      const existing = d.projects.find((p) => normalizeProjectRoot(p.rootPath) === rootPath)
      if (existing) {
        existing.rootPath = rootPath
        if (input.name) existing.name = input.name
        if (input.defaultBranch !== undefined) existing.defaultBranch = input.defaultBranch
        existing.updatedAt = now()
        d.activeProjectId = existing.id
        d.projects = dedupeProjectsByRoot(d.projects)
        result = existing
        return
      }
      const project: Project = {
        id: createId('proj'),
        name: input.name || rootPath.split(/[/\\]/).filter(Boolean).pop() || 'project',
        rootPath,
        defaultBranch: input.defaultBranch,
        workerIds: d.workers.filter((w) => w.enabled).map((w) => w.id),
        createdAt: now(),
        updatedAt: now(),
      }
      d.projects.unshift(project)
      d.projects = dedupeProjectsByRoot(d.projects)
      d.activeProjectId = project.id
      result = project
    })
    globalActivityLog.append('project', `Opened project ${result.name}`, {
      projectId: result.id,
      rootPath: result.rootPath,
    })
    return structuredClone(result)
  }

  deleteProject(projectId: string): void {
    let deleted = false
    this.commit((d) => {
      const before = d.projects.length
      d.projects = d.projects.filter((p) => p.id !== projectId)
      d.sessions = d.sessions.filter((s) => s.projectId !== projectId)
      if (d.activeProjectId === projectId) {
        d.activeProjectId = d.projects[0]?.id ?? null
      }
      if (d.activeSessionId && !d.sessions.some((s) => s.id === d.activeSessionId)) {
        d.activeSessionId = d.sessions[0]?.id ?? null
      }
      deleted = before !== d.projects.length
    })
    if (deleted) {
      globalActivityLog.append('project', `Deleted project ${projectId}`, { projectId })
    }
  }

  deleteSession(sessionId: string): void {
    this.commit((d) => {
      d.sessions = d.sessions.filter((s) => s.id !== sessionId)
      if (d.activeSessionId === sessionId) {
        d.activeSessionId = d.sessions[0]?.id ?? null
      }
    })
    globalActivityLog.append('session', `Deleted session ${sessionId}`, { sessionId })
  }

  updateSessionMode(sessionId: string, mode: LeaderMode): Session {
    let session!: Session
    this.commit((d) => {
      const s = d.sessions.find((x) => x.id === sessionId)
      if (!s) throw new Error(`Session not found: ${sessionId}`)
      s.mode = mode
      s.updatedAt = now()
      session = s
    })
    return structuredClone(session)
  }

  updateSessionApprovalPolicy(sessionId: string, policy: SessionApprovalPolicy): Session {
    if (!isValidSessionApprovalPolicy(policy)) {
      throw new Error(`Invalid approval policy: ${String(policy)}`)
    }
    let session!: Session
    this.commit((d) => {
      const s = d.sessions.find((x) => x.id === sessionId)
      if (!s) throw new Error(`Session not found: ${sessionId}`)
      s.approvalPolicy = policy
      s.updatedAt = now()
      session = s
    })
    return structuredClone(session)
  }

  /**
   * User-driven rename. Always wins, and stamps `titleSource='user'` so future
   * auto-naming (autoTitleSession) will not overwrite it.
   */
  renameSession(sessionId: string, title: string): Session {
    const trimmed = title.trim()
    if (!trimmed) throw new Error('title required')
    let session!: Session
    this.commit((d) => {
      const s = d.sessions.find((x) => x.id === sessionId)
      if (!s) throw new Error(`Session not found: ${sessionId}`)
      s.title = trimmed
      s.titleSource = 'user'
      s.updatedAt = now()
      session = s
    })
    return structuredClone(session)
  }

  /**
   * Leader auto-naming hook, called by chat onFinish after the first task.
   * Returns the updated session, or null if the session was deleted, the
   * caller supplied an empty title, or the session is already user-named
   * (locked) — in all those cases the title is left untouched.
   */
  autoTitleSession(sessionId: string, title: string): Session | null {
    const trimmed = title.trim()
    if (!trimmed) return null
    let session: Session | null = null
    this.commit((d) => {
      const s = d.sessions.find((x) => x.id === sessionId)
      if (!s) return
      // Lock: a user-named session is never auto-overwritten.
      if (s.titleSource === 'user') return
      s.title = trimmed
      s.titleSource = 'auto'
      s.updatedAt = now()
      session = s
    })
    return session ? structuredClone(session) : null
  }

  /**
   * Chat onFinish hook: stamp `lastReplyAt` to the time the assistant finished
   * a reply. The sidebar renders `lastReplyAt ?? createdAt` as the relative
   * time, so this is the only thing that should make a session look "fresh" —
   * opening / renaming / switching mode must not. Also bumps `updatedAt` so the
   * session sorts to the top of recent lists. No-op (returns null) if the
   * session was deleted between stream start and finish.
   */
  markSessionReply(sessionId: string): Session | null {
    let session: Session | null = null
    const ts = now()
    this.commit((d) => {
      const s = d.sessions.find((x) => x.id === sessionId)
      if (!s) return
      s.lastReplyAt = ts
      s.updatedAt = ts
      session = s
    })
    return session ? structuredClone(session) : null
  }

  createSession(input: { projectId: string; title?: string; mode?: LeaderMode }): Session {
    let session!: Session
    this.commit((d) => {
      const project = d.projects.find((p) => p.id === input.projectId)
      if (!project) throw new Error(`Project not found: ${input.projectId}`)
      const providedTitle = input.title?.trim()
      session = {
        id: createId('sess'),
        projectId: input.projectId,
        // Empty/missing title → placeholder; Leader will auto-name on first task.
        title: providedTitle || DEFAULT_SESSION_TITLE,
        // User-supplied titles are locked; placeholder/auto titles may be
        // overwritten by autoTitleSession on first task completion.
        titleSource: providedTitle ? 'user' : 'auto',
        status: 'idle',
        mode: input.mode ?? 'build',
        activeWorkerIds: [...project.workerIds],
        memoryThreadId: createId('thread'),
        approvalPolicy: 'manual',
        createdAt: now(),
        updatedAt: now(),
      }
      d.sessions.unshift(session)
      d.activeSessionId = session.id
      d.activeProjectId = project.id
    })
    globalActivityLog.append('session', `Created session “${session.title}”`, {
      sessionId: session.id,
      projectId: session.projectId,
    })
    return structuredClone(session)
  }

  setActiveSession(sessionId: string): Session {
    let session!: Session
    this.commit((d) => {
      const s = d.sessions.find((x) => x.id === sessionId)
      if (!s) throw new Error(`Session not found: ${sessionId}`)
      d.activeSessionId = s.id
      d.activeProjectId = s.projectId
      s.updatedAt = now()
      session = s
    })
    return structuredClone(session)
  }

  setActiveProject(projectId: string): Project {
    let project!: Project
    this.commit((d) => {
      const p = d.projects.find((x) => x.id === projectId)
      if (!p) throw new Error(`Project not found: ${projectId}`)
      d.activeProjectId = p.id
      const current = d.sessions.find((s) => s.id === d.activeSessionId)
      if (!current || current.projectId !== projectId) {
        const next = d.sessions.find((s) => s.projectId === projectId)
        d.activeSessionId = next?.id ?? null
      }
      p.updatedAt = now()
      project = p
    })
    return structuredClone(project)
  }

  updateSessionStatus(
    sessionId: string,
    status: Session['status'],
    opts?: { lastChatError?: string | null },
  ): Session {
    let session!: Session
    this.commit((d) => {
      const s = d.sessions.find((x) => x.id === sessionId)
      if (!s) throw new Error(`Session not found: ${sessionId}`)
      s.status = status
      s.updatedAt = now()
      if (opts && 'lastChatError' in opts) {
        if (opts.lastChatError) {
          s.lastChatError = opts.lastChatError
          s.lastChatErrorAt = now()
        } else {
          delete s.lastChatError
          delete s.lastChatErrorAt
        }
      } else if (status !== 'error') {
        // Leaving error clears sticky chat error card
        delete s.lastChatError
        delete s.lastChatErrorAt
      }
      session = s
    })
    return structuredClone(session)
  }

  /**
   * Clear sticky chat errors + red lamps after credentials/settings change.
   * Returns how many sessions were cleared.
   */
  clearAllSessionChatErrors(): number {
    let cleared = 0
    this.commit((d) => {
      for (const s of d.sessions) {
        if (s.status === 'error' || s.lastChatError) {
          s.status = 'idle'
          delete s.lastChatError
          delete s.lastChatErrorAt
          s.updatedAt = now()
          cleared += 1
        }
      }
    })
    return cleared
  }

  upsertWorker(worker: WorkerRegistration): WorkerRegistration {
    let normalized!: WorkerRegistration
    this.commit((d) => {
      const idx = d.workers.findIndex((w) => w.id === worker.id)
      const existing = idx >= 0 ? d.workers[idx] : undefined
      normalized = {
        ...existing,
        ...worker,
        ...normalizeWorkerRoles(worker),
      }
      if (worker.availableModels == null && existing?.availableModels?.length) {
        normalized.availableModels = existing.availableModels
        if (worker.modelsFetchedAt == null && existing.modelsFetchedAt) {
          normalized.modelsFetchedAt = existing.modelsFetchedAt
        }
      }
      if (worker.model == null && existing?.model) {
        normalized.model = existing.model
      }
      if (idx >= 0) d.workers[idx] = normalized
      else d.workers.push(normalized)
    })
    return structuredClone(normalized)
  }

  /**
   * Atomically replace one Worker only when its complete persisted value still
   * matches the caller's snapshot. This is the per-Worker Store-revision guard
   * used after async Registry lifecycle work; unrelated Worker writes do not
   * cause false conflicts.
   */
  compareAndSwapWorker(
    expected: WorkerRegistration,
    replacement: WorkerRegistration,
  ): WorkerRegistration {
    let normalized!: WorkerRegistration
    this.commit((d) => {
      const idx = d.workers.findIndex((worker) => worker.id === expected.id)
      if (idx < 0 || !isDeepStrictEqual(d.workers[idx], expected)) {
        throw new WorkerStoreConflictError(expected.id)
      }
      normalized = {
        ...replacement,
        ...normalizeWorkerRoles(replacement),
      }
      d.workers[idx] = normalized
    })
    return structuredClone(normalized)
  }

  /**
   * Atomically remove one Worker only when its complete persisted value still
   * matches the caller's snapshot.
   */
  compareAndRemoveWorker(expected: WorkerRegistration): WorkerRegistration {
    let removed!: WorkerRegistration
    this.commit((d) => {
      const idx = d.workers.findIndex((worker) => worker.id === expected.id)
      if (idx < 0 || !isDeepStrictEqual(d.workers[idx], expected)) {
        throw new WorkerStoreConflictError(expected.id)
      }
      removed = d.workers[idx]!
      d.workers.splice(idx, 1)
    })
    return structuredClone(removed)
  }

  setWorkerEnabled(workerId: string, enabled: boolean): WorkerRegistration {
    let worker!: WorkerRegistration
    this.commit((d) => {
      const w = d.workers.find((x) => x.id === workerId)
      if (!w) throw new Error(`Worker not found: ${workerId}`)
      w.enabled = enabled
      worker = normalizeWorkerRoles(w) as WorkerRegistration
    })
    return structuredClone(worker)
  }

  /**
   * Remove a Worker registration. Does not delete ACP installations;
   * callers should detach installation refs separately.
   */
  removeWorker(workerId: string): WorkerRegistration {
    let removed!: WorkerRegistration
    this.commit((d) => {
      const idx = d.workers.findIndex((x) => x.id === workerId)
      if (idx < 0) throw new Error(`Worker not found: ${workerId}`)
      removed = d.workers[idx]!
      d.workers.splice(idx, 1)
    })
    return structuredClone(removed)
  }

  setWorkerRoles(
    workerId: string,
    input: { primaryRole: WorkerRole; roles: WorkerRole[] },
  ): WorkerRegistration {
    let worker!: WorkerRegistration
    this.commit((d) => {
      const w = d.workers.find((x) => x.id === workerId)
      if (!w) throw new Error(`Worker not found: ${workerId}`)
      const roles = input.roles.includes(input.primaryRole)
        ? input.roles
        : [input.primaryRole, ...input.roles]
      w.primaryRole = input.primaryRole
      w.roles = roles
      worker = w
    })
    return structuredClone(worker)
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
    let worker!: WorkerRegistration
    this.commit((d) => {
      const w = d.workers.find((x) => x.id === workerId)
      if (!w) throw new Error(`Worker not found: ${workerId}`)
      const trimmed = typeof model === 'string' ? model.trim() : ''
      if (trimmed) w.model = trimmed
      else delete w.model
      if (availableModels !== undefined) {
        w.availableModels = availableModels
      }
      worker = w
    })
    return structuredClone(worker)
  }

  setWorkerAvailableModels(
    workerId: string,
    models: NonNullable<WorkerRegistration['availableModels']>,
    state?: WorkerRegistration['modelsState'],
  ): WorkerRegistration {
    let worker!: WorkerRegistration
    this.commit((d) => {
      const w = d.workers.find((x) => x.id === workerId)
      if (!w) throw new Error(`Worker not found: ${workerId}`)
      w.availableModels = models
      w.modelsFetchedAt = now()
      w.modelsState = state ?? 'fresh'
      w.modelCatalogState = state === 'stale' ? 'stale' : 'fresh'
      delete w.modelsError
      worker = w
    })
    return structuredClone(worker)
  }

  setWorkerModelsStale(workerId: string, error: string): WorkerRegistration {
    let worker!: WorkerRegistration
    this.commit((d) => {
      const w = d.workers.find((x) => x.id === workerId)
      if (!w) throw new Error(`Worker not found: ${workerId}`)
      w.modelsState = 'stale'
      w.modelCatalogState = w.availableModels?.length ? 'stale' : 'empty'
      w.modelsError = error.slice(0, 500)
      worker = w
    })
    return structuredClone(worker)
  }

  listApprovals(status?: ApprovalItem['status']): ApprovalItem[] {
    const all = this.data.approvals ?? []
    const filtered = !status ? all : all.filter((a) => a.status === status)
    return structuredClone(filtered)
  }

  listPendingApprovals(): ApprovalItem[] {
    return structuredClone(listPendingApprovals(this.data.approvals ?? []))
  }

  enqueueApproval(input: EnqueueApprovalInput): ApprovalItem {
    let item!: ApprovalItem
    this.commit((d) => {
      const { queue, item: created } = enqueueApproval(d.approvals ?? [], input)
      d.approvals = queue
      item = created
      const sessionId = input.sessionId ?? d.activeSessionId
      if (sessionId) {
        this.recomputeSessionStatusOn(d, sessionId)
      }
    })
    globalActivityLog.append('approval', `Pending: ${item.title}`, {
      approvalId: item.id,
      workerName: item.workerName,
    })
    return structuredClone(item)
  }

  /**
   * Create an approval atomically in resolved state (no pending intermediate).
   * Used by auto-approval path.
   */
  createResolvedApproval(input: {
    title: string
    detail?: string
    action?: string
    pathOrTarget?: string
    workerId?: string
    workerName?: string
    sessionId?: string | null
    source?: ApprovalItem['source']
    option: ApprovalOption
    decision: 'allow' | 'deny'
    reason?: string
    jobId?: string
    toolCallId?: string
    toolKind?: AcpToolKind
    locations?: ApprovalLocation[]
  }): ApprovalItem {
    const resolvedAt = new Date().toISOString()
    const item: ApprovalItem = {
      id: createId('appr'),
      status: input.decision === 'allow' ? 'allowed' : 'denied',
      title: input.title,
      detail: input.detail,
      action: input.action,
      pathOrTarget: input.pathOrTarget,
      workerId: input.workerId,
      workerName: input.workerName,
      sessionId: input.sessionId ?? null,
      options: [{ ...input.option }],
      selectedOptionId: input.option.optionId,
      selectedOption: { ...input.option },
      decision: input.decision,
      source: input.source ?? 'acp',
      resolutionSource: 'policy',
      resolutionReason: input.reason,
      createdAt: new Date().toISOString(),
      resolvedAt,
      jobId: input.jobId,
      toolCallId: input.toolCallId,
      toolKind: input.toolKind,
      locations: input.locations,
    }
    this.commit((d) => {
      d.approvals = [item, ...(d.approvals ?? [])]
      if (item.sessionId) {
        this.recomputeSessionStatusOn(d, item.sessionId)
      }
    })
    globalActivityLog.append('approval', `Auto-resolved ${input.decision}: ${item.title}`, {
      approvalId: item.id,
      decision: input.decision,
    })
    return structuredClone(item)
  }

  resolveApproval(
    id: string,
    decision: ApprovalDecision,
    optionId?: string,
    metadata?: {
      resolutionSource?: ApprovalItem['resolutionSource']
      resolutionReason?: string
    },
  ): ApprovalItem {
    const result = this.tryResolveApproval(id, decision, optionId, metadata)
    if (!result.resolved) {
      throw new Error(`Approval ${id} is already ${result.item.status}`)
    }
    return result.item
  }

  tryResolveApproval(
    id: string,
    decision: ApprovalDecision,
    optionId?: string,
    metadata?: {
      resolutionSource?: ApprovalItem['resolutionSource']
      resolutionReason?: string
    },
  ): { resolved: boolean; item: ApprovalItem } {
    const prev = (this.data.approvals ?? []).find((a) => a.id === id)
    if (!prev) throw new Error(`Approval not found: ${id}`)
    if (prev.status !== 'pending') {
      return { resolved: false, item: structuredClone(prev) }
    }

    let item!: ApprovalItem
    this.commit((d) => {
      const items = d.approvals ?? []
      const { queue, item: resolved } = resolveApprovalInQueue(
        items,
        id,
        decision,
        optionId,
        metadata,
      )
      d.approvals = queue
      item = resolved
      if (item.sessionId) {
        this.recomputeSessionStatusOn(d, item.sessionId)
      }
    })
    globalApprovalWaiters.settle(id, decision, optionId ?? item.selectedOptionId)
    globalActivityLog.append('approval', `Resolved ${decision}: ${item.title}`, {
      approvalId: item.id,
      decision,
    })
    return { resolved: true, item: structuredClone(item) }
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
    let jobs = [...(this.data.jobs ?? [])]
    if (filter?.sessionId) jobs = jobs.filter((j) => j.sessionId === filter.sessionId)
    if (filter?.workerId) jobs = jobs.filter((j) => j.workerId === filter.workerId)
    if (filter?.status) {
      const set = new Set(Array.isArray(filter.status) ? filter.status : [filter.status])
      jobs = jobs.filter((j) => set.has(j.status))
    }
    const limit = filter?.limit ?? 50
    return structuredClone(jobs.slice(0, limit))
  }

  getJob(jobId: string): WorkerJob | undefined {
    const job = (this.data.jobs ?? []).find((j) => j.id === jobId)
    return job ? structuredClone(job) : undefined
  }

  createJob(
    input: Omit<WorkerJob, 'id' | 'createdAt' | 'status' | 'approvalPolicy'> & {
      status?: JobStatus
      approvalPolicy?: SessionApprovalPolicy
    },
  ): WorkerJob {
    const approvalPolicy: SessionApprovalPolicy =
      input.approvalPolicy ??
      (this.data.sessions.find((s) => s.id === input.sessionId)?.approvalPolicy as
        SessionApprovalPolicy | undefined) ??
      'manual'
    const job: WorkerJob = {
      ...input,
      id: createId('job'),
      status: input.status ?? 'queued',
      createdAt: now(),
      approvalPolicy,
      task: input.task,
      output: input.output ? input.output.slice(0, JOB_OUTPUT_MAX_CHARS) : undefined,
    }
    this.commit((draft) => {
      if (!draft.jobs) draft.jobs = []
      draft.jobs.unshift(job)
      if (draft.jobs.length > JOB_HISTORY_LIMIT) {
        draft.jobs = draft.jobs.slice(0, JOB_HISTORY_LIMIT)
      }
      // Preserve sticky error / approval lamps via shared recompute
      this.recomputeSessionStatusOn(draft, job.sessionId)
    })
    if (job.status === 'queued') {
      globalActivityLog.append('dispatch', `Job queued: ${job.workerName}`, {
        jobId: job.id,
        workerId: job.workerId,
        sessionId: job.sessionId,
        role: job.role,
      })
    }
    return structuredClone(job)
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
        | 'reuseKeyDigest'
      >
    >,
  ): WorkerJob {
    let next!: WorkerJob
    this.commit((draft) => {
      if (!draft.jobs) draft.jobs = []
      const idx = draft.jobs.findIndex((j) => j.id === jobId)
      if (idx < 0) throw new Error(`Job not found: ${jobId}`)
      const prev = draft.jobs[idx]!
      next = {
        ...prev,
        ...patch,
        output:
          patch.output !== undefined ? patch.output.slice(0, JOB_OUTPUT_MAX_CHARS) : prev.output,
      }
      draft.jobs[idx] = next
      // Preserve sticky error lamp (lastChatError) when no open jobs
      this.recomputeSessionStatusOn(draft, next.sessionId)
    })
    return structuredClone(next)
  }

  countOpenJobs(filter?: { workerId?: string; sessionId?: string }): number {
    return this.listJobs({
      workerId: filter?.workerId,
      sessionId: filter?.sessionId,
      status: ['queued', 'running', 'pending_approval'],
      limit: 1000,
    }).length
  }

  /** Derive and durably persist session status from open jobs + pending approvals. */
  recomputeSessionStatus(sessionId: string): Session | undefined {
    if (!this.data.sessions.some((session) => session.id === sessionId)) return undefined
    let session: Session | undefined
    this.commit((draft) => {
      this.recomputeSessionStatusOn(draft, sessionId)
      session = draft.sessions.find((candidate) => candidate.id === sessionId)
    })
    return session ? structuredClone(session) : undefined
  }

  /** Pure draft helper used inside commit() — single source for sidebar lamp. */
  private recomputeSessionStatusOn(data: AppSnapshot, sessionId: string): void {
    const session = data.sessions.find((s) => s.id === sessionId)
    if (!session) return
    const pendingApprovals = listPendingApprovals(data.approvals ?? []).filter(
      (a) => a.sessionId === sessionId,
    )
    const jobs = data.jobs ?? []
    const sessionJobs = jobs.filter((j) => j.sessionId === sessionId)
    const open = sessionJobs.filter(
      (j) => j.status === 'queued' || j.status === 'running' || j.status === 'pending_approval',
    )
    // Sticky chat error (and lamp) until user sends again (cleared via updateSessionStatus running)
    const stickyChatError = Boolean(session.lastChatError?.trim())

    let status: Session['status'] = 'idle'
    if (pendingApprovals.length > 0 || open.some((j) => j.status === 'pending_approval')) {
      status = 'needs_approval'
    } else if (open.some((j) => j.status === 'running' || j.status === 'queued')) {
      status = 'running'
    } else if (stickyChatError) {
      // Durable red lamp + error card after reload
      status = 'error'
    } else {
      // Recent job failure also lights red (short window)
      const latestFailed = sessionJobs.find(
        (j) => j.status === 'failed' || j.status === 'timed_out',
      )
      if (latestFailed) {
        const age = Date.now() - Date.parse(latestFailed.finishedAt ?? latestFailed.createdAt)
        if (Number.isFinite(age) && age < 60_000) status = 'error'
      }
    }

    session.status = status
    // Only clear sticky error when explicitly leaving error (user re-sends → running)
    // recompute must NOT wipe lastChatError while status stays error
    if (status !== 'error') {
      // When moving to approve/running/idle without sticky chat error payload, drop it
      if (status === 'running' || status === 'idle') {
        delete session.lastChatError
        delete session.lastChatErrorAt
      }
    }
    session.updatedAt = now()
    const runningWorkerIds = open.filter((j) => isJobOpen(j.status)).map((j) => j.workerId)
    session.activeWorkerIds = [...new Set(runningWorkerIds)]
  }
}
