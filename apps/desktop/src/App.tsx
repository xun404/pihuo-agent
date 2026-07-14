import { useState } from 'react'
import type { LeaderMode, Project, Session } from '@router-agents/shared'
import { LeftSidebar } from './components/LeftSidebar'
import { ChatWorkspace } from './components/ChatWorkspace'
import { RightPanel } from './components/RightPanel'
import { SettingsPanel } from './components/SettingsPanel'
import { TextPromptModal } from './components/TextPromptModal'
import { OpenProjectModal } from './components/OpenProjectModal'
import { useAppState } from './hooks/useAppState'
import { I18nProvider, useI18n } from './i18n/I18nProvider'
import type { Locale } from './i18n/locales'
import { ThemeProvider, useTheme, type ThemeMode } from './theme/ThemeProvider'
import { confirmAction } from './lib/native-dialogs'

function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n()
  return (
    <div className="seg" title={t('lang.label')} style={{ marginRight: 4 }}>
      <button
        type="button"
        className={locale === 'zh' ? 'active' : ''}
        onClick={() => setLocale('zh')}
      >
        {t('lang.zh')}
      </button>
      <button
        type="button"
        className={locale === 'en' ? 'active' : ''}
        onClick={() => setLocale('en')}
      >
        {t('lang.en')}
      </button>
    </div>
  )
}

function ThemeSwitcher() {
  const { mode, setMode } = useTheme()
  const { t } = useI18n()
  const options: { id: ThemeMode; label: string }[] = [
    { id: 'system', label: t('theme.system') },
    { id: 'light', label: t('theme.light') },
    { id: 'dark', label: t('theme.dark') },
  ]
  return (
    <div className="seg" title={t('theme.label')} style={{ marginRight: 4 }}>
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          className={mode === opt.id ? 'active' : ''}
          onClick={() => setMode(opt.id)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

function modeLabelKey(mode: LeaderMode): 'mode.ask' | 'mode.plan' | 'mode.build' | 'mode.review' {
  if (mode === 'ask') return 'mode.ask'
  if (mode === 'plan') return 'mode.plan'
  if (mode === 'build') return 'mode.build'
  return 'mode.review'
}

type TextPromptState = {
  title: string
  defaultValue: string
  placeholder?: string
  onConfirm: (value: string) => void
}

function AppShell({
  snapshot,
  loading,
  error,
  serverUp,
  activeProject,
  activeSession,
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
  resolveApproval,
  demoApproval,
  registerWorker,
  detectWorkers,
  refresh,
}: ReturnType<typeof useAppState>) {
  const { t } = useI18n()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [textPrompt, setTextPrompt] = useState<TextPromptState | null>(null)
  const [busySessionIds, setBusySessionIds] = useState<Set<string>>(() => new Set())
  const [openProjectOpen, setOpenProjectOpen] = useState(false)

  const title = activeSession
    ? `${t('app.title')} — ${activeProject?.name ?? 'project'} / ${activeSession.title}`
    : t('app.title')

  /** Always show a modal so the click never feels dead (native browse is inside). */
  const onOpenProject = () => {
    setOpenProjectOpen(true)
  }

  const onNewSession = () => {
    setTextPrompt({
      title: t('prompt.sessionTitle'),
      defaultValue: t('prompt.sessionDefault'),
      onConfirm: (sessionTitle) => {
        setTextPrompt(null)
        void createSession(sessionTitle).catch((e) => alert(String(e)))
      },
    })
  }

  const onDeleteProject = (project: Project) => {
    void (async () => {
      const ok = await confirmAction(
        t('sidebar.confirmDeleteProject', { name: project.name }),
      )
      if (!ok) return
      try {
        await deleteProject(project.id)
      } catch (e) {
        alert(String(e))
      }
    })()
  }

  const onDeleteSession = (session: Session) => {
    void (async () => {
      const ok = await confirmAction(
        t('sidebar.confirmDeleteSession', { title: session.title }),
      )
      if (!ok) return
      try {
        await deleteSession(session.id)
      } catch (e) {
        alert(String(e))
      }
    })()
  }

  const onModeChange = (mode: LeaderMode) => {
    if (!activeSession) return
    void setSessionMode(activeSession.id, mode).catch((e) => alert(String(e)))
  }

  return (
    <div className="app-root">
      <div className="window app-window">
        <div className="titlebar">
          <div className="traffic" aria-hidden>
            <span className="r" />
            <span className="y" />
            <span className="g" />
          </div>
          <div className="titlebar-title">{title}</div>
          <div className="titlebar-actions">
            <ThemeSwitcher />
            <LanguageSwitcher />
            <button
              type="button"
              className="settings-btn"
              title={t('settings.title')}
              aria-label={t('settings.title')}
              onClick={() => setSettingsOpen(true)}
            >
              <span aria-hidden style={{ fontSize: 18, lineHeight: 1 }}>
                ⚙
              </span>
            </button>
          </div>
        </div>

        <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />

        <TextPromptModal
          open={Boolean(textPrompt)}
          title={textPrompt?.title ?? ''}
          defaultValue={textPrompt?.defaultValue ?? ''}
          placeholder={textPrompt?.placeholder}
          confirmLabel={t('prompt.ok')}
          cancelLabel={t('prompt.cancel')}
          onCancel={() => setTextPrompt(null)}
          onConfirm={(value) => textPrompt?.onConfirm(value)}
        />

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
            void openProject(path).catch((e) => alert(String(e)))
          }}
        />

        {error && !serverUp && (
          <div
            style={{
              padding: '8px 14px',
              background: 'var(--warning-soft)',
              color: 'var(--warning)',
              fontSize: 12,
              borderBottom: '1px solid var(--border-subtle)',
            }}
          >
            {t('app.bannerOffline', { error })}
            <code style={{ marginLeft: 6 }}>{t('app.bannerCmd')}</code>
          </div>
        )}

        <div className="shell">
          <LeftSidebar
            projects={snapshot.projects}
            sessions={snapshot.sessions}
            activeProjectId={snapshot.activeProjectId}
            activeSessionId={snapshot.activeSessionId}
            busySessionIds={busySessionIds}
            onSelectSession={(s) => void activateSession(s)}
            onSelectProject={(p) => void activateProject(p.id).catch((e) => alert(String(e)))}
            onNewSession={onNewSession}
            onOpenProject={onOpenProject}
            onDeleteProject={onDeleteProject}
            onDeleteSession={onDeleteSession}
            onSeedDemo={() => void seedDemo().catch((e) => alert(String(e)))}
          />

          <ChatWorkspace
            project={activeProject}
            session={activeSession}
            sessions={snapshot.sessions}
            projects={snapshot.projects}
            serverUp={serverUp}
            onModeChange={onModeChange}
            onOpenSettings={() => setSettingsOpen(true)}
            settingsOpen={settingsOpen}
            onBusySessionsChange={setBusySessionIds}
          />

          <RightPanel
            workers={snapshot.workers}
            approvals={snapshot.approvals ?? []}
            projectId={activeProject?.id ?? null}
            sessionId={activeSession?.id ?? null}
            memoryThreadId={activeSession?.memoryThreadId ?? null}
            onToggle={(id, enabled) => void toggleWorker(id, enabled)}
            onHealth={(id, depth) => void healthWorker(id, depth)}
            onHealthAll={() => healthAllWorkers()}
            onSetRoles={(id, body) => void setWorkerRoles(id, body)}
            onSetModel={(id, model) => void setWorkerModel(id, model)}
            onFetchModels={(id) => fetchWorkerModels(id)}
            onResolveApproval={(id, decision) =>
              void resolveApproval(id, decision).catch((e) => alert(String(e)))
            }
            onDemoApproval={() => void demoApproval().catch((e) => alert(String(e)))}
            onRegisterWorker={(body) => registerWorker(body)}
            onDetectWorkers={() => detectWorkers({ apply: true })}
            onRefreshSnapshot={() => void refresh()}
          />
        </div>

        <div className="statusbar">
          <span className="dot-live" style={{ opacity: serverUp ? 1 : 0.3 }} />
          <span>{serverUp ? t('app.mastraConnected') : t('app.mastraOffline')}</span>
          <span>·</span>
          <span>
            {t('app.workersCount', {
              n: snapshot.workers.filter((w) => w.enabled).length,
            })}
          </span>
          {activeProject?.defaultBranch && (
            <>
              <span>·</span>
              <span className="mono">{activeProject.defaultBranch}</span>
            </>
          )}
          <div className="spacer" />
          <span>
            {loading
              ? t('app.loading')
              : activeSession
                ? `${t(modeLabelKey(activeSession.mode))} · ${t('app.modeSuffix')}`
                : t('app.idle')}
          </span>
        </div>
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
        <AppShell {...state} />
      </I18nProvider>
    </ThemeProvider>
  )
}
