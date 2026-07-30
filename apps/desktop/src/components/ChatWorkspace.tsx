import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { evaluateTeamTemplateAvailability } from '@swarmdesk-agent/shared'
import type {
  ApprovalItem,
  LeaderMode,
  Project,
  Session,
  SessionPermissionMode,
  TeamTemplate,
  WorkerJob,
  WorkerRegistration,
} from '@swarmdesk-agent/shared'
import type { PendingNewSession } from '../hooks/useAppState'
import { api } from '../lib/api'
import { ChatPanel } from './ChatPanel'
import { BrandLogo } from './BrandLogo'
import { BranchSwitcher } from './BranchSwitcher'
import { ComposerToolbar, type ModelOption, type TeamTemplateOption } from './ComposerToolbar'
import { useI18n } from '../i18n/I18nProvider'
import type { MessageKey } from '../i18n/locales'
import { THINKING_INTENSITY_OPTIONS, type ThinkingIntensity } from '../lib/settings'
import { useSendShortcut } from '../hooks/useSendShortcut'
import { useComposing } from '../hooks/useComposing'
import { isComposerSendKey } from '../lib/send-shortcut'
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
  /** Inline rename from chat header: (sessionId, newTitle) */
  onRenameSession?: (sessionId: string, title: string) => void
  onOpenSettings?: (tab?: 'general' | 'model' | 'prompts' | 'workers' | 'about') => void
  /** Fired after an action mutates server-side session state (e.g. context
   * compression) so the parent can re-fetch the snapshot. */
  onRefreshSnapshot?: () => void
  settingsOpen?: boolean
  onBusySessionsChange?: (busyIds: Set<string>) => void
  onSetPermissionMode?: (
    sessionId: string,
    permissionMode: SessionPermissionMode,
  ) => void | Promise<void>
  onSessionStatusChange?: (
    sessionId: string,
    status: Session['status'],
    opts?: { lastChatError?: string | null },
  ) => void | Promise<void>
  snapshotApprovals: ApprovalItem[]
  snapshotJobs: WorkerJob[]
  snapshotWorkers: WorkerRegistration[]
  snapshotTeamTemplates: TeamTemplate[]
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
   *  preselected permission mode from the toolbar. */
  onComposeFirstMessage?: (
    text: string,
    preset: {
      permissionMode: SessionPermissionMode
      teamTemplateId?: string
    },
  ) => Promise<boolean>
  /** Click handler for the "open folder" chip on the empty-state composer (scene 1, no project). */
  onPickFolder?: () => void
  /** Pre-fill text to inject into a specific session's composer (once). */
  pendingComposerForSession?: { sessionId: string; text: string; autoSend: boolean } | null
  /** Fired when the matching ChatPanel has consumed pendingComposerForSession. */
  onInitialInputConsumed?: () => void
  /** True while the empty-state composer is creating a session (disables the input). */
  creatingFromComposer?: boolean
  /** Pending new session (not yet on server). Created on first message send. */
  pendingNewSession?: PendingNewSession | null
  /** Clear the pending new session state. */
  clearPendingSession?: () => void
  /** Create a session on the server (used by transport on first message send). */
  createSession?: (
    title: string | undefined,
    mode?: LeaderMode,
    explicitProjectId?: string,
    memoryThreadId?: string,
  ) => Promise<Session>
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
  onRenameSession,
  onOpenSettings,
  onRefreshSnapshot,
  settingsOpen,
  onBusySessionsChange,
  onSetPermissionMode,
  onSessionStatusChange,
  snapshotApprovals,
  snapshotJobs,
  snapshotWorkers,
  snapshotTeamTemplates,
  resolving = {},
  onResolveApproval,
  onResetContext,
  inspectorOpen,
  onToggleInspector,
  onRefreshGit,
  onComposeFirstMessage,
  onPickFolder,
  pendingComposerForSession,
  onInitialInputConsumed,
  creatingFromComposer,
  pendingNewSession,
  clearPendingSession,
  createSession,
}: Props) {
  const { t, locale } = useI18n()
  const { sendShortcut } = useSendShortcut()
  const { composing, onCompositionStart, onCompositionEnd } = useComposing()
  const [aliveIds, setAliveIds] = useState<string[]>([])
  const [busyMap, setBusyMap] = useState<Record<string, boolean>>({})
  const lastBusyKeyRef = useRef('')
  const [firstMessage, setFirstMessage] = useState('')
  const [selectedTeamTemplateId, setSelectedTeamTemplateId] = useState('')
  // —— Empty-state ComposerToolbar presets (permission / model / thinking) ——
  // Loaded from settings once; selections here are passed to onComposeFirstMessage
  // so the new session inherits them.
  const [presetPermissionMode, setPresetPermissionMode] =
    useState<SessionPermissionMode>('default')
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

  const teamTemplateOptions = useMemo<TeamTemplateOption[]>(
    () =>
      snapshotTeamTemplates.map((template) => {
        const availability = evaluateTeamTemplateAvailability({
          template,
          workers: snapshotWorkers,
          projectId: project?.id,
        })
        return {
          id: template.id,
          name: template.name,
          disabled: !availability.ready,
          reason: availability.ready ? undefined : t('chat.teamNeedsMapping'),
        }
      }),
    [project?.id, snapshotTeamTemplates, snapshotWorkers, t],
  )

  useEffect(() => {
    if (!selectedTeamTemplateId) return
    const selected = teamTemplateOptions.find((option) => option.id === selectedTeamTemplateId)
    if (!selected || selected.disabled) setSelectedTeamTemplateId('')
  }, [selectedTeamTemplateId, teamTemplateOptions])

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
      setSelectedTeamTemplateId('')
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
    const key = [...busy].sort().join(',')
    if (lastBusyKeyRef.current === key) return
    lastBusyKeyRef.current = key
    onBusySessionsChange?.(busy)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onBusySessionsChange is a stable useState setter
  }, [busyMap])

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

  // Show empty composer when no session is active OR when there's a pending new session.
  // IMPORTANT: we do NOT early-return here. Doing so would unmount all ChatPanels
  // (the mounted.map below), destroying their useChat state mid-stream — when the
  // panels remount, the in-flight messages can't be recovered from memory (not yet
  // persisted), so the chat shows an empty "home" placeholder forever. Instead we
  // render the panels hidden and overlay the empty composer on top.
  const showEmptyComposer = !session || pendingNewSession
  const submitFirstMessage = async () => {
    const text = firstMessage.trim()
    if (!text || creatingFromComposer || !serverUp || !onComposeFirstMessage) return
    const sent = await onComposeFirstMessage(text, {
      permissionMode: presetPermissionMode,
      teamTemplateId: selectedTeamTemplateId || undefined,
    })
    if (sent) setFirstMessage('')
  }

  const emptyComposer = showEmptyComposer ? (
    <main className="main home-main home-overlay">
      {/* Titleband only — content must not be window-drag */}
      <div className="window-drag-top" aria-hidden />
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
              void submitFirstMessage()
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
                if (isComposerSendKey(e, sendShortcut, composing())) {
                  e.preventDefault()
                  void submitFirstMessage()
                }
              }}
              onCompositionStart={onCompositionStart}
              onCompositionEnd={onCompositionEnd}
              disabled={!serverUp || creatingFromComposer}
            />
            <div className="composer-tools">
              <ComposerToolbar
                permissionMode={presetPermissionMode}
                selectedModel={presetModel}
                thinkingIntensity={presetThinking}
                models={presetModels}
                modelsLoading={presetModelsLoading}
                tokenCount={0}
                locale={locale}
                persistThinking={false}
                onPermissionModeChange={setPresetPermissionMode}
                onModelChange={setPresetModel}
                onThinkingChange={setPresetThinking}
                onOpenSettings={onOpenSettings}
                teamTemplateOptions={teamTemplateOptions}
                selectedTeamTemplateId={selectedTeamTemplateId}
                onTeamTemplateChange={setSelectedTeamTemplateId}
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
  ) : null

  return (
    <div className="chat-workspace">
      {emptyComposer}
      {mounted.map(({ session: s, project: p }) => {
        // Hide all panels when the empty composer overlay is shown, but keep
        // them MOUNTED so their useChat state survives the overlay.
        const hidden = showEmptyComposer
        const isActive = !hidden && s.id === session.id
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
              initialInput={
                pendingComposerForSession?.sessionId === s.id
                  ? pendingComposerForSession.text
                  : undefined
              }
              autoSendInitialInput={
                pendingComposerForSession?.sessionId === s.id
                  ? pendingComposerForSession.autoSend
                  : false
              }
              onInitialInputConsumed={
                pendingComposerForSession?.sessionId === s.id ? onInitialInputConsumed : undefined
              }
              onRenameSession={
                isActive && onRenameSession ? (title) => onRenameSession(s.id, title) : undefined
              }
              onOpenSettings={onOpenSettings}
              onRefreshSnapshot={onRefreshSnapshot}
              settingsOpen={settingsOpen}
              onBusyChange={(busy) =>
                setBusyMap((prev) => (prev[s.id] === busy ? prev : { ...prev, [s.id]: busy }))
              }
              permissionMode={s.permissionMode}
              onSetPermissionMode={
                onSetPermissionMode ? (mode) => onSetPermissionMode(s.id, mode) : undefined
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
              pendingNewSession={pendingNewSession}
              clearPendingSession={clearPendingSession}
              createSession={createSession}
            />
          </div>
        )
      })}
    </div>
  )
}
