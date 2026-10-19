/**
 * One chat message: user bubble or Leader speaker.
 * Worker speech is a sibling timeline item, not a child of this tree.
 * memo + areEqual skip composer keystroke rerenders.
 */
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type ReactNode,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react'
import type { LeaderViewMessage } from '../lib/leader-chat-view'

import { MarkdownContent } from './MarkdownContent'
import { ToolCallRow } from './chat/ToolCallRow'
import { ThinkingBlock } from './chat/ThinkingBlock'

import { DiscussionSpeakerAvatar } from './chat/GroupParticipantAvatar'
import { MessageMeta } from './chat/MessageMeta'
import { paintLeaderSequence } from './chat/paintLeaderSequence'
import { TaskListCard, type TaskItem } from './chat/TaskListCard'
import { IconClock, Zap, ZapOff } from './Icons'
import { Check, Copy } from 'lucide-react'
import { setRecordKey } from '../lib/chat-state'
import type { MessageKey } from '../i18n/locales'
import { parseRouterUserMessage, type UserQuoteChrome } from '../lib/user-message-display'
import {
  formatImActivityLabel,
  hasImActivity,
  summarizeLeaderActivity,
  thinkMetaKey,
  toolMetaKey,
} from '../lib/im-activity'
import { ImActivityQuote } from './chat/ImActivityQuote'
import { ImMentionText } from './chat/ImMentionText'
import {
  formatClockTime,
  parseMessageTimestamp,
  providerIdFromModel,
  resolveLeaderActivity,
  resolveLeaderRunMeta,
  shortModelId,
  type ClientTurnMeta,
} from '../lib/leader-run-meta'
import { ProviderLogo } from '../lib/provider-icons'
import { formatElapsedHms } from '../lib/format-elapsed'

import type { ThinkingIntensity } from '../lib/settings'

// i18n: reuse the MessageKey union from locales, aligned with I18nProvider's t signature.
type TFunc = (key: MessageKey, vars?: Record<string, string | number>) => string

/** Render shape produced by LeaderChatStore (no AI SDK). */
type AnyMessage = LeaderViewMessage & { parts: Array<Record<string, unknown> & { type: string }> }

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

type ModelOption = {
  id: string
  label: string
}

export const RANGE_BOUNDARY_START_TO_START = 0
export const RANGE_BOUNDARY_END_TO_END = 2

/**
 * Whether a selection range fully covers the rendered text parts range.
 * Uses boundary-point comparison instead of string matching: the browser's
 * `selection.toString()` and a hand-built `Range.toString()` serialize block
 * boundaries with different newline rules, so string comparison is unreliable
 * for multi-paragraph replies. Boundary comparison is exact for any shape.
 */
export function selectionCoversFullRange(
  selection: Pick<Range, 'compareBoundaryPoints'>,
  fullRange: Pick<Range, 'compareBoundaryPoints'>,
): boolean {
  return (
    selection.compareBoundaryPoints(RANGE_BOUNDARY_START_TO_START, fullRange as Range) <= 0 &&
    selection.compareBoundaryPoints(RANGE_BOUNDARY_END_TO_END, fullRange as Range) >= 0
  )
}

export interface MessageItemProps {
  message: AnyMessage
  msgIdx: number
  messages: AnyMessage[]
  busy: boolean
  lastAssistantId: string | undefined
  showErrorInThisBubble: boolean
  t: TFunc
  locale: string
  models: ModelOption[]
  selectedModel: string
  thinkingIntensity: ThinkingIntensity
  modelShort: string
  thinkShort: string
  metaOpen: Record<string, boolean>
  setMetaOpen: Dispatch<SetStateAction<Record<string, boolean>>>
  isMetaOpen: (key: string, autoOpen: boolean) => boolean
  errorBlock: ReactNode | null
  timingEpoch: number
  turnTimingRef: RefObject<Map<string, ClientTurnMeta>>
  toolStartTimes: RefObject<Map<string, number>>
  toolDurations: RefObject<Map<string, number>>
  discussionMode?: boolean
  /** When set, only these part indexes render. Used by the speaker timeline. */
  partIndexes?: number[]
  /** Timeline-provided consecutive; falls back to adjacent persisted roles. */
  isConsecutive?: boolean
  showDateDivider?: boolean
  isLiveFragment?: boolean
  mentionNames?: readonly string[]
  onMentionClick?: (name: string) => void
  onQuote?: (quote: UserQuoteChrome) => void
}

function BubbleCluster({ bubbles, meta }: { bubbles: ReactNode[]; meta: ReactNode }) {
  if (bubbles.length === 0) return null
  return (
    <div className="msg-bubble-row">
      <div className="msg-bubbles">{bubbles}</div>
      {meta}
    </div>
  )
}

/** Returns the complete task snapshot carried by a task-list signal, if valid. */
function taskListSnapshot(part: unknown): TaskItem[] | null {
  const signal = part as {
    type?: unknown
    data?: {
      tagName?: unknown
      metadata?: { value?: { tasks?: unknown } }
      value?: { tasks?: unknown }
    }
  }
  if (signal.type !== 'data-signal') return null
  const tagName = signal.data?.tagName
  if (tagName !== 'task-list-update' && tagName !== 'current-task-list') return null
  const tasks = signal.data?.metadata?.value?.tasks ?? signal.data?.value?.tasks
  return Array.isArray(tasks) ? (tasks as TaskItem[]) : null
}

/**
 * Task-list signals are complete snapshots, not an append-only task history.
 * A Leader turn therefore renders only its last valid snapshot. An empty
 * snapshot deliberately wins so a later completion clears an earlier card.
 */
export function latestTaskListSignalIndex(parts: readonly unknown[]): number {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (taskListSnapshot(parts[index]) !== null) return index
  }
  return -1
}

function MessageItemImpl({
  message,
  msgIdx,
  messages,
  busy,
  lastAssistantId,
  showErrorInThisBubble,
  t,
  locale,
  models,
  selectedModel,
  thinkingIntensity,
  modelShort,
  thinkShort,
  metaOpen,
  setMetaOpen,
  isMetaOpen,
  errorBlock,
  timingEpoch,
  turnTimingRef,
  toolStartTimes,
  toolDurations,
  discussionMode = false,
  partIndexes,
  isConsecutive,
  showDateDivider,
  isLiveFragment,
  mentionNames = [],
  onMentionClick,
  onQuote,
}: MessageItemProps) {
  const msgLive = isLiveFragment ?? (busy && message.id === lastAssistantId)

  // ── Supervisor (leader) meta (slim header + footer-anchored) ──
  const isLeader = message.role !== 'user'
  const latestTaskListPartIndex = isLeader ? latestTaskListSignalIndex(message.parts) : -1
  const leaderMeta = isLeader
    ? (() => {
        const live = msgLive
        void timingEpoch
        const meta = resolveLeaderRunMeta(messages, msgIdx, turnTimingRef.current, {
          live,
          now: Date.now(),
          fallbackModel: selectedModel || undefined,
          fallbackThinking: thinkingIntensity || undefined,
        })
        const modelId = meta.model || ''
        const modelLabel =
          (modelId && (models.find((m) => m.id === modelId)?.label || shortModelId(modelId))) ||
          (live ? modelShort : '') ||
          ''
        const providerId = providerIdFromModel(modelId || (live ? selectedModel : '') || '')
        const thinkKey = (meta.thinking || '') as ThinkingIntensity | ''
        const thinkLabel =
          (thinkKey
            ? t(THINK_LABEL_KEY[thinkKey as ThinkingIntensity] ?? 'chat.think.medium')
            : live
              ? thinkShort
              : '') || ''
        // resolveLeaderRunMeta already gives durable data precedence over the
        // volatile client map. Do not re-read the map here: a brief stale busy
        // state after reload can otherwise replace a persisted 90s run with a
        // synthetic 0.1s timing entry.
        const sealedStart = meta.startedAt
        const sealedEnd = !live ? meta.endedAt : undefined
        const durationSec =
          !live && sealedStart != null && sealedEnd != null && sealedEnd >= sealedStart
            ? Math.max(0, (sealedEnd - sealedStart) / 1000)
            : null
        const durationLabel = durationSec != null ? formatElapsedHms(durationSec, locale) : ''
        const startLabel = sealedStart != null ? formatClockTime(sealedStart, locale) : ''
        const currentActivity = live
          ? resolveLeaderActivity(message.parts as Array<Record<string, unknown>>)
          : ''
        return {
          modelLabel,
          providerId,
          thinking: thinkKey,
          thinkLabel,
          durationLabel,
          durationSec,
          startLabel,
          currentActivity,
          live,
        }
      })()
    : null

  const renderLeaderPart = (part: AnyMessage['parts'][number], i: number): ReactNode => {
    if (part.type === 'text') {
      const tp = part as { type: 'text'; text?: string }
      return (
        <div className="sup-text md-content" key={i}>
          <MarkdownContent mentionNames={mentionNames} onMentionClick={onMentionClick}>
            {tp.text ?? ''}
          </MarkdownContent>
        </div>
      )
    }
    if (part.type === 'reasoning') {
      const rp = part as { type: 'reasoning'; text?: string; state?: string }
      const text = rp.text?.trim() ?? ''
      if (!text && rp.state !== 'streaming') return null
      const key = thinkMetaKey(message.id, i)
      const streaming = rp.state === 'streaming'
      const open = singleReasoningIndex === i || metaOpen[key] === true
      return (
        <ThinkingBlock
          key={i}
          text={text || '…'}
          streaming={streaming}
          open={open}
          onToggle={(o) => setMetaOpen((prev) => setRecordKey(prev, key as string, o))}
          streamingLabel={t('chat.thinkingLive')}
          doneLabel={t('chat.thinkingDone')}
          doneLabelFor={(time) => t('chat.thinkingDoneFor', { time })}
          locale={locale}
          persistKey={key}
          hideSummary={singleReasoningIndex === i}
        />
      )
    }

    if (part.type.startsWith('tool-')) {
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
        (toolPart.type === 'dynamic-tool' ? 'tool' : toolPart.type.replace(/^tool-/, ''))
      const isDiscussionDispatch = discussionMode && /dispatch/i.test(name)
      const key = toolMetaKey(part, message.id, i)
      const toolOutput =
        toolPart.output && typeof toolPart.output === 'object'
          ? (toolPart.output as Record<string, unknown>)
          : null
      const workerJobId = typeof toolOutput?.jobId === 'string' ? toolOutput.jobId : null

      // Track tool execution duration (live)
      const isDone =
        toolPart.state === 'result' ||
        toolPart.state === 'output-available' ||
        toolPart.output != null ||
        Boolean(toolPart.errorText)
      if (!isDone && !toolStartTimes.current.has(key)) {
        toolStartTimes.current.set(key, Date.now())
      }
      if (isDone && toolStartTimes.current.has(key) && !toolDurations.current.has(key)) {
        const duration = (Date.now() - toolStartTimes.current.get(key)!) / 1000
        toolDurations.current.set(key, duration)
        toolStartTimes.current.delete(key)
      }
      const finalDuration = toolDurations.current.get(key)
      const liveMs = toolStartTimes.current.has(key)
        ? Date.now() - toolStartTimes.current.get(key)!
        : 0
      const showDuration = finalDuration != null ? finalDuration : liveMs > 0 ? liveMs / 1000 : null

      // While dispatch is still streaming without output.jobId, suppress the
      // tool row — the worker speaker is rendered from livePlacements at the tail.
      if (/dispatch/i.test(name) && !workerJobId && !isDone) {
        return null
      }

      const toolOpen = isMetaOpen(key, false)
      const toolShell = (
        <ToolCallRow
          name={name}
          input={toolPart.input}
          output={toolPart.output}
          errorText={toolPart.errorText}
          durationSec={showDuration}
          running={!isDone}
          open={toolOpen}
          onToggle={(o) => setMetaOpen((prev) => setRecordKey(prev, key as string, o))}
          errorLabel={t('chat.toolError')}
        />
      )

      return (
        <div
          key={i}
          className={`chat-tool-worker-stack${isDiscussionDispatch ? ' is-discussion-dispatch' : ''}`}
        >
          {toolShell}
        </div>
      )
    }

    if (part.type === 'data-worker-run') return null
    if (part.type === 'data-signal') {
      if (i !== latestTaskListPartIndex) return null
      const tasks = taskListSnapshot(part)
      return tasks ? <TaskListCard key={i} tasks={tasks} discussionMode={discussionMode} /> : null
    }
    return null
  }

  const processNodes: ReactNode[] = []
  const textNodes: ReactNode[] = []
  const structuralNodes: ReactNode[] = []
  const indexes = partIndexes ?? message.parts.map((_, index) => index)
  const processIndexes = indexes.filter((index) => {
    const part = message.parts[index]
    return part?.type === 'reasoning' || part?.type.startsWith('tool-')
  })
  const singleReasoningIndex =
    processIndexes.length === 1 && message.parts[processIndexes[0]!]?.type === 'reasoning'
      ? processIndexes[0]
      : undefined
  if (isLeader) {
    for (const i of indexes) {
      const part = message.parts[i]
      if (!part) continue
      const node = renderLeaderPart(part, i)
      if (!node) continue
      if (part.type === 'reasoning' || part.type.startsWith('tool-')) {
        processNodes.push(node)
        continue
      }
      if (part.type === 'text') {
        textNodes.push(node)
        continue
      }
      structuralNodes.push(node)
    }
  }
  const activitySummary = isLeader ? summarizeLeaderActivity(message.parts, indexes) : null
  const activityLabel =
    activitySummary && hasImActivity(activitySummary)
      ? formatImActivityLabel(activitySummary, (key, vars) => t(key as MessageKey, vars))
      : ''

  // ── Message actions: user bubble (send time + copy) and leader footer copy, shown on hover ──
  const [copied, setCopied] = useState(false)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
    }
  }, [])
  const flashCopied = useCallback(() => {
    setCopied(true)
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
    copiedTimerRef.current = setTimeout(() => setCopied(false), 1600)
  }, [])
  const copyToClipboard = useCallback(
    async (text: string) => {
      if (!text) return
      try {
        await navigator.clipboard.writeText(text)
        flashCopied()
      } catch {
        /* ignore clipboard failures */
      }
    },
    [flashCopied],
  )

  // User message: copy what is displayed (router chrome stripped), send time from the persisted timestamp.
  const userCopyText = useMemo(() => {
    if (message.role !== 'user') return ''
    return message.parts
      .filter((p) => p.type === 'text')
      .map((p) => {
        const raw = (p as { text?: string }).text ?? ''
        const { text: display } = parseRouterUserMessage(raw)
        return display || raw
      })
      .join('\n')
      .trim()
  }, [message])
  const userSentAt = useMemo(
    () => (message.role === 'user' ? parseMessageTimestamp(message) : null),
    [message],
  )

  // Leader message: all text parts joined, used for the copy button and selection copy.
  const leaderCopyText = useMemo(() => {
    if (message.role === 'user') return ''
    const allowed = partIndexes ? new Set(partIndexes) : null
    return message.parts
      .filter((p, index) => p.type === 'text' && (allowed ? allowed.has(index) : true))
      .map((p) => (p as { text?: string }).text ?? '')
      .join('\n\n')
      .trim()
  }, [message, partIndexes])

  // Intercept native copy (Cmd/Ctrl+C, context menu) over the leader markdown body:
  // only rewrite the clipboard when the selection covers EVERY rendered text part
  // (write the original Markdown source instead of the rendered plain text).
  // Partial selections keep the native copy behavior (only the selected text is
  // copied). Code-block selections and selections outside .sup-text (error cards,
  // tool outputs, worker cards) keep their native behavior.
  const handleLeaderCopyEvent = useCallback(
    (e: ClipboardEvent<HTMLDivElement>) => {
      if (!leaderCopyText) return
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return
      const container = selection.getRangeAt(0).commonAncestorContainer
      if (!e.currentTarget.contains(container)) return
      const elem = container instanceof Element ? container : container.parentElement
      if (elem?.closest('.md-code-block') || !elem?.closest('.sup-text')) return
      const supTexts = e.currentTarget.querySelectorAll('.sup-text')
      if (supTexts.length === 0) return
      // A Range spanning every .sup-text. Boundary comparison against the
      // user's selection is exact regardless of paragraph/block structure;
      // textContent or Range.toString() string matching breaks on block
      // boundary newlines for multi-paragraph replies.
      const fullRange = document.createRange()
      const first = supTexts[0]!
      const last = supTexts[supTexts.length - 1]!
      fullRange.setStart(first, 0)
      fullRange.setEnd(last, last.childNodes.length)
      if (!selectionCoversFullRange(selection.getRangeAt(0), fullRange)) return
      e.preventDefault()
      void copyToClipboard(leaderCopyText)
    },
    [leaderCopyText, copyToClipboard],
  )

  const copyAriaLabel = copied ? t('chat.errorCopied') : t('chat.errorCopy')
  const userTimeLabel = userSentAt != null ? formatClockTime(userSentAt, locale) : ''
  const discussionTimeLabel = isLeader ? leaderMeta?.startLabel || '' : userTimeLabel
  const discussionDateLabel = discussionTimeLabel
    ? t('chat.discussionToday', { time: discussionTimeLabel })
    : t('chat.discussionTodayLabel')
  const consecutive = isConsecutive ?? (msgIdx > 0 && messages[msgIdx - 1]?.role === message.role)
  const pendingNode =
    msgLive &&
    !indexes.some((index) => {
      const part = message.parts[index]
      return part?.type === 'text' && Boolean((part as { text?: string }).text?.trim())
    }) ? (
      <div className="msg-pending" aria-label={t('chat.runPlaceholder')}>
        <span className="pdot" />
        <span className="pdot" />
        <span className="pdot" />
      </div>
    ) : null
  // Quote-back targets Leader replies only; quoting one's own message is noise.
  const quotePayload: UserQuoteChrome | null = isLeader
    ? leaderCopyText
      ? { speaker: 'leader', speakerName: t('chat.discussionLeader'), text: leaderCopyText }
      : null
    : userCopyText
      ? { speaker: 'user', text: userCopyText }
      : null
  // User rows keep a simple hover meta (time + copy); Leader actions moved into
  // the footer caption: 模型 · 思考 · 耗时 · 复制 · 引用.
  const userMeta = (
    <MessageMeta
      timeLabel={userTimeLabel}
      copyText={userCopyText}
      copied={copied}
      copyAriaLabel={copyAriaLabel}
      onCopy={() => void copyToClipboard(userCopyText)}
    />
  )

  const dateDivider =
    (showDateDivider ?? (discussionMode && msgIdx === 0)) ? (
      <div className="discussion-date-divider" aria-label={discussionDateLabel}>
        <span>{discussionDateLabel}</span>
      </div>
    ) : null

  const leaderActions = isLeader ? (
    <>
      {leaderCopyText ? (
        <button
          type="button"
          className="msg-copy"
          onClick={() => void copyToClipboard(leaderCopyText)}
          aria-label={copyAriaLabel}
          title={copyAriaLabel}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
      ) : null}
      {onQuote && quotePayload ? (
        <button
          type="button"
          className="msg-quote"
          onClick={() => onQuote(quotePayload)}
          aria-label={t('chat.quoteAria')}
          title={t('chat.quote')}
        >
          {t('chat.quote')}
        </button>
      ) : null}
    </>
  ) : null

  const leaderCaption =
    leaderMeta &&
    (leaderMeta.modelLabel ||
      leaderMeta.thinkLabel ||
      leaderMeta.durationLabel ||
      leaderMeta.live ||
      leaderActions) ? (
      <div className={`msg-caption${leaderMeta.live ? ' is-live' : ''}`}>
        {leaderMeta.modelLabel && (
          <span className="lead-footer-meta">
            {leaderMeta.providerId ? (
              <ProviderLogo
                providerId={leaderMeta.providerId}
                size={14}
                className="lead-footer-provider"
              />
            ) : null}
            <span className="lead-footer-text">{leaderMeta.modelLabel}</span>
          </span>
        )}
        {leaderMeta.live ? (
          <>
            {leaderMeta.modelLabel && <span className="lead-footer-separator">·</span>}
            <span className="lead-footer-action">
              {t((leaderMeta.currentActivity || 'chat.activity.thinking') as MessageKey)}
            </span>
          </>
        ) : (
          <>
            {leaderMeta.thinkLabel && (
              <>
                {leaderMeta.modelLabel && <span className="lead-footer-separator">·</span>}
                <span className="lead-footer-meta">
                  {leaderMeta.thinking === 'off' ? <ZapOff size={13} /> : <Zap size={13} />}
                  <span className="lead-footer-text">{leaderMeta.thinkLabel}</span>
                </span>
              </>
            )}
            {leaderMeta.durationLabel && (
              <>
                {(leaderMeta.modelLabel || leaderMeta.thinkLabel) && (
                  <span className="lead-footer-separator">·</span>
                )}
                <span className="lead-footer-meta mono">
                  <IconClock size={13} />
                  <span className="lead-footer-text">{leaderMeta.durationLabel}</span>
                </span>
              </>
            )}
          </>
        )}
        {leaderActions ? (
          <>
            {(leaderMeta.modelLabel || leaderMeta.thinkLabel || leaderMeta.durationLabel) && (
              <span className="lead-footer-separator">·</span>
            )}
            <span className="lead-footer-actions">{leaderActions}</span>
          </>
        ) : null}
        {/* Start timestamp intentionally lives only in the identity row —
            rendering it here too duplicated the same time twice per bubble. */}
      </div>
    ) : null

  const activityKey = `activity:${message.id}:${partIndexes?.[0] ?? 0}`
  const processTrail = activityLabel ? (
    <ImActivityQuote
      label={activityLabel}
      running={msgLive}
      previewRows={singleReasoningIndex == null ? 3 : 0}
      open={metaOpen[activityKey] === true}
      onToggle={(open) => setMetaOpen((prev) => setRecordKey(prev, activityKey, open))}
      earlierLabel={(count) => t('chat.activityEarlier', { count })}
    >
      {processNodes}
    </ImActivityQuote>
  ) : null
  const bubbles = paintLeaderSequence(textNodes, msgLive && !activityLabel ? pendingNode : null)
  const head = structuralNodes
  const leaderHasSurface =
    Boolean(processTrail) || bubbles.length > 0 || head.length > 0 || Boolean(showErrorInThisBubble)

  if (isLeader && !leaderHasSurface) return null

  return (
    <div
      className={`msg ${message.role === 'user' ? 'user' : 'leader'}${consecutive ? ' is-consecutive' : ''}${msgLive ? ' is-live' : ''}`}
      data-msg-id={message.id}
      data-msg-role={message.role}
      aria-label={message.role === 'user' ? t('chat.discussionYou') : undefined}
      onCopy={isLeader ? handleLeaderCopyEvent : undefined}
    >
      {dateDivider}
      {isLeader && leaderMeta ? (
        <div className="msg-row is-lead-start">
          <DiscussionSpeakerAvatar participant="leader" title={t('chat.discussionLeader')} />
          <div className="msg-stack">
            <div className="discussion-message-identity">
              <span className="discussion-message-name">{t('chat.discussionLeader')}</span>
              {msgLive ? (
                <span className="discussion-live-ellipsis" aria-hidden>
                  …
                </span>
              ) : null}
              {discussionTimeLabel ? (
                <span className="discussion-message-time">{discussionTimeLabel}</span>
              ) : null}
            </div>
            {processTrail}
            {head}
            <BubbleCluster bubbles={bubbles} meta={null} />
            {showErrorInThisBubble ? errorBlock : null}
            {leaderCaption}
          </div>
        </div>
      ) : (
        <div className="msg-stack">
          <BubbleCluster
            bubbles={message.parts.flatMap((part, i) => {
              if (part.type !== 'text') return []
              const { text: display, quote } = parseRouterUserMessage(part.text)
              const visible = display || part.text
              return [
                <div className="bubble" key={i}>
                  {quote ? (
                    <div className="im-quote">
                      <span className="im-quote-bar" aria-hidden />
                      <span className="im-quote-text">
                        <span className="im-quote-who">{quote.speakerName || quote.speaker}</span>{' '}
                        {quote.text}
                      </span>
                    </div>
                  ) : null}
                  <ImMentionText
                    text={visible}
                    names={mentionNames}
                    onMentionClick={onMentionClick}
                  />
                </div>,
              ]
            })}
            meta={userMeta}
          />
        </div>
      )}
    </div>
  )
}

/** Keystrokes skip this component. Streaming and metaOpen still rerender. */
function areEqual(prev: MessageItemProps, next: MessageItemProps): boolean {
  return (
    prev.message === next.message &&
    prev.busy === next.busy &&
    prev.metaOpen === next.metaOpen &&
    prev.discussionMode === next.discussionMode &&
    prev.showErrorInThisBubble === next.showErrorInThisBubble &&
    prev.errorBlock === next.errorBlock &&
    prev.lastAssistantId === next.lastAssistantId &&
    prev.selectedModel === next.selectedModel &&
    prev.thinkingIntensity === next.thinkingIntensity &&
    prev.models === next.models &&
    prev.locale === next.locale &&
    prev.timingEpoch === next.timingEpoch &&
    prev.msgIdx === next.msgIdx &&
    prev.messages === next.messages &&
    prev.partIndexes === next.partIndexes &&
    prev.isConsecutive === next.isConsecutive &&
    prev.showDateDivider === next.showDateDivider &&
    prev.isLiveFragment === next.isLiveFragment &&
    prev.mentionNames === next.mentionNames &&
    prev.onMentionClick === next.onMentionClick &&
    prev.onQuote === next.onQuote
  )
}

export const MessageItem = memo(MessageItemImpl, areEqual)
