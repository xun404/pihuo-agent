import type { LeaderViewMessage, LeaderViewPart } from './leader-chat-view'
import type { WorkerCardPlacement } from './worker-card-placement'

export type ChatTimelineSpeaker = 'user' | 'leader' | 'worker'

export type ChatTimelineUserItem = {
  type: 'user'
  key: string
  speaker: 'user'
  messageIndex: number
  message: LeaderViewMessage
}

export type ChatTimelineLeaderItem = {
  type: 'leader'
  key: string
  speaker: 'leader'
  messageIndex: number
  message: LeaderViewMessage
  partIndexes: number[]
  fragment: number
}

export type ChatTimelineWorkerItem = {
  type: 'worker'
  key: string
  speaker: 'worker'
  jobId: string
  placement: WorkerCardPlacement
  taskPrompt?: string
  messageIndex?: number
  partIndex?: number
  anchorMessageId?: string
}

export type ChatTimelineItem =
  ChatTimelineUserItem | ChatTimelineLeaderItem | ChatTimelineWorkerItem

export function taskPromptFromPart(part: LeaderViewPart | undefined): string | undefined {
  if (!part || typeof part !== 'object') return undefined
  if (!('input' in part)) return undefined
  const task = (part.input as { task?: unknown } | undefined)?.task
  return typeof task === 'string' && task.trim() ? task : undefined
}

function isToolPart(part: LeaderViewPart): boolean {
  return part.type.startsWith('tool-')
}

function placementAt(
  placementByJobId: Map<string, WorkerCardPlacement>,
  messageIndex: number,
  partIndex: number,
): WorkerCardPlacement | undefined {
  for (const placement of placementByJobId.values()) {
    if (
      placement.source === 'message' &&
      placement.messageIndex === messageIndex &&
      placement.partIndex === partIndex
    ) {
      return placement
    }
  }
  return undefined
}

export function lastAssistantIdOf(messages: readonly LeaderViewMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'assistant') return messages[index]!.id
  }
  return undefined
}

export function projectChatTimeline(args: {
  messages: readonly LeaderViewMessage[]
  placementByJobId: Map<string, WorkerCardPlacement>
  livePlacements: readonly WorkerCardPlacement[]
  busy?: boolean
  lastAssistantId?: string
}): ChatTimelineItem[] {
  const items: ChatTimelineItem[] = []
  const emittedJobs = new Set<string>()
  const lastAssistantId = args.lastAssistantId ?? lastAssistantIdOf(args.messages)

  args.messages.forEach((message, messageIndex) => {
    if (message.role === 'user') {
      items.push({
        type: 'user',
        key: message.id,
        speaker: 'user',
        messageIndex,
        message,
      })
      return
    }

    const live = Boolean(args.busy && message.id === lastAssistantId)
    let fragment = 0
    let current: number[] = []
    const startLength = items.length

    const flushLeader = () => {
      if (current.length === 0) return
      items.push({
        type: 'leader',
        key: `${message.id}:l${fragment}`,
        speaker: 'leader',
        messageIndex,
        message,
        partIndexes: current,
        fragment,
      })
      current = []
      fragment += 1
    }

    message.parts.forEach((part, partIndex) => {
      const placed = placementAt(args.placementByJobId, messageIndex, partIndex)
      if (placed && !emittedJobs.has(placed.jobId)) {
        if (isToolPart(part)) current.push(partIndex)
        flushLeader()
        items.push({
          type: 'worker',
          key: `worker:${placed.jobId}`,
          speaker: 'worker',
          jobId: placed.jobId,
          placement: placed,
          taskPrompt: taskPromptFromPart(part) ?? placed.state.task,
          messageIndex,
          partIndex,
          anchorMessageId: message.id,
        })
        emittedJobs.add(placed.jobId)
        return
      }
      if (part.type === 'data-worker-run') return
      current.push(partIndex)
    })
    flushLeader()

    // Only synthesize a pending Leader item when this live turn has no Leader
    // fragment yet. Do not append an empty fragment after a Worker — that
    // remounts earlier fragments and re-opens collapsed process rows.
    if (live && !items.slice(startLength).some((item) => item.type === 'leader')) {
      items.push({
        type: 'leader',
        key: `${message.id}:l${fragment}`,
        speaker: 'leader',
        messageIndex,
        message,
        partIndexes: [],
        fragment,
      })
    }
  })

  for (const live of args.livePlacements) {
    if (emittedJobs.has(live.jobId)) continue
    items.push({
      type: 'worker',
      key: `worker:${live.jobId}`,
      speaker: 'worker',
      jobId: live.jobId,
      placement: live,
      taskPrompt: live.state.task,
    })
    emittedJobs.add(live.jobId)
  }

  return items
}

export function timelineConsecutive(items: readonly ChatTimelineItem[], index: number): boolean {
  if (index <= 0) return false
  const previous = items[index - 1]
  const current = items[index]
  if (!previous || !current) return false
  if (current.speaker === 'worker') return false
  return previous.speaker === current.speaker
}

export function timelineMessageId(item: ChatTimelineItem): string | undefined {
  if (item.type === 'user' || item.type === 'leader') return item.message.id
  return item.anchorMessageId
}
