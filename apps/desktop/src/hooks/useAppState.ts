import { useCallback, useEffect, useState } from 'react'
import type {
  AppSnapshot,
  ApprovalDecision,
  LeaderMode,
  Locale,
  Session,
  WorkerRole,
} from '@router-agents/shared'
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

  const refresh = useCallback(async () => {
    try {
      const data = await api.snapshot()
      setSnapshot(data)
      setServerUp(true)
      setError(null)
    } catch (e) {
      setServerUp(false)
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const t = setInterval(() => void refresh(), 8000)
    return () => clearInterval(t)
  }, [refresh])

  const seedDemo = async () => {
    const { snapshot: next } = await api.seedDemo()
    setSnapshot(next)
    setServerUp(true)
    setError(null)
  }

  const openProject = async (rootPath: string, name?: string) => {
    const { project } = await api.createProject({
      rootPath: rootPath.trim(),
      name: name?.trim() || undefined,
    })
    await refresh()
    return project
  }

  const createSession = async (title: string, mode: LeaderMode = 'build') => {
    const projectId = snapshot.activeProjectId ?? snapshot.projects[0]?.id
    if (!projectId) throw new Error('No project — open a project first')
    const { session } = await api.createSession({ projectId, title, mode })
    await refresh()
    return session
  }

  const detectWorkers = async (opts?: { apply?: boolean }) => {
    const res = await api.detectWorkers({ apply: opts?.apply !== false })
    if (res.snapshot) setSnapshot(res.snapshot)
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
    setSnapshot(next)
  }

  const setSessionMode = async (sessionId: string, mode: LeaderMode) => {
    const { session } = await api.setSessionMode(sessionId, mode)
    setSnapshot((s) => ({
      ...s,
      sessions: s.sessions.map((x) => (x.id === session.id ? session : x)),
    }))
    return session
  }

  const deleteProject = async (projectId: string) => {
    const { snapshot: next } = await api.deleteProject(projectId)
    setSnapshot(next)
  }

  const deleteSession = async (sessionId: string) => {
    const { snapshot: next } = await api.deleteSession(sessionId)
    setSnapshot(next)
  }

  const toggleWorker = async (id: string, enabled: boolean) => {
    await api.toggleWorker(id, enabled)
    await refresh()
  }

  const healthWorker = async (id: string, depth: 'presence' | 'version' | 'acp' = 'version') => {
    const res = await api.healthWorker(id, depth)
    if (res.snapshot) setSnapshot(res.snapshot)
    else await refresh()
  }

  const healthAllWorkers = async () => {
    const res = await api.healthWorkers({ onlyEnabled: true, depth: 'version' })
    if (res.snapshot) setSnapshot(res.snapshot)
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

  const setWorkerModel = async (id: string, model: string | null) => {
    const res = await api.setWorkerModel(id, model)
    if (res.snapshot) setSnapshot(res.snapshot)
    else await refresh()
  }

  const fetchWorkerModels = async (id: string) => {
    const res = await api.fetchWorkerModels(id)
    // Server may return updated snapshot (health + models)
    if ((res as { snapshot?: typeof snapshot }).snapshot) {
      setSnapshot((res as { snapshot: typeof snapshot }).snapshot)
    } else {
      await refresh()
    }
    return res
  }

  const setLocale = async (locale: Locale) => {
    try {
      const { snapshot: next } = await api.setLocale(locale)
      setSnapshot(next)
      setServerUp(true)
    } catch {
      setSnapshot((s) => ({ ...s, locale }))
    }
  }

  const resolveApproval = async (id: string, decision: ApprovalDecision) => {
    const { snapshot: next } = await api.resolveApproval(id, decision)
    setSnapshot(next)
  }

  const demoApproval = async () => {
    const { snapshot: next } = await api.demoApproval()
    setSnapshot(next)
  }

  const activeProject =
    snapshot.projects.find((p) => p.id === snapshot.activeProjectId) ??
    snapshot.projects[0] ??
    null
  const activeSession =
    snapshot.sessions.find((s) => s.id === snapshot.activeSessionId) ?? null

  return {
    snapshot,
    loading,
    error,
    serverUp,
    activeProject,
    activeSession,
    refresh,
    seedDemo,
    openProject,
    createSession,
    activateSession,
    activateProject,
    setSessionMode,
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
    demoApproval,
    registerWorker,
    detectWorkers,
  }
}
