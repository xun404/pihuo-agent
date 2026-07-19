import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AppSnapshot,
  ApprovalDecision,
  LeaderMode,
  Locale,
  Session,
  SessionApprovalPolicy,
  WorkerRole,
} from '@swarmdesk-agent/shared'
import { api } from '../lib/api'

const empty: AppSnapshot = {
  projects: [],
  sessions: [],
  workers: [],
  approvals: [],
  activeProjectId: null,
  activeSessionId: null,
  locale: 'zh',
}

export function useAppState() {
  const [snapshot, setSnapshot] = useState<AppSnapshot>(empty)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [serverUp, setServerUp] = useState(false)
  const [resolvingState, setResolvingState] = useState<Record<string, boolean>>({})
  const resolvingRef = useRef(resolvingState)
  resolvingRef.current = resolvingState
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
  ) => {
    const projectId = explicitProjectId ?? snapshot.activeProjectId ?? snapshot.projects[0]?.id
    if (!projectId) throw new Error('No project — open a project first')
    const { session, snapshot: snap } = await api.createSession({ projectId, title, mode })
    if (snap) applySnapshot(snap, ++applyGenRef.current)
    else await refresh()
    return session
  }

  const renameSession = async (sessionId: string, title: string) => {
    const { snapshot: snap } = await api.renameSession(sessionId, title)
    if (snap) applySnapshot(snap, ++applyGenRef.current)
    else await refresh()
  }

  const detectWorkers = async (opts?: { apply?: boolean }) => {
    const res = await api.detectWorkers({ apply: opts?.apply !== false })
    if (res.snapshot) applySnapshot(res.snapshot, ++applyGenRef.current)
    else await refresh()
    return res
  }

  const registerWorker = async (body: Parameters<typeof api.registerWorker>[0]) => {
    await api.registerWorker(body)
    await refresh()
  }

  const activateSession = async (session: Session) => {
    await api.activateSession(session.id)
    await refresh()
  }

  const activateProject = async (projectId: string) => {
    const { snapshot: next } = await api.activateProject(projectId)
    applySnapshot(next, ++applyGenRef.current)
  }

  const setSessionMode = async (sessionId: string, mode: LeaderMode) => {
    // Supersede an older refresh before starting the mutation. The server snapshot
    // carries the authoritative revision, so an out-of-order poll cannot revert it.
    const gen = ++applyGenRef.current
    abortRef.current?.abort()
    const { session, snapshot: next } = await api.setSessionMode(sessionId, mode)
    applySnapshot(next, gen)
    return session
  }

  const setSessionApprovalPolicy = async (
    sessionId: string,
    approvalPolicy: SessionApprovalPolicy,
  ) => {
    const { snapshot: next } = await api.setSessionApprovalPolicy(sessionId, approvalPolicy)
    applySnapshot(next, ++applyGenRef.current)
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

  const setWorkerRoles = async (
    id: string,
    body: { primaryRole: WorkerRole; roles: WorkerRole[] },
  ) => {
    await api.setWorkerRoles(id, body)
    await refresh()
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
    refresh,
    openProject,
    createSession,
    activateSession,
    activateProject,
    setSessionMode,
    setSessionStatus,
    renameSession,
    deleteProject,
    deleteSession,
    toggleWorker,
    healthWorker,
    healthAllWorkers,
    setWorkerRoles,
    setWorkerModel,
    fetchWorkerModels,
    setLocale,
    resolveApproval,
    registerWorker,
    detectWorkers,
    setSessionApprovalPolicy,
    resetAcpContext,
    resolvingState,
  }
}
