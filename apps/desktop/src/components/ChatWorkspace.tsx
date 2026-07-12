import { useEffect, useMemo, useState } from 'react'
import type { LeaderMode, Project, Session } from '@router-agents/shared'
import { ChatPanel } from './ChatPanel'
import { useI18n } from '../i18n/I18nProvider'

interface Props {
  project: Project | null
  session: Session | null
  /** All known sessions — used to drop deleted ones from the keep-alive set */
  sessions: Session[]
  projects: Project[]
  serverUp: boolean
  onModeChange?: (mode: LeaderMode) => void
  onOpenSettings?: () => void
  settingsOpen?: boolean
  /** Notify parent which sessions are currently streaming (for sidebar dots) */
  onBusySessionsChange?: (busyIds: Set<string>) => void
}

/**
 * Keeps multiple ChatPanel instances mounted so sessions can run in parallel.
 * Only the active session is visible; others stay alive (streams continue).
 * @see https://mastra.ai/docs/memory/message-history
 * @see https://mastra.ai/docs/long-running-agents/background-tasks
 */
export function ChatWorkspace({
  project,
  session,
  sessions,
  projects,
  serverUp,
  onModeChange,
  onOpenSettings,
  settingsOpen,
  onBusySessionsChange,
}: Props) {
  const { t } = useI18n()
  // Session ids that stay mounted after first open (or while busy)
  const [aliveIds, setAliveIds] = useState<string[]>([])
  const [busyMap, setBusyMap] = useState<Record<string, boolean>>({})

  // Open/activate → keep mounted
  useEffect(() => {
    if (!session?.id) return
    setAliveIds((prev) => (prev.includes(session.id) ? prev : [...prev, session.id]))
  }, [session?.id])

  // Drop deleted sessions
  useEffect(() => {
    const valid = new Set(sessions.map((s) => s.id))
    setAliveIds((prev) => prev.filter((id) => valid.has(id)))
    setBusyMap((prev) => {
      const next: Record<string, boolean> = {}
      for (const [id, v] of Object.entries(prev)) {
        if (valid.has(id)) next[id] = v
      }
      return next
    })
  }, [sessions])

  // Report busy set to parent
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
      <main className="panel panel-center">
        <div className="empty-state">
          <div className="icon-lg">⌘</div>
          <h3>{t('chat.openSession')}</h3>
          <p>{t('chat.openSessionHint')}</p>
          {!serverUp && (
            <p style={{ color: 'var(--danger)', marginTop: 8 }}>{t('chat.serverDown')}</p>
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
            // Keep off-screen panes mounted (hidden) so streams continue
            aria-hidden={!isActive}
            style={{ display: isActive ? 'flex' : 'none' }}
          >
            <ChatPanel
              project={p}
              session={s}
              serverUp={serverUp}
              isActive={isActive}
              onModeChange={isActive ? onModeChange : undefined}
              onOpenSettings={onOpenSettings}
              settingsOpen={settingsOpen}
              onBusyChange={(busy) =>
                setBusyMap((prev) =>
                  prev[s.id] === busy ? prev : { ...prev, [s.id]: busy },
                )
              }
            />
          </div>
        )
      })}
    </div>
  )
}
