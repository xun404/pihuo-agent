import { useEffect, useState } from 'react'
import type { Project, Session } from '@router-agents/shared'
import { useI18n } from '../i18n/I18nProvider'

function statusClass(status: Session['status']): string {
  if (status === 'running') return 'running'
  if (status === 'needs_approval') return 'needs-approval'
  if (status === 'error') return 'error'
  return ''
}

function relTime(iso: string, nowLabel: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return nowLabel
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

interface Props {
  projects: Project[]
  sessions: Session[]
  activeProjectId: string | null
  activeSessionId: string | null
  /** Sessions currently streaming / generating (parallel) */
  busySessionIds?: Set<string>
  onSelectSession: (session: Session) => void
  onSelectProject: (project: Project) => void
  onNewSession: () => void
  onOpenProject: () => void
  onDeleteProject: (project: Project) => void
  onDeleteSession: (session: Session) => void
  onSeedDemo: () => void
}

export function LeftSidebar({
  projects,
  sessions,
  activeProjectId,
  activeSessionId,
  busySessionIds,
  onSelectSession,
  onSelectProject,
  onNewSession,
  onOpenProject,
  onDeleteProject,
  onDeleteSession,
  onSeedDemo,
}: Props) {
  const { t } = useI18n()
  /** Collapsed project ids — empty = expanded */
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())

  // Expand newly added projects by default; keep user collapses
  useEffect(() => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      for (const id of [...next]) {
        if (!projects.some((p) => p.id === id)) next.delete(id)
      }
      return next
    })
  }, [projects])

  const toggleCollapsed = (projectId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(projectId)) next.delete(projectId)
      else next.add(projectId)
      return next
    })
  }

  return (
    <aside className="panel panel-left">
      <div className="panel-header">
        <h2>{t('sidebar.projects')}</h2>
        <div className="spacer" />
        <button
          className="btn btn-ghost btn-sm sidebar-action-btn"
          type="button"
          title={t('sidebar.openProject')}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onOpenProject()
          }}
        >
          ＋
        </button>
      </div>

      <div className="search">
        <span>⌕</span>
        <input type="search" placeholder={t('sidebar.search')} />
      </div>

      <div className="scroll">
        {projects.length === 0 && (
          <div style={{ padding: 12, color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.5 }}>
            {t('sidebar.empty')}
          </div>
        )}

        {projects.map((project) => {
          const projectSessions = sessions.filter((s) => s.projectId === project.id)
          const isCollapsed = collapsed.has(project.id)
          const isActive = project.id === activeProjectId
          return (
            <div
              className={`project${isCollapsed ? ' collapsed' : ''}${isActive ? ' active' : ''}`}
              key={project.id}
            >
              <div
                className="project-head"
                role="button"
                tabIndex={0}
                aria-expanded={!isCollapsed}
                aria-selected={isActive}
                title={project.rootPath}
                onClick={() => onSelectProject(project)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onSelectProject(project)
                  }
                }}
              >
                <button
                  type="button"
                  className="chev-btn"
                  aria-label={isCollapsed ? t('sidebar.expand') : t('sidebar.collapse')}
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    toggleCollapsed(project.id)
                  }}
                >
                  <span className="chev">{isCollapsed ? '▶' : '▼'}</span>
                </button>
                <span className="project-icon">{project.name.slice(0, 1).toUpperCase()}</span>
                <div className="project-meta">
                  <div className="project-name">{project.name}</div>
                  <div className="project-path">{project.rootPath}</div>
                </div>
                {project.defaultBranch && (
                  <span className="branch-badge">{project.defaultBranch}</span>
                )}
                <button
                  type="button"
                  className="btn btn-ghost btn-sm project-del"
                  title={t('sidebar.deleteProject')}
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    onDeleteProject(project)
                  }}
                >
                  ×
                </button>
              </div>
              {!isCollapsed && (
                <div className="sessions">
                  {projectSessions.length === 0 && (
                    <div className="session-empty">{t('sidebar.noSessions')}</div>
                  )}
                  {projectSessions.map((session) => {
                    const busy = busySessionIds?.has(session.id)
                    const dotClass = busy
                      ? 'running'
                      : statusClass(session.status)
                    return (
                    <div
                      key={session.id}
                      className={`session-item${session.id === activeSessionId ? ' active' : ''}${busy ? ' busy' : ''}`}
                      onClick={() => onSelectSession(session)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') onSelectSession(session)
                      }}
                    >
                      <span className={`session-dot ${dotClass}`} title={busy ? 'running' : session.status} />
                      <span className="session-title">{session.title}</span>
                      <span className="session-time">
                        {relTime(session.updatedAt, t('sidebar.now'))}
                      </span>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm session-del"
                        title={t('sidebar.deleteSession')}
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          onDeleteSession(session)
                        }}
                      >
                        ×
                      </button>
                    </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div
        style={{
          padding: '10px 12px',
          borderTop: '1px solid var(--border-subtle)',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <button
          className="btn btn-primary"
          style={{ width: '100%', justifyContent: 'center' }}
          type="button"
          onClick={(e) => {
            e.preventDefault()
            onOpenProject()
          }}
        >
          {t('sidebar.openProject')}
        </button>
        <button
          className="btn btn-soft"
          style={{ width: '100%', justifyContent: 'center' }}
          type="button"
          onClick={onNewSession}
        >
          {t('sidebar.newSession')}
        </button>
        <button
          className="btn btn-ghost btn-sm"
          style={{ width: '100%', justifyContent: 'center' }}
          type="button"
          onClick={onSeedDemo}
          title={t('sidebar.seedDemoHint')}
        >
          {t('sidebar.seedDemo')}
        </button>
      </div>
    </aside>
  )
}
