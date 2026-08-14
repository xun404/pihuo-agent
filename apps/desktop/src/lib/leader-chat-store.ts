import type {
  FollowUpRequestMeta,
  LeaderChatEvent,
  LeaderChatMessage,
  LeaderThinkingIntensity,
  LeaderWorkMode,
  WorkerRunEvent,
} from '@pihuo-agent/shared'
import {
  applyLeaderChatEvent,
  coalesceLeaderMessages,
  toLeaderViewMessages,
  type LeaderViewMessage,
} from './leader-chat-view'
import {
  readLeaderChatSse,
  resumeLeaderChatRequest,
  startLeaderChatRequest,
} from './leader-chat-client'

export type LeaderChatStatus = 'ready' | 'submitted' | 'streaming' | 'error'

export class LeaderChatStore {
  messages: LeaderChatMessage[] = []
  status: LeaderChatStatus = 'ready'
  error: Error | undefined
  private listeners = new Set<() => void>()
  private abort: AbortController | null = null

  constructor(readonly threadId: string) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit() {
    for (const listener of this.listeners) listener()
  }

  get viewMessages(): LeaderViewMessage[] {
    return toLeaderViewMessages(this.messages)
  }

  setMessages(messages: LeaderChatMessage[]) {
    this.messages = coalesceLeaderMessages(messages)
    this.emit()
  }

  clearError() {
    this.error = undefined
    if (this.status === 'error') this.status = 'ready'
    this.emit()
  }

  stop() {
    this.abort?.abort()
    this.status = 'ready'
    this.emit()
  }

  async send(input: {
    text: string
    followUp: FollowUpRequestMeta
    model: string
    thinking?: LeaderThinkingIntensity
    workMode?: LeaderWorkMode
    onAccepted?: (followUp: FollowUpRequestMeta) => void
  }): Promise<void> {
    if (this.status === 'submitted' || this.status === 'streaming') return
    this.status = 'submitted'
    this.error = undefined
    this.messages = applyLeaderChatEvent(this.messages, {
      type: 'message_end',
      message: {
        id: input.followUp.deliveryId,
        role: 'user',
        timestamp: Date.now(),
        content: input.text,
      },
    })
    this.emit()
    this.abort = new AbortController()
    const response = await startLeaderChatRequest({
      threadId: this.threadId,
      ...input,
      signal: this.abort.signal,
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => ({ error: response.statusText }))
      this.status = 'error'
      this.error = new Error(
        typeof payload.error === 'string' ? payload.error : 'Chat failed',
      )
      this.emit()
      throw this.error
    }
    this.status = 'streaming'
    this.emit()
    input.onAccepted?.(input.followUp)
    await this.consume(response)
  }

  async resume(clientRunId: string): Promise<void> {
    const response = await resumeLeaderChatRequest(this.threadId, clientRunId)
    if (response.status === 204 || !response.ok) return
    this.status = 'streaming'
    this.emit()
    await this.consume(response)
  }

  private async consume(response: Response): Promise<void> {
    try {
      for await (const event of readLeaderChatSse(response)) {
        this.apply(event)
      }
      this.status = 'ready'
    } catch (error) {
      this.status = 'error'
      this.error = error instanceof Error ? error : new Error(String(error))
    } finally {
      this.abort = null
      this.emit()
    }
  }

  apply(event: LeaderChatEvent) {
    if (event.type === 'error') {
      this.status = 'error'
      this.error = new Error(event.message)
    }
    this.messages = applyLeaderChatEvent(this.messages, event)
    this.emit()
  }
}

export function workerEventsFromLeaderMessages(
  messages: LeaderChatMessage[],
): WorkerRunEvent[] {
  const events: WorkerRunEvent[] = []
  for (const message of messages) {
    if (message.custom?.kind === 'worker-run' && message.custom.data) {
      events.push(message.custom.data as WorkerRunEvent)
    }
  }
  return events
}
