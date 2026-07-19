import { useEffect, useState } from 'react'
import type { LeaderMode, Project, Session, WorkerJob } from '@swarmdesk-agent/shared'
import { LeftSidebar } from './components/LeftSidebar'
import { ChatWorkspace } from './components/ChatWorkspace'
import { RightPanel } from './components/RightPanel'
import { SettingsPanel } from './components/SettingsPanel'
import { OpenProjectModal } from './components/OpenProjectModal'
import { useAppState } from './hooks/useAppState'
import { I18nProvider, useI18n } from './i18n/I18nProvider'
import type { Locale } from './i18n/locales'
import { ThemeProvider } from './theme/ThemeProvider'
import { ToastProvider, useToast } from './components/Toast'
import { confirmAction, pickProjectDirectory } from './lib/native-dialogs'

const EMPTY_JOBS: WorkerJob[] = []

function AppShell({
  snapshot,
  serverUp,
  activeProject,
  activeSession,
  openProject,
  createSession,
  activateSession,
  activateProject,
  setSessionMode,
  setSessionStatus,
  deleteProject,
  deleteSession,
  renameSession,
  toggleWorker,
  healthWorker,
  healthAllWorkers,
  setWorkerRoles,
  setWorkerModel,
  fetchWorkerModels,
  resolveApproval,
  resetAcpContext,
  resolvingState,
  registerWorker,
  detectWorkers,
  refresh,
  setSessionApprovalPolicy,
}: ReturnType<typeof useAppState>) {
  const { t } = useI18n()
  const { error: toastError } = useToast()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<
    'general' | 'model' | 'workers' | 'about' | undefined
  >()
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [busySessionIds, setBusySessionIds] = useState<Set<string>>(() => new Set())
  const [openProjectOpen, setOpenProjectOpen] = useState(false)
  /**
   * First-message composer on the empty Chat state: when the user types a
   * message before any session exists, we create a session and pre-fill its
   * composer with the typed text (the user then hits send once). Cleared by
   * ChatPanel via onInitialInputConsumed once consumed.
   */
  const [pendingComposerText, setPendingComposerText] = useState<string>('')
  /** True while the empty-state composer is creating a session (disables the input). */
  const [creatingFromComposer, setCreatingFromComposer] = useState(false)

  useEffect(() => {
    const onOpen = (ev: Event) => {
      const detail = (ev as CustomEvent<{ tab?: string }>).detail
      if (
        detail?.tab === 'workers' ||
        detail?.tab === 'model' ||
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

  const onOpenProject = () => {
    setOpenProjectOpen(true)
  }

  /**
   * Empty-state composer: create a session, then pre-fill the new session's
   * composer with the user's text.
   *
   * - If a project is already active → createSession directly.
   * - If no project → first open the native folder picker; once a project is
   *   opened, create a session under it. The pending text is cleared once
   *   ChatPanel consumes it.
   */
  const onComposeFirstMessage = (text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    void (async () => {
      setCreatingFromComposer(true)
      try {
        setPendingComposerText(trimmed)
        let projectId = activeProject?.id ?? snapshot.activeProjectId ?? undefined
        if (!projectId) {
          const path = await pickProjectDirectory({ title: t('sidebar.openProject') })
          if (!path) {
            // user canceled the picker — keep the typed text, abort session creation
            setPendingComposerText('')
            return
          }
          const project = await openProject(path)
          projectId = project.id
        }
        await createSession(undefined, 'build', projectId)
      } catch (e) {
        setPendingComposerText('')
        toastError(e instanceof Error ? e.message : String(e))
      } finally {
        setCreatingFromComposer(false)
      }
    })()
  }

  const onNewSession = () => {
    // Delayed naming: no title prompt at creation time.
    // The Leader auto-names the session after the first task; the user can
    // rename any time via the inline edit affordance in the chat header.
    void createSession(undefined).catch((e) => toastError(String(e)))
  }

  const onRenameSession = (sessionId: string, title: string) => {
    const trimmed = title.trim()
    if (!trimmed) return
    void renameSession(sessionId, trimmed).catch((e) => toastError(String(e)))
  }

  const onDeleteProject = (project: Project) => {
    void (async () => {
      const ok = await confirmAction(t('sidebar.confirmDeleteProject', { name: project.name }))
      if (!ok) return
      try {
        await deleteProject(project.id)
      } catch (e) {
        toastError(String(e))
      }
    })()
  }

  const onDeleteSession = (session: Session) => {
    void (async () => {
      const ok = await confirmAction(t('sidebar.confirmDeleteSession', { title: session.title }))
      if (!ok) return
      try {
        await deleteSession(session.id)
      } catch (e) {
        toastError(String(e))
      }
    })()
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
        <OpenProjectModal
          open={openProjectOpen}
          title={t('sidebar.openProject')}
          pathLabel={t('prompt.projectPath')}
          pathPlaceholder="/Users/…/my-project"
          browseLabel={t('prompt.browse')}
          openLabel={t('prompt.ok')}
          cancelLabel={t('prompt.cancel')}
          noSelectionLabel={t('prompt.noFolder')}
          onCancel={() => setOpenProjectOpen(false)}
          onOpen={(path) => {
            setOpenProjectOpen(false)
            void openProject(path).catch((e) => toastError(String(e)))
          }}
        />

        {/* 设置全页：按线稿替换整个 shell（无项目侧栏） */}
        {settingsOpen ? (
          <SettingsPanel
            onClose={leaveSettings}
            initialTab={settingsTab}
            workers={snapshot.workers}
            onToggleWorker={(id, enabled) => void toggleWorker(id, enabled)}
            onHealthWorker={(id, depth) => void healthWorker(id, depth)}
            onHealthAllWorkers={() => healthAllWorkers()}
            onRegisterWorker={(body) => registerWorker(body)}
            onDetectWorkers={() => detectWorkers({ apply: true })}
            onRefreshSnapshot={() => void refresh()}
          />
        ) : (
          <div className={`shell${inspectorOpen ? ' with-inspector' : ''}`}>
            <LeftSidebar
              projects={snapshot.projects}
              sessions={snapshot.sessions}
              activeProjectId={snapshot.activeProjectId}
              activeSessionId={snapshot.activeSessionId}
              busySessionIds={busySessionIds}
              onSelectSession={(s) => void activateSession(s)}
              onSelectProject={(p) =>
                void activateProject(p.id).catch((e) => toastError(String(e)))
              }
              onNewSession={onNewSession}
              onOpenProject={onOpenProject}
              onDeleteProject={onDeleteProject}
              onDeleteSession={onDeleteSession}
              onOpenSettings={(tab) => {
                if (tab) setSettingsTab(tab)
                setSettingsOpen(true)
                setInspectorOpen(false)
              }}
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
                initialInput={pendingComposerText}
                onInitialInputConsumed={() => setPendingComposerText('')}
                creatingFromComposer={creatingFromComposer}
              />
            </div>

            {inspectorOpen && (
              <div className="inspector-host drawer">
                <div className="drawer-panel">
                  <RightPanel
                    workers={snapshot.workers}
                    approvals={snapshot.approvals ?? []}
                    projectId={activeProject?.id ?? null}
                    sessionId={activeSession?.id ?? null}
                    onToggle={(id, enabled) => void toggleWorker(id, enabled)}
                    onHealth={(id, depth) => void healthWorker(id, depth)}
                    onHealthAll={() => healthAllWorkers()}
                    onSetRoles={(id, body) => void setWorkerRoles(id, body)}
                    onSetModel={(id, model, projectId) => void setWorkerModel(id, model, projectId)}
                    onFetchModels={(id, opts) => fetchWorkerModels(id, opts)}
                    onResolveApproval={(id, optionId, decision, surface) =>
                      void resolveApproval(id, decision, optionId, surface).catch((e) =>
                        toastError(String(e)),
                      )
                    }
                    resolving={resolvingState}
                    onRegisterWorker={(body) => registerWorker(body)}
                    onDetectWorkers={() => detectWorkers({ apply: true })}
                    onRefreshSnapshot={() => void refresh()}
                  />
                </div>
              </div>
            )}
          </div>
        )}
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
