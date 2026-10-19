import {
  Fragment,
  memo,
  useMemo,
  type Dispatch,
  type ReactNode,
  type RefObject,
  type SetStateAction,
} from 'react'
import type { LeaderStepBudgetEvent, WorkerRunState } from '@pihuo-agent/shared'
import { useI18n } from '../../i18n/I18nProvider'
import type { LeaderViewMessage } from '../../lib/leader-chat-view'
import type { ClientTurnMeta } from '../../lib/leader-run-meta'
import {
  lastAssistantIdOf,
  projectChatTimeline,
  timelineConsecutive,
  timelineMessageId,
} from '../../lib/chat-timeline'
import type { WorkerCardPlacement } from '../../lib/worker-card-placement'
import { setRecordKey } from '../../lib/chat-state'
import type { ThinkingIntensity } from '../../lib/settings'
import { MessageItem } from '../MessageItem'
import { WorkerMessageItem } from './WorkerMessageItem'
import { CompactionMarker, type CompactionMarkerData } from '../CompactionMarker'
import { LeaderStepBudgetNotice } from '../LeaderStepBudgetNotice'
import type { UserQuoteChrome } from '../../lib/user-message-display'

type ModelOption = {
  id: string
  label: string
}

export interface ChatMessageListProps {
  messages: LeaderViewMessage[]
  historyLoading: boolean
  busy: boolean
  discussionMode: boolean
  lastMessageId?: string
  errorBelongsInLastAssistant: boolean
  displayError: unknown
  errorBlock: ReactNode | null
  models: ModelOption[]
  selectedModel: string
  thinkingIntensity: ThinkingIntensity
  modelShort: string
  thinkShort: string
  metaOpen: Record<string, boolean>
  setMetaOpen: Dispatch<SetStateAction<Record<string, boolean>>>
  tick: number
  placementByJobId: Map<string, WorkerCardPlacement>
  livePlacements: WorkerCardPlacement[]
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
  timingEpoch: number
  turnTimingRef: RefObject<Map<string, ClientTurnMeta>>
  toolStartTimes: RefObject<Map<string, number>>
  toolDurations: RefObject<Map<string, number>>
  compactionMarkers: CompactionMarkerData[]
  activeBudgetEvent: LeaderStepBudgetEvent | null
  canContinueBudget: boolean
  onContinueBudget: () => void
  bottomRef: RefObject<HTMLDivElement | null>
  mentionNames?: readonly string[]
  onMentionClick?: (name: string) => void
  onQuote?: (quote: UserQuoteChrome) => void
}

export const ChatMessageList = memo(function ChatMessageList({
  messages,
  historyLoading,
  busy,
  discussionMode,
  lastMessageId,
  errorBelongsInLastAssistant,
  displayError,
  errorBlock,
  models,
  selectedModel,
  thinkingIntensity,
  modelShort,
  thinkShort,
  metaOpen,
  setMetaOpen,
  tick,
  placementByJobId,
  livePlacements,
  resolving,
  onResolveApproval,
  onResetContext,
  registryIdentityFor,
  isMetaOpen,
  timingEpoch,
  turnTimingRef,
  toolStartTimes,
  toolDurations,
  compactionMarkers,
  activeBudgetEvent,
  canContinueBudget,
  onContinueBudget,
  bottomRef,
  mentionNames,
  onMentionClick,
  onQuote,
}: ChatMessageListProps) {
  const { t, locale } = useI18n()
  const lastAssistantId = useMemo(() => lastAssistantIdOf(messages), [messages])

  const timeline = useMemo(
    () =>
      projectChatTimeline({
        messages,
        placementByJobId,
        livePlacements,
        busy,
        lastAssistantId,
      }),
    [messages, placementByJobId, livePlacements, busy, lastAssistantId],
  )

  const lastLeaderIndex = useMemo(() => {
    for (let index = timeline.length - 1; index >= 0; index -= 1) {
      const item = timeline[index]
      if (item?.type === 'leader' && item.message.id === lastAssistantId) return index
    }
    return -1
  }, [timeline, lastAssistantId])

  return (
    <>
      {historyLoading && messages.length === 0 && (
        <div className="chat-history-loading">{t('app.loading')}</div>
      )}
      {timeline.map((item, index) => {
        const consecutive = timelineConsecutive(timeline, index)
        const messageId = timelineMessageId(item)
        const nextId = timeline[index + 1] ? timelineMessageId(timeline[index + 1]!) : undefined
        const lastOfMessage = Boolean(messageId) && nextId !== messageId
        const dateDivider =
          discussionMode && index === 0 && item.type === 'worker' ? (
            <div className="discussion-date-divider" aria-label={t('chat.discussionTodayLabel')}>
              <span>{t('chat.discussionTodayLabel')}</span>
            </div>
          ) : null
        const node =
          item.type === 'worker' ? (
            <WorkerMessageItem
              state={item.placement.state}
              taskPrompt={item.taskPrompt}
              consecutive={consecutive}
              registryIdentity={registryIdentityFor(item.placement.state)}
              open={isMetaOpen(item.jobId, false)}
              onToggle={(open) => setMetaOpen((prev) => setRecordKey(prev, item.jobId, open))}
              tick={tick}
              resolving={resolving}
              onResolveApproval={onResolveApproval}
              onResetContext={onResetContext}
              onQuote={
                onQuote && item.placement.state.output.trim()
                  ? () =>
                      onQuote({
                        speaker: 'worker',
                        speakerName:
                          item.placement.state.teamMemberName || item.placement.state.workerName,
                        job: item.jobId,
                        text: item.placement.state.output.trim(),
                      })
                  : undefined
              }
            />
          ) : (
            <MessageItem
              message={item.message}
              msgIdx={item.messageIndex}
              messages={messages}
              busy={busy}
              lastAssistantId={lastAssistantId}
              showErrorInThisBubble={
                item.type === 'leader' &&
                errorBelongsInLastAssistant &&
                lastMessageId === item.message.id &&
                index === lastLeaderIndex
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
              isMetaOpen={isMetaOpen}
              errorBlock={errorBlock}
              timingEpoch={timingEpoch}
              turnTimingRef={turnTimingRef}
              toolStartTimes={toolStartTimes}
              toolDurations={toolDurations}
              discussionMode={discussionMode}
              partIndexes={item.type === 'leader' ? item.partIndexes : undefined}
              isConsecutive={consecutive}
              showDateDivider={discussionMode && index === 0}
              isLiveFragment={
                item.type === 'leader' &&
                busy &&
                item.message.id === lastAssistantId &&
                index === lastLeaderIndex
              }
              mentionNames={mentionNames}
              onMentionClick={onMentionClick}
              onQuote={onQuote}
            />
          )
        return (
          <Fragment key={item.key}>
            {dateDivider}
            {node}
            {lastOfMessage &&
              messageId &&
              compactionMarkers
                .filter((marker) => marker.afterMessageId === messageId)
                .map((marker) => (
                  <CompactionMarker
                    key={marker.id}
                    status={marker.status}
                    freedTokens={marker.freedTokens}
                  />
                ))}
          </Fragment>
        )
      })}
      {compactionMarkers
        .filter(
          (marker) =>
            !marker.afterMessageId ||
            !messages.some((message) => message.id === marker.afterMessageId),
        )
        .map((marker) => (
          <CompactionMarker
            key={marker.id}
            status={marker.status}
            freedTokens={marker.freedTokens}
          />
        ))}
      {displayError && !errorBelongsInLastAssistant && (
        <div className="msg leader msg-error-standalone">{errorBlock}</div>
      )}
      {activeBudgetEvent && (
        <LeaderStepBudgetNotice
          event={activeBudgetEvent}
          canContinue={canContinueBudget}
          busy={busy}
          onContinue={onContinueBudget}
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
})
