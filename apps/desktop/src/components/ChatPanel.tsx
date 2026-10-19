import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, Copy, DatabaseCheck, DatabaseX } from 'lucide-react'
import { useMotionPreference } from '../motion/MotionPreferenceProvider'

import type {
  ApprovalItem,
  CreateTeamMemberInput,
  LeaderMode,
  Project,
  Session,
  SessionPermissionMode,
  TeamMember,
  UpdateTeamMemberInput,
  WorkerJob,
  WorkerRegistration,
} from '@pihuo-agent/shared'
import { isJobOpen, isPlaceholderSessionTitle } from '@pihuo-agent/shared'
import { shouldAnimateSessionTitleTransition } from '../lib/session-title-animation'
import type { PendingNewSession } from '../hooks/useAppState'
import { api, type ProjectMemorySnapshot } from '../lib/api'
import { useLeaderChat } from '../hooks/useLeaderChat'
import type { FollowUpCoordinator } from '../lib/follow-up-coordinator'
import { useI18n } from '../i18n/I18nProvider'
import { THINKING_INTENSITY_OPTIONS, type ThinkingIntensity } from '../lib/settings'
import { resolveModelThinkingIntensity } from '../lib/model-thinking-memory'
import { formatChatError, serializeChatErrorForSticky } from '../lib/chat-errors'

import { ChatMessageList } from './chat/ChatMessageList'
import { ImComposerChrome, ImMentionPicker, ImQuoteDock } from './chat/ImComposerChrome'
import { useImComposer } from '../hooks/useImComposer'
import { ComposerStatusRow } from './chat/ComposerStatusRow'
import {
  GroupDiscussionCoordinationStrip,
  GroupDiscussionHeader,
  GroupDiscussionParticipantStack,
} from './chat/GroupDiscussionHeader'
import { TurnNavigator } from './chat/TurnNavigator'
import { IconApprovals, IconArrowUp, IconCrew, IconEdit, IconFolder } from './Icons'
import { RightPanel, type InspectorTab } from './RightPanel'
import type { MemoryPanelError } from './MemoryPanel'
import { BranchSwitcher } from './BranchSwitcher'
import { ComposerToolbar } from './ComposerToolbar'
import { type CompactionMarkerData } from './CompactionMarker'
import { useToast } from './Toast'
import { useSendShortcut } from '../hooks/useSendShortcut'
import { useFollowUpBehavior } from '../hooks/useFollowUpBehavior'
import { useFollowUpCoordinator } from '../hooks/useFollowUpCoordinator'
import { useComposing } from '../hooks/useComposing'
import { isComposerSendKey } from '../lib/send-shortcut'
import { findLatestActionableBudget, buildContinuePrompt } from '../lib/leader-step-budget'
import { findLatestTaskList } from '../lib/find-latest-task-list'
import { formatTokenCountDisplay } from '../lib/context-window'
import { approvalsForSession } from '../lib/session-approvals'
import { findCurrentTurnAssistant, type ClientTurnMeta } from '../lib/leader-run-meta'
import {
  workerRunReducer,
  seedWorkerStates,
  cleanupTerminalWorkers,
  seedAcpResetMarkers,
  seedWorkerStatesFromSnapshot,
} from '../lib/worker-run-reducer'
import { projectWorkerCardPlacements, type WorkerCardPlacement } from '../lib/worker-card-placement'
import { deriveGroupDiscussionState } from '../lib/group-discussion'
import type { WorkerRunEvent, WorkerRunState, LeaderStepBudgetEvent } from '@pihuo-agent/shared'
import { QueueChips } from './chat/QueueChips'

type ModelOption = {
  id: string
  label: string
  providerId: string
  providerName: string
  configured: boolean
  /** Supported thinking levels for this provider (preset for builtins) */
  thinkingIntensities: ThinkingIntensity[]
  /** Model context window tokens when known */
  contextWindow?: number
}

/**
 * Pick the thinking intensity for a model.
 * Strategy: from the model's supported levels, take the HIGHEST one
 * (max > xhigh > high > medium > low > off). The global `preferred` and the
 * option order are ignored — we always default to the strongest level the
 * model actually supports. Empty supported → 'off'.
 */
interface Props {
  project: Project | null
  session: Session
  serverUp: boolean
  /** Visible pane (vs keep-alive hidden for parallel sessions) */
  isActive?: boolean
  /** Inline rename from the chat header. Receives the new title; the parent
   *  decides whether to actually persist (e.g. skip if unchanged / empty). */
  onRenameSession?: (title: string) => void
  /** Open settings panel; optionally pin a tab (e.g. 'model' for model-config entries). */
  onOpenSettings?: (tab?: 'general' | 'model' | 'prompts' | 'workers' | 'about') => void
  /** Fired after an action mutates server-side session state (e.g. context
   * compression) so the parent can re-fetch the snapshot. */
  onRefreshSnapshot?: () => void
  /** When settings closes, reload available models */
  settingsOpen?: boolean
  /** Report streaming/busy so sidebar can show parallel activity */
  onBusyChange?: (busy: boolean) => void
  /** Approval policy and resolution */
  permissionMode: SessionPermissionMode
  permissionFailureCount?: number
  onSetPermissionMode?: (mode: SessionPermissionMode) => void | Promise<void>
  resolving?: Record<string, boolean>
  onResolveApproval?: (
    approvalId: string,
    optionId: string | undefined,
    decision: 'allow' | 'deny' | 'cancel',
    surface: 'chat' | 'panel',
  ) => void
  onResetContext?: (jobId: string) => void
  snapshotApprovals: ApprovalItem[]
  snapshotJobs: WorkerJob[]
  snapshotWorkers: WorkerRegistration[]
  /** Active session crew members (not archived). */
  teamMembers?: TeamMember[]
  onCreateTeamMember?: (body: Omit<CreateTeamMemberInput, 'chatSessionId'>) => Promise<void>
  onUpdateTeamMember?: (id: string, body: UpdateTeamMemberInput) => Promise<void>
  onArchiveTeamMember?: (id: string, expectedRevision: number) => Promise<void>
  onResetTeamMemberSession?: (id: string) => Promise<void>
  /** Fired after a successful git branch switch so parents can refresh git panels. */
  onRefreshGit?: () => void
  /** Pre-fill the composer once (e.g. text typed on the empty-state composer). */
  initialInput?: string
  /** When true, also auto-send initialInput after pre-filling (new-session flow). */
  autoSendInitialInput?: boolean
  /** Model chosen on the empty-state composer for the new session's first message. */
  initialModel?: string
  /** Thinking intensity chosen on the empty-state composer (new-session flow). */
  initialThinking?: ThinkingIntensity
  /** Fired when initialInput has been applied so the parent can clear it. */
  onInitialInputConsumed?: () => void
  /** Persist session status + sticky chat error for sidebar / reload */
  onSessionStatusChange?: (
    status: Session['status'],
    opts?: { lastChatError?: string | null },
  ) => void | Promise<void>
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

const THINK_LABEL_KEY: Record<
  ThinkingIntensity,
  | 'chat.think.off'
  | 'chat.think.low'
  | 'chat.think.medium'
  | 'chat.think.high'
  | 'chat.think.xhigh'
  | 'chat.think.max'
> = {
  off: 'chat.think.off',
  low: 'chat.think.low',
  medium: 'chat.think.medium',
  high: 'chat.think.high',
  xhigh: 'chat.think.xhigh',
  max: 'chat.think.max',
}

export function ChatPanel({
  project,
  session,
  serverUp: _serverUp,
  isActive = true,
  onRenameSession,
  onOpenSettings,
  onRefreshSnapshot,
  settingsOpen: _settingsOpen,
  onBusyChange,
  permissionMode,
  permissionFailureCount = 0,
  onSetPermissionMode,
  resolving = {},
  onResolveApproval,
  onResetContext,
  snapshotApprovals,
  snapshotJobs,
  snapshotWorkers,
  teamMembers = [],
  onCreateTeamMember,
  onUpdateTeamMember,
  onArchiveTeamMember,
  onResetTeamMemberSession,
  onRefreshGit,
  initialInput,
  autoSendInitialInput,
  initialModel,
  initialThinking,
  onInitialInputConsumed,
  onSessionStatusChange,
  pendingNewSession,
  clearPendingSession,
  createSession,
}: Props) {
  const { t, locale } = useI18n()
  const { reduceMotion } = useMotionPreference()
  const { sendShortcut } = useSendShortcut()
  const { followUpBehavior } = useFollowUpBehavior()
  const { composing, onCompositionStart, onCompositionEnd } = useComposing()
  const [input, setInput] = useState('')
  const im = useImComposer({
    teamMembers,
    workers: snapshotWorkers,
    leaderName: t('chat.discussionLeader'),
  })
  /** Tracks the initialInput value already consumed, so we apply each text once. */
  const consumedInitialInputRef = useRef<string | undefined>(undefined)
  /** When initialInput arrives with autoSendInitialInput, the text is staged
   *  here and fired by the autoSend effect once a model is selected. */
  const pendingAutoSendRef = useRef<string | null>(null)
  /** Prevent repeated Settings popups while the staged initial prompt waits
   * for a configured model. The text remains available in the composer. */
  const pendingAutoSendModelPromptedRef = useRef(false)
  useEffect(() => {
    if (initialInput && initialInput !== consumedInitialInputRef.current) {
      consumedInitialInputRef.current = initialInput
      setInput(initialInput)
      if (autoSendInitialInput) {
        pendingAutoSendRef.current = initialInput
        pendingAutoSendModelPromptedRef.current = false
      } else {
        onInitialInputConsumed?.()
      }
    }
  }, [initialInput, autoSendInitialInput, onInitialInputConsumed])
  const [models, setModels] = useState<ModelOption[]>([])
  const [selectedModel, setSelectedModel] = useState<string>('')
  const [thinkingIntensity, setThinkingIntensity] = useState<ThinkingIntensity>('medium')
  const [modelsLoading, setModelsLoading] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(true)
  /** User toggles for collapsed tool/thinking rows (keyed by msgId:partIndex) */
  const [metaOpen, setMetaOpen] = useState<Record<string, boolean>>({})
  /** Inline title editing in the chat header */
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  /** Typewriter effect for auto-named titles */
  const [typingTitle, setTypingTitle] = useState<string | null>(null)
  const typingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const typingFullRef = useRef('')
  const prevSessionTitleRef = useRef({
    id: session.id,
    title: session.title,
    titleSource: session.titleSource,
  })
  /** Compaction separators in the timeline (one per compress action). Each
   * carries an `afterMessageId` so it renders at the right spot in the stream. */
  const [compactionMarkers, setCompactionMarkers] = useState<CompactionMarkerData[]>([])
  /** Header bubble: crew / approvals (null = closed). */
  const [inspectorTab, setInspectorTab] = useState<InspectorTab | null>(null)
  const [projectMemory, setProjectMemory] = useState<ProjectMemorySnapshot | null>(null)
  const [projectMemoryLoading, setProjectMemoryLoading] = useState(false)
  const [projectMemorySaving, setProjectMemorySaving] = useState(false)
  const [projectMemoryError, setProjectMemoryError] = useState<MemoryPanelError | null>(null)
  const inspectorAnchorRef = useRef<HTMLDivElement>(null)
  const { success: toastSuccess, error: toastError } = useToast()
  const titleInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!isActive) setInspectorTab(null)
  }, [isActive])

  useEffect(() => {
    if (!inspectorTab) return
    const isPortaledOverlay = (target: EventTarget | null) => {
      const el = target instanceof Element ? target : null
      return Boolean(
        el?.closest?.(
          '.modal-overlay-anim, .text-prompt-overlay, .settings-overlay, [role="dialog"][aria-modal="true"]',
        ),
      )
    }
    const onDown = (event: MouseEvent) => {
      if (inspectorAnchorRef.current?.contains(event.target as Node)) return
      // Role / template modals portal to body — keep the bubble open.
      if (isPortaledOverlay(event.target)) return
      setInspectorTab(null)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (
        isPortaledOverlay(document.activeElement) ||
        document.querySelector('.modal-overlay-anim')
      )
        return
      setInspectorTab(null)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [inspectorTab])

  const sessionApprovals = useMemo(() => {
    return approvalsForSession(snapshotApprovals, snapshotJobs, session.id)
  }, [session.id, snapshotApprovals, snapshotJobs])

  const pendingApprovalCount = useMemo(
    () => sessionApprovals.filter((item) => item.status === 'pending').length,
    [sessionApprovals],
  )

  const toggleInspectorTab = useCallback((tab: InspectorTab) => {
    setInspectorTab((current) => (current === tab ? null : tab))
  }, [])

  const inspectorBubbleMotion = useMemo(
    () =>
      reduceMotion
        ? {
            initial: { opacity: 0 },
            animate: { opacity: 1 },
            exit: { opacity: 0 },
            transition: { duration: 0.12 },
          }
        : {
            initial: { opacity: 0, y: -6, scale: 0.96 },
            animate: { opacity: 1, y: 0, scale: 1 },
            exit: { opacity: 0, y: -4, scale: 0.98 },
            transition: { duration: 0.18, ease: [0.32, 0.72, 0, 1] as const },
          },
    [reduceMotion],
  )

  const inspectorPanelMotion = useMemo(
    () =>
      reduceMotion
        ? {
            initial: { opacity: 0 },
            animate: { opacity: 1 },
            exit: { opacity: 0 },
            transition: { duration: 0.1 },
          }
        : {
            initial: { opacity: 0, x: 8 },
            animate: { opacity: 1, x: 0 },
            exit: { opacity: 0, x: -8 },
            transition: { duration: 0.14, ease: [0.32, 0.72, 0, 1] as const },
          },
    [reduceMotion],
  )
  const memoryIconMotion = useMemo(
    () =>
      reduceMotion
        ? {
            initial: { opacity: 0 },
            animate: { opacity: 1 },
            exit: { opacity: 0 },
            transition: { duration: 0.12 },
          }
        : {
            initial: { opacity: 0, scale: 0.72, rotate: -18 },
            animate: { opacity: 1, scale: 1, rotate: 0 },
            exit: { opacity: 0, scale: 0.72, rotate: 18 },
            transition: { duration: 0.2, ease: [0.32, 0.72, 0, 1] as const },
          },
    [reduceMotion],
  )
  const bottomRef = useRef<HTMLDivElement>(null)
  /** messages-scroll 容器：TurnNavigator 跳转 + 滚动监听用 */
  const messagesScrollRef = useRef<HTMLDivElement>(null)
  /**
   * Chat instance we've successfully hydrated from memory. Keyed by the
   * Leader chat store thread (not a transport object): a remounted panel
   * starts empty, and skipping reload leaves the keep-alive pane stuck on
   * the empty "home" layout forever.
   */
  const historyHydratedChat = useRef<string | null>(null)
  /** Bumped when an active empty pane needs another history attempt. */
  const [historyReloadToken, setHistoryReloadToken] = useState(0)
  /** Follow-up coordinator lives beside the Leader chat store. */
  const followUpCoordinatorRef = useRef<FollowUpCoordinator | null>(null)
  // Keep latest model / thinking for transport body (avoid stale closure)
  const selectedModelRef = useRef(selectedModel)
  selectedModelRef.current = selectedModel
  const thinkingIntensityRef = useRef(thinkingIntensity)
  thinkingIntensityRef.current = thinkingIntensity
  /** Track tool start times (keyed by metaKey) for execution duration */
  const toolStartTimes = useRef<Map<string, number>>(new Map())
  const toolDurations = useRef<Map<string, number>>(new Map())
  /** Per-assistant-turn: wall clock + model/thinking at start (UI user text has no wire context) */
  const turnTimingRef = useRef<Map<string, ClientTurnMeta>>(new Map())
  const [timingEpoch, setTimingEpoch] = useState(0)
  /** Accumulated worker run states keyed by jobId (live + history) */
  const [workerStates, setWorkerStates] = useState<Map<string, WorkerRunState>>(new Map())
  /** Terminal worker states moved from workerStates after cleanup */
  const terminalWorkerStatesRef = useRef<Map<string, WorkerRunState>>(new Map())

  const registryIdentityFor = useCallback(
    (state: WorkerRunState): string | undefined => {
      const worker = state.workerId
        ? snapshotWorkers.find((candidate) => candidate.id === state.workerId)
        : undefined
      return worker?.source?.type === 'registry'
        ? `${worker.source.registryId}@${worker.source.registryVersion}`
        : undefined
    },
    [snapshotWorkers],
  )

  const [activeBudgetEvent, setActiveBudgetEvent] = useState<LeaderStepBudgetEvent | null>(null)
  const [canContinueBudget, setCanContinueBudget] = useState(false)
  /** Tick counter to trigger re-renders for live tool duration updates */
  const [tick, setTick] = useState(0)
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const localeRef = useRef(locale)
  localeRef.current = locale
  const projectRef = useRef(project)
  projectRef.current = project
  const sessionRef = useRef(session)
  sessionRef.current = session
  const pendingNewSessionRef = useRef(pendingNewSession)
  pendingNewSessionRef.current = pendingNewSession
  const createSessionRef = useRef(createSession)
  createSessionRef.current = createSession
  const clearPendingSessionRef = useRef(clearPendingSession)
  clearPendingSessionRef.current = clearPendingSession

  // Bind Leader JSONL thread / project memory so working memory can run
  const memoryThreadId = session.memoryThreadId ?? session.id
  const projectId = project?.id
  const memoryResourceId = project?.id ?? session.projectId ?? 'default-resource'
  const hasPendingNewSession = Boolean(pendingNewSession)
  const currentProjectMemory = projectMemory?.projectId === project?.id ? projectMemory : null
  const memoryEnabled = currentProjectMemory?.enabled ?? project?.memoryEnabled !== false

  const handleMemoryToggle = useCallback(
    async (enabled: boolean) => {
      if (!project || projectMemorySaving) return
      setProjectMemorySaving(true)
      setProjectMemoryError(null)
      try {
        const result = await api.setProjectMemoryEnabled(project.id, enabled)
        setProjectMemory((current) =>
          current
            ? {
                ...current,
                enabled: result.project.memoryEnabled !== false,
                workingMemory: result.project.memoryEnabled !== false,
              }
            : current,
        )
        onRefreshSnapshot?.()
      } catch (error) {
        console.warn('[ChatPanel] project memory toggle failed', error)
        setProjectMemoryError('toggle')
        toastError(t('memory.toggleFailed'))
      } finally {
        setProjectMemorySaving(false)
      }
    },
    [onRefreshSnapshot, project, projectMemorySaving, t, toastError],
  )

  const handleMemorySave = useCallback(
    async (content: string) => {
      if (!project || !currentProjectMemory || projectMemorySaving) return false
      setProjectMemorySaving(true)
      setProjectMemoryError(null)
      try {
        const snapshot = await api.updateProjectWorkingMemory(project.id, memoryThreadId, content)
        setProjectMemory(snapshot)
        onRefreshSnapshot?.()
        toastSuccess(t('memory.saved'))
        return true
      } catch (error) {
        console.warn('[ChatPanel] project memory save failed', error)
        setProjectMemoryError('save')
        toastError(t('memory.saveFailed'))
        return false
      } finally {
        setProjectMemorySaving(false)
      }
    },
    [
      memoryThreadId,
      onRefreshSnapshot,
      project,
      currentProjectMemory,
      projectMemorySaving,
      t,
      toastError,
      toastSuccess,
    ],
  )

  useEffect(() => {
    if (!isActive || !projectId || hasPendingNewSession) {
      setProjectMemory(null)
      setProjectMemoryLoading(false)
      setProjectMemoryError(null)
      return
    }
    let cancelled = false
    setProjectMemory(null)
    setProjectMemoryLoading(true)
    setProjectMemoryError(null)
    void api
      .getProjectMemory(projectId, memoryThreadId)
      .then((snapshot) => {
        if (cancelled) return
        setProjectMemory(snapshot)
      })
      .catch((error) => {
        if (cancelled) return
        console.warn('[ChatPanel] project memory load failed', error)
        setProjectMemory(null)
        setProjectMemoryError('load')
      })
      .finally(() => {
        if (!cancelled) setProjectMemoryLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [hasPendingNewSession, isActive, memoryThreadId, projectId])

  const loadModels = useCallback(async () => {
    setModelsLoading(true)
    try {
      const s = await api.getSettings()
      // Only show providers that already have an API key configured
      const list: ModelOption[] = []
      for (const p of s.providers) {
        if (!p.configured) continue
        // Custom providers can be toggled off in 模型设置
        if ((p as { enabled?: boolean }).enabled === false) continue
        for (const m of p.models) {
          // Model-level thinkingIntensities win; fall back to the provider's
          // declared list (mirrors the Settings built-in list) so models that
          // don't set their own levels aren't forced to 'off'-only.
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
      setModels(list)
      const current = s.settings.leaderModel
      const previous = selectedModelRef.current
      // Existing session selection is sticky: never clobber a valid previous pick
      // when the app default (leaderModel) changes. Only seed from default when
      // this panel has no selection yet (and no first-message initialModel).
      const nextModel =
        initialModel && list.some((m) => m.id === initialModel)
          ? initialModel
          : previous && list.some((m) => m.id === previous)
            ? previous
            : current && list.some((m) => m.id === current)
              ? current
              : (list[0]?.id ?? current ?? '')
      const modelChanged = nextModel !== previous
      setSelectedModel(nextModel)
      selectedModelRef.current = nextModel
      const meta = list.find((m) => m.id === nextModel) ?? list[0]
      // Only re-seed thinking when model is first chosen or changed — do not
      // overwrite a manual intensity pick on settings reload.
      if (modelChanged || !thinkingIntensityRef.current) {
        const nextThink = resolveModelThinkingIntensity(
          nextModel,
          meta?.thinkingIntensities ?? [],
          {
            preferred: initialThinking,
          },
        )
        setThinkingIntensity(nextThink)
        thinkingIntensityRef.current = nextThink
      }
    } catch (e) {
      console.warn('[ChatPanel] load models failed', e)
    } finally {
      setModelsLoading(false)
    }
  }, [initialModel, initialThinking])

  useEffect(() => {
    void loadModels()
  }, [session.id, loadModels])

  // Compaction markers are per-session timeline artifacts — drop them when the
  // active session changes so a stale "compressing" marker doesn't bleed into
  // another chat.
  useEffect(() => {
    setCompactionMarkers([])
  }, [session.id])

  // After leaving settings, re-fetch so newly configured keys / intensity appear.
  // Event bus (not settingsOpen prop) — avoids re-rendering every ChatPanel on open/close.
  // Only the active panel reloads models to keep close INP small.
  useEffect(() => {
    if (!isActive) return
    const onClosed = () => {
      void loadModels()
    }
    window.addEventListener('pihuo-agent:settings-closed', onClosed)
    return () => window.removeEventListener('pihuo-agent:settings-closed', onClosed)
  }, [loadModels, isActive])

  const {
    messages,
    status,
    error,
    send: sendLeader,
    stop,
    setMessages,
    clearError,
    resume,
    store: leaderStore,
  } = useLeaderChat(memoryThreadId)

  const onSessionStatusChangeRef = useRef(onSessionStatusChange)
  onSessionStatusChangeRef.current = onSessionStatusChange
  /** Updated after i18n errorCopy is built; onError reads latest */
  const errorCopyRef = useRef({
    missingKey: 'Missing API key',
    billing: 'Insufficient balance or inactive subscription',
    rateLimit: 'Provider rate limit hit — retry later or switch models',
    network: 'Network error',
    offline: 'Offline',
    model: 'Model error',
    generic: 'Chat failed',
  })
  const lastStatusPostRef = useRef<string>('')

  const handleChatData = useCallback((dataPart: { type?: string; data?: unknown }) => {
    if (dataPart.type !== 'data-worker-run') return
    const event = dataPart.data as WorkerRunEvent
    setWorkerStates((prev) => workerRunReducer(prev, event))
  }, [])

  const handleChatError = useCallback((err: unknown) => {
    const friendly = formatChatError(err, errorCopyRef.current)
    const sticky = serializeChatErrorForSticky(friendly)
    const key = `error:${sticky}`
    if (lastStatusPostRef.current === key) return
    lastStatusPostRef.current = key
    onSessionStatusChangeRef.current?.('error', { lastChatError: sticky })
  }, [])

  const busy = status === 'submitted' || status === 'streaming'

  const refreshFollowUpHistory = useCallback(async () => {
    const result = await api.getThreadMessages(memoryThreadId, memoryResourceId)
    setMessages(result.messages)
  }, [memoryThreadId, memoryResourceId, setMessages])

  const followUpHistoryReady = !historyLoading && historyHydratedChat.current === memoryThreadId

  const followUp = useFollowUpCoordinator({
    threadId: memoryThreadId,
    historyReady: followUpHistoryReady,
    modelReady: Boolean(selectedModel && models.length > 0),
    send: async ({ id, text, followUp: meta }) => {
      lastStatusPostRef.current = 'running'
      if (error) clearError()
      onSessionStatusChange?.('running', { lastChatError: null })
      followTailRef.current = true
      const pending = pendingNewSessionRef.current
      const createSession = createSessionRef.current
      if (pending && createSession) {
        const created = await createSession(
          undefined,
          pending.mode,
          pending.projectId,
          pending.memoryThreadId,
        )
        sessionRef.current = created
        clearPendingSessionRef.current?.()
      }
      await sendLeader({
        text,
        followUp: meta,
        model: selectedModelRef.current,
        thinking: thinkingIntensityRef.current,
        workMode: sessionRef.current.workMode,
        onAccepted: (accepted) => followUpCoordinatorRef.current?.transportAccepted(accepted),
      })
      void followUpCoordinatorRef.current?.reconcileAndDispatch()
      void id
    },
    stopLocal: () => {
      stop()
    },
    resume: async (clientRunId) => {
      if (clientRunId) await resume(clientRunId)
    },
    refreshHistory: refreshFollowUpHistory,
    onModelRequired: () => onOpenSettings?.('model'),
    onCapacityReached: () => toastError(t('chat.followUpQueueFull')),
    coordinatorRef: followUpCoordinatorRef,
  })

  // Auto-send the staged initial input once a model is available. Models load
  // async after mount; the coordinator also waits for history/run reconciliation.
  useEffect(() => {
    const pending = pendingAutoSendRef.current
    if (!pending || !followUp.snapshot.bootstrapped || modelsLoading) return
    const modelReady = Boolean(selectedModel && models.length > 0)
    if (!modelReady && pendingAutoSendModelPromptedRef.current) return
    const result = followUp.submit(pending, {
      behavior: followUpBehavior,
      preferSteer: false,
      source: 'direct',
    })
    if (result === 'wait') return
    if (result === 'blocked_model') {
      pendingAutoSendModelPromptedRef.current = true
      return
    }
    pendingAutoSendRef.current = null
    pendingAutoSendModelPromptedRef.current = false
    setInput('')
    onInitialInputConsumed?.()
  }, [selectedModel, models, modelsLoading, followUp, followUpBehavior, onInitialInputConsumed])

  // Load persisted history once per chat instance (survives refresh). Retries on
  // transient failure while another session is streaming or React StrictMode
  // double-mounts in dev. Without retry, the session would render the empty
  // "home" state even though the messages exist on disk.
  //
  // Guard is the hydrated thread id: keep-alive ChatPanels never remount on
  // re-select, so skipping reload after a failed first attempt leaves messages
  // empty until a later retry token bump.
  useEffect(() => {
    if (historyHydratedChat.current === memoryThreadId) {
      setHistoryLoading(false)
      return
    }
    let cancelled = false
    setHistoryLoading(true)
    const MAX_ATTEMPTS = 4
    const RETRY_DELAYS = [500, 1500, 3000]
    ;(async () => {
      try {
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
          try {
            const res = await api.getThreadMessages(memoryThreadId, memoryResourceId)
            if (cancelled) return
            if (
              Array.isArray(res.messages) &&
              res.messages.length > 0 &&
              leaderStore.messages.length === 0
            ) {
              setMessages(res.messages)
            }
            historyHydratedChat.current = memoryThreadId
            return
          } catch (e) {
            if (cancelled) return
            if (attempt < MAX_ATTEMPTS - 1) {
              console.warn(
                `[ChatPanel] load history failed (attempt ${attempt + 1}/${MAX_ATTEMPTS}), retrying…`,
                e,
              )
              await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt] ?? 3000))
              if (cancelled) return
            } else {
              console.warn('[ChatPanel] load history failed, giving up', e)
            }
          }
        }
      } finally {
        if (!cancelled) setHistoryLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [memoryThreadId, memoryResourceId, setMessages, historyReloadToken, leaderStore])

  // Keep-alive panels can sit forever on empty "home" after a failed recall or a
  // chat recreation that wiped messages. When this pane becomes active with no
  // messages, force another hydration attempt.
  const wasActiveRef = useRef(isActive)
  useEffect(() => {
    const becameActive = isActive && !wasActiveRef.current
    wasActiveRef.current = isActive
    if (!becameActive) return
    if (historyLoading || messages.length > 0) return
    historyHydratedChat.current = null
    setHistoryReloadToken((n) => n + 1)
  }, [isActive, historyLoading, messages.length])

  // Seed message history and the complete durable snapshot in one monotonic update.
  useEffect(() => {
    if (historyLoading) return
    setWorkerStates((prev) => {
      let next = seedWorkerStates(prev, messages)
      next = seedWorkerStatesFromSnapshot(next, {
        sessionId: session.id,
        jobs: snapshotJobs,
        workers: snapshotWorkers,
        approvals: snapshotApprovals,
      })

      const terminal = seedAcpResetMarkers(
        terminalWorkerStatesRef.current,
        snapshotJobs,
        session.id,
      )
      if (terminal !== terminalWorkerStatesRef.current) {
        terminalWorkerStatesRef.current = terminal
        if (next === prev) next = new Map(prev)
      }
      return next
    })
  }, [
    messages,
    historyLoading,
    memoryThreadId,
    session.id,
    snapshotApprovals,
    snapshotJobs,
    snapshotWorkers,
  ])

  // Extract active budget events from message parts
  useEffect(() => {
    const actionable = findLatestActionableBudget(messages)
    if (actionable) {
      setActiveBudgetEvent((previous) =>
        previous?.data.runId === actionable.data.runId &&
        previous.data.maxSteps === actionable.data.maxSteps &&
        previous.data.usedSteps === actionable.data.usedSteps
          ? previous
          : actionable,
      )
      setCanContinueBudget(true)
    } else {
      setActiveBudgetEvent(null)
      setCanContinueBudget(false)
    }
  }, [messages])

  // Clean up transient worker states for terminal jobs already persisted in message.parts
  useEffect(() => {
    setWorkerStates((prev) => {
      const { active, terminal } = cleanupTerminalWorkers(prev, messages)
      for (const [jobId, state] of terminal) {
        terminalWorkerStatesRef.current.set(jobId, state)
      }
      return active
    })
  }, [messages])

  const onBusyChangeRef = useRef(onBusyChange)
  onBusyChangeRef.current = onBusyChange

  // Worker card live duration tick (no top-bar elapsed badge)
  const placements = useMemo(
    () => projectWorkerCardPlacements(messages, workerStates, terminalWorkerStatesRef.current),
    [messages, workerStates],
  )

  const placementByJobId = useMemo(() => {
    const map = new Map<string, WorkerCardPlacement>()
    for (const p of placements) map.set(p.jobId, p)
    return map
  }, [placements])

  const livePlacements = useMemo(() => placements.filter((p) => p.source === 'live'), [placements])

  const groupDiscussion = useMemo(
    () =>
      deriveGroupDiscussionState(
        teamMembers,
        placements.map((placement) => placement.state),
      ),
    [placements, teamMembers],
  )
  const isGroupDiscussion = groupDiscussion.enabled

  useEffect(() => {
    if (isGroupDiscussion) setInspectorTab(null)
  }, [isGroupDiscussion])

  const hasRunningWorker = useMemo(() => {
    for (const s of workerStates.values()) {
      if (s.status === 'running' || s.status === 'pending_approval') return true
    }
    return false
  }, [workerStates])
  const hasOpenWorkerJob = useMemo(
    () => snapshotJobs.some((job) => job.sessionId === session.id && isJobOpen(job.status)),
    [session.id, snapshotJobs],
  )
  const followUpLeaderBusy =
    followUp.snapshot.serverStatus?.active === true ||
    followUp.snapshot.phase === 'dispatching' ||
    followUp.snapshot.phase === 'observing' ||
    followUp.snapshot.phase === 'terminating'
  const effectiveBusy =
    busy ||
    !followUp.snapshot.bootstrapped ||
    followUpLeaderBusy ||
    hasRunningWorker ||
    hasOpenWorkerJob
  const hasMessages = messages.length > 0 || historyLoading

  useEffect(() => {
    onBusyChangeRef.current?.(effectiveBusy)
  }, [effectiveBusy])

  useEffect(() => {
    if (hasRunningWorker && !tickRef.current) {
      tickRef.current = setInterval(() => setTick((t) => t + 1), 250)
    } else if (!hasRunningWorker && tickRef.current) {
      clearInterval(tickRef.current)
      tickRef.current = null
    }
    return () => {
      if (tickRef.current) {
        clearInterval(tickRef.current)
        tickRef.current = null
      }
    }
  }, [hasRunningWorker])

  /** Follow mode: the view only tracks the streaming tail while the user is
   *  parked at the bottom. Detach happens ONLY on explicit user scroll intent
   *  (wheel-up / touch-drag / scrollbar track / turn-navigator jump) — never on
   *  scrollTop deltas: thinking blocks and worker cards collapse above the
   *  fold all the time, which moves scrollTop with zero user input and made
   *  delta-based detection drop the tail mid-stream ("跟丢"). Re-attach when
   *  the user scrolls back to the bottom. */
  const followTailRef = useRef(true)
  /** On session open/switch/reload, reveal the tail instantly — never animate
   *  a top-to-bottom smooth scroll through the whole history. */
  const jumpToTailRef = useRef(true)
  /**
   * Signature of live Worker growth. Must include thought/tools/plan/approvals —
   * those expand the card without always changing message text, and used to
   * leave the approval card half-hidden until the user scrolled manually.
   */
  const workerTailSig = useMemo(() => {
    const active: string[] = []
    for (const s of workerStates.values()) {
      if (s.status !== 'running' && s.status !== 'pending_approval') continue
      const tools = (s.toolCalls ?? [])
        .map((tool) =>
          [
            tool.toolCallId,
            tool.status ?? '',
            tool.title.length,
            tool.detail?.length ?? 0,
            tool.locations?.length ?? 0,
          ].join(':'),
        )
        .join(',')
      const plan = (s.planEntries ?? [])
        .map((entry) => [entry.status ?? '', entry.content.length].join(':'))
        .join(',')
      const pendingApprovals = Array.isArray(s.pendingApprovals)
        ? s.pendingApprovals
        : s.pendingApproval
          ? [s.pendingApproval]
          : []
      const approvals = pendingApprovals
        .map((approval) =>
          [
            approval.id,
            approval.status,
            approval.title.length,
            approval.detail?.length ?? 0,
            approval.pathOrTarget?.length ?? 0,
            approval.locations?.length ?? 0,
            approval.options.length,
          ].join(':'),
        )
        .join(',')
      active.push(
        [
          s.jobId,
          s.status,
          s.sequence,
          s.output?.length ?? 0,
          s.task?.length ?? 0,
          s.thought?.length ?? 0,
          tools,
          plan,
          approvals,
        ].join('|'),
      )
    }
    return active.join('||')
  }, [workerStates])

  /** Pin the messages scroller to its true bottom (more reliable than scrollIntoView
   *  when nested layouts / composer dock compete for the scroll ancestor). */
  const pinMessagesToBottom = useCallback(() => {
    if (!followTailRef.current) return
    const el = messagesScrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [])

  useEffect(() => {
    jumpToTailRef.current = true
    followTailRef.current = true
  }, [session.id])
  useEffect(() => {
    if (!isActive) {
      jumpToTailRef.current = true
      return
    }
    if (jumpToTailRef.current && messages.length > 0) {
      // First reveal of a session: land on the tail instantly, follow mode on.
      jumpToTailRef.current = false
      followTailRef.current = true
      pinMessagesToBottom()
      // Second frame: Worker/approval layout often settles after first paint.
      requestAnimationFrame(() => pinMessagesToBottom())
      return
    }
    if (!followTailRef.current) return
    // Typewriter follow: lock the view to the tail on every update. Instant,
    // not smooth — retargeting a smooth scroll on every chunk makes the
    // viewport oscillate (the visible "jumping" while streaming).
    // Also re-run when workerStates grow: ACP deltas / thought / tool / approval
    // update cards without always rewriting `messages`.
    pinMessagesToBottom()
    requestAnimationFrame(() => pinMessagesToBottom())
  }, [messages, status, isActive, workerTailSig, hasRunningWorker, pinMessagesToBottom])

  // While following the tail, any content-height growth (approval card expand,
  // tool list, thinking open) must re-pin — effect deps alone miss CSS/layout
  // settles that happen without a React state change in the same tick.
  useEffect(() => {
    if (!isActive) return
    if (typeof ResizeObserver === 'undefined') return
    const scroller = messagesScrollRef.current
    if (!scroller) return
    const content = scroller.querySelector('.messages')
    if (!content) return
    const ro = new ResizeObserver(() => pinMessagesToBottom())
    // Observe both the viewport and its content. The content catches Worker
    // card growth; the viewport catches window/composer layout changes that
    // alter the maximum scroll position without changing message state.
    ro.observe(scroller)
    ro.observe(content)
    return () => ro.disconnect()
  }, [isActive, hasMessages, session.id, pinMessagesToBottom])

  /**
   * Supervisor 本轮计时：
   * - busy 一开始就记 startedAt（不绑 message id，避免流式 id 变更丢耗时）
   * - 流式中把同一 startedAt 同步到「当前」assistant id
   * - busy 结束时在最终 assistant id 上封印 endedAt
   */
  const activeTurnRef = useRef<{
    startedAt: number
    model?: string
    thinking?: string
    assistantId?: string
    /** busy may end one render before the final assistant message is published. */
    endedAt?: number
  } | null>(null)
  const wasBusyRef = useRef(false)
  const wasBusyForMetaSyncRef = useRef(false)
  useEffect(() => {
    const map = turnTimingRef.current
    let changed = false
    const currentAssistant = findCurrentTurnAssistant(messages)
    const wasBusy = wasBusyRef.current

    const seal = (at: NonNullable<typeof activeTurnRef.current>, id: string | undefined) => {
      if (!id) return false
      map.set(id, {
        startedAt: at.startedAt,
        endedAt: at.endedAt,
        model: at.model || selectedModelRef.current || undefined,
        thinking: at.thinking || thinkingIntensityRef.current || undefined,
      })
      return true
    }

    if (busy) {
      // A previous run can finish before its final assistant message is
      // published. Do not let that orphaned timing object become the next run.
      if (activeTurnRef.current?.endedAt != null) {
        const previous = activeTurnRef.current
        if (seal(previous, previous.assistantId)) changed = true
        activeTurnRef.current = null
      }
      if (!activeTurnRef.current) {
        activeTurnRef.current = {
          startedAt: Date.now(),
          model: selectedModelRef.current || undefined,
          thinking: thinkingIntensityRef.current || undefined,
        }
        changed = true
      } else {
        const at = activeTurnRef.current
        if (!at.model && selectedModelRef.current) {
          at.model = selectedModelRef.current
          changed = true
        }
        if (!at.thinking && thinkingIntensityRef.current) {
          at.thinking = thinkingIntensityRef.current
          changed = true
        }
      }

      // 同步到当前 assistant id（id 变了就迁过去，删掉旧 key）
      if (currentAssistant && activeTurnRef.current) {
        const at = activeTurnRef.current
        const prevId = at.assistantId
        if (prevId && prevId !== currentAssistant.id) {
          map.delete(prevId)
          changed = true
        }
        if (at.assistantId !== currentAssistant.id) {
          at.assistantId = currentAssistant.id
          changed = true
        }
        const next: ClientTurnMeta = {
          startedAt: at.startedAt,
          model: at.model,
          thinking: at.thinking,
        }
        const prev = map.get(currentAssistant.id)
        if (
          !prev ||
          prev.startedAt !== next.startedAt ||
          prev.model !== next.model ||
          prev.thinking !== next.thinking ||
          prev.endedAt != null
        ) {
          map.set(currentAssistant.id, next)
          changed = true
        }
      }
    } else if (wasBusy && activeTurnRef.current) {
      // 本轮结束：封印到最终 assistant
      const at = activeTurnRef.current
      at.endedAt = Date.now()
      const id = currentAssistant?.id ?? at.assistantId
      if (seal(at, id)) {
        changed = true
        activeTurnRef.current = null
      }
    } else if (!busy && activeTurnRef.current?.endedAt != null) {
      // The stream status can settle before useChat publishes the final
      // assistant message (notably after an approval cancellation). Keep the
      // sealed clock alive and bind it on the next messages update.
      const at = activeTurnRef.current
      const id = currentAssistant?.id ?? at.assistantId
      if (seal(at, id)) {
        changed = true
        activeTurnRef.current = null
      }
    }

    wasBusyRef.current = busy
    if (changed) setTimingEpoch((n) => n + 1)
  }, [messages, busy])

  // The server persists data-leader-run-meta from onFinish, but that marker is
  // a separate memory row and is not part of the live AI SDK stream. Re-read
  // the just-completed turn a few times and merge only missing markers so the
  // collapsed "已处理" summary gets its duration without replacing live UI.
  useEffect(() => {
    const wasBusy = wasBusyForMetaSyncRef.current
    wasBusyForMetaSyncRef.current = busy
    if (busy || !wasBusy) return

    let cancelled = false
    const syncPersistedMeta = async () => {
      // onFinish saves after the stream settles; the short retries cover both
      // the normal completion and approval/continuation timing paths.
      for (const delay of [0, 200, 700]) {
        if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
        if (cancelled) return
        try {
          const result = await api.getThreadMessages(memoryThreadId, memoryResourceId)
          if (cancelled) return
          setMessages(result.messages)
        } catch {
          // History sync is best-effort; the client timing path remains active.
        }
      }
    }
    void syncPersistedMeta()
    return () => {
      cancelled = true
    }
  }, [busy, memoryThreadId, memoryResourceId, setMessages])

  const selectedMeta = models.find((m) => m.id === selectedModel)
  const modelShort = selectedMeta
    ? selectedMeta.label
    : selectedModel
      ? selectedModel.includes('/')
        ? selectedModel.slice(selectedModel.indexOf('/') + 1)
        : selectedModel
      : t('chat.model')
  const thinkShort = t(THINK_LABEL_KEY[thinkingIntensity] ?? 'chat.think.medium')

  // Context meter: UI-only estimate until backend exposes token usage (see HANDOVER)
  const ctxTotal =
    selectedMeta?.contextWindow && selectedMeta.contextWindow > 0
      ? selectedMeta.contextWindow
      : 1_000_000
  // memo 化：避免每次按键（setInput）都重算 messages.reduce
  const approxTokens = useMemo(
    () =>
      Math.min(
        ctxTotal,
        Math.round(
          messages.reduce((acc, m) => {
            for (const p of m.parts) {
              if (p.type === 'text' && 'text' in p) acc += String(p.text).length / 4
            }
            return acc
          }, 0),
        ),
      ),
    [messages, ctxTotal],
  )
  // Follow-mode event wiring:
  // - detach on explicit user scroll intent ONLY (wheel-up, touch drag-up,
  //   scrollbar-track mousedown). Content-height changes above the fold must
  //   never detach (see followTailRef comment).
  // - re-engage when the scroll position lands back at the bottom (~2 rows).
  // The .messages-scroll container only exists when hasMessages, so re-attach
  // when it (re)appears.
  useEffect(() => {
    const el = messagesScrollRef.current
    if (!el) return
    const detach = () => {
      followTailRef.current = false
    }
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) detach()
    }
    let touchY: number | null = null
    const onTouchStart = (e: TouchEvent) => {
      touchY = e.touches[0]?.clientY ?? null
    }
    const onTouchMove = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY
      // Finger drags DOWN → content scrolls UP → detach.
      if (touchY != null && y != null && y > touchY + 4) detach()
      touchY = y ?? touchY
    }
    const onMouseDown = (e: MouseEvent) => {
      // Scrollbar track zone (right edge). Clicking/dragging there is always a
      // scroll intent; content clicks this close to the edge are rare.
      if (e.clientX >= el.getBoundingClientRect().right - 20) detach()
    }
    const onScroll = () => {
      if (el.scrollHeight - el.scrollTop - el.clientHeight <= 48) {
        followTailRef.current = true
      }
    }
    el.addEventListener('wheel', onWheel, { passive: true })
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: true })
    el.addEventListener('mousedown', onMouseDown)
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('mousedown', onMouseDown)
      el.removeEventListener('scroll', onScroll)
    }
  }, [hasMessages, session.id])

  const errorCopy = useMemo(
    () => ({
      missingKey: t('chat.errorMissingKey'),
      billing: t('chat.errorBilling'),
      rateLimit: t('chat.errorRateLimit'),
      network: t('chat.errorNetwork'),
      offline: t('chat.errorOffline'),
      model: t('chat.errorModel'),
      generic: t('chat.errorGeneric'),
    }),
    [t],
  )
  errorCopyRef.current = errorCopy

  const liveFriendlyError = useMemo(() => {
    if (!error) return null
    return formatChatError(error, errorCopy)
  }, [error, errorCopy])

  // Live stream error + sticky session error (survives reload).
  // lastChatError alone is enough — don't require status==='error' (recompute races).
  const displayError = useMemo(() => {
    if (liveFriendlyError) return liveFriendlyError
    if (session.lastChatError?.trim()) {
      return formatChatError(session.lastChatError, errorCopy, { log: false })
    }
    return null
  }, [liveFriendlyError, session.lastChatError, errorCopy])

  // One card only: embed error in the tail assistant turn when present;
  // otherwise a single standalone Supervisor card at the end (failed before any reply).
  // A trailing assistant view with no parts is an invisible streaming ghost
  // (e.g. a model failure that produced zero output) — it hosts no bubble, so
  // the error must fall through to the standalone card instead.
  const lastMessage = messages[messages.length - 1]
  const errorBelongsInLastAssistant =
    Boolean(displayError) &&
    Boolean(lastMessage) &&
    lastMessage!.role !== 'user' &&
    lastMessage!.parts.length > 0

  // Credentials rotation clears lastChatError while idle → drop useChat error too.
  // Do NOT clear when user re-sends (status→running) or while busy — that hid the next failure.
  const prevStickyErrorRef = useRef(session.lastChatError)
  useEffect(() => {
    const prev = prevStickyErrorRef.current
    prevStickyErrorRef.current = session.lastChatError
    const stickyClearedExternally =
      Boolean(prev?.trim()) &&
      !session.lastChatError?.trim() &&
      session.status !== 'error' &&
      session.status !== 'running' &&
      !busy
    if (!stickyClearedExternally) return
    lastStatusPostRef.current = ''
    if (error) clearError()
  }, [session.lastChatError, session.status, busy, error, clearError])

  const persistChatError = useCallback(
    (friendly: { message: string; detail?: string; kind?: string }, opts?: { force?: boolean }) => {
      const cb = onSessionStatusChangeRef.current
      if (!cb) return Promise.resolve()
      const sticky = serializeChatErrorForSticky({
        kind: (friendly.kind as 'generic') || 'generic',
        message: friendly.message,
        detail: friendly.detail,
      })
      const key = `error:${sticky}`
      if (!opts?.force && lastStatusPostRef.current === key) return Promise.resolve()
      lastStatusPostRef.current = key
      return Promise.resolve(cb('error', { lastChatError: sticky }))
    },
    [],
  )

  // Keep latest error text for unmount flush (Settings replaces the shell)
  const displayErrorRef = useRef(displayError)
  displayErrorRef.current = displayError

  useEffect(() => {
    const cb = onSessionStatusChangeRef.current
    if (!cb) return
    if (liveFriendlyError) {
      void persistChatError(liveFriendlyError)
      return
    }
    if (busy) {
      const key = 'running'
      if (lastStatusPostRef.current === key) return
      lastStatusPostRef.current = key
      cb('running', { lastChatError: null })
    }
  }, [liveFriendlyError, busy])

  // Opening Settings unmounts this panel — flush sticky so the card returns after close
  useEffect(() => {
    return () => {
      const err = displayErrorRef.current
      if (!err?.message) return
      const sticky = serializeChatErrorForSticky(err)
      const key = `error:${sticky}`
      lastStatusPostRef.current = key
      onSessionStatusChangeRef.current?.('error', { lastChatError: sticky })
    }
  }, [])

  const openSettingsFromError = useCallback(() => {
    const go = () => onOpenSettings?.()
    if (!displayError) {
      go()
      return
    }
    // Wait for sticky write so leaveSettings refresh cannot race-away the card
    void persistChatError(displayError, { force: true }).finally(go)
  }, [displayError, persistChatError, onOpenSettings])

  const [errorCopied, setErrorCopied] = useState(false)
  const errorCopiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    return () => {
      if (errorCopiedTimerRef.current) clearTimeout(errorCopiedTimerRef.current)
    }
  }, [])
  // Reset "已复制" when the error content changes
  useEffect(() => {
    setErrorCopied(false)
    if (errorCopiedTimerRef.current) {
      clearTimeout(errorCopiedTimerRef.current)
      errorCopiedTimerRef.current = null
    }
  }, [displayError?.message, displayError?.detail, displayError?.href])

  const copyErrorCard = useCallback(async () => {
    if (!displayError) return
    const lines = [t('chat.error'), displayError.message.trim()]
    if (displayError.detail?.trim() && displayError.detail.trim() !== displayError.message.trim()) {
      lines.push('', displayError.detail.trim())
    }
    if (displayError.href?.trim()) {
      lines.push('', displayError.href.trim())
    }
    const text = lines.filter((l, i) => l !== '' || (i > 0 && lines[i - 1] !== '')).join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setErrorCopied(true)
      if (errorCopiedTimerRef.current) clearTimeout(errorCopiedTimerRef.current)
      errorCopiedTimerRef.current = setTimeout(() => setErrorCopied(false), 1600)
    } catch {
      /* ignore clipboard failures */
    }
  }, [displayError, t])

  const errorBlock = displayError ? (
    <div className="chat-error-card user-select-text" role="alert">
      <div className="chat-error-card-head">
        <div className="chat-error-card-title">{t('chat.error')}</div>
        <button
          type="button"
          className={`chat-error-copy${errorCopied ? ' is-copied' : ''}`}
          onClick={() => void copyErrorCard()}
          aria-label={errorCopied ? t('chat.errorCopied') : t('chat.errorCopy')}
        >
          {errorCopied ? <Check size={13} /> : <Copy size={13} />}
          <span>{errorCopied ? t('chat.errorCopied') : t('chat.errorCopy')}</span>
        </button>
      </div>
      <div className="chat-error-card-body">{displayError.message}</div>
      {displayError.detail && displayError.detail.trim() !== displayError.message.trim() && (
        <pre className="chat-error-card-detail">{displayError.detail}</pre>
      )}
      <div className="chat-error-card-actions">
        {displayError.href && (
          <a
            className="btn btn-soft btn-sm chat-error-action"
            href={displayError.href}
            target="_blank"
            rel="noreferrer"
          >
            {displayError.kind === 'billing' ? t('chat.errorOpenBilling') : t('chat.errorOpenLink')}
          </a>
        )}
        {(displayError.action === 'open_settings' ||
          displayError.kind === 'missing_key' ||
          displayError.kind === 'model') &&
          onOpenSettings && (
            <button
              type="button"
              className="btn btn-primary btn-sm chat-error-action"
              onClick={openSettingsFromError}
            >
              {t('chat.openSettings')}
            </button>
          )}
      </div>
      <div className="chat-error-troubleshoot">
        <div className="chat-error-trouble-title">{t('chat.troubleTitle')}</div>
        <ul className="chat-error-trouble-list">
          {[t('chat.troubleKeyMissing'), t('chat.troubleBilling'), t('chat.troubleRateLimited'), t('chat.troubleNetwork'), t('chat.troubleModelCheck')].map(
            (line) => (
              <li key={line}>{line}</li>
            ),
          )}
        </ul>
      </div>
    </div>
  ) : null

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const typed = input.trim()
    if (!typed) return

    // /compact slash command: trigger context compression inline. Unlike a
    // normal send this is allowed while busy (compression is a memory-thread
    // op, independent of any in-flight leader turn). Don't transmit the slash
    // text to the model — clear the composer and run the compressor.
    if (typed === '/compact' || typed === '/compress') {
      setInput('')
      void runCompressContext()
      return
    }
    const text = im.applyChrome(typed)
    const nativeEvent = e.nativeEvent as unknown as { ctrlKey?: boolean; metaKey?: boolean }
    const result = followUp.submit(text, {
      behavior: followUpBehavior,
      preferSteer: Boolean(nativeEvent.ctrlKey || nativeEvent.metaKey),
      source: 'direct',
    })
    if (result === 'wait' || result === 'blocked_model') return
    setInput('')
    im.clearQuote()
  }

  /**
   * Run context compression and reflect it in the chat timeline.
   * 1. Insert a `running` compaction marker after the current last message.
   * 2. Call the backend; on resolve, update the marker to success/failed/skipped.
   * 3. On success, reload the message list from the thread (the early history
   *    was replaced by a digest on the server) and refresh the snapshot so the
   *    context-ring number shrinks.
   * Returns true if compression actually happened (not skipped/failed).
   */
  const runCompressContext = useCallback(async (): Promise<boolean> => {
    if (!session?.id) return false
    const markerId = `compact-${Date.now()}`
    const afterMessageId = messages.length > 0 ? messages[messages.length - 1]!.id : null
    // Insert running marker immediately — visible feedback that the action started.
    setCompactionMarkers((prev) => [...prev, { id: markerId, status: 'running', afterMessageId }])
    try {
      const result = await api.compressSessionContext(session.id)
      if (result.skipped) {
        setCompactionMarkers((prev) =>
          prev.map((m) => (m.id === markerId ? { ...m, status: 'skipped' } : m)),
        )
        toastSuccess(t('chat.compactSkipped'))
        return false
      }
      const freed = result.freedTokens ?? 0
      setCompactionMarkers((prev) =>
        prev.map((m) => (m.id === markerId ? { ...m, status: 'success', freedTokens: freed } : m)),
      )
      toastSuccess(
        freed > 0
          ? t('chat.ctxCompressedFreed', { freed: formatTokenCountDisplay(freed, locale) })
          : t('chat.ctxCompressed'),
      )
      // Reload messages so the compressed-away early history disappears from the
      // chat view, and refresh the snapshot so usage/context-ring update.
      try {
        const res = await api.getThreadMessages(session.memoryThreadId ?? session.id)
        if (Array.isArray(res.messages) && res.messages.length >= 0) {
          // Content shrinks — keep following the tail across the reload.
          followTailRef.current = true
          setMessages(res.messages)
        }
      } catch (e) {
        // Non-fatal: marker + toast already shown; messages will refresh on next poll.
        console.error('[compress] message reload failed', e)
      }
      onRefreshSnapshot?.()
      return true
    } catch (err) {
      setCompactionMarkers((prev) =>
        prev.map((m) => (m.id === markerId ? { ...m, status: 'failed' } : m)),
      )
      toastError(err instanceof Error ? err.message : t('chat.compactFailed'))
      return false
    }
  }, [
    session?.id,
    session?.memoryThreadId,
    messages,
    setMessages,
    t,
    locale,
    toastSuccess,
    toastError,
    onRefreshSnapshot,
  ])

  const handleContinueBudget = useCallback(() => {
    if (!activeBudgetEvent) return
    const saved = activeBudgetEvent
    const prompt = buildContinuePrompt(locale)
    const result = followUp.submit(prompt, {
      behavior: followUpBehavior,
      preferSteer: false,
      source: 'budget_continue',
    })
    if (result === 'wait' || result === 'blocked_model') {
      setActiveBudgetEvent(saved)
      setCanContinueBudget(true)
      return
    }
    setCanContinueBudget(false)
  }, [activeBudgetEvent, followUp, followUpBehavior, locale])

  // —— Inline title editing (chat header) ——
  // Begin editing: seed the draft from the *raw* session title (not the
  // "Untitled" placeholder shown in the UI), so users can clear/replace it.

  const stopTyping = useCallback(() => {
    if (typingTimerRef.current) {
      clearInterval(typingTimerRef.current)
      typingTimerRef.current = null
    }
    setTypingTitle(null)
  }, [])

  // Typewriter effect: when session.title transitions from placeholder to a
  // real title (auto-named by the Leader), animate it character by character.
  useEffect(() => {
    const previous = prevSessionTitleRef.current
    const next = { id: session.id, title: session.title, titleSource: session.titleSource }
    prevSessionTitleRef.current = next
    if (previous.id !== next.id) {
      typingFullRef.current = ''
      stopTyping()
      return
    }
    if (!shouldAnimateSessionTitleTransition(previous, next) || reduceMotion) return
    const clean = session.title
      .replace(/[\n\r\t]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!clean) return
    if (typingFullRef.current === clean) return
    stopTyping()
    typingFullRef.current = clean
    let i = 0
    setTypingTitle('')
    typingTimerRef.current = setInterval(() => {
      i++
      setTypingTitle(clean.slice(0, i))
      if (i >= clean.length) {
        if (typingTimerRef.current) {
          clearInterval(typingTimerRef.current)
          typingTimerRef.current = null
        }
        setTypingTitle(null)
      }
    }, 60)
    return () => {
      if (typingTimerRef.current) {
        clearInterval(typingTimerRef.current)
        typingTimerRef.current = null
      }
    }
  }, [session.title, session.titleSource, session.id, reduceMotion, stopTyping])

  const beginEditTitle = useCallback(() => {
    if (!onRenameSession) return
    setTitleDraft(session.title)
    setEditingTitle(true)
    stopTyping()
  }, [onRenameSession, session.title])

  // Focus + select-all once the input mounts.
  useEffect(() => {
    if (editingTitle) {
      const el = titleInputRef.current
      if (el) {
        el.focus()
        el.select()
      }
    }
  }, [editingTitle])

  const commitTitle = useCallback(() => {
    if (!editingTitle) return
    const next = titleDraft.trim()
    setEditingTitle(false)
    // Parent skips empty / unchanged values; we always exit edit mode.
    if (next && next !== session.title) onRenameSession?.(next)
  }, [editingTitle, titleDraft, session.title, onRenameSession])

  const cancelTitle = useCallback(() => {
    setEditingTitle(false)
    setTitleDraft(session.title)
  }, [session.title])

  const isMetaOpen = useCallback(
    (key: string, autoOpen: boolean): boolean => {
      if (key in metaOpen) return metaOpen[key]!
      return autoOpen
    },
    [metaOpen],
  )

  const messageList = (
    <ChatMessageList
      messages={messages}
      historyLoading={historyLoading}
      busy={busy}
      discussionMode={isGroupDiscussion}
      lastMessageId={lastMessage?.id}
      errorBelongsInLastAssistant={errorBelongsInLastAssistant}
      displayError={displayError}
      errorBlock={errorBlock}
      models={models}
      selectedModel={selectedModel}
      thinkingIntensity={thinkingIntensity}
      modelShort={modelShort}
      thinkShort={thinkShort}
      metaOpen={metaOpen}
      setMetaOpen={setMetaOpen}
      tick={tick}
      placementByJobId={placementByJobId}
      livePlacements={livePlacements}
      resolving={resolving}
      onResolveApproval={onResolveApproval}
      onResetContext={onResetContext}
      registryIdentityFor={registryIdentityFor}
      isMetaOpen={isMetaOpen}
      timingEpoch={timingEpoch}
      turnTimingRef={turnTimingRef}
      toolStartTimes={toolStartTimes}
      toolDurations={toolDurations}
      compactionMarkers={compactionMarkers}
      activeBudgetEvent={activeBudgetEvent}
      canContinueBudget={canContinueBudget}
      onContinueBudget={handleContinueBudget}
      bottomRef={bottomRef}
      mentionNames={im.mentionNames}
      onMentionClick={(name) => {
        const root = messagesScrollRef.current
        if (!root) return
        const rows = [...root.querySelectorAll('.msg.worker-speaker')]
        const hit = rows
          .reverse()
          .find((el) => el.querySelector('.discussion-message-name')?.textContent?.trim() === name)
        if (hit instanceof HTMLElement) {
          followTailRef.current = false
          hit.scrollIntoView({ block: 'center' })
        }
      }}
      onQuote={im.setQuote}
    />
  )

  // Task list snapshot for composer status row
  const taskSnapshot = useMemo(() => findLatestTaskList(messages), [messages])
  const activeTaskCount = useMemo(
    () => taskSnapshot?.filter((task) => task.status === 'in_progress').length ?? 0,
    [taskSnapshot],
  )
  const [gitRefreshToken, setGitRefreshToken] = useState(0)
  const handleRefreshGit = useCallback(() => {
    setGitRefreshToken((n) => n + 1)
    onRefreshGit?.()
  }, [onRefreshGit])

  const returnQueuedMessageToInput = useCallback(
    (deliveryId: string) => {
      const item = followUp.remove(deliveryId)
      if (!item) return
      setInput((current) => (current.trim() ? current + '\n' + item.content : item.content))
    },
    [followUp],
  )

  const hasLeaderStopAction =
    busy ||
    followUp.snapshot.serverStatus?.active === true ||
    followUp.snapshot.phase === 'dispatching' ||
    followUp.snapshot.phase === 'terminating'

  const composerCard = (
    <div className="composer-stack">
      <ComposerStatusRow
        projectId={project?.id ?? session.projectId}
        enabled={isActive}
        tasks={taskSnapshot}
        gitRefreshToken={gitRefreshToken}
      />
      <QueueChips
        items={followUp.outbox}
        phase={followUp.snapshot.phase}
        onRemove={(deliveryId) => {
          followUp.remove(deliveryId)
        }}
        onReturnToInput={returnQueuedMessageToInput}
        onSendNow={followUp.sendNow}
      />
      <ImQuoteDock quote={im.quote} onClear={im.clearQuote} closeLabel={t('common.cancel')} />
      <form className="composer-card" onSubmit={onSubmit}>
        <div className="context-bar">
          {project && (
            <span className="ctx" title={project.rootPath}>
              <IconFolder size={13} />
              {project.name}
            </span>
          )}
          {project && (
            <BranchSwitcher
              project={project}
              snapshotWorkers={snapshotWorkers}
              snapshotJobs={snapshotJobs}
              onAfterSwitch={handleRefreshGit}
            />
          )}
        </div>
        <ImComposerChrome
          mentionPicker={
            <ImMentionPicker
              open={Boolean(im.queryAt(input) && im.visibleCandidates(input).length > 0)}
              candidates={im.visibleCandidates(input)}
              activeIndex={im.activeIndex}
              onPick={(candidate) => {
                const next = im.pickMention(input, candidate.name)
                setInput(next.text)
              }}
              title={t('chat.mentionPicker')}
            />
          }
        >
          <textarea
            className="composer-input"
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              im.onCaret(e.target.selectionStart ?? e.target.value.length)
            }}
            onSelect={(e) => im.onCaret(e.currentTarget.selectionStart ?? 0)}
            placeholder={
              hasMessages
                ? t('chat.placeholder', {
                    shortcut: sendShortcut === 'enter' ? '↵' : '⌘↵',
                  })
                : t('chat.placeholderHome')
            }
            rows={hasMessages ? 2 : 3}
            onKeyDown={(e) => {
              if (im.onKeyDown(e, input, setInput)) return
              if (isComposerSendKey(e, sendShortcut, composing())) {
                e.preventDefault()
                onSubmit(e)
              }
            }}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={onCompositionEnd}
          />
        </ImComposerChrome>
        <div className="composer-tools">
          <ComposerToolbar
            permissionMode={permissionMode}
            permissionPendingCount={pendingApprovalCount}
            permissionFailureCount={permissionFailureCount}
            selectedModel={selectedModel}
            thinkingIntensity={thinkingIntensity}
            models={models}
            modelsLoading={modelsLoading}
            tokenCount={approxTokens}
            tokenUsage={{
              inputTokens: session.usageInputTokens ?? 0,
              cachedTokens: session.usageCachedTokens ?? 0,
              outputTokens: session.usageOutputTokens ?? 0,
              lastInputTokens: session.usageLastInputTokens ?? 0,
            }}
            sessionId={session.id}
            onCompressContext={runCompressContext}
            locale={locale}
            onPermissionModeChange={(next) => onSetPermissionMode?.(next)}
            onModelChange={(id) => {
              setSelectedModel(id)
              selectedModelRef.current = id
            }}
            onThinkingChange={(th) => {
              setThinkingIntensity(th)
              thinkingIntensityRef.current = th
            }}
            onOpenSettings={onOpenSettings}
          />

          {hasLeaderStopAction ? (
            <button
              className="send stop"
              type="button"
              onClick={() => void followUp.stop()}
              title={
                followUp.snapshot.phase === 'terminating'
                  ? t('chat.followUpStopPending')
                  : t('chat.stop')
              }
              aria-label={
                followUp.snapshot.phase === 'terminating'
                  ? t('chat.followUpStopPending')
                  : t('chat.stop')
              }
            />
          ) : (
            <button
              className="send"
              type="submit"
              disabled={!input.trim()}
              title="Send"
              aria-label="Send"
            >
              <IconArrowUp />
            </button>
          )}
        </div>
      </form>
    </div>
  )

  const titleControl = editingTitle ? (
    <input
      ref={titleInputRef}
      className="title-input"
      value={titleDraft}
      placeholder={t('sidebar.renamePlaceholder')}
      aria-label={t('sidebar.renameSession')}
      onChange={(e) => setTitleDraft(e.target.value)}
      onBlur={commitTitle}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          commitTitle()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          cancelTitle()
        }
      }}
    />
  ) : (
    <div className="title-wrap">
      <span className={'title' + (isPlaceholderSessionTitle(session.title) ? ' untitled' : '')}>
        {isPlaceholderSessionTitle(session.title)
          ? t('sidebar.untitledSession')
          : typingTitle !== null
            ? typingTitle
            : session.title}
      </span>
      {onRenameSession && (
        <button
          type="button"
          className="title-edit-btn"
          title={t('sidebar.renameSession')}
          aria-label={t('sidebar.renameSession')}
          onClick={beginEditTitle}
        >
          <IconEdit />
        </button>
      )}
    </div>
  )

  // The Inspector remains a transient management surface in group discussion.
  // It is anchored to the header tools, not mounted as a persistent right column.
  const inspectorTools = (
    <div className="chat-head-tools" ref={inspectorAnchorRef}>
      <button
        type="button"
        className={`icon-btn chat-head-tool-btn${inspectorTab === 'roles' ? ' is-active' : ''}`}
        title={t('right.roles')}
        aria-label={t('right.roles')}
        aria-expanded={inspectorTab === 'roles'}
        aria-pressed={inspectorTab === 'roles'}
        onClick={() => toggleInspectorTab('roles')}
      >
        <IconCrew />
        {teamMembers.length > 0 && (
          <span className="chat-head-tool-badge" aria-hidden>
            {teamMembers.length > 9 ? '9+' : teamMembers.length}
          </span>
        )}
      </button>
      <button
        type="button"
        className={`icon-btn chat-head-tool-btn${inspectorTab === 'approvals' ? ' is-active' : ''}`}
        title={t('right.approvals')}
        aria-label={t('right.approvals')}
        aria-expanded={inspectorTab === 'approvals'}
        aria-pressed={inspectorTab === 'approvals'}
        onClick={() => toggleInspectorTab('approvals')}
      >
        <IconApprovals />
        {pendingApprovalCount > 0 && (
          <span className="chat-head-tool-badge is-warn" aria-hidden>
            {pendingApprovalCount > 9 ? '9+' : pendingApprovalCount}
          </span>
        )}
      </button>
      {project && isActive && !hasPendingNewSession && (
        <button
          type="button"
          className={`icon-btn chat-head-tool-btn chat-head-tool-memory${
            inspectorTab === 'memory' ? ' is-active' : ''
          }${memoryEnabled ? ' is-memory-on' : ' is-memory-off'}`}
          title={t(memoryEnabled ? 'memory.openEnabled' : 'memory.openDisabled')}
          aria-label={t(memoryEnabled ? 'memory.openEnabled' : 'memory.openDisabled')}
          aria-expanded={inspectorTab === 'memory'}
          aria-pressed={inspectorTab === 'memory'}
          data-memory-enabled={memoryEnabled}
          onClick={() => toggleInspectorTab('memory')}
        >
          <AnimatePresence initial={false} mode="wait">
            {memoryEnabled ? (
              <motion.span key="memory-on" {...memoryIconMotion} aria-hidden>
                <DatabaseCheck className="i" strokeWidth={1.75} />
              </motion.span>
            ) : (
              <motion.span key="memory-off" {...memoryIconMotion} aria-hidden>
                <DatabaseX className="i" strokeWidth={1.75} />
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      )}
      <AnimatePresence>
        {inspectorTab &&
          (inspectorTab === 'memory' ||
            (onCreateTeamMember &&
              onUpdateTeamMember &&
              onArchiveTeamMember &&
              onResetTeamMemberSession &&
              onResolveApproval)) && (
            <motion.div
              key="chat-inspector-bubble"
              className="chat-inspector-bubble"
              role="dialog"
              aria-label={
                inspectorTab === 'roles'
                  ? t('right.roles')
                  : inspectorTab === 'approvals'
                    ? t('right.approvals')
                    : t('memory.title')
              }
              {...inspectorBubbleMotion}
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={inspectorTab}
                  className="chat-inspector-bubble-pane"
                  {...inspectorPanelMotion}
                >
                  <RightPanel
                    tab={inspectorTab}
                    workers={snapshotWorkers}
                    teamMembers={teamMembers}
                    approvals={sessionApprovals}
                    projectId={project?.id ?? null}
                    projectName={project?.name ?? t('memory.noProject')}
                    sessionId={session.id}
                    memoryEnabled={memoryEnabled}
                    memory={currentProjectMemory}
                    memoryLoading={projectMemoryLoading}
                    memorySaving={projectMemorySaving}
                    memoryError={projectMemoryError}
                    onToggleMemory={handleMemoryToggle}
                    onSaveMemory={handleMemorySave}
                    onCreateTeamMember={onCreateTeamMember ?? (async () => {})}
                    onUpdateTeamMember={onUpdateTeamMember ?? (async () => {})}
                    onArchiveTeamMember={onArchiveTeamMember ?? (async () => {})}
                    onResetTeamMemberSession={onResetTeamMemberSession ?? (async () => {})}
                    onResolveApproval={onResolveApproval ?? (() => {})}
                    resolving={resolving}
                    onRefreshSnapshot={() => onRefreshSnapshot?.()}
                  />
                </motion.div>
              </AnimatePresence>
            </motion.div>
          )}
      </AnimatePresence>
    </div>
  )

  return (
    <main
      className={`main chat-panel${isGroupDiscussion ? ' is-group-discussion' : ''}`}
      style={{ display: 'flex', flexDirection: 'column', position: 'relative' }}
    >
      <div className={`chat-head${isGroupDiscussion ? ' is-group-discussion' : ''}`}>
        {isGroupDiscussion ? (
          <div className="group-discussion-title-row">
            {titleControl}
            <div className="spacer" />
            <GroupDiscussionParticipantStack teamMembers={teamMembers} workers={snapshotWorkers} />
            {inspectorTools}
          </div>
        ) : (
          <>
            {titleControl}
            <div className="spacer" />
            {inspectorTools}
          </>
        )}
        {isGroupDiscussion ? (
          <GroupDiscussionHeader
            teamMembers={teamMembers}
            workers={snapshotWorkers}
            activeWorkerCount={groupDiscussion.activeWorkerCount}
            activeTaskCount={activeTaskCount}
          />
        ) : null}
      </div>

      {isGroupDiscussion ? (
        <GroupDiscussionCoordinationStrip
          activeTaskCount={activeTaskCount}
          pendingApprovalCount={pendingApprovalCount}
        />
      ) : null}

      {!hasMessages || (!historyLoading && messages.length === 0) ? (
        <div className="home" style={{ flex: 1 }}>
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
          <div className="subhead">{t('chat.subhead')}</div>
          {!modelsLoading && models.length === 0 && (
            <p style={{ color: 'var(--text-3)', fontSize: 'var(--fs-sm)' }}>
              {t('chat.noModelHint')}{' '}
              <button
                type="button"
                className="btn btn-soft btn-sm"
                onClick={() => onOpenSettings?.('model')}
              >
                {t('chat.openSettings')}
              </button>
            </p>
          )}
          {composerCard}
        </div>
      ) : (
        <>
          {/* 左侧时间线：≥2 query 才渲染 */}
          <TurnNavigator
            messages={messages}
            busy={effectiveBusy}
            scrollContainerRef={messagesScrollRef}
            onNavigate={() => {
              // Explicit jump into history = user scroll intent: detach follow.
              followTailRef.current = false
            }}
          />
          <div ref={messagesScrollRef} className="messages-scroll">
            <div className="messages">{messageList}</div>
          </div>
          <div className="composer-dock">{composerCard}</div>
        </>
      )}
    </main>
  )
}
