import type { AgentSession, AgentSessionEvent } from '@earendil-works/pi-coding-agent'
import type { LeaderChatEvent, LeaderChatMessage } from '@pihuo-agent/shared'
import { snapshotLeaderMessages, piMessageToLeader } from './pi-messages.js'

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function hasVisibleContent(message: LeaderChatMessage): boolean {
  if (typeof message.content === 'string') return message.content.trim().length > 0
  if (!Array.isArray(message.content)) return false
  return message.content.some((block) => {
    if (block.type === 'text') return block.text.trim().length > 0
    if (block.type === 'thinking') return block.thinking.trim().length > 0
    return block.type === 'toolCall' || block.type === 'image'
  })
}

/**
 * Terminal model failure of a finished run: the last assistant message carries
 * `stopReason: 'error'` and the agent gave up retrying (`willRetry: false`).
 * Without this, provider outages (4xx/429 upstream errors) reach persistence but
 * never the chat UI — the turn silently ends with empty assistant bubbles.
 * Only surfaces after retries are exhausted so transient blips don't flash an
 * error card that the next successful attempt would leave stale.
 */
function terminalModelErrorMessage(event: unknown): string | null {
  const record = asRecord(event)
  if (!record || record.willRetry !== false) return null
  const messages = Array.isArray(record.messages) ? record.messages : []
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = asRecord(messages[i])
    if (!message || message.role !== 'assistant') continue
    if (message.stopReason !== 'error') return null
    const detail = typeof message.errorMessage === 'string' ? message.errorMessage.trim() : ''
    return detail || 'Assistant turn failed (stopReason: error).'
  }
  return null
}

export function mapSessionEvent(event: AgentSessionEvent): LeaderChatEvent[] {
  switch (event.type) {
    case 'agent_start':
      return [{ type: 'agent_start' }]
    case 'agent_end': {
      const events: LeaderChatEvent[] = [{ type: 'agent_end' }]
      const fatal = terminalModelErrorMessage(event)
      if (fatal) events.push({ type: 'error', message: fatal })
      return events
    }
    case 'turn_start':
      return [{ type: 'turn_start' }]
    case 'turn_end':
      return [{ type: 'turn_end' }]
    case 'message_start':
    case 'message_update':
    case 'message_end': {
      const raw = (event as { message?: unknown }).message
      const role = asRecord(raw)?.role
      const stableId =
        (asRecord(raw)?.id as string | undefined) ||
        (role === 'user' ? `user-${Date.now()}` : 'assistant-live')
      const message = piMessageToLeader(raw, stableId)
      if (!message) return []
      if (!asRecord(raw)?.id) message.id = stableId
      if (
        event.type === 'message_start' &&
        message.role === 'assistant' &&
        !hasVisibleContent(message)
      ) {
        return []
      }
      return [{ type: event.type, message }]
    }
    case 'tool_execution_start': {
      const record = event as unknown as {
        toolCallId?: string
        toolName?: string
        args?: unknown
      }
      return [
        {
          type: 'tool_start',
          toolCallId: record.toolCallId ?? 'tool',
          name: record.toolName ?? 'tool',
          args: record.args,
        },
      ]
    }
    case 'tool_execution_update': {
      const record = event as unknown as { toolCallId?: string; partialResult?: unknown }
      return [
        {
          type: 'tool_update',
          toolCallId: record.toolCallId ?? 'tool',
          partial: record.partialResult,
        },
      ]
    }
    case 'tool_execution_end': {
      const record = event as unknown as {
        toolCallId?: string
        isError?: boolean
        result?: unknown
      }
      return [
        {
          type: 'tool_end',
          toolCallId: record.toolCallId ?? 'tool',
          isError: record.isError === true,
          result: record.result,
        },
      ]
    }
    case 'queue_update':
      return [
        {
          type: 'queue_update',
          steering: event.steering.length,
          followUp: event.followUp.length,
        },
      ]
    case 'compaction_start':
      return [{ type: 'compaction_start' }]
    case 'compaction_end':
      return [
        {
          type: 'compaction_end',
          summary: asRecord(event.result)?.summary as string | undefined,
        },
      ]
    default:
      return []
  }
}

export function createLeaderEventStream(input: {
  session: AgentSession
  text: string
  mode: 'prompt' | 'steer'
  abortSignal: AbortSignal
  extraEvents?: AsyncIterable<LeaderChatEvent>
  /** Persisted per turn as a leader-run-meta custom message (footer timing). */
  modelId?: string
  thinking?: string
}): ReadableStream<LeaderChatEvent> {
  return new ReadableStream<LeaderChatEvent>({
    start(controller) {
      const enqueue = (event: LeaderChatEvent) => {
        try {
          controller.enqueue(event)
        } catch {
          /* closed */
        }
      }
      const snapshot: LeaderChatMessage[] = snapshotLeaderMessages(input.session.messages)
      if (snapshot.length > 0) enqueue({ type: 'snapshot', messages: snapshot })
      const unsubscribe = input.session.subscribe((event) => {
        for (const mapped of mapSessionEvent(event)) enqueue(mapped)
      })
      const onAbort = () => {
        void input.session.abort()
      }
      input.abortSignal.addEventListener('abort', onAbort, { once: true })
      const startedAtMs = Date.now()
      const run =
        input.mode === 'steer' ? input.session.steer(input.text) : input.session.prompt(input.text)
      void run
        .catch((error) => {
          enqueue({
            type: 'error',
            message: error instanceof Error ? error.message : String(error),
          })
        })
        .finally(() => {
          input.abortSignal.removeEventListener('abort', onAbort)
          unsubscribe()
          // Durable footer timing: the renderer's client-side clock is volatile
          // (gone after reload), so the completed turn appends its run meta to
          // the session transcript for later hydration.
          void input.session
            .sendCustomMessage(
              {
                customType: 'leader-run-meta',
                content: [],
                display: false,
                details: {
                  startedAt: startedAtMs,
                  completedAt: Date.now(),
                  model: input.modelId,
                  thinking: input.thinking,
                },
              },
              { triggerTurn: false },
            )
            .catch(() => {
              /* best-effort; timing is non-critical */
            })
          controller.close()
        })
    },
  })
}
