import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { evaluateTeamTemplateAvailability } from '@swarmdesk-agent/shared'
import { useMotionPreference } from '../motion/MotionPreferenceProvider'
import type {
  ApprovalItem,
  CreateTeamMemberInput,
  LeaderMode,
  Project,
  Session,
  SessionPermissionMode,
  TeamMember,
  TeamTemplate,
  UpdateTeamMemberInput,
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
import { resolveModelThinkingIntensity } from '../lib/model-thinking-memory'
import { useSendShortcut } from '../hooks/useSendShortcut'
import { useComposing } from '../hooks/useComposing'
import { isComposerSendKey } from '../lib/send-shortcut'
import { IconArrowUp, IconFolder } from './Icons'
import { ComposerStatusRow } from './chat/ComposerStatusRow'
import { LEADER_MODEL_CHANGED_EVENT, SETTINGS_CLOSED_EVENT } from './SettingsLayer'

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
  permissionFailureCounts?: Record<string, number>
  onSessionStatusChange?: (
    sessionId: string,
    status: Session['status'],
    opts?: { lastChatError?: string | null },
  ) => void | Promise<void>
  snapshotApprovals: ApprovalItem[]
  snapshotJobs: WorkerJob[]
  snapshotWorkers: WorkerRegistration[]
  snapshotTeamMembers: TeamMember[]
  snapshotTeamTemplates: TeamTemplate[]
  resolving?: Record<string, boolean>
  onResolveApproval?: (
    approvalId: string,
    optionId: string | undefined,
    decision: 'allow' | 'deny' | 'cancel',
    surface: 'chat' | 'panel',
  ) => void
  onResetContext?: (jobId: string) => void
  onCreateTeamMember?: (
    sessionId: string,
    body: Omit<CreateTeamMemberInput, 'chatSessionId'>,
  ) => Promise<void>
  onUpdateTeamMember?: (sessionId: string, id: string, body: UpdateTeamMemberInput) => Promise<void>
  onArchiveTeamMember?: (sessionId: string, id: string, expectedRevision: number) => Promise<void>
  onResetTeamMemberSession?: (sessionId: string, id: string) => Promise<void>
  /** Fired after a git branch switch so parents can refresh git panels. */
  onRefreshGit?: () => void
  /** Empty-state composer: fired with the user's first message text + the
   *  preselected permission mode / model / thinking from the toolbar. */
  onComposeFirstMessage?: (
    text: string,
    preset: {
      permissionMode: SessionPermissionMode
      teamTemplateId?: string
      model?: string
      thinking?: ThinkingIntensity
    },
  ) => Promise<boolean>
  /** Click handler for the "open folder" chip on the empty-state composer (scene 1, no project). */
  onPickFolder?: () => void
  /** Pre-fill text to inject into a specific session's composer (once). */
  pendingComposerForSession?: {
    sessionId: string
    text: string
    autoSend: boolean
    model?: string
    thinking?: ThinkingIntensity
  } | null
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
  permissionFailureCounts = {},
  onSessionStatusChange,
  snapshotApprovals,
  snapshotJobs,
  snapshotWorkers,
  snapshotTeamMembers,
  snapshotTeamTemplates,
  resolving = {},
  onResolveApproval,
  onResetContext,
  onCreateTeamMember,
  onUpdateTeamMember,
  onArchiveTeamMember,
  onResetTeamMemberSession,
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
  const { reduceMotion } = useMotionPreference()
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
  const [presetPermissionMode, setPresetPermissionMode] = useState<SessionPermissionMode>('default')
  const [presetModel, setPresetModel] = useState('')
  const [presetThinking, setPresetThinking] = useState<ThinkingIntensity>('medium')
  const [presetModels, setPresetModels] = useState<ModelOption[]>([])
  const [presetModelsLoading, setPresetModelsLoading] = useState(false)
  /** Current preset model + last seen leader (for default-model 联动). */
  const presetModelRef = useRef(presetModel)
  presetModelRef.current = presetModel
  const lastLeaderRef = useRef<string | null>(null)

  const loadPresetModels = useCallback(async () => {
    setPresetModelsLoading(true)
    try {
      const s = await api.getSettings()
      const list: ModelOption[] = []
      for (const p of s.providers) {
        if (!p.configured) continue
        // Built-in disabled via disabledProviderIds; custom/models.dev via enabled flag
        if ((p as { enabled?: boolean }).enabled === false) continue
        for (const m of p.models) {
          // Model-level thinkingIntensities win; fall back to the provider's
          // declared list so models without their own levels aren't 'off'-only.
          const modelThink = (m as { thinkingIntensities?: ThinkingIntensity[] })
            .thinkingIntensities
          const providerThink = (p as { thinkingIntensities?: ThinkingIntensity[] })
            .thinkingIntensities
          const supported = (modelThink ?? providerThink ?? []).filter((x) =>
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
      const prev = presetModelRef.current
      // Home tracks the app default model. When leaderModel changes, always
      // follow it. A one-off pick on Home is kept only while the default is
      // unchanged (existing sessions have their own ChatPanel state).
      const leaderChanged = lastLeaderRef.current !== null && lastLeaderRef.current !== current
      lastLeaderRef.current = current ?? null
      let nextModel = ''
      if (leaderChanged && current && list.some((m) => m.id === current)) {
        nextModel = current
      } else if (prev && list.some((m) => m.id === prev)) {
        nextModel = prev
      } else if (current && list.some((m) => m.id === current)) {
        nextModel = current
      } else {
        nextModel = list[0]?.id ?? current ?? ''
      }
      setPresetModel(nextModel)
      presetModelRef.current = nextModel
      // Chat 1 uses the linked tier calculator; later chats restore a manual
      // level only when this exact model has one in memory.
      const meta = list.find((m) => m.id === nextModel) ?? list[0]
      setPresetThinking(resolveModelThinkingIntensity(nextModel, meta?.thinkingIntensities ?? []))
    } catch (e) {
      console.warn('[ChatWorkspace] load preset models failed', e)
    } finally {
      setPresetModelsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadPresetModels()
  }, [loadPresetModels])

  const handlePresetModelChange = useCallback((modelId: string) => {
    setPresetModel(modelId)
    presetModelRef.current = modelId
  }, [])

  // Home empty-state owns its own model list (not ChatPanel). Re-fetch after
  // settings close or an immediate “设为默认” so the draft composer tracks
  // leaderModel without remounting the app. Existing sessions are untouched.
  useEffect(() => {
    const reload = () => {
      void loadPresetModels()
    }
    window.addEventListener(SETTINGS_CLOSED_EVENT, reload)
    window.addEventListener(LEADER_MODEL_CHANGED_EVENT, reload)
    return () => {
      window.removeEventListener(SETTINGS_CLOSED_EVENT, reload)
      window.removeEventListener(LEADER_MODEL_CHANGED_EVENT, reload)
    }
  }, [loadPresetModels])

  const draftProjectId = pendingNewSession?.projectId ?? project?.id
  const teamTemplateOptions = useMemo<TeamTemplateOption[]>(
    () =>
      snapshotTeamTemplates.map((template) => {
        const availability = evaluateTeamTemplateAvailability({
          template,
          workers: snapshotWorkers,
          projectId: draftProjectId,
        })
        return {
          id: template.id,
          name: template.name,
          disabled: !availability.ready,
          reason: availability.ready ? undefined : t('chat.teamNeedsMapping'),
        }
      }),
    [draftProjectId, snapshotTeamTemplates, snapshotWorkers, t],
  )

  useEffect(() => {
    if (!selectedTeamTemplateId) return
    const selected = teamTemplateOptions.find((option) => option.id === selectedTeamTemplateId)
    if (!selected || selected.disabled) setSelectedTeamTemplateId('')
  }, [selectedTeamTemplateId, teamTemplateOptions])

  const [hintKey, setHintKey] = useState<MessageKey>(() => EMPTY_HINT_KEYS[0]!)
  // remember the last hint so we don't pick it twice in a row
  const lastHintIdxRef = useRef(0)
  const [homeGitRefreshToken, setHomeGitRefreshToken] = useState(0)
  const handleHomeRefreshGit = useCallback(() => {
    setHomeGitRefreshToken((n) => n + 1)
    onRefreshGit?.()
  }, [onRefreshGit])

  // Rotate the empty-state hint each time we (re)enter the empty state.
  // Triggered when session becomes null after having been non-null, or on mount.
  const prevSessionIdRef = useRef<string | null>(session?.id ?? null)
  useEffect(() => {
    const currentSessionId = session?.id ?? null
    // Sidebar “new task” first creates a local draft while the previous
    // ChatPanel remains mounted, so `session` is not necessarily null yet.
    // Both routes render Home and must restore the remembered preset.
    const showingHome = currentSessionId === null || pendingNewSession != null
    if (showingHome) {
      setSelectedTeamTemplateId('')
      // Home stays mounted while a chat is active. Re-read the remembered
      // level when returning here so Chat 1 → New Chat immediately reflects
      // the explicit choice made for the default model in Chat 1.
      const meta = presetModels.find((model) => model.id === presetModel)
      setPresetThinking(resolveModelThinkingIntensity(presetModel, meta?.thinkingIntensities ?? []))
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
  }, [pendingNewSession, presetModel, presetModels, session?.id])

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
  // Home draft must show the project the "+" was clicked on, not the previous
  // active session's project (activeProjectId may lag until activate completes).
  const homeProject = useMemo(() => {
    if (pendingNewSession?.projectId) {
      return (
        projects.find((p) => p.id === pendingNewSession.projectId) ??
        (project?.id === pendingNewSession.projectId ? project : null)
      )
    }
    return project
  }, [pendingNewSession?.projectId, project, projects])

  // Permission is Session-only. Every new draft starts fail-closed, while a
  // one-off draft toggle survives unrelated refreshes until the project changes.
  useEffect(() => {
    setPresetPermissionMode('default')
  }, [homeProject?.id])

  const submitFirstMessage = async () => {
    const text = firstMessage.trim()
    if (!text || creatingFromComposer || !serverUp || !onComposeFirstMessage) return
    const sent = await onComposeFirstMessage(text, {
      permissionMode: presetPermissionMode,
      teamTemplateId: selectedTeamTemplateId || undefined,
      model: presetModel || undefined,
      thinking: presetThinking,
    })
    if (sent) setFirstMessage('')
  }

  const homeTransition = {
    duration: reduceMotion ? 0 : 0.12,
    ease: [0.32, 0.72, 0, 1] as const,
  }

  return (
    <div className="chat-workspace">
      <AnimatePresence initial={false}>
        {showEmptyComposer && (
          <motion.main
            key="home-overlay"
            className="main home-main home-overlay"
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduceMotion ? undefined : { opacity: 0 }}
            transition={homeTransition}
          >
            {/* Titleband only — content must not be window-drag */}
            <div className="window-drag-top" aria-hidden />
            <div className="home">
              <div className="logo-cloud" aria-hidden>
                <BrandLogo size={88} variant="glyph" />
              </div>
              <h1 className="greeting">
                {homeProject ? (
                  <>
                    {t('chat.greeting', { project: '\uE000' }).split('\uE000')[0]}
                    <em>{homeProject.name}</em>
                    {t('chat.greeting', { project: '\uE000' }).split('\uE000')[1]}
                  </>
                ) : (
                  t('chat.greetingNoProject')
                )}
              </h1>
              <p className="home-hint">{t(hintKey)}</p>
              {onComposeFirstMessage && (
                <div className="composer-stack home-composer-stack">
                  <ComposerStatusRow
                    projectId={homeProject?.id}
                    enabled
                    gitRefreshToken={homeGitRefreshToken}
                  />
                  <form
                    className="composer-card home-composer"
                    onSubmit={(e) => {
                      e.preventDefault()
                      void submitFirstMessage()
                    }}
                  >
                    <div className="context-bar">
                      {!homeProject && onPickFolder && (
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
                      {homeProject && (
                        <>
                          <span className="ctx" title={homeProject.rootPath}>
                            <IconFolder size={13} />
                            {homeProject.name}
                          </span>
                          <BranchSwitcher
                            project={homeProject}
                            snapshotWorkers={snapshotWorkers}
                            snapshotJobs={snapshotJobs}
                            onAfterSwitch={handleHomeRefreshGit}
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
                        permissionScope="draft"
                        selectedModel={presetModel}
                        thinkingIntensity={presetThinking}
                        models={presetModels}
                        modelsLoading={presetModelsLoading}
                        tokenCount={0}
                        locale={locale}
                        persistThinking={false}
                        onPermissionModeChange={setPresetPermissionMode}
                        onModelChange={handlePresetModelChange}
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
                        aria-label={
                          creatingFromComposer ? t('common.loading') : t('chat.placeholder')
                        }
                      >
                        {creatingFromComposer ? <span className="send-spinner" /> : <IconArrowUp />}
                      </button>
                    </div>
                  </form>
                </div>
              )}
              {!serverUp && (
                <p className="home-hint" style={{ color: 'var(--danger)' }}>
                  {t('chat.serverDown')}
                </p>
              )}
            </div>
          </motion.main>
        )}
      </AnimatePresence>
      {mounted.map(({ session: s, project: p }) => {
        // Keep panels MOUNTED under the home overlay so useChat state survives.
        // Visual show/hide is opacity crossfade via .active (not display:none).
        const hidden = showEmptyComposer
        const isActive = !hidden && s.id === session.id
        return (
          <div
            key={s.id}
            className={`chat-workspace-pane${isActive ? ' active' : ''}`}
            aria-hidden={!isActive}
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
              initialModel={
                pendingComposerForSession?.sessionId === s.id
                  ? pendingComposerForSession.model
                  : undefined
              }
              initialThinking={
                pendingComposerForSession?.sessionId === s.id
                  ? pendingComposerForSession.thinking
                  : undefined
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
              permissionFailureCount={permissionFailureCounts[s.id] ?? 0}
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
              teamMembers={snapshotTeamMembers.filter(
                (role) => role.chatSessionId === s.id && !role.archivedAt,
              )}
              resolving={resolving}
              onResolveApproval={onResolveApproval}
              onResetContext={onResetContext}
              onCreateTeamMember={
                onCreateTeamMember ? (body) => onCreateTeamMember(s.id, body) : undefined
              }
              onUpdateTeamMember={
                onUpdateTeamMember ? (id, body) => onUpdateTeamMember(s.id, id, body) : undefined
              }
              onArchiveTeamMember={
                onArchiveTeamMember ? (id, rev) => onArchiveTeamMember(s.id, id, rev) : undefined
              }
              onResetTeamMemberSession={
                onResetTeamMemberSession ? (id) => onResetTeamMemberSession(s.id, id) : undefined
              }
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
