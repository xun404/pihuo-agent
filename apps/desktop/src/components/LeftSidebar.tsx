import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  Project,
  Session,
  SessionLampClass,
  TeamTemplate,
  WorkerRegistration,
} from '@swarmdesk-agent/shared'
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
  IconOpen,
  IconPlus,
  IconQueenBee,
  IconSettings,
  IconTrash,
  IconWorkers,
} from './Icons'
import { Folder, FolderOpen } from './Icons'
import { Modal } from './ui/Modal'
import { Expandable } from './ui/Expandable'
import { TeamTemplateLibrary } from './TeamTemplateLibrary'

/** Sessions shown per project before the rest collapse behind "show more". */
const SESSION_PREVIEW_LIMIT = 5
/** Crew templates shown before the rest collapse behind "show more". */
const CREW_PREVIEW_LIMIT = 5

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

export type SettingsTabId = 'general' | 'model' | 'prompts' | 'workers' | 'about'

interface Props {
  projects: Project[]
  sessions: Session[]
  teamTemplates?: TeamTemplate[]
  workers?: WorkerRegistration[]
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
  onOpenSettings: (tab?: SettingsTabId) => void
  onTeamTemplatesChanged?: () => void
}

export function LeftSidebar({
  projects,
  sessions,
  teamTemplates = [],
  workers = [],
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
  onTeamTemplatesChanged,
}: Props) {
  const { t } = useI18n()
  /** Per-project: reveal sessions beyond the first N. */
  const [sessionsExpanded, setSessionsExpanded] = useState<Set<string>>(() => new Set())
  /** Per-project: collapse all sessions under a project. Default: visible. */
  const [sessionsCollapsed, setSessionsCollapsed] = useState<Set<string>>(() => new Set())
  /** Crew section starts collapsed; expand to browse saved templates. */
  const [crewsCollapsed, setCrewsCollapsed] = useState(true)
  /** Projects section supports collapse; default expanded. */
  const [projectsCollapsed, setProjectsCollapsed] = useState(false)
  const [crewsListExpanded, setCrewsListExpanded] = useState(false)
  /** Two-click delete: null → first click → second click fires actual delete. */
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null)
  const [crewModal, setCrewModal] = useState<{ open: boolean; focusId: string | null }>({
    open: false,
    focusId: null,
  })
  const confirmDeleteTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!confirmingDeleteId) return
    confirmDeleteTimer.current = setTimeout(() => setConfirmingDeleteId(null), 3000)
    return () => {
      if (confirmDeleteTimer.current) clearTimeout(confirmDeleteTimer.current)
    }
  }, [confirmingDeleteId])
  const handleDeleteClick = useCallback(
    (id: string, onDelete: () => void) => {
      if (confirmingDeleteId === id) {
        setConfirmingDeleteId(null)
        onDelete()
      } else {
        setConfirmingDeleteId(id)
      }
    },
    [confirmingDeleteId],
  )
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
    setSessionsExpanded((prev) => {
      const next = new Set(prev)
      for (const id of [...next]) {
        if (!projects.some((p) => p.id === id)) next.delete(id)
      }
      return next
    })
  }, [projects])

  const toggleSessionsExpanded = (projectId: string) => {
    setSessionsExpanded((prev) => {
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

      <div className="sidebar-section sidebar-crews">
        <div className="section-label section-label-row">
          <button
            type="button"
            className="section-label-toggle"
            onClick={() => setCrewsCollapsed((value) => !value)}
            aria-expanded={!crewsCollapsed}
          >
            <span className="section-label-text">{t('sidebar.crews')}</span>
            <span className="section-label-count" aria-hidden>
              {teamTemplates.length}
            </span>
            <span
              className={`section-label-chevron${crewsCollapsed ? ' is-collapsed' : ''}`}
              aria-hidden
            >
              <IconChevronDown size={12} />
            </span>
          </button>
          <button
            type="button"
            className="section-label-action"
            title={t('sidebar.manageCrews')}
            aria-label={t('sidebar.manageCrews')}
            onClick={() => onOpenSettings('workers')}
          >
            {t('sidebar.manage')}
          </button>
        </div>
        <Expandable open={!crewsCollapsed}>
          <div className="crew-list" role="list" aria-label={t('sidebar.crews')}>
            {teamTemplates.length === 0 ? (
              <div className="crew-empty">
                <p>{t('sidebar.crewsEmpty')}</p>
                <button
                  type="button"
                  className="crew-empty-link"
                  onClick={() => onOpenSettings('workers')}
                >
                  {t('sidebar.manageCrews')}
                </button>
              </div>
            ) : (
              (() => {
                const overflow = Math.max(0, teamTemplates.length - CREW_PREVIEW_LIMIT)
                const visible =
                  overflow === 0 || crewsListExpanded
                    ? teamTemplates
                    : teamTemplates.slice(0, CREW_PREVIEW_LIMIT)
                return (
                  <>
                    {visible.map((template) => (
                      <button
                        key={template.id}
                        type="button"
                        className="crew-row"
                        role="listitem"
                        onClick={() => setCrewModal({ open: true, focusId: template.id })}
                        title={template.description || template.name}
                      >
                        <span className="crew-row-name">{template.name}</span>
                        <span className="crew-row-meta">
                          {t('team.memberCount', { count: template.members.length })}
                        </span>
                      </button>
                    ))}
                    {overflow > 0 && !crewsListExpanded && (
                      <div className="sess-fade crew-list-fade" aria-hidden>
                        <button
                          type="button"
                          className="sess-toggle"
                          onClick={() => setCrewsListExpanded(true)}
                          aria-label={t('sidebar.showMore', { count: overflow })}
                          title={t('sidebar.showMore', { count: overflow })}
                        >
                          <span className="sess-toggle-chevron" aria-hidden>
                            <IconChevronDown size={14} />
                          </span>
                        </button>
                      </div>
                    )}
                    {overflow > 0 && crewsListExpanded && (
                      <button
                        type="button"
                        className="sess-toggle sess-toggle-text"
                        onClick={() => setCrewsListExpanded(false)}
                        aria-expanded={crewsListExpanded}
                      >
                        <span className="sess-toggle-chevron up" aria-hidden>
                          <IconChevronDown size={12} />
                        </span>
                        {t('sidebar.showLess')}
                      </button>
                    )}
                  </>
                )
              })()
            )}
          </div>
        </Expandable>
      </div>

      <div
        className={`sidebar-section sidebar-projects${projectsCollapsed ? '' : ' is-open'}`}
      >
        <div className="section-label section-label-row">
          <button
            type="button"
            className="section-label-toggle"
            onClick={() => setProjectsCollapsed((value) => !value)}
            aria-expanded={!projectsCollapsed}
          >
            <span className="section-label-text">{t('sidebar.projects')}</span>
            <span className="section-label-count" aria-hidden>
              {projects.length}
            </span>
            <span
              className={`section-label-chevron${projectsCollapsed ? ' is-collapsed' : ''}`}
              aria-hidden
            >
              <IconChevronDown size={12} />
            </span>
          </button>
        </div>

        {/*
          项目区要「占满剩余高度 + 内部滚动」，不能用 Expandable 的 height 像素动画
         （flex:1 会与 height 动画互相抢布局）。用 grid 0fr↔1fr 做同节奏展开。
        */}
        <div className="sidebar-projects-collapse" aria-hidden={projectsCollapsed}>
          <div className="sidebar-projects-collapse-inner">
      <div className="session-scroll">
        {projects.length === 0 && <div className="empty-sess">{t('sidebar.empty')}</div>}

        {projects.map((project) => {
          const projectSessions = sessions
            .filter((s) => s.projectId === project.id)
            .slice()
            .sort((a, b) => sessionSortKey(b) - sessionSortKey(a))
          const showAllSessions = sessionsExpanded.has(project.id)
          const overflow = Math.max(0, projectSessions.length - SESSION_PREVIEW_LIMIT)
           const visibleSessions =
            overflow === 0 || showAllSessions
              ? projectSessions
              : projectSessions.slice(0, SESSION_PREVIEW_LIMIT)
           const toggleSessions = () => {
                setSessionsCollapsed((prev) => {
                  const next = new Set(prev)
                  if (next.has(project.id)) next.delete(project.id)
                  else next.add(project.id)
                  return next
                })
              }
          const isSessionsVisible = projectSessions.length > 0 && !sessionsCollapsed.has(project.id)
          return (
            <div className="proj" key={project.id}>
              <div
                className="proj-head"
                role="button"
                tabIndex={0}
                title={project.rootPath}
                onClick={projectSessions.length > 0 ? toggleSessions : () => onSelectProject(project)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    if (projectSessions.length > 0) toggleSessions()
                    else onSelectProject(project)
                  }
                }}
              >
                <span className="ico" aria-hidden>
                  {isSessionsVisible ? <FolderOpen size={15} /> : <Folder size={15} />}
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
                  className={`row-del${confirmingDeleteId === project.id ? ' confirming' : ''}`}
                  title={
                    confirmingDeleteId === project.id
                      ? t('sidebar.confirmDeleteAction')
                      : t('sidebar.deleteProject')
                  }
                  aria-label={
                    confirmingDeleteId === project.id
                      ? t('sidebar.confirmDeleteAction')
                      : t('sidebar.deleteProject')
                  }
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    handleDeleteClick(project.id, () => onDeleteProject(project))
                  }}
                  onMouseLeave={() => setConfirmingDeleteId(null)}
                >
                  {confirmingDeleteId === project.id ? t('common.confirm') : <IconTrash size={14} />}
                </button>
              </div>
              {projectSessions.length === 0 ? (
                <div className="empty-sess">{t('sidebar.noSessions')}</div>
              ) : (
                <Expandable open={!sessionsCollapsed.has(project.id)} contentClassName="sess-list">
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
                      <span className={`sess-trail${confirmingDeleteId === session.id ? ' confirming' : ''}`}>
                        <span className="time">
                          {relTime(session.lastReplyAt ?? session.createdAt, t)}
                        </span>
                        <button
                          type="button"
                          className={`row-del${confirmingDeleteId === session.id ? ' confirming' : ''}`}
                          title={
                            confirmingDeleteId === session.id
                              ? t('sidebar.confirmDeleteAction')
                              : t('sidebar.deleteSession')
                          }
                          aria-label={
                            confirmingDeleteId === session.id
                              ? t('sidebar.confirmDeleteAction')
                              : t('sidebar.deleteSession')
                          }
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            handleDeleteClick(session.id, () => onDeleteSession(session))
                          }}
                          onMouseLeave={() => setConfirmingDeleteId(null)}
                        >
                          {confirmingDeleteId === session.id ? t('common.confirm') : <IconTrash size={14} />}
                        </button>
                      </span>
                    </div>
                  )
                })}
                {overflow > 0 && !showAllSessions && (
                  <div className="sess-fade" aria-hidden>
                    <button
                      type="button"
                      className="sess-toggle"
                      onClick={() => toggleSessionsExpanded(project.id)}
                      aria-label={t('sidebar.showMore', { count: overflow })}
                      title={t('sidebar.showMore', { count: overflow })}
                    >
                      <span className="sess-toggle-chevron" aria-hidden>
                        <IconChevronDown size={14} />
                      </span>
                    </button>
                  </div>
                )}
                {overflow > 0 && showAllSessions && (
                  <button
                    type="button"
                    className="sess-toggle sess-toggle-text"
                    onClick={() => toggleSessionsExpanded(project.id)}
                    aria-expanded={showAllSessions}
                  >
                    <span className="sess-toggle-chevron up" aria-hidden>
                      <IconChevronDown size={12} />
                    </span>
                    {t('sidebar.showLess')}
                  </button>
                 )}
                </Expandable>
              )}
            </div>
          )
        })}
      </div>
          </div>
        </div>
      </div>

      <div className="sidebar-foot">
        <button type="button" className="sidebar-settings" onClick={() => onOpenSettings()}>
          <span className="glyph" aria-hidden>
            <IconSettings />
          </span>
          <span className="nav-label">{t('sidebar.settings')}</span>
        </button>
      </div>

      <Modal
        open={crewModal.open}
        onClose={() => setCrewModal({ open: false, focusId: null })}
        label={t('sidebar.crews')}
        panelClassName="team-library-modal team-library-modal--settings"
      >
        <div className="team-library-modal-page">
          <h2 className="settings-page-title">{t('settings.navTeams')}</h2>
          <p className="settings-page-desc">{t('settings.descTeams')}</p>
          <TeamTemplateLibrary
            workers={workers}
            initialTemplates={teamTemplates}
            focusTemplateId={crewModal.focusId}
            onChanged={onTeamTemplatesChanged}
            layout="settings"
          />
        </div>
      </Modal>
    </aside>
  )
}
