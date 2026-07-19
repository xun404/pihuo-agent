import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ApprovalItem,
  LeaderMode,
  Project,
  Session,
  SessionApprovalPolicy,
  WorkerJob,
  WorkerRegistration,
} from '@swarmdesk-agent/shared'
import { api } from '../lib/api'
import { ChatPanel } from './ChatPanel'
import { BrandLogo } from './BrandLogo'
import { BranchSwitcher } from './BranchSwitcher'
import { ComposerToolbar, type ModelOption } from './ComposerToolbar'
import { useI18n } from '../i18n/I18nProvider'
import type { MessageKey } from '../i18n/locales'
import {
  THINKING_INTENSITY_OPTIONS,
  type ThinkingIntensity,
} from '../lib/settings'
import { IconArrowUp, IconFolder } from './Icons'

/**
 * Empty-state hint pool. Each time the user lands on the empty Chat state
 * (no session), one hint is shown at random — avoiding repeating the same
 * one twice in a row. All keys are existing i18n entries.
 */
const EMPTY_HINT_KEYS: MessageKey[] = [
  'chat.subhead',
  'chat.hint.compose',
  'chat.hint.capability',
  'chat.hint.start',
]

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
  /** Fired after a git branch switch so parents can refresh git panels. */
  onRefreshGit?: () => void
  /** Empty-state composer: fired with the user's first message text + the
   *  preselected mode / approval policy from the toolbar. */
  onComposeFirstMessage?: (
    text: string,
    preset: { mode: LeaderMode; approvalPolicy: SessionApprovalPolicy },
  ) => void
  /** Click handler for the "open folder" chip on the empty-state composer (scene 1, no project). */
  onPickFolder?: () => void
  /** Pre-fill text to inject into the active session's composer (once). */
  initialInput?: string
  /** Fired when the active ChatPanel has consumed initialInput. */
  onInitialInputConsumed?: () => void
  /** True while the empty-state composer is creating a session (disables the input). */
  creatingFromComposer?: boolean
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
  onRefreshGit,
  onComposeFirstMessage,
  onPickFolder,
  initialInput,
  onInitialInputConsumed,
  creatingFromComposer,
}: Props) {
  const { t, locale } = useI18n()
  const [aliveIds, setAliveIds] = useState<string[]>([])
  const [busyMap, setBusyMap] = useState<Record<string, boolean>>({})
  const [firstMessage, setFirstMessage] = useState('')
  // —— Empty-state ComposerToolbar presets (mode / approval / model / thinking) ——
  // Loaded from settings once; selections here are passed to onComposeFirstMessage
  // so the new session inherits them.
  const [presetMode, setPresetMode] = useState<LeaderMode>('build')
  const [presetPolicy, setPresetPolicy] = useState<SessionApprovalPolicy>('manual')
  const [presetModel, setPresetModel] = useState('')
  const [presetThinking, setPresetThinking] = useState<ThinkingIntensity>('medium')
  const [presetModels, setPresetModels] = useState<ModelOption[]>([])
  const [presetModelsLoading, setPresetModelsLoading] = useState(false)

  const loadPresetModels = useCallback(async () => {
    setPresetModelsLoading(true)
    try {
      const s = await api.getSettings()
      const list: ModelOption[] = []
      for (const p of s.providers) {
        if (!p.configured) continue
        if (p.custom && (p as { enabled?: boolean }).enabled === false) continue
        for (const m of p.models) {
          const modelThink = (m as { thinkingIntensities?: ThinkingIntensity[] })
            .thinkingIntensities
          const supported = (modelThink ?? []).filter((x) =>
            THINKING_INTENSITY_OPTIONS.includes(x),
          ) as ThinkingIntensity[]
          list.push({
            id: m.id,
            label: m.label,
            providerId: p.id,
            providerName: p.name,
            configured: true,
            contextWindow: (m as { contextWindow?: number }).contextWindow,
            thinkingIntensities:
              supported.length > 0 ? supported : (['off'] as ThinkingIntensity[]),
          })
        }
      }
      setPresetModels(list)
      const current = s.settings.leaderModel
      setPresetModel((prev) => {
        if (prev && list.some((m) => m.id === prev)) return prev
        if (current && list.some((m) => m.id === current)) return current
        return list[0]?.id ?? current ?? ''
      })
      const preferred = s.settings.thinkingIntensity
      setPresetThinking(
        preferred && THINKING_INTENSITY_OPTIONS.includes(preferred) ? preferred : 'medium',
      )
    } catch (e) {
      console.warn('[ChatWorkspace] load preset models failed', e)
    } finally {
      setPresetModelsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadPresetModels()
  }, [loadPresetModels])

  const [hintKey, setHintKey] = useState<MessageKey>(() => EMPTY_HINT_KEYS[0]!)
  // remember the last hint so we don't pick it twice in a row
  const lastHintIdxRef = useRef(0)

  // Rotate the empty-state hint each time we (re)enter the empty state.
  // Triggered when session becomes null after having been non-null, or on mount.
  const prevSessionIdRef = useRef<string | null>(session?.id ?? null)
  useEffect(() => {
    const currentSessionId = session?.id ?? null
    const enteredEmpty = currentSessionId === null
    if (enteredEmpty) {
      // pick a random index != lastHintIdxRef (when pool > 1)
      let next = lastHintIdxRef.current
      if (EMPTY_HINT_KEYS.length > 1) {
        while (next === lastHintIdxRef.current) {
          next = Math.floor(Math.random() * EMPTY_HINT_KEYS.length)
        }
      }
      lastHintIdxRef.current = next
      setHintKey(EMPTY_HINT_KEYS[next]!)
    }
    prevSessionIdRef.current = currentSessionId
  }, [session?.id])

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
            <BrandLogo size={88} />
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
          <p className="home-hint">{t(hintKey)}</p>
          {onComposeFirstMessage && (
            <form
              className="composer-card home-composer"
              onSubmit={(e) => {
                e.preventDefault()
                const text = firstMessage.trim()
                if (!text || creatingFromComposer || !serverUp) return
                onComposeFirstMessage(text, {
                  mode: presetMode,
                  approvalPolicy: presetPolicy,
                })
              }}
            >
              <div className="context-bar">
                {!project && onPickFolder && (
                  <button
                    type="button"
                    className="ctx"
                    onClick={(e) => {
                      e.preventDefault()
                      onPickFolder()
                    }}
                  >
                    <IconFolder size={13} />
                    {t('chat.openFolder')}
                  </button>
                )}
                {project && (
                  <>
                    <span className="ctx" title={project.rootPath}>
                      <IconFolder size={13} />
                      {project.name}
                    </span>
                    <BranchSwitcher
                      project={project}
                      snapshotWorkers={snapshotWorkers}
                      snapshotJobs={snapshotJobs}
                      onAfterSwitch={onRefreshGit}
                    />
                  </>
                )}
              </div>
              <textarea
                className="composer-input"
                value={firstMessage}
                onChange={(e) => setFirstMessage(e.target.value)}
                placeholder={t('chat.placeholderHome')}
                rows={3}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    const text = firstMessage.trim()
                    if (text && !creatingFromComposer && serverUp)
                      onComposeFirstMessage(text, {
                        mode: presetMode,
                        approvalPolicy: presetPolicy,
                      })
                  }
                }}
                disabled={!serverUp || creatingFromComposer}
              />
              <div className="composer-tools">
                <ComposerToolbar
                  mode={presetMode}
                  approvalPolicy={presetPolicy}
                  selectedModel={presetModel}
                  thinkingIntensity={presetThinking}
                  models={presetModels}
                  modelsLoading={presetModelsLoading}
                  tokenCount={0}
                  locale={locale}
                  persistThinking={false}
                  onModeChange={setPresetMode}
                  onApprovalPolicyChange={setPresetPolicy}
                  onModelChange={setPresetModel}
                  onThinkingChange={setPresetThinking}
                  onOpenSettings={onOpenSettings}
                />
                <button
                  type="submit"
                  className={`send${creatingFromComposer ? ' sending' : ''}`}
                  disabled={!firstMessage.trim() || !serverUp || creatingFromComposer}
                  title={creatingFromComposer ? t('common.loading') : t('chat.placeholder')}
                  aria-label={creatingFromComposer ? t('common.loading') : t('chat.placeholder')}
                >
                  {creatingFromComposer ? <span className="send-spinner" /> : <IconArrowUp />}
                </button>
              </div>
            </form>
          )}
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
              initialInput={isActive ? initialInput : undefined}
              onInitialInputConsumed={isActive ? onInitialInputConsumed : undefined}
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
              onRefreshGit={onRefreshGit}
            />
          </div>
        )
      })}
    </div>
  )
}
