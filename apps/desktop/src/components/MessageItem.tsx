/**
 * 单条消息的渲染（用户气泡 / Supervisor 卡片）。
 *
 * 从 ChatPanel 抽出，并用 React.memo + 自定义 areEqual 包裹——
 * 这样在 composer 输入（setInput）导致 ChatPanel 重渲染时，只要消息本身
 * （message 引用、busy、workerStates、metaOpen 等核心数据）没变，就跳过
 * 本组件的重渲染。根治「输入越多越卡」——原来每次按键都会重建 340 行 JSX。
 *
 * areEqual 故意忽略不稳定的 props（t / 回调 / 派生函数）：它们在按键时虽
 * 拿到新引用，但输出不变；只有核心数据变了才需要重渲染。
 */
import { memo, type ReactNode, type Dispatch, type RefObject, type SetStateAction } from 'react'
import type { UIMessage } from '@ai-sdk/react'
import type { WorkerRunEvent, WorkerRunState, ApprovalItem } from '@swarmdesk-agent/shared'
import { MarkdownContent } from './MarkdownContent'
import { ToolCallRow } from './chat/ToolCallRow'
import { ThinkingBlock } from './chat/ThinkingBlock'
import { WorkedForSection } from './chat/WorkedForSection'
import { WorkerRunCard } from './WorkerRunCard'
import { TaskListCard, type TaskItem } from './chat/TaskListCard'
import { IconClock, Origami, Zap, ZapOff, Calendar } from './Icons'
import { setRecordKey } from '../lib/chat-state'
import type { MessageKey } from '../i18n/locales'
import { parseRouterUserMessage } from '../lib/user-message-display'
import {
  formatClockTime,
  resolveLeaderActivity,
  resolveLeaderRunMeta,
  shortModelId,
  type ClientTurnMeta,
} from '../lib/leader-run-meta'
import { formatElapsedCompact, formatElapsedHms } from '../lib/format-elapsed'
import {
  shouldRenderGenericToolShell,
  type WorkerCardPlacement,
} from '../lib/worker-card-placement'
import type { ThinkingIntensity } from '../lib/settings'

// i18n：复用 locales 的 MessageKey 联合类型，和 I18nProvider 的 t 签名对齐。
type TFunc = (key: MessageKey, vars?: Record<string, string | number>) => string

/** 从 useChat 取到的消息形态（UIMessage）。parts 含 text / reasoning / tool-x / data-worker-run。 */
type AnyMessage = UIMessage<any>

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

export interface MessageItemProps {
  message: AnyMessage
  msgIdx: number
  messages: AnyMessage[]
  busy: boolean
  lastAssistantId: string | undefined
  isTailMessage: boolean
  showErrorInThisBubble: boolean
  // —— 以下在 areEqual 中被忽略（按键时不影响输出）——
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

  // ── Supervisor (leader) meta（header 精简 + footer 下沉）──
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
    // data-signal：Mastra TaskSignalProvider 下发的任务列表快照。
    // tagName='task-list-update'(增量)/'current-task-list'(快照)，
    // 全量 tasks 在 part.data.metadata.value.tasks。
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
          {/* body：过程折叠（已处理）+ 最终正文 */}
          <div className="sup-body">
            {msgLive ? (
              liveNodes
            ) : processNodes.length > 0 ? (
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
            ) : (
              resultNodes
            )}
            {/* pending 占位符：busy 且本轮还没产出任何 text 正文时显示。
                放在 parts 之后（最末尾），这样思考/工具流式时它在最下面，
                不会跑到内容前面。条件用 text 正文而非所有 part——
                思考/工具已在流但正文没来时仍显示，给用户"还在等回复"的信号。*/}
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
            {/* 与失败轮次同一张 Supervisor 卡 */}
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
                  <Origami size={13} />
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
            </div>
          )}
        </>
      ) : (
        /* User message: just the bubble */
        message.parts.map((part, i) => {
          if (part.type !== 'text') return null
          const { text: display } = parseRouterUserMessage(part.text)
          return (
            <div className="bubble" key={i} title={part.text}>
              {display || part.text}
            </div>
          )
        })
      )}
    </div>
  )
}

/**
 * 自定义浅比较：只检查「真正影响渲染输出」的核心数据。
 *
 * 按键（setInput）时这些值都不变 → 返回 true → 跳过重渲染。
 * 流式/状态变化时 message 引用 / busy / tick / metaOpen / placements 会变 → 返回 false → 正常重渲染。
 *
 * 故意忽略：t / setMetaOpen / onResolveApproval / registryIdentityFor / isMetaOpen / 回调等
 * ——它们每次 render 新引用，但按键时输出不变；只关心它们最终消费的数据。
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
