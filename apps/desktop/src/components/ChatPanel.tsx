import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import type { LeaderMode, Project, Session } from '@router-agents/shared'
import { api, chatUrl } from '../lib/api'
import { useI18n } from '../i18n/I18nProvider'
import {
  saveSettings,
  THINKING_INTENSITY_OPTIONS,
  type ThinkingIntensity,
} from '../lib/settings'
import { ProviderLogo } from '../lib/provider-icons'
import { formatChatError } from '../lib/chat-errors'
import {
  enrichLastUserMessageForWire,
  parseRouterUserMessage,
} from '../lib/user-message-display'
import { MarkdownContent } from './MarkdownContent'
import { WorkerRunCard } from './WorkerRunCard'
import { LeaderStepBudgetNotice } from './LeaderStepBudgetNotice'
import { findLatestActionableBudget, buildContinuePrompt } from '../lib/leader-step-budget'
import { workerRunReducer, seedWorkerStates, cleanupTerminalWorkers } from '../lib/worker-run-reducer'
import { setRecordKey } from '../lib/chat-state'
import type { WorkerRunEvent, WorkerRunState, LeaderStepBudgetEvent } from '@router-agents/shared'

const MODES: LeaderMode[] = ['ask', 'plan', 'build', 'review']

type ModelOption = {
  id: string
  label: string
  providerId: string
  providerName: string
  configured: boolean
  /** Supported thinking levels for this provider (preset for builtins) */
  thinkingIntensities: ThinkingIntensity[]
}

function clampThink(
  preferred: ThinkingIntensity | undefined,
  supported: ThinkingIntensity[],
): ThinkingIntensity {
  const list = supported.length > 0 ? supported : ([...THINKING_INTENSITY_OPTIONS] as ThinkingIntensity[])
  if (preferred && list.includes(preferred)) return preferred
  if (list.includes('medium')) return 'medium'
  return list[0] ?? 'off'
}

interface Props {
  project: Project | null
  session: Session
  serverUp: boolean
  /** Visible pane (vs keep-alive hidden for parallel sessions) */
  isActive?: boolean
  onModeChange?: (mode: LeaderMode) => void
  onOpenSettings?: () => void
  /** When settings closes, reload available models */
  settingsOpen?: boolean
  /** Report streaming/busy so sidebar can show parallel activity */
  onBusyChange?: (busy: boolean) => void
}

export function ChatPanel({
  project,
  session,
  serverUp,
  isActive = true,
  onModeChange,
  onOpenSettings,
  settingsOpen,
  onBusyChange,
}: Props) {
  const { t, locale } = useI18n()
  const [input, setInput] = useState('')
  const [mode, setMode] = useState<LeaderMode>(session?.mode ?? 'build')
  const [modeMenuOpen, setModeMenuOpen] = useState(false)
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [thinkMenuOpen, setThinkMenuOpen] = useState(false)
  const [models, setModels] = useState<ModelOption[]>([])
  const [selectedModel, setSelectedModel] = useState<string>('')
  const [thinkingIntensity, setThinkingIntensity] = useState<ThinkingIntensity>('medium')
  const [modelsLoading, setModelsLoading] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(true)
  /** User toggles for collapsed tool/thinking rows (keyed by msgId:partIndex) */
  const [metaOpen, setMetaOpen] = useState<Record<string, boolean>>({})
  const bottomRef = useRef<HTMLDivElement>(null)
  const modeWrapRef = useRef<HTMLDivElement>(null)
  const modelWrapRef = useRef<HTMLDivElement>(null)
  const thinkWrapRef = useRef<HTMLDivElement>(null)
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
  /** Accumulated worker run states keyed by jobId (live + history) */
  const [workerStates, setWorkerStates] = useState<Map<string, WorkerRunState>>(new Map())
  /** Terminal worker states moved from workerStates after cleanup */
  const terminalWorkerStatesRef = useRef<Map<string, WorkerRunState>>(new Map())

  /** Track chat start time for total elapsed */
  const chatStartRef = useRef<number | null>(null)
  const [chatElapsed, setChatElapsed] = useState('')
  const chatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
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
        const supported =
          p.thinkingIntensities && p.thinkingIntensities.length > 0
            ? (p.thinkingIntensities.filter((x) =>
                THINKING_INTENSITY_OPTIONS.includes(x),
              ) as ThinkingIntensity[])
            : p.custom
              ? (['off', 'medium'] as ThinkingIntensity[])
              : ([...THINKING_INTENSITY_OPTIONS] as ThinkingIntensity[])
        for (const m of p.models) {
          list.push({
            id: m.id,
            label: m.label,
            providerId: p.id,
            providerName: p.name,
            configured: true,
            thinkingIntensities: supported,
          })
        }
      }
      setModels(list)
      const current = s.settings.leaderModel
      const previous = selectedModelRef.current
      const nextModel = previous && list.some((m) => m.id === previous)
        ? previous
        : current && list.some((m) => m.id === current)
          ? current
          : list[0]?.id ?? current ?? ''
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

  // After leaving settings, re-fetch so newly configured keys / intensity appear
  useEffect(() => {
    if (settingsOpen === false) void loadModels()
  }, [settingsOpen, session.id, loadModels])

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: chatUrl('router-leader'),
        // Mastra Memory already stores history — send only the latest user turn
        // @see https://mastra.ai/docs/memory/message-history
        // @see https://mastra.ai/guides/build-your-ui/ai-sdk-ui
        prepareSendMessagesRequest: ({ messages: msgs }) => {
          const last = msgs[msgs.length - 1]
          const proj = projectRef.current
          const sess = sessionRef.current
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
          return {
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
      }),
    [memoryThreadId, memoryResourceId],
  )

  const { messages, sendMessage, status, stop, error, setMessages } = useChat({
    transport,
    id: memoryThreadId,
    experimental_throttle: 50,
    onData: (dataPart) => {
      if (dataPart.type !== 'data-worker-run') return
      const event = dataPart.data as WorkerRunEvent
      setWorkerStates((prev) => workerRunReducer(prev, event))
    },
  })

  const busy = status === 'submitted' || status === 'streaming'

  // Load persisted history once per thread (survives refresh)
  useEffect(() => {
    if (historyLoadedFor.current === memoryThreadId) {
      setHistoryLoading(false)
      return
    }
    let cancelled = false
    setHistoryLoading(true)
    ;(async () => {
      try {
        const res = await api.getThreadMessages(memoryThreadId, memoryResourceId)
        if (cancelled) return
        historyLoadedFor.current = memoryThreadId
        if (Array.isArray(res.messages) && res.messages.length > 0) {
          // Don't clobber an in-flight / already-populated chat
          setMessages((prev) => (prev.length > 0 ? prev : (res.messages as never)))
        }
      } catch (e) {
        console.warn('[ChatPanel] load history failed', e)
        historyLoadedFor.current = memoryThreadId
      } finally {
        if (!cancelled) setHistoryLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [memoryThreadId, memoryResourceId, setMessages])

  // Seed worker run states from persisted message parts (history loads)
  useEffect(() => {
    if (historyLoading) return
    setWorkerStates((prev) => seedWorkerStates(prev, messages))
  }, [messages, historyLoading, memoryThreadId])

  // Extract active budget events from message parts
  useEffect(() => {
    const actionable = findLatestActionableBudget(messages)
    if (actionable) {
      setActiveBudgetEvent((previous) =>
        previous?.data.runId === actionable.data.runId
          && previous.data.maxSteps === actionable.data.maxSteps
          && previous.data.usedSteps === actionable.data.usedSteps
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

  useEffect(() => {
    onBusyChangeRef.current?.(busy)
  }, [busy])

  // Chat total elapsed timer (minutes) + tool duration tick
  const hasRunningWorker = useMemo(
    () => {
      for (const s of workerStates.values()) {
        if (s.status === 'running') return true
      }
      return false
    },
    [workerStates],
  )

  useEffect(() => {
    if (busy) {
      if (!chatStartRef.current) chatStartRef.current = Date.now()
      if (!chatTimerRef.current) {
        chatTimerRef.current = setInterval(() => {
          const elapsed = (Date.now() - chatStartRef.current!) / 60000
          setChatElapsed(`${elapsed.toFixed(1)}m`)
        }, 1000)
      }
      // Only start the 250ms worker-card tick when there are running workers
      if (hasRunningWorker && !tickRef.current) {
        tickRef.current = setInterval(() => setTick((t) => t + 1), 250)
      } else if (!hasRunningWorker && tickRef.current) {
        clearInterval(tickRef.current)
        tickRef.current = null
      }
    } else if (!busy) {
      if (chatStartRef.current) {
        const total = (Date.now() - chatStartRef.current) / 60000
        setChatElapsed(`${total.toFixed(1)}m`)
      }
      if (chatTimerRef.current) { clearInterval(chatTimerRef.current); chatTimerRef.current = null }
      if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null }
      chatStartRef.current = null
    }
    return () => {
      if (chatTimerRef.current) clearInterval(chatTimerRef.current)
      if (tickRef.current) clearInterval(tickRef.current)
    }
  }, [busy, hasRunningWorker])

  useEffect(() => {
    if (isActive) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, status, isActive])

  useEffect(() => {
    if (session.mode) setMode(session.mode)
  }, [session.mode, session.id])

  useEffect(() => {
    if (!modeMenuOpen && !modelMenuOpen && !thinkMenuOpen) return
    const onDoc = (e: MouseEvent) => {
      if (modeWrapRef.current && !modeWrapRef.current.contains(e.target as Node)) {
        setModeMenuOpen(false)
      }
      if (modelWrapRef.current && !modelWrapRef.current.contains(e.target as Node)) {
        setModelMenuOpen(false)
      }
      if (thinkWrapRef.current && !thinkWrapRef.current.contains(e.target as Node)) {
        setThinkMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [modeMenuOpen, modelMenuOpen, thinkMenuOpen])

  const modeLabel = (m: LeaderMode) => {
    if (m === 'ask') return t('mode.ask')
    if (m === 'plan') return t('mode.plan')
    if (m === 'build') return t('mode.build')
    return t('mode.review')
  }

  const selectMode = (m: LeaderMode) => {
    setMode(m)
    setModeMenuOpen(false)
    onModeChange?.(m)
  }

  const selectThinking = (level: ThinkingIntensity) => {
    setThinkingIntensity(level)
    thinkingIntensityRef.current = level
    setThinkMenuOpen(false)
    // Persist so Settings stays in sync
    void saveSettings({ thinkingIntensity: level }).catch((e) => {
      console.warn('[ChatPanel] save thinkingIntensity failed', e)
    })
  }

  const selectedMeta = models.find((m) => m.id === selectedModel)
  const modelChipLabel = selectedMeta
    ? `${selectedMeta.providerName} / ${selectedMeta.label}`
    : selectedModel || t('chat.model')

  const supportedThinking: ThinkingIntensity[] =
    selectedMeta?.thinkingIntensities?.length
      ? selectedMeta.thinkingIntensities
      : ([...THINKING_INTENSITY_OPTIONS] as ThinkingIntensity[])

  // When model changes, clamp thinking to what that provider supports
  useEffect(() => {
    if (!selectedMeta) return
    const next = clampThink(thinkingIntensity, selectedMeta.thinkingIntensities)
    if (next !== thinkingIntensity) {
      setThinkingIntensity(next)
      thinkingIntensityRef.current = next
    }
  }, [selectedModel, selectedMeta, thinkingIntensity])

  const friendlyError = useMemo(() => {
    if (!error) return null
    return formatChatError(error, {
      missingKey: t('chat.errorMissingKey'),
      network: t('chat.errorNetwork'),
      offline: t('chat.errorOffline'),
      model: t('chat.errorModel'),
      generic: t('chat.errorGeneric'),
    })
  }, [error, t])

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const text = input.trim()
    if (!text || busy) return

    // Soft client guard: no configured model/key — don't fire a raw stream error
    if (!selectedModel || models.length === 0) {
      console.error('[chat] blocked send: no configured model/API key', {
        selectedModel,
        models: models.length,
      })
      // useChat error state is server-driven; surface via temporary local message is harder.
      // Prefer opening settings — user sees empty model chip already.
      onOpenSettings?.()
      return
    }

    // UI message = clean user text only; mode/context injected in prepareSendMessagesRequest
    void sendMessage({ text })
    setInput('')
  }

  const handleContinueBudget = useCallback(() => {
    if (!activeBudgetEvent || busy) return
    const saved = activeBudgetEvent
    setCanContinueBudget(false)
    const prompt = buildContinuePrompt(locale)
    sendMessage({ text: prompt })
      .catch(() => {
        setActiveBudgetEvent(saved)
        setCanContinueBudget(true)
      })
  }, [activeBudgetEvent, busy, locale, sendMessage])

  // Group models by provider for the menu (before any early return — hooks rules)
  const byProvider = useMemo(() => {
    const map = new Map<string, { name: string; models: ModelOption[] }>()
    for (const m of models) {
      let g = map.get(m.providerId)
      if (!g) {
        g = { name: m.providerName, models: [] }
        map.set(m.providerId, g)
      }
      g.models.push(m)
    }
    return [...map.entries()]
  }, [models])

  const metaKey = (msgId: string, partIdx: number) => `${msgId}:${partIdx}`

  const isMetaOpen = (
    key: string,
    autoOpen: boolean,
  ): boolean => {
    if (key in metaOpen) return metaOpen[key]!
    return autoOpen
  }

  return (
    <main className="panel panel-center chat-panel" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="session-toolbar">
        <span className="session-title-main">{session.title}</span>
        {chatElapsed && (
          <span className="badge badge-gray chat-elapsed">{chatElapsed}</span>
        )}
        <div className="spacer" />
        <span className="badge badge-gray" title={selectedModel}>
          {selectedMeta ? `${selectedMeta.providerName}/${selectedMeta.label}` : selectedModel || '—'}
        </span>
        <span className="badge badge-gray">
          {t('chat.mode')}: {modeLabel(mode)}
        </span>
        <span className="badge badge-gray chat-think-badge" title={t('chat.think.hint')}>
          {t('chat.think.short')}: {thinkingIntensity}
        </span>
      </div>

      <div className="chat">
        <div className="chat-inner">
          {historyLoading && messages.length === 0 && (
            <div className="chat-history-loading">{t('app.loading')}</div>
          )}

          {!historyLoading && messages.length === 0 && (
            <div className="msg assistant">
              <div className="msg-role">
                <span className="badge badge-blue">Leader</span>
                {t('chat.leader')}
              </div>
              <div className="chat-ready-block">
                <div className="chat-ready-title">
                  <span>📋</span> {t('chat.ready')}
                  <span className={`chat-ready-status${serverUp ? ' on' : ''}`}>
                    {serverUp ? t('chat.connected') : t('chat.offline')}
                  </span>
                </div>
                <div className="chat-ready-body">
                  {t('chat.readyBody')}
                  <ul>
                    <li>
                      {t('chat.mode')}: {modeLabel(mode)}
                    </li>
                    <li>
                      {t('chat.model')}: {selectedModel || '—'}
                    </li>
                    <li>
                      {t('chat.think.label')}: {thinkingIntensity}
                    </li>
                    <li>
                      {t('chat.project')}: {project?.name ?? '—'}
                    </li>
                    <li>
                      {t('chat.path')}: {project?.rootPath ?? '—'}
                    </li>
                  </ul>
                  {!modelsLoading && models.length === 0 && (
                    <p className="chat-no-key-hint">
                      {t('chat.noModelHint')}{' '}
                      <button
                        type="button"
                        className="chat-settings-link"
                        onClick={() => onOpenSettings?.()}
                      >
                        {t('chat.openSettings')}
                      </button>
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {messages.map((message) => {
                const renderedWorkerJobs = new Set<string>()
                return (
            <div
              key={message.id}
              className={`msg ${message.role === 'user' ? 'user' : 'assistant'}`}
            >
              <div className="msg-role">
                {message.role === 'user' ? (
                  t('chat.you')
                ) : (
                  <>
                    <span className="badge badge-blue">Leader</span>
                    {t('chat.leader')}
                  </>
                )}
              </div>
              {message.parts.map((part, i) => {
                if (part.type === 'text') {
                  if (message.role === 'user') {
                    const { text: display, meta } = parseRouterUserMessage(part.text)
                    const chips: string[] = []
                    if (meta.mode) chips.push(meta.mode)
                    if (meta.model) {
                      const short = meta.model.includes('/')
                        ? meta.model.slice(meta.model.indexOf('/') + 1)
                        : meta.model
                      chips.push(short)
                    }
                    if (meta.thinking && meta.thinking !== 'off') {
                      chips.push(`think:${meta.thinking}`)
                    }
                    return (
                      <div className="user-msg-block" key={i}>
                        <div className="bubble">{display || part.text}</div>
                        {chips.length > 0 && (
                          <div className="user-msg-meta" title={part.text}>
                            {chips.map((c) => (
                              <span key={c} className="user-msg-chip">
                                {c}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  }
                  return (
                    <div className="bubble bubble-md" key={i}>
                      <MarkdownContent>{part.text}</MarkdownContent>
                    </div>
                  )
                }

                // Reasoning: expanded while streaming ("思考中" / "Thinking"),
                // auto-collapse when done (label "思考" / "Thinking")
                if (part.type === 'reasoning') {
                  const rp = part as { type: 'reasoning'; text?: string; state?: string }
                  const text = rp.text?.trim() ?? ''
                  if (!text && rp.state !== 'streaming') return null
                  const key = metaKey(message.id, i)
                  const streaming = rp.state === 'streaming'
                  // Force open only while streaming; after done stay collapsed
                  // unless the user explicitly expands again.
                  const open = streaming ? true : metaOpen[key] === true
                  return (
                    <details
                      className={`chat-meta chat-meta-thinking${streaming ? ' live' : ''}`}
                      key={i}
                      open={open}
                      onToggle={(e) => {
                        // While streaming, keep forced-open (ignore collapse attempts)
                        if (streaming) {
                          e.preventDefault()
                          return
                        }
                        const el = e.currentTarget
                        setMetaOpen((prev) => setRecordKey(prev, key as string, el.open))
                      }}
                    >
                      <summary className="chat-meta-summary">
                        <span className="chat-meta-chevron" aria-hidden>
                          ▸
                        </span>
                        <span className="chat-meta-label">
                          {streaming ? t('chat.thinkingLive') : t('chat.thinking')}
                        </span>
                      </summary>
                      <div className="chat-meta-body">{text || '…'}</div>
                    </details>
                  )
                }

                // Tools — muted, collapsed by default
                if (part.type.startsWith('tool-') || part.type === 'dynamic-tool') {
                  const toolPart = part as {
                    type: string
                    state?: string
                    input?: unknown
                    output?: unknown
                    errorText?: string
                    toolName?: string
                  }
                  const name =
                    toolPart.toolName ||
                    (toolPart.type === 'dynamic-tool'
                      ? 'tool'
                      : toolPart.type.replace(/^tool-/, ''))
                  const hasDetail =
                    toolPart.input != null ||
                    toolPart.output != null ||
                    Boolean(toolPart.errorText)
                  const key = metaKey(message.id, i)
                  const open = isMetaOpen(key, false)
                  const toolOutput = toolPart.output && typeof toolPart.output === 'object'
                    ? toolPart.output as Record<string, unknown>
                    : null
                  const workerJobId = typeof toolOutput?.jobId === 'string'
                    ? toolOutput.jobId
                    : null
                  const fallbackWorkerState = workerJobId
                    ? workerStates.get(workerJobId) ?? terminalWorkerStatesRef.current.get(workerJobId)
                    : undefined

                  if (workerJobId && fallbackWorkerState && fallbackWorkerState.status !== 'running') {
                    if (renderedWorkerJobs.has(workerJobId)) return null
                    renderedWorkerJobs.add(workerJobId)
                    return (
                      <WorkerRunCard
                        key={i}
                        state={fallbackWorkerState}
                        open={isMetaOpen(key, false)}
                        onToggle={(o) =>
                          setMetaOpen((prev) => setRecordKey(prev, key, o))
                        }
                        tick={tick}
                      />
                    )
                  }

                  // Track tool execution duration (live)
                  // eslint-disable-next-line react-hooks/rules-of-hooks
                  const isDone = toolPart.state === 'result' || toolPart.output != null || Boolean(toolPart.errorText)
                  if (!isDone && !toolStartTimes.current.has(key)) {
                    toolStartTimes.current.set(key, Date.now())
                  }
                  if (isDone && toolStartTimes.current.has(key) && !toolDurations.current.has(key)) {
                    const duration = (Date.now() - toolStartTimes.current.get(key)!) / 1000
                    toolDurations.current.set(key, duration)
                    toolStartTimes.current.delete(key)
                  }
                  const finalDuration = toolDurations.current.get(key)
                  const liveMs = toolStartTimes.current.has(key) ? Date.now() - toolStartTimes.current.get(key)! : 0
                  const showDuration = finalDuration != null ? finalDuration : (liveMs > 0 ? liveMs / 1000 : null)

                  return (
                    <details
                      className="chat-meta chat-meta-tool"
                      key={i}
                      open={open}
                      onToggle={(e) => {
                        const el = e.currentTarget
                        setMetaOpen((prev) => setRecordKey(prev, key as string, el.open))
                      }}
                    >
                      <summary className="chat-meta-summary">
                        <span className="chat-meta-chevron" aria-hidden>
                          ▸
                        </span>
                        <span className="chat-meta-label">{t('chat.tool')}</span>
                        <span className="chat-meta-name mono">{name}</span>
                        {toolPart.state && (
                          <span className="chat-meta-state">{toolPart.state}</span>
                        )}
                        {showDuration != null && (
                          <span className={`chat-meta-duration${finalDuration == null ? ' live' : ''}`}>
                            {showDuration.toFixed(1)}s
                          </span>
                        )}
                        {toolPart.errorText && (
                          <span className="chat-meta-error">{t('chat.toolError')}</span>
                        )}
                      </summary>
                      {hasDetail && (
                        <div className="chat-meta-body">
                          {toolPart.input != null && (
                            <pre className="chat-meta-pre mono">
                              {JSON.stringify(toolPart.input, null, 2)}
                            </pre>
                          )}
                          {toolPart.output != null && (
                            <pre className="chat-meta-pre mono">
                              {JSON.stringify(toolPart.output, null, 2)}
                            </pre>
                          )}
                          {toolPart.errorText && (
                            <div className="chat-meta-error-text">{toolPart.errorText}</div>
                          )}
                        </div>
                      )}
                    </details>
                  )
                }

                // Worker run events: rendered from accumulated state
                if (part.type === 'data-worker-run') {
                  const data = (part as { type: 'data-worker-run'; data: WorkerRunEvent }).data
                  const state = workerStates.get(data.jobId)
                    ?? terminalWorkerStatesRef.current.get(data.jobId)
                  if (!state) return null
                  if (renderedWorkerJobs.has(data.jobId)) return null
                  renderedWorkerJobs.add(data.jobId)
                  const wrKey = metaKey(message.id, i)
                  return (
                    <WorkerRunCard
                      key={i}
                      state={state}
                      open={isMetaOpen(wrKey, state.status === 'running')}
                      onToggle={(o) =>
                        setMetaOpen((prev) => setRecordKey(prev, wrKey, o))
                      }
                      tick={tick}
                    />
                  )
                }
                return null
              })}
            </div>
            )
          })}

          {/* Live running worker cards (transient, not in message.parts) */}
          {Array.from(workerStates.entries())
            .filter(([_, s]) => s.status === 'running')
            .map(([jobId, state]) => {
              const wrKey = `live-${jobId}`
              return (
                <WorkerRunCard
                  key={wrKey}
                  state={state}
                  open={isMetaOpen(wrKey, true)}
                  onToggle={(o) =>
                    setMetaOpen((prev) => setRecordKey(prev, wrKey, o))
                  }
                  tick={tick}
                />
              )
            })}

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

          {friendlyError && (
            <div className="chat-error-block" role="alert">
              <span className="chat-error-label">{t('chat.error')}</span>
              <div className="chat-error-body">{friendlyError.message}</div>
              {friendlyError.action === 'open_settings' && onOpenSettings && (
                <button
                  type="button"
                  className="btn btn-soft btn-sm chat-error-action"
                  onClick={() => onOpenSettings()}
                >
                  {t('chat.openSettings')}
                </button>
              )}
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      <div className="composer-wrap">
        <form className="composer" onSubmit={onSubmit}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t('chat.placeholder')}
            rows={3}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                onSubmit(e)
              }
            }}
          />
          <div className="composer-bar">
            <div className="mode-menu-wrap" ref={modeWrapRef}>
              <button
                type="button"
                className="chip mode-chip"
                onClick={() => {
                  setModeMenuOpen((v) => !v)
                  setModelMenuOpen(false)
                  setThinkMenuOpen(false)
                }}
              >
                {t('chat.mode')}: {modeLabel(mode)} ▾
              </button>
              {modeMenuOpen && (
                <div className="mode-menu" role="menu">
                  {MODES.map((m) => (
                    <button
                      key={m}
                      type="button"
                      className={mode === m ? 'active' : ''}
                      role="menuitem"
                      onClick={() => selectMode(m)}
                    >
                      {modeLabel(m)}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="mode-menu-wrap model-menu-wrap" ref={modelWrapRef}>
              {!modelsLoading && models.length === 0 ? (
                <button
                  type="button"
                  className="chip mode-chip model-chip model-chip-empty"
                  onClick={() => {
                    setModeMenuOpen(false)
                    setModelMenuOpen(false)
                    setThinkMenuOpen(false)
                    onOpenSettings?.()
                  }}
                >
                  {t('chat.model')}: {t('chat.noModelConfigured')} →
                </button>
              ) : (
                <button
                  type="button"
                  className="chip mode-chip model-chip"
                  title={selectedModel}
                  disabled={modelsLoading}
                  onClick={() => {
                    setModelMenuOpen((v) => !v)
                    setModeMenuOpen(false)
                    setThinkMenuOpen(false)
                    if (!models.length) void loadModels()
                  }}
                >
                  {t('chat.model')}: {modelsLoading ? t('app.loading') : modelChipLabel} ▾
                </button>
              )}
              {modelMenuOpen && models.length > 0 && (
                <div className="mode-menu model-menu" role="menu">
                  {byProvider.map(([providerId, group]) => (
                    <div key={providerId} className="model-menu-group">
                      <div className="model-menu-provider">
                        <ProviderLogo providerId={providerId} size={14} />
                        <span>{group.name}</span>
                      </div>
                      {group.models.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          className={selectedModel === m.id ? 'active' : ''}
                          role="menuitem"
                          onClick={() => {
                            setSelectedModel(m.id)
                            selectedModelRef.current = m.id
                            const nextThink = clampThink(thinkingIntensity, m.thinkingIntensities)
                            setThinkingIntensity(nextThink)
                            thinkingIntensityRef.current = nextThink
                            setModelMenuOpen(false)
                          }}
                        >
                          <span>{m.label}</span>
                          <span className="model-menu-id mono">{m.id}</span>
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {supportedThinking.length > 1 ? (
              <div className="mode-menu-wrap think-menu-wrap" ref={thinkWrapRef}>
                <button
                  type="button"
                  className="chip mode-chip think-chip"
                  title={t('chat.think.hint')}
                  onClick={() => {
                    setThinkMenuOpen((v) => !v)
                    setModeMenuOpen(false)
                    setModelMenuOpen(false)
                  }}
                >
                  {t('chat.think.short')}: {thinkingIntensity} ▾
                </button>
                {thinkMenuOpen && (
                  <div className="mode-menu think-menu" role="menu">
                    {supportedThinking.map((level) => (
                      <button
                        key={level}
                        type="button"
                        className={thinkingIntensity === level ? 'active' : ''}
                        role="menuitem"
                        onClick={() => selectThinking(level)}
                      >
                        <span className="mono">{level}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : supportedThinking.length === 1 ? (
              <span
                className="chip mode-chip think-chip think-chip-fixed"
                title={t('chat.think.hint')}
              >
                {t('chat.think.short')}: {supportedThinking[0]}
              </span>
            ) : null}

            <div className="spacer" />
            {busy && (
              <button className="stop-btn" type="button" onClick={() => stop()}>
                {t('chat.stop')}
              </button>
            )}
            <button
              className="send-btn"
              type="submit"
              disabled={busy || !input.trim()}
              title="Send"
            >
              ↑
            </button>
          </div>
        </form>
      </div>
    </main>
  )
}
