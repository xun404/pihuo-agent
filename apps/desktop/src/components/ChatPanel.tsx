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
import { MarkdownContent } from './MarkdownContent'

const MODES: LeaderMode[] = ['ask', 'plan', 'build', 'review']

type ModelOption = {
  id: string
  label: string
  providerId: string
  providerName: string
  configured: boolean
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
  // Keep latest model / thinking for transport body (avoid stale closure)
  const selectedModelRef = useRef(selectedModel)
  selectedModelRef.current = selectedModel
  const thinkingIntensityRef = useRef(thinkingIntensity)
  thinkingIntensityRef.current = thinkingIntensity

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
        for (const m of p.models) {
          list.push({
            id: m.id,
            label: m.label,
            providerId: p.id,
            providerName: p.name,
            configured: true,
          })
        }
      }
      setModels(list)
      const current = s.settings.leaderModel
      setSelectedModel((prev) => {
        if (prev && list.some((m) => m.id === prev)) return prev
        if (current && list.some((m) => m.id === current)) return current
        return list[0]?.id ?? current ?? ''
      })
      const ti = s.settings.thinkingIntensity
      if (ti && THINKING_INTENSITY_OPTIONS.includes(ti)) {
        setThinkingIntensity(ti)
        thinkingIntensityRef.current = ti
      }
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
          return {
            body: {
              messages: last ? [last] : [],
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

  useEffect(() => {
    onBusyChange?.(busy)
  }, [busy, onBusyChange])

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

  const thinkLabel = (level: ThinkingIntensity) => {
    if (level === 'off') return t('chat.think.off')
    if (level === 'low') return t('chat.think.low')
    if (level === 'medium') return t('chat.think.medium')
    if (level === 'high') return t('chat.think.high')
    return t('chat.think.max')
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

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const text = input.trim()
    if (!text || busy) return

    const langHint = locale === 'zh' ? 'Respond in Chinese. ' : 'Respond in English. '

    const prefix =
      mode === 'ask'
        ? '[mode=ask] '
        : mode === 'plan'
          ? '[mode=plan] Produce a plan only unless I ask to execute. Prefer role=plan workers if dispatching. '
          : mode === 'review'
            ? '[mode=review] Focus on review. Prefer role=review workers. '
            : '[mode=build] Prefer role=coder then role=test/review as needed. '

    const modelHint = selectedModel ? ` model=${selectedModel}` : ''
    const thinkHint = ` thinking=${thinkingIntensity}`
    const context = project
      ? `\n\n[context] project=${project.name} path=${project.rootPath} session=${session.title} locale=${locale} mode=${mode}${modelHint}${thinkHint}`
      : `\n\n[context] locale=${locale} mode=${mode}${modelHint}${thinkHint}`

    void sendMessage({ text: `${langHint}${prefix}${text}${context}` })
    setInput('')
  }

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
        <div className="spacer" />
        <span className="badge badge-gray" title={selectedModel}>
          {selectedMeta ? `${selectedMeta.providerName}/${selectedMeta.label}` : selectedModel || '—'}
        </span>
        <span className="badge badge-gray">
          {t('chat.mode')}: {modeLabel(mode)}
        </span>
        <span className="badge badge-gray chat-think-badge" title={t('chat.think.hint')}>
          {t('chat.think.short')}: {thinkLabel(thinkingIntensity)}
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
                      {t('chat.think.label')}: {thinkLabel(thinkingIntensity)}
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

          {messages.map((message) => (
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
                  return message.role === 'user' ? (
                    <div className="bubble" key={i}>
                      {part.text}
                    </div>
                  ) : (
                    <div className="bubble bubble-md" key={i}>
                      <MarkdownContent>{part.text}</MarkdownContent>
                    </div>
                  )
                }

                // Reasoning: open while streaming, auto-collapse when done
                if (part.type === 'reasoning') {
                  const rp = part as { type: 'reasoning'; text?: string; state?: string }
                  const text = rp.text?.trim() ?? ''
                  if (!text && rp.state !== 'streaming') return null
                  const key = metaKey(message.id, i)
                  const streaming = rp.state === 'streaming'
                  const open = isMetaOpen(key, streaming)
                  return (
                    <details
                      className={`chat-meta chat-meta-thinking${streaming ? ' live' : ''}`}
                      key={i}
                      open={open}
                      onToggle={(e) => {
                        const el = e.currentTarget
                        setMetaOpen((prev) => ({ ...prev, [key]: el.open }))
                      }}
                    >
                      <summary className="chat-meta-summary">
                        <span className="chat-meta-chevron" aria-hidden>
                          ▸
                        </span>
                        <span className="chat-meta-label">{t('chat.thinking')}</span>
                        {streaming && (
                          <span className="chat-meta-state">{t('chat.thinkingLive')}</span>
                        )}
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
                  return (
                    <details
                      className="chat-meta chat-meta-tool"
                      key={i}
                      open={open}
                      onToggle={(e) => {
                        const el = e.currentTarget
                        setMetaOpen((prev) => ({ ...prev, [key]: el.open }))
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
                return null
              })}
            </div>
          ))}

          {error && (
            <div className="chat-error-block">
              <span className="chat-error-label">{t('chat.error')}</span>
              <div className="chat-error-body">{error.message}</div>
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
                      <div className="model-menu-provider">{group.name}</div>
                      {group.models.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          className={selectedModel === m.id ? 'active' : ''}
                          role="menuitem"
                          onClick={() => {
                            setSelectedModel(m.id)
                            selectedModelRef.current = m.id
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
                {t('chat.think.short')}: {thinkLabel(thinkingIntensity)} ▾
              </button>
              {thinkMenuOpen && (
                <div className="mode-menu think-menu" role="menu">
                  {THINKING_INTENSITY_OPTIONS.map((level) => (
                    <button
                      key={level}
                      type="button"
                      className={thinkingIntensity === level ? 'active' : ''}
                      role="menuitem"
                      onClick={() => selectThinking(level)}
                    >
                      <span>{thinkLabel(level)}</span>
                      <span className="model-menu-id mono">{level}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

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
