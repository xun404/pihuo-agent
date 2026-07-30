import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AppSnapshot,
  ApprovalDecision,
  CreateTeamMemberInput,
  LeaderMode,
  Locale,
  Session,
  SessionPermissionMode,
  UpdateTeamMemberInput,
  WorkerRole,
} from '@swarmdesk-agent/shared'
import { api } from '../lib/api'

const empty: AppSnapshot = {
  projects: [],
  sessions: [],
  workers: [],
  teamMembers: [],
  teamTemplates: [],
  approvals: [],
  activeProjectId: null,
  activeSessionId: null,
  locale: 'zh',
}

export type PendingNewSession = {
  projectId: string
  mode: LeaderMode
  memoryThreadId: string
}

export function useAppState() {
  const [snapshot, setSnapshot] = useState<AppSnapshot>(empty)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [serverUp, setServerUp] = useState(false)
  const [resolvingState, setResolvingState] = useState<Record<string, boolean>>({})
  const resolvingRef = useRef(resolvingState)
  resolvingRef.current = resolvingState
  /** Pending new session: created locally, not yet on server. Created on first message send. */
  const [pendingNewSession, setPendingNewSession] = useState<PendingNewSession | null>(null)
  /** Monotonic apply generation — ignore stale responses that finish out of order. */
  const applyGenRef = useRef(0)
  const lastRevisionRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)

  const applySnapshot = useCallback((data: AppSnapshot, gen: number) => {
    if (gen !== applyGenRef.current) return // superseded
    const rev = typeof data.revision === 'number' ? data.revision : undefined
    if (rev != null && rev < lastRevisionRef.current) return // older server revision
    if (rev != null) lastRevisionRef.current = rev
    setSnapshot(data)
    setServerUp(true)
    setError(null)
  }, [])

  const refresh = useCallback(async () => {
    const gen = ++applyGenRef.current
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    try {
      const data = await api.snapshot(ac.signal)
      if (ac.signal.aborted) return
      applySnapshot(data, gen)
    } catch (e) {
      if (ac.signal.aborted || gen !== applyGenRef.current) return
      setServerUp(false)
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (gen === applyGenRef.current) setLoading(false)
    }
  }, [applySnapshot])

  useEffect(() => {
    void refresh()
    const t = setInterval(() => void refresh(), 8000)
    return () => {
      clearInterval(t)
      abortRef.current?.abort()
    }
  }, [refresh])

  const openProject = async (rootPath: string, name?: string) => {
    const { project } = await api.createProject({
      rootPath: rootPath.trim(),
      name: name?.trim() || undefined,
    })
    await refresh()
    return project
  }

  const createSession = async (
    title: string | undefined,
    mode: LeaderMode = 'build',
    explicitProjectId?: string,
    memoryThreadId?: string,
    teamTemplateId?: string,
    permissionMode?: SessionPermissionMode,
  ) => {
    const projectId = explicitProjectId ?? snapshot.activeProjectId ?? snapshot.projects[0]?.id
    // Surface a stable code for UI handling; user-facing copy lives in i18n.
    if (!projectId) throw new Error('NO_PROJECT')
    const { session, snapshot: snap } = await api.createSession({
      projectId,
      title,
      mode,
      memoryThreadId,
      permissionMode,
      ...(teamTemplateId?.trim() ? { teamTemplateId: teamTemplateId.trim() } : {}),
    })
    if (snap) applySnapshot(snap, ++applyGenRef.current)
    else await refresh()
    return session
  }

  const renameSession = async (sessionId: string, title: string) => {
    const { snapshot: snap } = await api.renameSession(sessionId, title)
    if (snap) applySnapshot(snap, ++applyGenRef.current)
    else await refresh()
  }

  const registerCustomAcpWorker = async (
    body: Parameters<typeof api.registerCustomAcpWorker>[0],
  ) => {
    const result = await api.registerCustomAcpWorker(body)
    applySnapshot(result.snapshot, ++applyGenRef.current)
    return result.worker
  }

  const createTeamMember = async (
    chatSessionId: string,
    body: Omit<CreateTeamMemberInput, 'chatSessionId'>,
  ) => {
    const result = await api.createTeamMember(chatSessionId, body)
    applySnapshot(result.snapshot, ++applyGenRef.current)
    return result.teamMember
  }

  const updateTeamMember = async (
    chatSessionId: string,
    teamMemberId: string,
    body: UpdateTeamMemberInput,
  ) => {
    const result = await api.updateTeamMember(chatSessionId, teamMemberId, body)
    applySnapshot(result.snapshot, ++applyGenRef.current)
    return result.teamMember
  }

  const archiveTeamMember = async (
    chatSessionId: string,
    teamMemberId: string,
    expectedRevision: number,
  ) => {
    const result = await api.archiveTeamMember(chatSessionId, teamMemberId, expectedRevision)
    applySnapshot(result.snapshot, ++applyGenRef.current)
    return result.teamMember
  }

  const resetTeamMemberSession = async (chatSessionId: string, teamMemberId: string) =>
    api.resetTeamMemberSession(chatSessionId, teamMemberId)

  const activateSession = async (session: Session) => {
    // Clear any pending new session when selecting an existing one
    setPendingNewSession(null)
    await api.activateSession(session.id)
    await refresh()
  }

  const activateProject = async (
    projectId: string,
    opts?: {
      /** When true, keep pending new-session (used after project "+" creates a local draft). */
      keepPending?: boolean
    },
  ) => {
    // Selecting a project from the sidebar cancels a draft session; creating a
    // draft *for* a project must not wipe itself.
    if (!opts?.keepPending) setPendingNewSession(null)
    const { snapshot: next } = await api.activateProject(projectId)
    applySnapshot(next, ++applyGenRef.current)
  }

  const setSessionPermissionMode = async (
    sessionId: string,
    permissionMode: SessionPermissionMode,
  ) => {
    const gen = ++applyGenRef.current
    abortRef.current?.abort()
    const { session, snapshot: next } = await api.setSessionPermissionMode(
      sessionId,
      permissionMode,
    )
    applySnapshot(next, gen)
    return session
  }

  const setSessionStatus = async (
    sessionId: string,
    status: Session['status'],
    opts?: { lastChatError?: string | null },
  ) => {
    // Always optimistic first: opening Settings unmounts ChatPanel; if we only
    // update after the API returns, leaveSettings refresh can race and drop the
    // sticky "无法完成对话" card.
    setSnapshot((prev) => ({
      ...prev,
      sessions: prev.sessions.map((s) => {
        if (s.id !== sessionId) return s
        const next: Session = {
          ...s,
          status,
          updatedAt: new Date().toISOString(),
        }
        if (opts && 'lastChatError' in opts) {
          if (opts.lastChatError) {
            next.lastChatError = opts.lastChatError
            next.lastChatErrorAt = new Date().toISOString()
          } else {
            delete next.lastChatError
            delete next.lastChatErrorAt
          }
        } else if (status !== 'error') {
          delete next.lastChatError
          delete next.lastChatErrorAt
        }
        return next
      }),
    }))
    try {
      const { snapshot: next } = await api.setSessionStatus(sessionId, status, opts)
      applySnapshot(next, ++applyGenRef.current)
    } catch {
      // Keep optimistic local state when API is down
    }
  }

  /**
   * Stamp the sidebar lamp read watermark. Optimistic first so lamps go out
   * immediately and an in-flight poll cannot re-light them before the POST
   * lands (server snapshot carries the authoritative revision anyway).
   * `upTo` reads only events at/before that timestamp; the watermark never
   * moves backwards.
   */
  const markSessionRead = async (sessionId: string, upTo?: string) => {
    const readAt = upTo ?? new Date().toISOString()
    setSnapshot((prev) => ({
      ...prev,
      sessions: prev.sessions.map((s) => {
        if (s.id !== sessionId) return s
        if (s.lastReadAt && s.lastReadAt >= readAt) return s
        return { ...s, lastReadAt: readAt }
      }),
    }))
    try {
      const { snapshot: next } = await api.markSessionRead(sessionId, upTo)
      applySnapshot(next, ++applyGenRef.current)
    } catch {
      // Keep optimistic local state when API is down
    }
  }

  const deleteProject = async (projectId: string) => {
    const { snapshot: next } = await api.deleteProject(projectId)
    applySnapshot(next, ++applyGenRef.current)
  }

  const deleteSession = async (sessionId: string) => {
    const { snapshot: next } = await api.deleteSession(sessionId)
    applySnapshot(next, ++applyGenRef.current)
  }

  const toggleWorker = async (id: string, enabled: boolean) => {
    await api.toggleWorker(id, enabled)
    await refresh()
  }

  const setWorkerDefaultRoleType = async (id: string, roleType: WorkerRole) => {
    const result = await api.setWorkerDefaultRoleType(id, roleType)
    applySnapshot(result.snapshot, ++applyGenRef.current)
    return result.worker
  }

  const healthWorker = async (id: string, depth: 'presence' | 'version' | 'acp' = 'version') => {
    const res = await api.healthWorker(id, depth)
    if (res.snapshot) applySnapshot(res.snapshot, ++applyGenRef.current)
    else await refresh()
  }

  const healthAllWorkers = async () => {
    const res = await api.healthWorkers({ onlyEnabled: true, depth: 'version' })
    if (res.snapshot) applySnapshot(res.snapshot, ++applyGenRef.current)
    else await refresh()
    return res.summary
  }

  const setWorkerModel = async (
    id: string,
    model: string | null,
    projectId: string | null = snapshot.activeProjectId,
  ) => {
    const res = await api.setWorkerModel(id, model, projectId)
    if (res.snapshot) applySnapshot(res.snapshot, ++applyGenRef.current)
    else await refresh()
  }

  const fetchWorkerModels = async (
    id: string,
    opts?: { q?: string; force?: boolean; limit?: number; projectId?: string | null },
  ) => {
    const res = await api.fetchWorkerModels(id, {
      ...opts,
      projectId: opts?.projectId ?? snapshot.activeProjectId,
    })
    // Search responses should not thrash snapshot; full refresh only when not search-only
    if (!opts?.q) {
      if ((res as { snapshot?: typeof snapshot }).snapshot) {
        applySnapshot((res as { snapshot: typeof snapshot }).snapshot, ++applyGenRef.current)
      } else {
        await refresh()
      }
    }
    return res
  }

  const setLocale = async (locale: Locale) => {
    try {
      const { snapshot: next } = await api.setLocale(locale)
      applySnapshot(next, ++applyGenRef.current)
    } catch {
      setSnapshot((s) => ({ ...s, locale }))
    }
  }

  const resolveApproval = async (
    id: string,
    decision: ApprovalDecision,
    optionId: string | undefined,
    surface: 'chat' | 'panel',
  ): Promise<{ resolved: boolean; conflict?: boolean }> => {
    if (resolvingRef.current[id]) return { resolved: false }
    const reserved = { ...resolvingRef.current, [id]: true }
    resolvingRef.current = reserved
    setResolvingState(reserved)
    try {
      const { snapshot: next } = await api.resolveApproval(id, decision, optionId, surface)
      applySnapshot(next, ++applyGenRef.current)
      return { resolved: true }
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes('409')) {
        await refresh()
        return { resolved: false, conflict: true }
      }
      throw e
    } finally {
      setResolvingState((prev) => {
        const n = { ...prev }
        delete n[id]
        resolvingRef.current = n
        return n
      })
    }
  }

  const resetAcpContext = async (jobId: string) => {
    const result = await api.resetAcpContext(jobId)
    applySnapshot(result.snapshot, ++applyGenRef.current)
  }

  /** Create a pending session locally (no server call). Created on first message send. */
  const createPendingSession = useCallback((projectId: string, mode: LeaderMode = 'build') => {
    const memoryThreadId = `thread_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`
    setPendingNewSession({
      projectId,
      mode,
      memoryThreadId,
    })
    // Point home / active project at the draft target immediately so greeting,
    // context bar, and first-message createSession all bind the same project —
    // not the previous session's project.
    setSnapshot((prev) =>
      prev.activeProjectId === projectId ? prev : { ...prev, activeProjectId: projectId },
    )
    // Note: do NOT set activeSessionId=null here — server polling would overwrite it.
    // ChatWorkspace checks pendingNewSession to decide whether to show empty composer.
    void api
      .activateProject(projectId)
      .then(({ snapshot: next }) => {
        applySnapshot(next, ++applyGenRef.current)
      })
      .catch(() => {
        // Local draft + optimistic activeProjectId still work offline.
      })
  }, [applySnapshot])

  /** Clear pending session (e.g. when user selects another session). */
  const clearPendingSession = useCallback(() => {
    setPendingNewSession(null)
  }, [])

  const activeProject =
    snapshot.projects.find((p) => p.id === snapshot.activeProjectId) ?? snapshot.projects[0] ?? null
  const activeSession = snapshot.sessions.find((s) => s.id === snapshot.activeSessionId) ?? null

  return {
    snapshot,
    loading,
    error,
    serverUp,
    activeProject,
    activeSession,
    pendingNewSession,
    refresh,
    openProject,
    createSession,
    createPendingSession,
    clearPendingSession,
    activateSession,
    activateProject,
    setSessionStatus,
    markSessionRead,
    renameSession,
    deleteProject,
    deleteSession,
    toggleWorker,
    setWorkerDefaultRoleType,
    healthWorker,
    healthAllWorkers,
    setWorkerModel,
    fetchWorkerModels,
    setLocale,
    resolveApproval,
    registerCustomAcpWorker,
    createTeamMember,
    updateTeamMember,
    archiveTeamMember,
    resetTeamMemberSession,
    setSessionPermissionMode,
    resetAcpContext,
    resolvingState,
  }
}
