import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useReducedMotion } from 'framer-motion'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import type {
  LeaderMode,
  Project,
  Session,
  SessionApprovalPolicy,
  WorkerJob,
  WorkerRegistration,
} from '@swarmdesk-agent/shared'
import { isPlaceholderSessionTitle } from '@swarmdesk-agent/shared'
import { shouldAnimateSessionTitleTransition } from '../lib/session-title-animation'
import type { PendingNewSession } from '../hooks/useAppState'
import { api, abortChatRun, chatUrl, clearDesktopToken, ensureDesktopToken } from '../lib/api'
import { ThrottledChat } from '../lib/throttled-chat'
import { useI18n } from '../i18n/I18nProvider'
import { THINKING_INTENSITY_OPTIONS, type ThinkingIntensity } from '../lib/settings'
import { formatChatError } from '../lib/chat-errors'
import { enrichLastUserMessageForWire, parseRouterUserMessage } from '../lib/user-message-display'
import { MarkdownContent } from './MarkdownContent'
import { MessageItem } from './MessageItem'
import { ToolCallRow } from './chat/ToolCallRow'
import { ThinkingBlock } from './chat/ThinkingBlock'
import { WorkerRunCard } from './WorkerRunCard'
import { ProcessFloatPanel } from './chat/ProcessFloatPanel'
import { TurnNavigator } from './chat/TurnNavigator'
import { LeaderStepBudgetNotice } from './LeaderStepBudgetNotice'
import {
  IconArrowUp,
  IconBolt,
  IconClock,
  IconEdit,
  IconFolder,
  IconPanel,
  IconSupervisor,
} from './Icons'
import { BrandLogo } from './BrandLogo'
import { BranchSwitcher } from './BranchSwitcher'
import { ComposerToolbar } from './ComposerToolbar'
import { CompactionMarker, type CompactionMarkerData } from './CompactionMarker'
import { useToast } from './Toast'
import { useSendShortcut } from '../hooks/useSendShortcut'
import { useComposing } from '../hooks/useComposing'
import { isComposerSendKey } from '../lib/send-shortcut'
import { findLatestActionableBudget, buildContinuePrompt } from '../lib/leader-step-budget'
import { findLatestTaskList } from '../lib/find-latest-task-list'
import { formatElapsedHms } from '../lib/format-elapsed'
import { formatTokenCountDisplay } from '../lib/context-window'
import {
  formatClockTime,
  resolveLeaderRunMeta,
  shortModelId,
  type ClientTurnMeta,
} from '../lib/leader-run-meta'
import {
  workerRunReducer,
  seedWorkerStates,
  cleanupTerminalWorkers,
  seedAcpResetMarkers,
  seedWorkerStatesFromSnapshot,
} from '../lib/worker-run-reducer'
import {
  projectWorkerCardPlacements,
  shouldRenderGenericToolShell,
  buildToolCallJobIdMap,
  type WorkerCardPlacement,
} from '../lib/worker-card-placement'
import { setRecordKey } from '../lib/chat-state'
import type {
  WorkerRunEvent,
  WorkerRunState,
  LeaderStepBudgetEvent,
  ApprovalItem,
} from '@swarmdesk-agent/shared'

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
function clampThink(
  _preferred: ThinkingIntensity | undefined,
  supported: ThinkingIntensity[],
): ThinkingIntensity {
  const list =
    supported.length > 0 ? supported : ([...THINKING_INTENSITY_OPTIONS] as ThinkingIntensity[])
  // THINKING_INTENSITY_OPTIONS is ordered low→high; pick the highest supported.
  let best: ThinkingIntensity = 'off'
  let bestRank = -1
  for (const lv of list) {
    const rank = THINKING_INTENSITY_OPTIONS.indexOf(lv)
    if (rank > bestRank) {
      bestRank = rank
      best = lv
    }
  }
  return best
}

interface Props {
  project: Project | null
  session: Session
  serverUp: boolean
  /** Visible pane (vs keep-alive hidden for parallel sessions) */
  isActive?: boolean
  onModeChange?: (mode: LeaderMode) => void
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
  approvalPolicy: SessionApprovalPolicy
  onSetApprovalPolicy?: (policy: SessionApprovalPolicy) => void
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
  inspectorOpen?: boolean
  onToggleInspector?: () => void
  /** Fired after a successful git branch switch so parents can refresh git panels. */
  onRefreshGit?: () => void
  /** Pre-fill the composer once (e.g. text typed on the empty-state composer). */
  initialInput?: string
  /** When true, also auto-send initialInput after pre-filling (new-session flow). */
  autoSendInitialInput?: boolean
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
  serverUp,
  isActive = true,
  onModeChange,
  onRenameSession,
  onOpenSettings,
  onRefreshSnapshot,
  settingsOpen,
  onBusyChange,
  approvalPolicy,
  onSetApprovalPolicy,
  resolving = {},
  onResolveApproval,
  onResetContext,
  snapshotApprovals,
  snapshotJobs,
  snapshotWorkers,
  inspectorOpen,
  onToggleInspector,
  onRefreshGit,
  initialInput,
  autoSendInitialInput,
  onInitialInputConsumed,
  onSessionStatusChange,
  pendingNewSession,
  clearPendingSession,
  createSession,
}: Props) {
  const { t, locale } = useI18n()
  const reduceMotion = useReducedMotion()
  const { sendShortcut } = useSendShortcut()
  const { composing, onCompositionStart, onCompositionEnd } = useComposing()
  const [input, setInput] = useState('')
  /** Tracks the initialInput value already consumed, so we apply each text once. */
  const consumedInitialInputRef = useRef<string | undefined>(undefined)
  /** When initialInput arrives with autoSendInitialInput, the text is staged
   *  here and fired by the autoSend effect once a model is selected. */
  const pendingAutoSendRef = useRef<string | null>(null)
  useEffect(() => {
    if (initialInput && initialInput !== consumedInitialInputRef.current) {
      consumedInitialInputRef.current = initialInput
      setInput(initialInput)
      if (autoSendInitialInput) {
        pendingAutoSendRef.current = initialInput
      } else {
        onInitialInputConsumed?.()
      }
    }
  }, [initialInput, autoSendInitialInput, onInitialInputConsumed])
  const [mode, setMode] = useState<LeaderMode>(session?.mode ?? 'build')
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
  const { success: toastSuccess, error: toastError } = useToast()
  const titleInputRef = useRef<HTMLInputElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  /** messages-scroll 容器：TurnNavigator 跳转 + 滚动监听用 */
  const messagesScrollRef = useRef<HTMLDivElement>(null)
  const historyLoadedFor = useRef<string | null>(null)
  // Keep latest model / thinking / mode for transport body (avoid stale closure)
  const selectedModelRef = useRef(selectedModel)
  selectedModelRef.current = selectedModel
  const thinkingIntensityRef = useRef(thinkingIntensity)
  thinkingIntensityRef.current = thinkingIntensity
  const modeRef = useRef(mode)
  modeRef.current = mode
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

  // Bind Mastra memory thread/resource so goal-state + working memory can run
  const memoryThreadId = session.memoryThreadId ?? session.id
  const memoryResourceId = project?.id ?? session.projectId ?? 'default-resource'

  const loadModels = useCallback(async () => {
    setModelsLoading(true)
    try {
      const s = await api.getSettings()
      // Only show providers that already have an API key configured
      const list: ModelOption[] = []
      for (const p of s.providers) {
        if (!p.configured) continue
        // Custom providers can be toggled off in 模型设置
        if (p.custom && (p as { enabled?: boolean }).enabled === false) continue
        for (const m of p.models) {
          // Strictly read the model's own thinkingIntensities (set per-model
          // in 模型设置). No fallback to provider-level or defaults — if a
          // model has none configured, it only supports 'off'.
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
      setModels(list)
      const current = s.settings.leaderModel
      const previous = selectedModelRef.current
      const nextModel =
        previous && list.some((m) => m.id === previous)
          ? previous
          : current && list.some((m) => m.id === current)
            ? current
            : (list[0]?.id ?? current ?? '')
      setSelectedModel(nextModel)
      selectedModelRef.current = nextModel
      const preferred = s.settings.thinkingIntensity
      const meta = list.find((m) => m.id === nextModel) ?? list[0]
      const nextThink = clampThink(
        preferred && THINKING_INTENSITY_OPTIONS.includes(preferred) ? preferred : undefined,
        meta?.thinkingIntensities ?? [],
      )
      setThinkingIntensity(nextThink)
      thinkingIntensityRef.current = nextThink
    } catch (e) {
      console.warn('[ChatPanel] load models failed', e)
    } finally {
      setModelsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadModels()
  }, [session.id, loadModels])

  // Compaction markers are per-session timeline artifacts — drop them when the
  // active session changes so a stale "compressing" marker doesn't bleed into
  // another chat.
  useEffect(() => {
    setCompactionMarkers([])
  }, [session.id])

  // After leaving settings, re-fetch so newly configured keys / intensity appear
  useEffect(() => {
    if (settingsOpen === false) void loadModels()
  }, [settingsOpen, session.id, loadModels])

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: chatUrl('swarmdesk-leader'),
        // Mastra Memory already stores history — send only the latest user turn
        // @see https://mastra.ai/docs/memory/message-history
        // @see https://mastra.ai/guides/build-your-ui/ai-sdk-ui
        // Desktop bearer attached here (async headers not always typed on DefaultChatTransport)
        prepareSendMessagesRequest: async ({ messages: msgs }) => {
          const last = msgs[msgs.length - 1]
          const proj = projectRef.current
          let sess = sessionRef.current
          const pending = pendingNewSessionRef.current
          const createSessionFn = createSessionRef.current
          const clearPendingFn = clearPendingSessionRef.current

          // Lazy session creation: if there's a pending session, create it on the server now
          if (pending && createSessionFn) {
            try {
              const created = await createSessionFn(
                undefined,
                pending.mode,
                pending.projectId,
                pending.memoryThreadId,
              )
              sess = created
              sessionRef.current = created
              clearPendingFn?.()
            } catch (e) {
              console.error('[ChatPanel] lazy session creation failed', e)
              throw e
            }
          }

          // UI keeps clean user text; inject mode/context only on the wire
          const wireLast = enrichLastUserMessageForWire(last as never, {
            locale: localeRef.current,
            mode: modeRef.current,
            projectName: proj?.name,
            projectPath: proj?.rootPath,
            sessionTitle: sess?.title,
            model: selectedModelRef.current || undefined,
            thinking: thinkingIntensityRef.current,
          })
          const tok = await ensureDesktopToken()
          const headers: Record<string, string> = {}
          if (tok) {
            headers.Authorization = `Bearer ${tok}`
            headers['X-SwarmDesk-Agent-Desktop-Token'] = tok
          }
          return {
            headers,
            body: {
              messages: wireLast ? [wireLast] : [],
              memory: {
                thread: memoryThreadId,
                resource: memoryResourceId,
              },
              model: selectedModelRef.current || undefined,
              thinkingIntensity: thinkingIntensityRef.current,
            },
          }
        },
        // Auth headers for the resumeStream() reconnect GET (api defaults to
        // `${api}/${chatId}/stream`, which the server implements).
        prepareReconnectToStreamRequest: async () => {
          const tok = await ensureDesktopToken()
          const headers: Record<string, string> = {}
          if (tok) {
            headers.Authorization = `Bearer ${tok}`
            headers['X-SwarmDesk-Agent-Desktop-Token'] = tok
          }
          return { headers }
        },
        // AI SDK 6: custom fetch so first 401 clears token, IPC re-fetch, replay once
        fetch: async (input, init) => {
          const doFetch = (headers: HeadersInit | undefined) =>
            globalThis.fetch(input, { ...init, headers })
          let res = await doFetch(init?.headers)
          if (res.status !== 401) return res
          clearDesktopToken()
          const again = await ensureDesktopToken(true)
          if (!again) return res
          const headers = new Headers(init?.headers)
          headers.set('Authorization', `Bearer ${again}`)
          headers.set('X-SwarmDesk-Agent-Desktop-Token', again)
          res = await doFetch(headers)
          return res
        },
      }),
    [memoryThreadId, memoryResourceId],
  )

  const onSessionStatusChangeRef = useRef(onSessionStatusChange)
  onSessionStatusChangeRef.current = onSessionStatusChange
  /** Updated after i18n errorCopy is built; onError reads latest */
  const errorCopyRef = useRef({
    missingKey: 'Missing API key',
    billing: 'Insufficient balance or inactive subscription',
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
    const key = `error:${friendly.message}`
    if (lastStatusPostRef.current === key) return
    lastStatusPostRef.current = key
    onSessionStatusChangeRef.current?.('error', { lastChatError: friendly.message })
  }, [])

  // One ThrottledChat per memory thread (vercel/ai#6166 workaround: publish a
  // stable messages snapshot at most once per 100ms instead of swapping the
  // array per chunk, so React's tearing guard stops force-rerendering).
  const chat = useMemo(
    () =>
      new ThrottledChat({
        id: memoryThreadId,
        transport,
        onData: handleChatData,
        onError: handleChatError,
      }),
    [memoryThreadId, transport, handleChatData, handleChatError],
  )
  const { messages, sendMessage, status, stop, error, setMessages, clearError, resumeStream } =
    useChat({ chat })

  const busy = status === 'submitted' || status === 'streaming'

  // Auto-send the staged initial input once a model is available. Models load
  // async after mount; sending before one is set would hit the no-model guard.
  useEffect(() => {
    const pending = pendingAutoSendRef.current
    if (!pending || busy || !selectedModel || models.length === 0) return
    pendingAutoSendRef.current = null
    lastStatusPostRef.current = 'running'
    if (error) clearError()
    onSessionStatusChange?.('running', { lastChatError: null })
    followTailRef.current = true // user-initiated send re-engages tail follow
    void sendMessage({ text: pending })
    setInput('')
    onInitialInputConsumed?.()
  }, [
    selectedModel,
    models,
    busy,
    error,
    clearError,
    sendMessage,
    onSessionStatusChange,
    onInitialInputConsumed,
  ])

  // Load persisted history once per thread (survives refresh). Retries on
  // transient failure: memory.recall() can 500 under SQLite concurrency (e.g.
  // while another session is streaming + React StrictMode double-mounts in dev).
  // Without retry, the session would render the empty "home" state even though
  // the messages exist on disk — looking like the chat "disappeared" until reload.
  useEffect(() => {
    if (historyLoadedFor.current === memoryThreadId) {
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
            historyLoadedFor.current = memoryThreadId
            if (Array.isArray(res.messages) && res.messages.length > 0) {
              // Don't clobber an in-flight / already-populated chat
              setMessages((prev) => (prev.length > 0 ? prev : (res.messages as never)))
            }
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
              historyLoadedFor.current = memoryThreadId
            }
          }
        }
      } finally {
        // MUST clear loading on every exit path (success, give-up, or cancel)
        // — otherwise hasMessages stays true via historyLoading and the chat
        // is stuck in a perpetual "loading" state.
        if (!cancelled) setHistoryLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [memoryThreadId, memoryResourceId, setMessages])

  // Resume an in-flight run after a reload: re-attach to the server-side stream
  // (GET /chat/:agentId/:threadId/stream). MUST wait until history is loaded so
  // the replayed chunks build on the persisted messages instead of racing
  // setMessages. 204 = no active run → no-op. Once per thread per mount.
  const resumeAttemptedFor = useRef<string | null>(null)
  useEffect(() => {
    if (historyLoading) return
    if (resumeAttemptedFor.current === memoryThreadId) return
    resumeAttemptedFor.current = memoryThreadId
    void resumeStream()
  }, [historyLoading, memoryThreadId, resumeStream])

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

  const toolCallJobIds = useMemo(() => buildToolCallJobIdMap(messages as never), [messages])

  const placementByJobId = useMemo(() => {
    const map = new Map<string, WorkerCardPlacement>()
    for (const p of placements) map.set(p.jobId, p)
    return map
  }, [placements])

  const livePlacements = useMemo(() => placements.filter((p) => p.source === 'live'), [placements])

  const hasRunningWorker = useMemo(() => {
    for (const s of workerStates.values()) {
      if (s.status === 'running' || s.status === 'pending_approval') return true
    }
    return false
  }, [workerStates])
  const effectiveBusy = busy || hasRunningWorker

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
      bottomRef.current?.scrollIntoView({ behavior: 'instant' })
      return
    }
    if (!followTailRef.current) return
    // Typewriter follow: lock the view to the tail on every update. Instant,
    // not smooth — retargeting a smooth scroll on every chunk makes the
    // viewport oscillate (the visible "jumping" while streaming).
    bottomRef.current?.scrollIntoView({ behavior: 'instant' })
  }, [messages, status, isActive])

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
  } | null>(null)
  const wasBusyRef = useRef(false)
  useEffect(() => {
    const map = turnTimingRef.current
    let changed = false
    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')
    const wasBusy = wasBusyRef.current

    if (busy) {
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
      if (lastAssistant && activeTurnRef.current) {
        const at = activeTurnRef.current
        const prevId = at.assistantId
        if (prevId && prevId !== lastAssistant.id) {
          map.delete(prevId)
          changed = true
        }
        if (at.assistantId !== lastAssistant.id) {
          at.assistantId = lastAssistant.id
          changed = true
        }
        const next: ClientTurnMeta = {
          startedAt: at.startedAt,
          model: at.model,
          thinking: at.thinking,
        }
        const prev = map.get(lastAssistant.id)
        if (
          !prev ||
          prev.startedAt !== next.startedAt ||
          prev.model !== next.model ||
          prev.thinking !== next.thinking ||
          prev.endedAt != null
        ) {
          map.set(lastAssistant.id, next)
          changed = true
        }
      }
    } else if (wasBusy && activeTurnRef.current) {
      // 本轮结束：封印到最终 assistant
      const at = activeTurnRef.current
      const id = lastAssistant?.id ?? at.assistantId
      if (id) {
        map.set(id, {
          startedAt: at.startedAt,
          endedAt: Date.now(),
          model: at.model || selectedModelRef.current || undefined,
          thinking: at.thinking || thinkingIntensityRef.current || undefined,
        })
        changed = true
      }
      activeTurnRef.current = null
    }

    wasBusyRef.current = busy
    if (changed) setTimingEpoch((n) => n + 1)
  }, [messages, busy])

  useEffect(() => {
    if (session.mode) setMode(session.mode)
  }, [session.mode, session.id])

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
  const ctxPctRaw = ctxTotal > 0 ? (approxTokens / ctxTotal) * 100 : 0
  const ctxPct = Math.min(100, Math.round(ctxPctRaw * 10) / 10)
  const ctxUsedLabel = formatTokenCountDisplay(approxTokens, locale)
  const ctxTotalLabel = formatTokenCountDisplay(ctxTotal, locale)
  const ctxPctLabel =
    ctxPctRaw > 0 && ctxPctRaw < 0.1
      ? ctxPctRaw.toFixed(2)
      : ctxPct % 1 === 0
        ? String(Math.round(ctxPct))
        : ctxPct.toFixed(1)
  const hasMessages = messages.length > 0 || historyLoading

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

  // When model changes, clamp thinking to what that provider supports.
  // NOTE: intentionally does NOT depend on `thinkingIntensity` — otherwise
  // picking a different level would re-clamp and override the user's choice.

  useEffect(() => {
    if (!selectedMeta) return
    const next = clampThink(thinkingIntensityRef.current, selectedMeta.thinkingIntensities)
    if (next !== thinkingIntensityRef.current) {
      setThinkingIntensity(next)
      thinkingIntensityRef.current = next
    }
  }, [selectedModel, selectedMeta])

  const errorCopy = useMemo(
    () => ({
      missingKey: t('chat.errorMissingKey'),
      billing: t('chat.errorBilling'),
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
  const lastMessage = messages[messages.length - 1]
  const errorBelongsInLastAssistant =
    Boolean(displayError) && Boolean(lastMessage) && lastMessage!.role !== 'user'

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
    (friendly: { message: string }, opts?: { force?: boolean }) => {
      const cb = onSessionStatusChangeRef.current
      if (!cb) return Promise.resolve()
      const key = `error:${friendly.message}`
      if (!opts?.force && lastStatusPostRef.current === key) return Promise.resolve()
      lastStatusPostRef.current = key
      return Promise.resolve(cb('error', { lastChatError: friendly.message }))
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
      const key = `error:${err.message}`
      lastStatusPostRef.current = key
      onSessionStatusChangeRef.current?.('error', { lastChatError: err.message })
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

  const errorBlock = displayError ? (
    <div className="chat-error-block chat-error-in-bubble" role="alert">
      <span className="chat-error-label">{t('chat.error')}</span>
      <div className="chat-error-body">{displayError.message}</div>
      <div className="chat-error-actions">
        {displayError.href && (
          <a
            className="btn btn-soft btn-sm chat-error-action"
            href={displayError.href}
            target="_blank"
            rel="noreferrer"
          >
            {t('chat.errorOpenBilling')}
          </a>
        )}
        {displayError.action === 'open_settings' && onOpenSettings && (
          <button
            type="button"
            className="btn btn-soft btn-sm chat-error-action"
            onClick={openSettingsFromError}
          >
            {t('chat.openSettings')}
          </button>
        )}
      </div>
    </div>
  ) : null

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const text = input.trim()
    if (!text) return

    // /compact slash command: trigger context compression inline. Unlike a
    // normal send this is allowed while busy (compression is a memory-thread
    // op, independent of any in-flight leader turn). Don't transmit the slash
    // text to the model — clear the composer and run the compressor.
    if (text === '/compact' || text === '/compress') {
      setInput('')
      void runCompressContext()
      return
    }
    if (busy) return

    // Soft client guard: no configured model/key — don't fire a raw stream error
    if (!selectedModel || models.length === 0) {
      console.error('[chat] blocked send: no configured model/API key', {
        selectedModel,
        models: models.length,
      })
      // useChat error state is server-driven; surface via temporary local message is harder.
      // Prefer opening settings — user sees empty model chip already.
      onOpenSettings?.('model')
      return
    }

    // UI message = clean user text only; mode/context injected in prepareSendMessagesRequest
    lastStatusPostRef.current = 'running'
    if (error) clearError()
    onSessionStatusChange?.('running', { lastChatError: null })
    followTailRef.current = true // user-initiated send re-engages tail follow
    void sendMessage({ text })
    setInput('')
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
          setMessages(() => res.messages as never)
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
    if (!activeBudgetEvent || busy) return
    const saved = activeBudgetEvent
    setCanContinueBudget(false)
    const prompt = buildContinuePrompt(locale)
    followTailRef.current = true // user-initiated send re-engages tail follow
    sendMessage({ text: prompt }).catch(() => {
      setActiveBudgetEvent(saved)
      setCanContinueBudget(true)
    })
  }, [activeBudgetEvent, busy, locale, sendMessage])

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

  const metaKey = (msgId: string, partIdx: number) => `${msgId}:${partIdx}`

  const isMetaOpen = useCallback(
    (key: string, autoOpen: boolean): boolean => {
      if (key in metaOpen) return metaOpen[key]!
      return autoOpen
    },
    [metaOpen],
  )

  // 消息列表 JSX 缓存：只在真正影响渲染的数据变化时重建（不含 input）。
  // 按键（setInput）时所有 deps 引用都不变 → 返回缓存 JSX → React 完全跳过
  // 66 个 MessageItem 的 element 创建 + reconciliation。根治输入卡顿。
  const messageList = useMemo(() => {
    const lastAssistantId = (() => {
      for (let k = messages.length - 1; k >= 0; k--) {
        if (messages[k]!.role === 'assistant') return messages[k]!.id
      }
      return undefined
    })()
    return (
      <>
        {historyLoading && messages.length === 0 && (
          <div className="chat-history-loading">{t('app.loading')}</div>
        )}
        {messages.map((message, msgIdx) => (
          <Fragment key={message.id}>
            <MessageItem
              message={message}
              msgIdx={msgIdx}
              messages={messages}
              busy={busy}
              lastAssistantId={lastAssistantId}
              isTailMessage={lastMessage?.id === message.id}
              showErrorInThisBubble={
                errorBelongsInLastAssistant &&
                lastMessage?.id === message.id &&
                message.role !== 'user'
              }
              t={t}
              locale={locale}
              models={models}
              selectedModel={selectedModel}
              thinkingIntensity={thinkingIntensity}
              modelShort={modelShort}
              thinkShort={thinkShort}
              metaOpen={metaOpen}
              setMetaOpen={setMetaOpen}
              tick={tick}
              placementByJobId={placementByJobId}
              toolCallJobIds={toolCallJobIds}
              hasRunningWorker={hasRunningWorker}
              resolving={resolving}
              onResolveApproval={onResolveApproval}
              onResetContext={onResetContext}
              registryIdentityFor={registryIdentityFor}
              isMetaOpen={isMetaOpen}
              errorBlock={errorBlock}
              timingEpoch={timingEpoch}
              turnTimingRef={turnTimingRef}
              toolStartTimes={toolStartTimes}
              toolDurations={toolDurations}
            />
            {/* Compaction markers rendered inline at the position they were
                triggered (after the message whose id matches afterMessageId). */}
            {compactionMarkers
              .filter((m) => m.afterMessageId === message.id)
              .map((m) => (
                <CompactionMarker key={m.id} status={m.status} freedTokens={m.freedTokens} />
              ))}
          </Fragment>
        ))}
        {/* Markers with no anchor (afterMessageId null/undefined) render at the
            very end of the stream — e.g. a compress triggered when messages
            were empty, or anchored to an id no longer present after a reload. */}
        {compactionMarkers
          .filter((m) => !m.afterMessageId || !messages.some((msg) => msg.id === m.afterMessageId))
          .map((m) => (
            <CompactionMarker key={m.id} status={m.status} freedTokens={m.freedTokens} />
          ))}
        {/* 尚无 assistant 回复时（失败在首包前）：单独一张卡承载错误 */}
        {displayError && !errorBelongsInLastAssistant && (
          <div className="msg leader">
            <div className="sup-card">
              <div className="sup-header">
                <span className="sup-avatar" aria-hidden>
                  <IconSupervisor size={14} />
                </span>
                <span className="sup-name">{t('chat.leader')}</span>
              </div>
              <div className="sup-body">{errorBlock}</div>
            </div>
          </div>
        )}
        {livePlacements.map((wp) => (
          <WorkerRunCard
            key={wp.jobId}
            state={wp.state}
            registryIdentity={registryIdentityFor(wp.state)}
            open={isMetaOpen(wp.jobId, true)}
            onToggle={(o) => setMetaOpen((prev) => setRecordKey(prev, wp.jobId, o))}
            tick={tick}
            resolving={resolving}
            onResolveApproval={onResolveApproval}
            onResetContext={onResetContext}
          />
        ))}
        {activeBudgetEvent && (
          <LeaderStepBudgetNotice
            event={activeBudgetEvent}
            canContinue={canContinueBudget}
            busy={busy}
            onContinue={handleContinueBudget}
            continueLabel={t('chat.continueTask')}
            description={t('chat.budgetExhausted', {
              used: String(activeBudgetEvent.data.usedSteps),
              max: String(activeBudgetEvent.data.maxSteps),
            })}
          />
        )}
        <div ref={bottomRef} />
      </>
    )
  }, [
    messages,
    historyLoading,
    busy,
    lastMessage,
    errorBelongsInLastAssistant,
    displayError,
    errorBlock,
    t,
    locale,
    models,
    selectedModel,
    thinkingIntensity,
    modelShort,
    thinkShort,
    metaOpen,
    setMetaOpen,
    tick,
    placementByJobId,
    toolCallJobIds,
    hasRunningWorker,
    resolving,
    onResolveApproval,
    onResetContext,
    registryIdentityFor,
    isMetaOpen,
    timingEpoch,
    livePlacements,
    activeBudgetEvent,
    canContinueBudget,
    handleContinueBudget,
  ])

  // 浮窗进程气泡：提取最新 task 快照（无 task → null → 不渲染浮窗）
  const taskSnapshot = useMemo(() => findLatestTaskList(messages), [messages])

  const composerCard = (
    <div className="composer-stack">
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
              onAfterSwitch={onRefreshGit}
            />
          )}
        </div>
        <textarea
          className="composer-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={hasMessages ? t('chat.placeholder') : t('chat.placeholderHome')}
          rows={hasMessages ? 2 : 3}
          onKeyDown={(e) => {
            if (isComposerSendKey(e, sendShortcut, composing())) {
              e.preventDefault()
              onSubmit(e)
            }
          }}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={onCompositionEnd}
        />
        <div className="composer-tools">
          <ComposerToolbar
            mode={mode}
            approvalPolicy={approvalPolicy}
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
            onModeChange={(m) => {
              setMode(m)
              modeRef.current = m
              onModeChange?.(m)
            }}
            onApprovalPolicyChange={(p) => onSetApprovalPolicy?.(p)}
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

          {busy ? (
            <button
              className="send stop"
              type="button"
              onClick={() => {
                stop()
                // stop() only aborts the local fetch — cancel the server run too.
                void abortChatRun(memoryThreadId).catch(() => {})
              }}
              title={t('chat.stop')}
              aria-label={t('chat.stop')}
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

  return (
    <main
      className="main chat-panel"
      style={{ display: 'flex', flexDirection: 'column', position: 'relative' }}
    >
      <div className="chat-head">
        {editingTitle ? (
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
            <span
              className={'title' + (isPlaceholderSessionTitle(session.title) ? ' untitled' : '')}
            >
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
        )}
        <div className="spacer" />
        {/* 后端在线状态靠右（非当前任务 busy） */}
        {serverUp ? (
          <span className="badge run" title={t('chat.serviceOnlineHint')}>
            {t('chat.running')}
          </span>
        ) : (
          <span className="badge offline" title={t('chat.serverDown')}>
            {t('chat.serviceOffline')}
          </span>
        )}
        {onToggleInspector && (
          <button
            type="button"
            className="icon-btn"
            title={inspectorOpen ? t('chat.inspectorClose') : t('chat.inspector')}
            aria-label={inspectorOpen ? t('chat.inspectorClose') : t('chat.inspector')}
            aria-pressed={inspectorOpen}
            onClick={onToggleInspector}
          >
            <IconPanel />
          </button>
        )}
      </div>

      {!hasMessages || (!historyLoading && messages.length === 0) ? (
        <div className="home" style={{ flex: 1 }}>
          {/* 线稿 home：logo-cloud（品牌标）→ 问候 → Composer */}
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
          {/* 右上角浮窗进程气泡：有 task 快照时显示（mini/panel 切换，无关闭按钮）*/}
          {taskSnapshot && <ProcessFloatPanel tasks={taskSnapshot} />}
          <div ref={messagesScrollRef} className="messages-scroll">
            <div className="messages">{messageList}</div>
          </div>
          <div className="composer-dock">{composerCard}</div>
        </>
      )}
    </main>
  )
}
