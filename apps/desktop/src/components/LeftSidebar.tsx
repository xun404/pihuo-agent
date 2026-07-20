import { useEffect, useState } from 'react'
import type { Project, Session } from '@swarmdesk-agent/shared'
import { isPlaceholderSessionTitle } from '@swarmdesk-agent/shared'
import { useI18n } from '../i18n/I18nProvider'
import type { MessageKey } from '../i18n/locales'
import { IconFolder, IconOpen, IconPlus, IconQueenBee, IconSettings } from './Icons'

/**
 * 任务状态灯（优先级从高到低，与 Session 持久化字段对齐）：
 * - red error：响应报错（status=error 或 lastChatError）
 * - orange approve：需要授权等操作
 * - green run（闪烁）：正在执行
 * - gray idle：空闲
 */
function statusClass(session: Session, busy?: boolean): string {
  if (session.status === 'error' || Boolean(session.lastChatError?.trim())) return 'error'
  if (session.status === 'needs_approval') return 'approve'
  if (busy || session.status === 'running') return 'run'
  return 'idle'
}

function statusTitleKey(
  sc: string,
): 'sidebar.statusError' | 'sidebar.statusApprove' | 'sidebar.statusRun' | 'sidebar.statusIdle' {
  if (sc === 'error') return 'sidebar.statusError'
  if (sc === 'approve') return 'sidebar.statusApprove'
  if (sc === 'run') return 'sidebar.statusRun'
  return 'sidebar.statusIdle'
}

/**
 * Sidebar relative-time formatter (6 buckets):
 *   < 1 min  → "现在"
 *   < 60 min → "N 分钟前"
 *   < 24 h   → "N 小时前"
 *   < 8 day  → "N 天前"      (1–7 天)
 *   < 28 day → "N 周前"      (1–3 周)
 *   else     → "1 个月前"
 *
 * Time source should be the last assistant reply (session.lastReplyAt),
 * falling back to createdAt — see usage below. We deliberately do NOT use
 * session.updatedAt: it's bumped by open / rename / mode-change, which would
 * make a freshly-opened old session falsely read "现在".
 */
function relTime(
  iso: string,
  t: (key: MessageKey, vars?: Record<string, string | number>) => string,
): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return t('sidebar.now')
  if (m < 60) return t('sidebar.relMinutes', { count: m })
  const h = Math.floor(m / 60)
  if (h < 24) return t('sidebar.relHours', { count: h })
  const d = Math.floor(h / 24)
  if (d < 8) return t('sidebar.relDays', { count: d })
  if (d < 28) return t('sidebar.relWeeks', { count: Math.floor(d / 7) })
  return t('sidebar.relMonth')
}

interface Props {
  projects: Project[]
  sessions: Session[]
  activeProjectId: string | null
  activeSessionId: string | null
  busySessionIds?: Set<string>
  onSelectSession: (session: Session) => void
  onSelectProject: (project: Project) => void
  onNewSession: () => void
  onOpenProject: () => void
  onDeleteProject: (project: Project) => void
  onDeleteSession: (session: Session) => void
  onOpenSettings: (tab?: 'general' | 'model' | 'workers' | 'about') => void
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
  onOpenSettings,
}: Props) {
  const { t } = useI18n()
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())

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
    <aside className="sidebar">
      {/* 系统 traffic lights 占位 + 拖拽区；不自绘彩色圆点 */}
      <div className="sidebar-top" aria-hidden />

      <div className="brand">
        <span className="mark" aria-hidden>
          <IconQueenBee size={22} />
        </span>
        <span className="brand-name">{t('sidebar.brand')}</span>
      </div>

      <div className="nav-actions">
        <button type="button" className="nav-item" onClick={onNewSession}>
          <span className="glyph" aria-hidden>
            <IconPlus />
          </span>
          <span className="nav-label">{t('sidebar.newTask')}</span>
        </button>
        <button type="button" className="nav-item" onClick={onOpenProject}>
          <span className="glyph" aria-hidden>
            <IconOpen />
          </span>
          <span className="nav-label">{t('sidebar.openProject')}</span>
        </button>
      </div>

      <div className="section-label">{t('sidebar.projects')}</div>

      <div className="session-scroll">
        {projects.length === 0 && <div className="empty-sess">{t('sidebar.empty')}</div>}

        {projects.map((project) => {
          const projectSessions = sessions.filter((s) => s.projectId === project.id)
          const isCollapsed = collapsed.has(project.id)
          return (
            <div className="proj" key={project.id}>
              <div
                className="proj-head"
                role="button"
                tabIndex={0}
                title={project.rootPath}
                onClick={() => {
                  onSelectProject(project)
                  toggleCollapsed(project.id)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onSelectProject(project)
                    toggleCollapsed(project.id)
                  }
                }}
              >
                <span className="ico" aria-hidden>
                  <IconFolder size={15} />
                </span>
                <span className="proj-name">{project.name}</span>
                <button
                  type="button"
                  className="row-del"
                  title={t('sidebar.deleteProject')}
                  aria-label={t('sidebar.deleteProject')}
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
                <>
                  {projectSessions.length === 0 && (
                    <div className="empty-sess">{t('sidebar.noSessions')}</div>
                  )}
                  {projectSessions.map((session) => {
                    const busy = busySessionIds?.has(session.id)
                    const sc = statusClass(session, busy)
                    const active = session.id === activeSessionId
                    const untitled = isPlaceholderSessionTitle(session.title)
                    const displayTitle = untitled ? t('sidebar.untitledSession') : session.title
                    return (
                      <div
                        key={session.id}
                        className={`sess${active ? ' active' : ''}${sc ? ` ${sc}` : ''}${untitled ? ' untitled' : ''}`}
                        onClick={() => onSelectSession(session)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') onSelectSession(session)
                        }}
                      >
                        <span className="dot" aria-hidden title={t(statusTitleKey(sc))} />
                        <span className="sess-title">{displayTitle}</span>
                        <span className="sess-trail">
                          <span className="time">
                            {relTime(session.lastReplyAt ?? session.createdAt, t)}
                          </span>
                          <button
                            type="button"
                            className="row-del"
                            title={t('sidebar.deleteSession')}
                            aria-label={t('sidebar.deleteSession')}
                            onClick={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              onDeleteSession(session)
                            }}
                          >
                            ×
                          </button>
                        </span>
                      </div>
                    )
                  })}
                </>
              )}
            </div>
          )
        })}
      </div>

      <div className="sidebar-foot">
        <button type="button" className="sidebar-settings" onClick={() => onOpenSettings()}>
          <span className="glyph" aria-hidden>
            <IconSettings />
          </span>
          <span className="nav-label">{t('sidebar.settings')}</span>
        </button>
      </div>
    </aside>
  )
}
