import { useEffect, useMemo, useState } from 'react'
import type {
  ApprovalItem,
  LeaderMode,
  Project,
  Session,
  SessionApprovalPolicy,
  WorkerJob,
  WorkerRegistration,
} from '@swarmdesk-agent/shared'
import { ChatPanel } from './ChatPanel'
import { useI18n } from '../i18n/I18nProvider'
import { IconTerminal } from './Icons'

interface Props {
  project: Project | null
  session: Session | null
  sessions: Session[]
  projects: Project[]
  serverUp: boolean
  onModeChange?: (mode: LeaderMode) => void
  /** Inline rename from chat header: (sessionId, newTitle) */
  onRenameSession?: (sessionId: string, title: string) => void
  onOpenSettings?: (tab?: 'general' | 'model' | 'workers' | 'about') => void
  settingsOpen?: boolean
  onBusySessionsChange?: (busyIds: Set<string>) => void
  onSetApprovalPolicy?: (sessionId: string, policy: SessionApprovalPolicy) => void
  onSessionStatusChange?: (
    sessionId: string,
    status: Session['status'],
    opts?: { lastChatError?: string | null },
  ) => void | Promise<void>
  snapshotApprovals: ApprovalItem[]
  snapshotJobs: WorkerJob[]
  snapshotWorkers: WorkerRegistration[]
  resolving?: Record<string, boolean>
  onResolveApproval?: (
    approvalId: string,
    optionId: string | undefined,
    decision: 'allow' | 'deny' | 'cancel',
    surface: 'chat' | 'panel',
  ) => void
  onResetContext?: (jobId: string) => void
  inspectorOpen?: boolean
  onToggleInspector?: () => void
}

/**
 * Keeps multiple ChatPanel instances mounted so sessions can run in parallel.
 * Only the active session is visible; others stay alive (streams continue).
 */
export function ChatWorkspace({
  project,
  session,
  sessions,
  projects,
  serverUp,
  onModeChange,
  onRenameSession,
  onOpenSettings,
  settingsOpen,
  onBusySessionsChange,
  onSetApprovalPolicy,
  onSessionStatusChange,
  snapshotApprovals,
  snapshotJobs,
  snapshotWorkers,
  resolving = {},
  onResolveApproval,
  onResetContext,
  inspectorOpen,
  onToggleInspector,
}: Props) {
  const { t } = useI18n()
  const [aliveIds, setAliveIds] = useState<string[]>([])
  const [busyMap, setBusyMap] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (!session?.id) return
    setAliveIds((prev) => (prev.includes(session.id) ? prev : [...prev, session.id]))
  }, [session?.id])

  useEffect(() => {
    const valid = new Set(sessions.map((s) => s.id))
    setAliveIds((prev) => {
      const next = prev.filter((id) => valid.has(id))
      return next.length === prev.length ? prev : next
    })
    setBusyMap((prev) => {
      const next: Record<string, boolean> = {}
      for (const [id, v] of Object.entries(prev)) {
        if (valid.has(id)) next[id] = v
      }
      const prevKeys = Object.keys(prev)
      const nextKeys = Object.keys(next)
      if (prevKeys.length === nextKeys.length && nextKeys.every((id) => prev[id] === next[id])) {
        return prev
      }
      return next
    })
  }, [sessions])

  useEffect(() => {
    const busy = new Set(
      Object.entries(busyMap)
        .filter(([, v]) => v)
        .map(([id]) => id),
    )
    onBusySessionsChange?.(busy)
  }, [busyMap, onBusySessionsChange])

  const mounted = useMemo(() => {
    return aliveIds
      .map((id) => {
        const s = sessions.find((x) => x.id === id)
        if (!s) return null
        const p =
          projects.find((x) => x.id === s.projectId) ??
          (project?.id === s.projectId ? project : null)
        return { session: s, project: p }
      })
      .filter(Boolean) as { session: Session; project: Project | null }[]
  }, [aliveIds, sessions, projects, project])

  if (!session) {
    return (
      <main className="main home-main">
        <div className="home">
          <div className="logo-cloud" aria-hidden>
            <IconTerminal />
          </div>
          <h1 className="greeting">
            {project ? (
              <>
                {t('chat.greeting', { project: '\uE000' }).split('\uE000')[0]}
                <em>{project.name}</em>
                {t('chat.greeting', { project: '\uE000' }).split('\uE000')[1]}
              </>
            ) : (
              t('chat.greetingNoProject')
            )}
          </h1>
          <p className="home-hint">{t('chat.openSession')}</p>
          {!serverUp && (
            <p className="home-hint" style={{ color: 'var(--danger)' }}>
              {t('chat.serverDown')}
            </p>
          )}
        </div>
      </main>
    )
  }

  return (
    <div className="chat-workspace">
      {mounted.map(({ session: s, project: p }) => {
        const isActive = s.id === session.id
        return (
          <div
            key={s.id}
            className={`chat-workspace-pane${isActive ? ' active' : ''}`}
            aria-hidden={!isActive}
            style={{ display: isActive ? 'flex' : 'none' }}
          >
            <ChatPanel
              project={p}
              session={s}
              serverUp={serverUp}
              isActive={isActive}
              onModeChange={isActive ? onModeChange : undefined}
              onRenameSession={
                isActive && onRenameSession ? (title) => onRenameSession(s.id, title) : undefined
              }
              onOpenSettings={onOpenSettings}
              settingsOpen={settingsOpen}
              onBusyChange={(busy) =>
                setBusyMap((prev) => (prev[s.id] === busy ? prev : { ...prev, [s.id]: busy }))
              }
              approvalPolicy={s.approvalPolicy}
              onSetApprovalPolicy={
                onSetApprovalPolicy ? (policy) => onSetApprovalPolicy(s.id, policy) : undefined
              }
              onSessionStatusChange={
                onSessionStatusChange
                  ? (status, opts) => onSessionStatusChange(s.id, status, opts)
                  : undefined
              }
              snapshotApprovals={snapshotApprovals}
              snapshotJobs={snapshotJobs}
              snapshotWorkers={snapshotWorkers}
              resolving={resolving}
              onResolveApproval={onResolveApproval}
              onResetContext={onResetContext}
              inspectorOpen={inspectorOpen}
              onToggleInspector={onToggleInspector}
            />
          </div>
        )
      })}
    </div>
  )
}
