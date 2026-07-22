import { useEffect, useState } from 'react'
import type { Project, Session, SessionLampClass } from '@swarmdesk-agent/shared'
import {
  SESSION_LAMP_ERROR_GRACE_MS,
  isPlaceholderSessionTitle,
  sessionLampClass,
  sessionLampTimes,
} from '@swarmdesk-agent/shared'
import { useI18n } from '../i18n/I18nProvider'
import type { MessageKey } from '../i18n/locales'
import {
  IconChevronDown,
  IconFolder,
  IconOpen,
  IconPlus,
  IconQueenBee,
  IconSettings,
  IconWorkers,
} from './Icons'

/** Sessions shown per project before the rest collapse behind "show more". */
const SESSION_PREVIEW_LIMIT = 5

/**
 * Sort key for "most recently active first". Matches the relative-time source
 * (`lastReplyAt ?? createdAt`) — see `relTime`. We deliberately avoid
 * `updatedAt` (bumped by open / rename / mode-change).
 */
function sessionSortKey(s: Session): number {
  const iso = s.lastReplyAt ?? s.createdAt
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : 0
}

/**
 * 任务状态灯（优先级从高到低，判定逻辑见 shared/sessionLampClass）：
 * - orange approve：需要授权等操作
 * - green run（闪烁）：正在执行
 * - red error：未读报错；阅读后 3s 熄灭，当前会话内 60s 自动熄灭
 * - green done（常亮）：执行结束未读；阅读后熄灭，当前会话内 60s 自动熄灭
 * - gray idle：空闲
 * 通知类灯（error/done）由事件时间戳 + lastReadAt 水位驱动，App 侧负责打点已读。
 */

function statusTitleKey(
  sc: SessionLampClass,
): 'sidebar.statusError' | 'sidebar.statusApprove' | 'sidebar.statusRun' | 'sidebar.statusDone' | 'sidebar.statusIdle' {
  if (sc === 'error') return 'sidebar.statusError'
  if (sc === 'approve') return 'sidebar.statusApprove'
  if (sc === 'run') return 'sidebar.statusRun'
  if (sc === 'done') return 'sidebar.statusDone'
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
  onNewSessionForProject: (project: Project) => void
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
  onNewSessionForProject,
  onOpenProject,
  onDeleteProject,
  onDeleteSession,
  onOpenSettings,
}: Props) {
  const { t } = useI18n()
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  /**
   * Ticking clock for lamp expiry: the only time-dependent render is the
   * red lamp's 3s after-read grace. Schedule the next re-render exactly at
   * the earliest pending grace deadline (no perpetual interval).
   */
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    let next = Infinity
    for (const s of sessions) {
      const { errAt, readAt } = sessionLampTimes(s)
      if (errAt > 0 && errAt <= readAt && now - readAt < SESSION_LAMP_ERROR_GRACE_MS) {
        next = Math.min(next, readAt + SESSION_LAMP_ERROR_GRACE_MS)
      }
    }
    if (next === Infinity) return
    const t = setTimeout(() => setNow(Date.now()), Math.max(next - Date.now(), 50))
    return () => clearTimeout(t)
  }, [sessions, now])

  useEffect(() => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      for (const id of [...next]) {
        if (!projects.some((p) => p.id === id)) next.delete(id)
      }
      return next
    })
    setExpanded((prev) => {
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

  const toggleExpanded = (projectId: string) => {
    setExpanded((prev) => {
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
        <button type="button" className="nav-item" onClick={onOpenProject}>
          <span className="glyph" aria-hidden>
            <IconOpen />
          </span>
          <span className="nav-label">{t('sidebar.openProject')}</span>
        </button>
        <button type="button" className="nav-item" onClick={onNewSession}>
          <span className="glyph" aria-hidden>
            <IconPlus />
          </span>
          <span className="nav-label">{t('sidebar.newTask')}</span>
        </button>
        <button
          type="button"
          className="nav-item"
          onClick={() => onOpenSettings('workers')}
        >
          <span className="glyph" aria-hidden>
            <IconWorkers />
          </span>
          <span className="nav-label">{t('settings.navWorkers')}</span>
        </button>
      </div>

      <div className="section-label">{t('sidebar.projects')}</div>

      <div className="session-scroll">
        {projects.length === 0 && <div className="empty-sess">{t('sidebar.empty')}</div>}

        {projects.map((project) => {
          const projectSessions = sessions
            .filter((s) => s.projectId === project.id)
            .slice()
            .sort((a, b) => sessionSortKey(b) - sessionSortKey(a))
          const isCollapsed = collapsed.has(project.id)
          const isExpanded = expanded.has(project.id)
          const overflow = Math.max(0, projectSessions.length - SESSION_PREVIEW_LIMIT)
          const visibleSessions =
            overflow === 0 || isExpanded ? projectSessions : projectSessions.slice(0, SESSION_PREVIEW_LIMIT)
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
                  className="proj-add"
                  title={t('sidebar.newTask')}
                  aria-label={t('sidebar.newTask')}
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    onNewSessionForProject(project)
                  }}
                >
                  <IconPlus size={14} />
                </button>
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
                  <div className="sess-list">
                    {visibleSessions.map((session) => {
                      // busy = 乐观 UI：发消息瞬间即刻变绿，不等持久化状态落盘
                      const busy = busySessionIds?.has(session.id)
                      const sc = sessionLampClass(session, busy ?? false, now)
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
                    {overflow > 0 && !isExpanded && (
                      /* 渐变遮罩盖在第 5 个 session 上：底部淡入侧栏背景色，
                         中间放一个向下箭头，提示下面还有更多 session。遮罩自身
                         pointer-events:none，仅箭头按钮可点。 */
                      <div className="sess-fade" aria-hidden>
                        <button
                          type="button"
                          className="sess-toggle"
                          onClick={() => toggleExpanded(project.id)}
                          aria-label={t('sidebar.showMore', { count: overflow })}
                          title={t('sidebar.showMore', { count: overflow })}
                        >
                          <span className="sess-toggle-chevron" aria-hidden>
                            <IconChevronDown size={14} />
                          </span>
                        </button>
                      </div>
                    )}
                    {overflow > 0 && isExpanded && (
                      <button
                        type="button"
                        className="sess-toggle sess-toggle-text"
                        onClick={() => toggleExpanded(project.id)}
                        aria-expanded={isExpanded}
                      >
                        <span className="sess-toggle-chevron up" aria-hidden>
                          <IconChevronDown size={12} />
                        </span>
                        {t('sidebar.showLess')}
                      </button>
                    )}
                  </div>
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
