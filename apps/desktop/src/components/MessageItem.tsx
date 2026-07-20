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
import { WorkerRunCard } from './WorkerRunCard'
import { IconBolt, IconClock, IconSupervisor } from './Icons'
import { setRecordKey } from '../lib/chat-state'
import type { MessageKey } from '../i18n/locales'
import { parseRouterUserMessage } from '../lib/user-message-display'
import {
  formatClockTime,
  resolveLeaderRunMeta,
  shortModelId,
  type ClientTurnMeta,
} from '../lib/leader-run-meta'
import { formatElapsedHms } from '../lib/format-elapsed'
import {
  shouldRenderGenericToolShell,
  type WorkerCardPlacement,
} from '../lib/worker-card-placement'
import type { ThinkingIntensity } from '../lib/settings'
import type { AccessModeId } from '../lib/access-mode'

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
          live: false,
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
        const clientTiming = turnTimingRef.current.get(message.id)
        const sealedStart = clientTiming?.startedAt ?? meta.startedAt
        const sealedEnd = clientTiming?.endedAt ?? (!live ? meta.endedAt : undefined)
        const durationSec =
          !live && sealedStart != null && sealedEnd != null && sealedEnd >= sealedStart
            ? Math.max(0, (sealedEnd - sealedStart) / 1000)
            : null
        const durationLabel = durationSec != null ? formatElapsedHms(durationSec, locale) : ''
        const startLabel =
          sealedStart != null
            ? formatClockTime(sealedStart, locale, { timeZoneLabel: t('chat.runTzCst') })
            : ''
        return { modelLabel, thinkLabel, durationLabel, startLabel, live }
      })()
    : null

  return (
    <div className={`msg ${message.role === 'user' ? 'user' : 'leader'}`}>
      {isLeader && leaderMeta ? (
        <div className="sup-card">
          {/* header：头像 + Supervisor + 模型 badge + 运行态 */}
          <div className="sup-header">
            <span className="sup-avatar" aria-hidden>
              <IconSupervisor size={14} />
            </span>
            <span className="sup-name">{t('chat.leader')}</span>
            {leaderMeta.modelLabel && (
              <span className="sup-model">
                <IconBolt size={9} />
                {leaderMeta.modelLabel}
              </span>
            )}
            {leaderMeta.live && (
              <span className="sup-status">
                <span className="pip" />
                {t('chat.runningShort')}
              </span>
            )}
          </div>
          {/* body：思考/工具/Worker/正文 */}
          <div className="sup-body">
            {message.parts.map((part, i) => {
              if (part.type === 'text') {
                return (
                  <div className="sup-text md-content" key={i}>
                    <MarkdownContent>{part.text}</MarkdownContent>
                    {msgLive && <span className="stream-cursor" aria-hidden="true" />}
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
                    label={t('chat.thinking')}
                    streamingLabel={t('chat.thinkingLive')}
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
                const open = isMetaOpen(key, false)
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
                const showDuration =
                  finalDuration != null ? finalDuration : liveMs > 0 ? liveMs / 1000 : null

                // dispatch 流式中：tool 还没返回 output.jobId → 抑制 tool-row。
                // 此时 worker 由 livePlacements 独立渲染（在末尾），
                // 若此处也渲染 tool-row 会和 worker-card 分离，中间产生大片空白。
                // tool 返回后（有 output.jobId），下方 isDispatchMerge 生效，显示合并节点。
                if (/dispatch/i.test(name) && !workerJobId && !isDone) {
                  return null
                }

                // dispatchWorkerTool: merge the tool row + worker card into a single
                // node (the tool's task prompt becomes the first body section, and
                // the worker output/approval flows underneath). Avoids the previous
                // duplicate render of [tool-row with task, worker-card with output].
                const isDispatchMerge =
                  showWorkerCard &&
                  !!cardPlacement &&
                  /dispatch/i.test(name) &&
                  typeof (toolPart.input as { task?: unknown } | null)?.task === 'string'
                const taskPrompt = isDispatchMerge
                  ? (toolPart.input as { task: string }).task
                  : undefined

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

                const toolShell = (
                  <ToolCallRow
                    name={name}
                    input={toolPart.input}
                    output={toolPart.output}
                    errorText={toolPart.errorText}
                    durationSec={showDuration}
                    running={!isDone}
                    open={open}
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
                        onToggle={(o) =>
                          setMetaOpen((prev) => setRecordKey(prev, cardPlacement.jobId, o))
                        }
                        tick={tick}
                        resolving={resolving}
                        onResolveApproval={onResolveApproval}
                        onResetContext={onResetContext}
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
                if (
                  !wp ||
                  wp.source !== 'message' ||
                  wp.messageIndex !== msgIdx ||
                  wp.partIndex !== i
                )
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
              return null
            })}
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
          {/* footer：时长 · 思考 · 时间戳（从 header 下沉）*/}
          {(leaderMeta.durationLabel || leaderMeta.thinkLabel || leaderMeta.startLabel) && (
            <div className="sup-footer">
              {leaderMeta.durationLabel && (
                <span className="sup-footer-meta mono">
                  <IconClock size={10} />
                  {leaderMeta.durationLabel}
                </span>
              )}
              {leaderMeta.durationLabel && leaderMeta.thinkLabel && (
                <span className="sup-footer-sep" aria-hidden>
                  ·
                </span>
              )}
              {leaderMeta.thinkLabel && (
                <span className="sup-footer-meta">
                  <IconBolt size={10} />
                  {leaderMeta.thinkLabel}
                </span>
              )}
              {leaderMeta.thinkLabel && leaderMeta.startLabel && (
                <span className="sup-footer-sep" aria-hidden>
                  ·
                </span>
              )}
              {leaderMeta.startLabel && (
                <span className="sup-footer-meta mono">{leaderMeta.startLabel}</span>
              )}
            </div>
          )}
        </div>
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
