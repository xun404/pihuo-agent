import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type {
  Project,
  Session,
  SessionPermissionMode,
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
import { SettingsLayer, openSettings } from './components/SettingsLayer'
import { useAppState } from './hooks/useAppState'
import { I18nProvider, useI18n } from './i18n/I18nProvider'
import type { Locale } from './i18n/locales'
import { ThemeProvider } from './theme/ThemeProvider'
import { MotionPreferenceProvider } from './motion/MotionPreferenceProvider'
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
  setSessionPermissionMode,
}: ReturnType<typeof useAppState>) {
  const { t } = useI18n()
  const { error: toastError, info: toastInfo } = useToast()
  const [inspectorOpen, setInspectorOpen] = useState(false)
  /** Keep inspector drawer mounted after first open to avoid remount jank. */
  const [inspectorMounted, setInspectorMounted] = useState(false)
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
    // Electron menu: About → settings/about, Settings… → settings/general
    // SettingsLayer owns open state; only bridge the menu IPC → event bus here.
    const unsubMenu = window.routerAgents?.onOpenSettings?.((tab?: string) => {
      if (
        tab === 'workers' ||
        tab === 'model' ||
        tab === 'prompts' ||
        tab === 'general' ||
        tab === 'about'
      ) {
        openSettings(tab)
      } else if (tab) {
        openSettings('workers')
      } else {
        openSettings()
      }
    })
    return () => {
      unsubMenu?.()
    }
  }, [])

  // Home empty-composer view has no room for the crew inspector; close it on entry.
  useEffect(() => {
    if (pendingNewSession || !activeSession) {
      setInspectorOpen(false)
    }
  }, [pendingNewSession, activeSession])

  useEffect(() => {
    if (inspectorOpen) setInspectorMounted(true)
  }, [inspectorOpen])

  // Warm-mount inspector during idle so first open isn't a cold RightPanel render.
  useEffect(() => {
    if (!activeSession) return
    let cancelled = false
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    let idleId: number | undefined
    const warm = () => {
      if (!cancelled) setInspectorMounted(true)
    }
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      idleId = window.requestIdleCallback(warm, { timeout: 2000 })
    } else {
      timeoutId = setTimeout(warm, 800)
    }
    return () => {
      cancelled = true
      if (idleId != null && 'cancelIdleCallback' in window) window.cancelIdleCallback(idleId)
      if (timeoutId != null) clearTimeout(timeoutId)
    }
  }, [activeSession?.id])

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
      permissionMode: SessionPermissionMode
      teamTemplateId?: string
    },
  ): Promise<boolean> => {
    const trimmed = text.trim()
    if (!trimmed) return Promise.resolve(false)
    return (async () => {
      setCreatingFromComposer(true)
      try {
        // Prefer the project the draft was opened for (sidebar "+" on a project),
        // not whatever the previous active session belonged to.
        let projectId =
          pendingNewSession?.projectId ??
          activeProject?.id ??
          snapshot.activeProjectId ??
          undefined
        if (!projectId) {
          const path = await pickProjectDirectory({ title: t('sidebar.openProject') })
          if (!path) return false
          const project = await openProject(path)
          projectId = project.id
        }
        // Clear any pending local-only session (sidebar button flow) after
        // capturing its projectId.
        clearPendingSession()
        const session = await createSession(
          undefined,
          'build',
          projectId,
          undefined,
          preset?.teamTemplateId,
          preset?.permissionMode ?? 'default',
        )
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
    deleteProject(project.id).catch((e) => toastError(String(e)))
  }

  const onDeleteSession = (session: Session) => {
    deleteSession(session.id).catch((e) => toastError(String(e)))
  }

  const onSettingsOpen = useCallback(() => {
    setInspectorOpen(false)
  }, [])

  return (
    <div className="app-root">
      <div className="window app-window">
        {/* Workspace never unmounts for settings — SettingsLayer is an isolated overlay. */}
        <div className="view-layer">
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
              onOpenSettings={(tab) => openSettings(tab)}
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
                onRenameSession={onRenameSession}
                onOpenSettings={(tab) => openSettings(tab)}
                onRefreshSnapshot={() => void refresh()}
                onBusySessionsChange={setBusySessionIds}
                onSetPermissionMode={(sessionId, permissionMode) =>
                  setSessionPermissionMode(sessionId, permissionMode).then(
                    () => undefined,
                    (e) => {
                      toastError(String(e))
                      throw e
                    },
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

            {/* Keep drawer mounted after first open; CSS show/hide (no remount / no exit jank). */}
            {inspectorMounted && (
              <div
                className={`inspector-host drawer${inspectorOpen ? ' is-open' : ' is-closed'}`}
                aria-hidden={!inspectorOpen}
              >
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
        </div>

        <SettingsLayer
          workers={snapshot.workers}
          projectId={snapshot.activeProjectId}
          onToggleWorker={(id, enabled) => void toggleWorker(id, enabled)}
          onSetWorkerDefaultRoleType={(id, role) => setWorkerDefaultRoleType(id, role)}
          onHealthAllWorkers={() => healthAllWorkers()}
          onRegisterCustomAcpWorker={(body) => registerCustomAcpWorker(body)}
          onRefreshSnapshot={() => void refresh()}
          onOpen={onSettingsOpen}
        />

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
      <MotionPreferenceProvider>
        <I18nProvider
          serverLocale={state.snapshot.locale}
          onLocaleChange={(locale: Locale) => void state.setLocale(locale)}
        >
          <ToastProvider>
            <AppShell {...state} />
          </ToastProvider>
        </I18nProvider>
      </MotionPreferenceProvider>
    </ThemeProvider>
  )
}
