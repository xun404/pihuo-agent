/**
 * Renders a single message (user bubble / Supervisor card).
 *
 * Extracted from ChatPanel and wrapped in React.memo with a custom areEqual —
 * so when typing in the composer (setInput) re-renders ChatPanel, this
 * component skips re-rendering as long as the message itself (message
 * reference, busy, workerStates, metaOpen, and other core data) is unchanged.
 * This fixes the "typing more makes it slower" issue — every keystroke used to
 * rebuild ~340 lines of JSX.
 *
 * areEqual deliberately ignores unstable props (t / callbacks / derived
 * functions): they get fresh references on each keystroke, but their output is
 * unchanged; only core data changes warrant a re-render.
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
import { Check, Copy } from 'lucide-react'
import type { LeaderViewMessage } from '../lib/leader-chat-view'
import type { WorkerRunEvent, WorkerRunState, ApprovalItem } from '@pihuo-agent/shared'
import { MarkdownContent } from './MarkdownContent'
import { ToolCallRow } from './chat/ToolCallRow'
import { ThinkingBlock } from './chat/ThinkingBlock'
import { WorkedForSection } from './chat/WorkedForSection'
import { WorkerRunCard } from './WorkerRunCard'
import { TaskListCard, type TaskItem } from './chat/TaskListCard'
import { IconClock, Zap, ZapOff, Calendar } from './Icons'
import { setRecordKey } from '../lib/chat-state'
import type { MessageKey } from '../i18n/locales'
import { parseRouterUserMessage } from '../lib/user-message-display'
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
import { formatElapsedCompact, formatElapsedHms } from '../lib/format-elapsed'
import {
  shouldRenderGenericToolShell,
  type WorkerCardPlacement,
} from '../lib/worker-card-placement'
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
  isTailMessage: boolean
  showErrorInThisBubble: boolean
  // — the following are ignored in areEqual (they don't affect output on keystrokes) —
  t: TFunc
  locale: string
  models: ModelOption[]
  selectedModel: string
  thinkingIntensity: ThinkingIntensity
  modelShort: string
  thinkShort: string
  metaOpen: Record<string, boolean>
  setMetaOpen: Dispatch<SetStateAction<Record<string, boolean>>>
  tick: number
  placementByJobId: Map<string, WorkerCardPlacement>
  toolCallJobIds: Map<string, string>
  hasRunningWorker: boolean
  resolving: Record<string, boolean>
  onResolveApproval?: (
    approvalId: string,
    optionId: string | undefined,
    decision: 'allow' | 'deny' | 'cancel',
    surface: 'chat' | 'panel',
  ) => void
  onResetContext?: (jobId: string) => void
  registryIdentityFor: (state: WorkerRunState) => string | undefined
  isMetaOpen: (key: string, autoOpen: boolean) => boolean
  errorBlock: ReactNode | null
  timingEpoch: number
  turnTimingRef: RefObject<Map<string, ClientTurnMeta>>
  toolStartTimes: RefObject<Map<string, number>>
  toolDurations: RefObject<Map<string, number>>
}

const metaKey = (msgId: string, partIdx: number) => `${msgId}:${partIdx}`
const workedMetaKey = (msgId: string) => `worked:${msgId}`

/** Process trail vs final answer (turn-level process collapse). */
function leaderPartBucket(part: { type: string }): 'process' | 'result' | 'other' {
  if (part.type === 'text') return 'result'
  if (part.type === 'reasoning') return 'process'
  if (part.type.startsWith('tool-') || part.type === 'dynamic-tool') return 'process'
  if (part.type === 'data-worker-run') return 'process'
  if (part.type === 'data-signal') return 'process'
  return 'other'
}

function MessageItemImpl({
  message,
  msgIdx,
  messages,
  busy,
  lastAssistantId,
  isTailMessage,
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
  tick,
  placementByJobId,
  toolCallJobIds,
  hasRunningWorker,
  resolving,
  onResolveApproval,
  onResetContext,
  registryIdentityFor,
  isMetaOpen,
  errorBlock,
  timingEpoch,
  turnTimingRef,
  toolStartTimes,
  toolDurations,
}: MessageItemProps) {
  const msgLive = busy && message.id === lastAssistantId

  // ── Supervisor (leader) meta (slim header + footer-anchored) ──
  const isLeader = message.role !== 'user'
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
          <MarkdownContent>{tp.text ?? ''}</MarkdownContent>
        </div>
      )
    }
    if (part.type === 'reasoning') {
      const rp = part as { type: 'reasoning'; text?: string; state?: string }
      const text = rp.text?.trim() ?? ''
      if (!text && rp.state !== 'streaming') return null
      const key = metaKey(message.id, i)
      const streaming = rp.state === 'streaming'
      const open = streaming ? true : metaOpen[key] === true
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
      const key = metaKey(message.id, i)
      const toolOutput =
        toolPart.output && typeof toolPart.output === 'object'
          ? (toolPart.output as Record<string, unknown>)
          : null
      const workerJobId = typeof toolOutput?.jobId === 'string' ? toolOutput.jobId : null
      const cardPlacement = workerJobId ? placementByJobId.get(workerJobId) : undefined
      const showWorkerCard =
        cardPlacement &&
        cardPlacement.source === 'message' &&
        cardPlacement.messageIndex === msgIdx &&
        cardPlacement.partIndex === i

      // Always keep tool row (ACP/dispatch included); worker card is additive
      if (
        !shouldRenderGenericToolShell(toolPart, hasRunningWorker, {
          placedJobIds: new Set(placementByJobId.keys()),
          toolCallJobIds,
        })
      ) {
        return null
      }

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
      // tool row — the worker is rendered by livePlacements at the tail.
      // Rendering both would split tool-row and worker-card with a large gap.
      // Once jobId exists, isDispatchMerge below merges them into one node.
      if (/dispatch/i.test(name) && !workerJobId && !isDone) {
        return null
      }

      // dispatch-team-member: merge tool row + worker card. The tool task
      // becomes the input section; worker output/approval flow underneath.
      const toolTask =
        typeof (toolPart.input as { task?: unknown } | null)?.task === 'string'
          ? (toolPart.input as { task: string }).task
          : undefined
      const isDispatchMerge =
        showWorkerCard && !!cardPlacement && /dispatch/i.test(name) && Boolean(toolTask)
      const taskPrompt = toolTask

      if (isDispatchMerge && cardPlacement) {
        return (
          <WorkerRunCard
            key={i}
            state={cardPlacement.state}
            registryIdentity={registryIdentityFor(cardPlacement.state)}
            open={isMetaOpen(
              key,
              cardPlacement.state.status === 'running' ||
                cardPlacement.state.status === 'pending_approval',
            )}
            onToggle={(o) => setMetaOpen((prev) => setRecordKey(prev, key as string, o))}
            tick={tick}
            resolving={resolving}
            onResolveApproval={onResolveApproval}
            onResetContext={onResetContext}
            taskPrompt={taskPrompt}
          />
        )
      }

      // Expand while the tool is still running; collapse when done unless
      // the user sticky-toggled open via metaOpen.
      const toolOpen = isMetaOpen(key, !isDone)
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

      if (showWorkerCard && cardPlacement) {
        return (
          <div key={i} className="chat-tool-worker-stack">
            {toolShell}
            <WorkerRunCard
              state={cardPlacement.state}
              registryIdentity={registryIdentityFor(cardPlacement.state)}
              open={isMetaOpen(
                cardPlacement.jobId,
                cardPlacement.state.status === 'running' ||
                  cardPlacement.state.status === 'pending_approval',
              )}
              onToggle={(o) => setMetaOpen((prev) => setRecordKey(prev, cardPlacement.jobId, o))}
              tick={tick}
              resolving={resolving}
              onResolveApproval={onResolveApproval}
              onResetContext={onResetContext}
              taskPrompt={taskPrompt}
            />
          </div>
        )
      }

      return (
        <div key={i} className="chat-tool-worker-stack">
          {toolShell}
        </div>
      )
    }

    // Worker run events: rendered from accumulated state
    if (part.type === 'data-worker-run') {
      const data = (part as { type: 'data-worker-run'; data: WorkerRunEvent }).data
      const wp = placementByJobId.get(data.jobId)
      if (!wp || wp.source !== 'message' || wp.messageIndex !== msgIdx || wp.partIndex !== i)
        return null
      return (
        <WorkerRunCard
          key={i}
          state={wp.state}
          registryIdentity={registryIdentityFor(wp.state)}
          open={isMetaOpen(
            data.jobId,
            wp.state.status === 'running' || wp.state.status === 'pending_approval',
          )}
          onToggle={(o) => setMetaOpen((prev) => setRecordKey(prev, data.jobId, o))}
          tick={tick}
          resolving={resolving}
          onResolveApproval={onResolveApproval}
          onResetContext={onResetContext}
        />
      )
    }
    // data-signal: task-list snapshot pushed by Leader task tools.
    // tagName='task-list-update' (incremental) / 'current-task-list' (snapshot);
    // the full tasks live in part.data.metadata.value.tasks.
    if (part.type === 'data-signal') {
      const sp = part as {
        type: 'data-signal'
        data?: {
          tagName?: string
          metadata?: { value?: { tasks?: unknown } }
          value?: { tasks?: unknown }
        }
      }
      const tagName = sp.data?.tagName
      if (tagName === 'task-list-update' || tagName === 'current-task-list') {
        const rawTasks = sp.data?.metadata?.value?.tasks ?? sp.data?.value?.tasks
        if (Array.isArray(rawTasks) && rawTasks.length > 0) {
          const tasks = rawTasks as TaskItem[]
          return <TaskListCard key={i} tasks={tasks} />
        }
      }
      return null
    }
    return null
  }

  // When turn is done, fold process trail under one summary; final text stays outside.
  // While live, keep natural part order.
  const processNodes: ReactNode[] = []
  const resultNodes: ReactNode[] = []
  const liveNodes: ReactNode[] = []
  for (let i = 0; i < message.parts.length; i += 1) {
    const part = message.parts[i]!
    const node = renderLeaderPart(part, i)
    if (!node) continue
    if (msgLive) {
      liveNodes.push(node)
      continue
    }
    const bucket = leaderPartBucket(part)
    if (bucket === 'process') processNodes.push(node)
    else if (bucket === 'result') resultNodes.push(node)
  }

  const workedKey = workedMetaKey(message.id)
  const workedOpen = metaOpen[workedKey] === true
  const workedLabel =
    leaderMeta && leaderMeta.durationSec != null && leaderMeta.durationSec >= 1
      ? t('chat.worked.for', { time: formatElapsedCompact(leaderMeta.durationSec) })
      : t('chat.worked.done')

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
    return message.parts
      .filter((p) => p.type === 'text')
      .map((p) => (p as { text?: string }).text ?? '')
      .join('\n\n')
      .trim()
  }, [message])

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

  return (
    <div
      className={`msg ${message.role === 'user' ? 'user' : 'leader'}`}
      data-msg-id={message.id}
      data-msg-role={message.role}
    >
      {isLeader && leaderMeta ? (
        /* Leader flat layout: model / thinking / duration / time in footer.
           Thinking, tools, workers, and body text are direct children of .msg.leader. */
        <>
          {/* body: collapsed process (handled) + final body text */}
          <div className="sup-body" onCopy={handleLeaderCopyEvent}>
            {msgLive ? (
              liveNodes
            ) : (
              <>
                <WorkedForSection
                  open={workedOpen}
                  onToggle={(o) => setMetaOpen((prev) => setRecordKey(prev, workedKey, o))}
                  label={workedLabel}
                >
                  {processNodes}
                </WorkedForSection>
                {resultNodes}
              </>
            )}
            {/* Pending placeholder: shown while busy and this turn has no text
                body yet. Placed after the parts (at the very end) so it stays
                below streaming thinking/tools instead of jumping ahead. Keyed
                off text body, not all parts — it still shows while thinking or
                tools stream before any text arrives, signaling the reply is
                coming. */}
            {msgLive &&
              !message.parts.some(
                (p) => p.type === 'text' && (p as { text?: string }).text?.trim(),
              ) && (
                <div className="msg-pending" aria-label={t('chat.runPlaceholder')}>
                  <span className="pdot" />
                  <span className="pdot" />
                  <span className="pdot" />
                </div>
              )}
            {/* Same Supervisor card as the failed turn */}
            {showErrorInThisBubble && errorBlock}
          </div>
          {/* /sup-body */}
          {/* Footer: live shows "model · activity"; done shows model · thinking · duration · start. */}
          {(leaderMeta.modelLabel ||
            leaderMeta.thinkLabel ||
            leaderMeta.durationLabel ||
            leaderMeta.startLabel ||
            leaderMeta.live) && (
            <div className="lead-footer">
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
                  {leaderMeta.startLabel && (
                    <>
                      {(leaderMeta.modelLabel ||
                        leaderMeta.thinkLabel ||
                        leaderMeta.durationLabel) && (
                        <span className="lead-footer-separator">·</span>
                      )}
                      <span className="lead-footer-meta mono">
                        <Calendar size={13} />
                        <span className="lead-footer-text">{leaderMeta.startLabel}</span>
                      </span>
                    </>
                  )}
                </>
              )}
              {leaderCopyText && (
                <button
                  type="button"
                  className="lead-footer-copy"
                  onClick={() => void copyToClipboard(leaderCopyText)}
                  aria-label={copyAriaLabel}
                  title={copyAriaLabel}
                >
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                </button>
              )}
            </div>
          )}
        </>
      ) : (
        /* User message: bubble + hover-revealed send time & copy */
        <>
          {message.parts.map((part, i) => {
            if (part.type !== 'text') return null
            const { text: display } = parseRouterUserMessage(part.text)
            return (
              <div className="bubble" key={i} title={part.text}>
                {display || part.text}
              </div>
            )
          })}
          {(userSentAt != null || userCopyText) && (
            <div className="msg-user-actions">
              {userTimeLabel && <span className="msg-user-time">{userTimeLabel}</span>}
              {userCopyText && (
                <button
                  type="button"
                  className="msg-user-copy"
                  onClick={() => void copyToClipboard(userCopyText)}
                  aria-label={copyAriaLabel}
                  title={copyAriaLabel}
                >
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

/**
 * Custom shallow comparison: only core data that actually affects the rendered
 * output is checked.
 *
 * On keystrokes (setInput) none of these change → returns true → skips re-render.
 * On streaming/state changes the message reference / busy / tick / metaOpen /
 * placements do change → returns false → re-renders normally.
 *
 * Deliberately ignored: t / setMetaOpen / onResolveApproval / registryIdentityFor /
 * isMetaOpen / callbacks — they get fresh references on every render, but their
 * output is unchanged on keystrokes; only the data they ultimately consume matters.
 */
function areEqual(prev: MessageItemProps, next: MessageItemProps): boolean {
  return (
    prev.message === next.message &&
    prev.busy === next.busy &&
    prev.metaOpen === next.metaOpen &&
    prev.tick === next.tick &&
    prev.placementByJobId === next.placementByJobId &&
    prev.toolCallJobIds === next.toolCallJobIds &&
    prev.hasRunningWorker === next.hasRunningWorker &&
    prev.resolving === next.resolving &&
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
    prev.isTailMessage === next.isTailMessage
  )
}

export const MessageItem = memo(MessageItemImpl, areEqual)
