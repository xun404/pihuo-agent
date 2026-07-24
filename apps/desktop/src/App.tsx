import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import type {
  LeaderMode,
  Project,
  Session,
  SessionApprovalPolicy,
  WorkerJob,
} from '@swarmdesk-agent/shared'
import {
  SESSION_LAMP_ACTIVE_TTL_MS,
  sessionHasUnreadLamp,
  sessionLampTimes,
} from '@swarmdesk-agent/shared'
import { LeftSidebar } from './components/LeftSidebar'
import { ChatWorkspace } from './components/ChatWorkspace'
import { RightPanel } from './components/RightPanel'
import { SettingsPanel } from './components/SettingsPanel'
import { useAppState } from './hooks/useAppState'
import { I18nProvider, useI18n } from './i18n/I18nProvider'
import type { Locale } from './i18n/locales'
import { ThemeProvider } from './theme/ThemeProvider'
import { ToastProvider, useToast } from './components/Toast'
import { pickProjectDirectory } from './lib/native-dialogs'
import { ConfirmDialog, type ConfirmDialogConfig } from './components/ui/ConfirmDialog'
import {
  clampDrawerWidth,
  clampSidebarWidth,
  loadDrawerWidth,
  loadSidebarWidth,
  saveDrawerWidth,
  saveSidebarWidth,
} from './lib/panel-widths'

/** Settings ↔ workspace view transition (aligned with Modal timing). */
const VIEW_EASE = [0.4, 0, 0.2, 1] as const

const EMPTY_JOBS: WorkerJob[] = []

function AppShell({
  snapshot,
  serverUp,
  activeProject,
  activeSession,
  pendingNewSession,
  openProject,
  createSession,
  createPendingSession,
  clearPendingSession,
  activateSession,
  activateProject,
  setSessionMode,
  setSessionStatus,
  markSessionRead,
  deleteProject,
  deleteSession,
  renameSession,
  toggleWorker,
  setWorkerDefaultRoleType,
  healthAllWorkers,
  resolveApproval,
  resetAcpContext,
  resolvingState,
  registerCustomAcpWorker,
  createTeamMember,
  updateTeamMember,
  archiveTeamMember,
  resetTeamMemberSession,
  refresh,
  setSessionApprovalPolicy,
}: ReturnType<typeof useAppState>) {
  const { t } = useI18n()
  const { error: toastError, info: toastInfo } = useToast()
  const reduceMotion = useReducedMotion()
  const viewTransition = {
    duration: reduceMotion ? 0.01 : 0.22,
    ease: VIEW_EASE,
  }
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<
    'general' | 'model' | 'prompts' | 'workers' | 'about' | undefined
  >()
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(() => loadSidebarWidth())
  const [drawerWidth, setDrawerWidth] = useState(() => loadDrawerWidth())
  const [busySessionIds, setBusySessionIds] = useState<Set<string>>(() => new Set())
  const sidebarWidthRef = useRef(sidebarWidth)
  const drawerWidthRef = useRef(drawerWidth)
  sidebarWidthRef.current = sidebarWidth
  drawerWidthRef.current = drawerWidth
  /**
   * First-message composer on the empty Chat state: store the text and
   * preset, then deselect active session so the empty-state composer shows.
   * The session is created on the server only when the first message is sent.
   *
   * `pendingComposerForSession` binds the text to the *newly created* session
   * id so only that session's ChatPanel consumes it. Without the binding, the
   * previously-active ChatPanel races ahead while createSession() is in flight
   * and swallows the text before the new panel mounts.
   */
  const [pendingComposerForSession, setPendingComposerForSession] = useState<{
    sessionId: string
    text: string
    autoSend: boolean
  } | null>(null)
  const [creatingFromComposer, setCreatingFromComposer] = useState(false)
  const [pendingConfirm, setPendingConfirm] = useState<ConfirmDialogConfig | null>(null)

  /**
   * Sidebar notification lamps (error/done) are read-watermark driven:
   *  - Opening a session marks it read (error lamp lingers 3s, done goes out).
   *  - While the session stays active, each lamp event auto-expires 60s after
   *    it happened (`upTo` per event so a later event keeps its own 60s).
   */
  const markReadRef = useRef(markSessionRead)
  markReadRef.current = markSessionRead
  const sessionsRef = useRef(snapshot.sessions)
  sessionsRef.current = snapshot.sessions
  const activeSessionId = activeSession?.id ?? null
  const activeErrAt = activeSession?.lastErrorAt ?? activeSession?.lastChatErrorAt ?? null
  const activeReplyAt = activeSession?.lastReplyAt ?? null
  const activeFinishedAt = activeSession?.lastFinishedAt ?? null
  const activeReadAt = activeSession?.lastReadAt ?? null

  useEffect(() => {
    if (!activeSessionId) return
    const s = sessionsRef.current.find((x) => x.id === activeSessionId)
    if (s && sessionHasUnreadLamp(s)) void markReadRef.current(activeSessionId)
  }, [activeSessionId])

  useEffect(() => {
    if (!activeSessionId || !activeSession) return
    const { errAt, doneAt, readAt } = sessionLampTimes(activeSession)
    const pending = [errAt, doneAt].filter((ts) => ts > readAt)
    if (pending.length === 0) return
    const oldest = Math.min(...pending)
    const fire = () => void markReadRef.current(activeSessionId, new Date(oldest).toISOString())
    const delay = oldest + SESSION_LAMP_ACTIVE_TTL_MS - Date.now()
    if (delay <= 0) {
      fire()
      return
    }
    const t = setTimeout(fire, delay)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- timestamps are the real deps
  }, [activeSessionId, activeErrAt, activeReplyAt, activeFinishedAt, activeReadAt])

  useEffect(() => {
    const onOpen = (ev: Event) => {
      const detail = (ev as CustomEvent<{ tab?: string }>).detail
      if (
        detail?.tab === 'workers' ||
        detail?.tab === 'model' ||
        detail?.tab === 'prompts' ||
        detail?.tab === 'general' ||
        detail?.tab === 'about'
      ) {
        setSettingsTab(detail.tab)
      } else {
        setSettingsTab('workers')
      }
      setSettingsOpen(true)
      setInspectorOpen(false)
    }
    window.addEventListener('swarmdesk-agent:open-settings', onOpen)
    return () => window.removeEventListener('swarmdesk-agent:open-settings', onOpen)
  }, [])

  const beginSidebarResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const startX = event.clientX
    const startW = sidebarWidthRef.current
    const target = event.currentTarget
    target.setPointerCapture(event.pointerId)
    document.body.classList.add('is-resizing-panels')

    const onMove = (ev: PointerEvent) => {
      setSidebarWidth(clampSidebarWidth(startW + (ev.clientX - startX)))
    }
    const onUp = () => {
      document.body.classList.remove('is-resizing-panels')
      target.removeEventListener('pointermove', onMove)
      target.removeEventListener('pointerup', onUp)
      target.removeEventListener('pointercancel', onUp)
      setSidebarWidth((current) => saveSidebarWidth(current))
    }
    target.addEventListener('pointermove', onMove)
    target.addEventListener('pointerup', onUp)
    target.addEventListener('pointercancel', onUp)
  }, [])

  const beginDrawerResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const startX = event.clientX
    const startW = drawerWidthRef.current
    const target = event.currentTarget
    target.setPointerCapture(event.pointerId)
    document.body.classList.add('is-resizing-panels')

    const onMove = (ev: PointerEvent) => {
      // Dragging the left edge of the drawer: move left → wider.
      setDrawerWidth(clampDrawerWidth(startW - (ev.clientX - startX)))
    }
    const onUp = () => {
      document.body.classList.remove('is-resizing-panels')
      target.removeEventListener('pointermove', onMove)
      target.removeEventListener('pointerup', onUp)
      target.removeEventListener('pointercancel', onUp)
      setDrawerWidth((current) => saveDrawerWidth(current))
    }
    target.addEventListener('pointermove', onMove)
    target.addEventListener('pointerup', onUp)
    target.addEventListener('pointercancel', onUp)
  }, [])

  /**
   * Open the native folder picker and activate the chosen project. Used by
   * both the sidebar "open project" entry and the empty-state "open folder"
   * chip. No intermediate modal — jumps straight to the OS folder dialog.
   */
  const onOpenProject = () => {
    void (async () => {
      const path = await pickProjectDirectory({ title: t('sidebar.openProject') })
      if (!path) return
      try {
        await openProject(path)
      } catch (e) {
        toastError(e instanceof Error ? e.message : String(e))
      }
    })()
  }

  /**
   * Empty-state composer: create a session on the server, then pre-fill the
   * new session's composer with the user's text.
   *
   * - If a project is already active → createSession directly.
   * - If no project → first open the native folder picker; once a project is
   *   opened, create a session under it.
   */
  const onComposeFirstMessage = (
    text: string,
    preset?: {
      mode: LeaderMode
      approvalPolicy: SessionApprovalPolicy
      teamTemplateId?: string
    },
  ): Promise<boolean> => {
    const trimmed = text.trim()
    if (!trimmed) return Promise.resolve(false)
    return (async () => {
      setCreatingFromComposer(true)
      try {
        let projectId = activeProject?.id ?? snapshot.activeProjectId ?? undefined
        if (!projectId) {
          const path = await pickProjectDirectory({ title: t('sidebar.openProject') })
          if (!path) return false
          const project = await openProject(path)
          projectId = project.id
        }
        // Clear any pending local-only session (sidebar button flow)
        clearPendingSession()
        const mode = preset?.mode ?? 'build'
        const session = await createSession(
          undefined,
          mode,
          projectId,
          undefined,
          preset?.teamTemplateId,
        )
        if (preset && preset.approvalPolicy !== 'manual') {
          await setSessionApprovalPolicy(session.id, preset.approvalPolicy)
        }
        // Bind the text to the newly-created session id so ONLY its ChatPanel
        // consumes it — the previously-active panel must not race in first.
        setPendingComposerForSession({ sessionId: session.id, text: trimmed, autoSend: true })
        return true
      } catch (e) {
        toastError(e instanceof Error ? e.message : String(e))
        return false
      } finally {
        setCreatingFromComposer(false)
      }
    })()
  }

  const onNewSession = () => {
    void (async () => {
      try {
        let projectId =
          activeProject?.id ?? snapshot.activeProjectId ?? snapshot.projects[0]?.id ?? undefined
        if (!projectId) {
          toastInfo(t('sidebar.needProjectOpenFolder'), 3200)
          await new Promise<void>((resolve) => {
            window.setTimeout(resolve, 3000)
          })
          const path = await pickProjectDirectory({ title: t('sidebar.openProject') })
          if (!path) return
          const project = await openProject(path)
          projectId = project.id
        }
        createPendingSession(projectId, 'build')
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        toastError(msg === 'NO_PROJECT' ? t('sidebar.needProjectOpenFolder') : msg)
      }
    })()
  }

  const onNewSessionForProject = (project: Project) => {
    createPendingSession(project.id, 'build')
  }

  const onRenameSession = (sessionId: string, title: string) => {
    const trimmed = title.trim()
    if (!trimmed) return
    void renameSession(sessionId, trimmed).catch((e) => toastError(String(e)))
  }

  const onDeleteProject = (project: Project) => {
    setPendingConfirm({
      title: t('sidebar.deleteProject'),
      message: t('sidebar.confirmDeleteProject', { name: project.name }),
      confirmLabel: t('common.confirmDelete'),
      cancelLabel: t('common.cancel'),
      danger: true,
      onConfirm: async () => {
        try {
          await deleteProject(project.id)
        } catch (e) {
          toastError(String(e))
        }
      },
    })
  }

  const onDeleteSession = (session: Session) => {
    setPendingConfirm({
      title: t('sidebar.deleteSession'),
      message: t('sidebar.confirmDeleteSession', { title: session.title }),
      confirmLabel: t('common.confirmDelete'),
      cancelLabel: t('common.cancel'),
      danger: true,
      onConfirm: async () => {
        try {
          await deleteSession(session.id)
        } catch (e) {
          toastError(String(e))
        }
      },
    })
  }

  const onModeChange = (mode: LeaderMode) => {
    if (!activeSession) return
    void setSessionMode(activeSession.id, mode).catch((e) => toastError(String(e)))
  }

  const leaveSettings = () => {
    setSettingsOpen(false)
    // Pick up sticky-error clears / model list after credentials change
    void refresh()
  }

  return (
    <div className="app-root">
      <div className="window app-window">
        {/* 设置全页 ↔ 工作区：AnimatePresence 延迟卸载以播放退场 */}
        <AnimatePresence mode="wait" initial={false}>
          {settingsOpen ? (
            <motion.div
              key="settings"
              className="view-layer"
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 28 }}
              animate={reduceMotion ? { opacity: 1 } : { opacity: 1, x: 0 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 28 }}
              transition={viewTransition}
            >
              <SettingsPanel
                onClose={leaveSettings}
                initialTab={settingsTab}
                workers={snapshot.workers}
                onToggleWorker={(id, enabled) => void toggleWorker(id, enabled)}
                onSetWorkerDefaultRoleType={(id, role) => setWorkerDefaultRoleType(id, role)}
                onHealthAllWorkers={() => healthAllWorkers()}
                onRegisterCustomAcpWorker={(body) => registerCustomAcpWorker(body)}
                onRefreshSnapshot={() => void refresh()}
              />
            </motion.div>
          ) : (
            <motion.div
              key="workspace"
              className="view-layer"
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -20 }}
              animate={reduceMotion ? { opacity: 1 } : { opacity: 1, x: 0 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -20 }}
              transition={viewTransition}
            >
              <div
                className={`shell${inspectorOpen ? ' with-inspector' : ''}`}
                style={
                  {
                    '--sidebar-w': `${sidebarWidth}px`,
                    '--drawer-w': `${drawerWidth}px`,
                  } as CSSProperties
                }
              >
                <LeftSidebar
                  projects={snapshot.projects}
                  sessions={snapshot.sessions}
                  teamTemplates={snapshot.teamTemplates}
                  workers={snapshot.workers}
                  activeProjectId={snapshot.activeProjectId}
                  // HomeChat / pending new session: no server session yet — clear highlight.
                  activeSessionId={pendingNewSession ? null : snapshot.activeSessionId}
                  busySessionIds={busySessionIds}
                  onSelectSession={(s) => {
                    clearPendingSession()
                    void activateSession(s)
                  }}
                  onSelectProject={(p) =>
                    void activateProject(p.id).catch((e) => toastError(String(e)))
                  }
                  onNewSession={onNewSession}
                  onNewSessionForProject={onNewSessionForProject}
                  onOpenProject={onOpenProject}
                  onDeleteProject={onDeleteProject}
                  onDeleteSession={onDeleteSession}
                  onOpenSettings={(tab) => {
                    if (tab) setSettingsTab(tab)
                    setSettingsOpen(true)
                    setInspectorOpen(false)
                  }}
                  onTeamTemplatesChanged={() => void refresh()}
                />
                <div
                  className="panel-resizer panel-resizer-left"
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={t('layout.resizeSidebar')}
                  aria-valuenow={sidebarWidth}
                  aria-valuemin={180}
                  aria-valuemax={360}
                  onPointerDown={beginSidebarResize}
                />

                <div className="main-column">
                  <ChatWorkspace
                    project={activeProject}
                    session={activeSession}
                    sessions={snapshot.sessions}
                    projects={snapshot.projects}
                    serverUp={serverUp}
                    onModeChange={onModeChange}
                    onRenameSession={onRenameSession}
                    onOpenSettings={(tab) => {
                      if (tab) setSettingsTab(tab)
                      setSettingsOpen(true)
                      setInspectorOpen(false)
                    }}
                    settingsOpen={false}
                    onBusySessionsChange={setBusySessionIds}
                    onSetApprovalPolicy={(sessionId, policy) =>
                      void setSessionApprovalPolicy(sessionId, policy).catch((e) =>
                        toastError(String(e)),
                      )
                    }
                    onSessionStatusChange={(sessionId, status, opts) =>
                      setSessionStatus(sessionId, status, opts)
                    }
                    resolving={resolvingState}
                    snapshotApprovals={snapshot.approvals}
                    snapshotJobs={snapshot.jobs ?? EMPTY_JOBS}
                    snapshotWorkers={snapshot.workers}
                    snapshotTeamTemplates={snapshot.teamTemplates}
                    onResolveApproval={(id, optionId, decision, surface) =>
                      void resolveApproval(id, decision, optionId, surface).catch((e) =>
                        toastError(String(e)),
                      )
                    }
                    onResetContext={(jobId) =>
                      void resetAcpContext(jobId).catch((e) => toastError(String(e)))
                    }
                    inspectorOpen={inspectorOpen}
                    onToggleInspector={() => setInspectorOpen((v) => !v)}
                    onRefreshGit={() => void refresh()}
                    onComposeFirstMessage={onComposeFirstMessage}
                    onPickFolder={onOpenProject}
                    pendingComposerForSession={pendingComposerForSession}
                    onInitialInputConsumed={() => setPendingComposerForSession(null)}
                    creatingFromComposer={creatingFromComposer}
                    pendingNewSession={pendingNewSession}
                    clearPendingSession={clearPendingSession}
                    createSession={createSession}
                  />
                </div>

                {inspectorOpen && (
                  <div className="inspector-host drawer">
                    <div
                      className="panel-resizer panel-resizer-right"
                      role="separator"
                      aria-orientation="vertical"
                      aria-label={t('layout.resizeInspector')}
                      aria-valuenow={drawerWidth}
                      aria-valuemin={260}
                      aria-valuemax={480}
                      onPointerDown={beginDrawerResize}
                    />
                    <div className="drawer-panel">
                      <RightPanel
                        workers={snapshot.workers}
                        teamMembers={snapshot.teamMembers.filter(
                          (role) => role.chatSessionId === activeSession?.id && !role.archivedAt,
                        )}
                        approvals={snapshot.approvals ?? []}
                        projectId={activeProject?.id ?? null}
                        sessionId={activeSession?.id ?? null}
                        onCreateTeamMember={async (body) => {
                          if (!activeSession) throw new Error('Chat session is required')
                          await createTeamMember(activeSession.id, body)
                        }}
                        onUpdateTeamMember={async (id, body) => {
                          if (!activeSession) throw new Error('Chat session is required')
                          await updateTeamMember(activeSession.id, id, body)
                        }}
                        onArchiveTeamMember={async (id, expectedRevision) => {
                          if (!activeSession) throw new Error('Chat session is required')
                          await archiveTeamMember(activeSession.id, id, expectedRevision)
                        }}
                        onResetTeamMemberSession={async (id) => {
                          if (!activeSession) throw new Error('Chat session is required')
                          await resetTeamMemberSession(activeSession.id, id)
                        }}
                        onResolveApproval={(id, optionId, decision, surface) =>
                          void resolveApproval(id, decision, optionId, surface).catch((e) =>
                            toastError(String(e)),
                          )
                        }
                        resolving={resolvingState}
                        onRefreshSnapshot={() => void refresh()}
                      />
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <ConfirmDialog
          open={!!pendingConfirm}
          config={pendingConfirm}
          onClose={() => setPendingConfirm(null)}
        />
      </div>
    </div>
  )
}

export default function App() {
  const state = useAppState()

  return (
    <ThemeProvider>
      <I18nProvider
        serverLocale={state.snapshot.locale}
        onLocaleChange={(locale: Locale) => void state.setLocale(locale)}
      >
        <ToastProvider>
          <AppShell {...state} />
        </ToastProvider>
      </I18nProvider>
    </ThemeProvider>
  )
}
