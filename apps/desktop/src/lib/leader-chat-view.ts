import type {
  LeaderChatEvent,
  LeaderChatMessage,
  LeaderContentBlock,
  LeaderTaskItem,
} from '@pihuo-agent/shared'

export type LeaderViewPart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string; state?: 'streaming' | 'done' }
  | {
      type: `tool-${string}`
      toolName: string
      toolCallId?: string
      state?: string
      input?: unknown
      output?: unknown
      errorText?: string
    }
  | { type: 'data-worker-run'; data: unknown }
  | {
      type: 'data-signal'
      data: {
        tagName?: 'task-list-update' | 'current-task-list'
        metadata?: { value?: { tasks?: LeaderTaskItem[] } }
      }
    }
  | { type: 'data-leader-run-meta'; data: unknown }

export type LeaderViewMessage = {
  id: string
  role: 'user' | 'assistant'
  timestamp: number
  parts: LeaderViewPart[]
}

function blocksToParts(content: string | LeaderContentBlock[] | undefined): LeaderViewPart[] {
  if (typeof content === 'string') return content ? [{ type: 'text', text: content }] : []
  if (!Array.isArray(content)) return []
  const parts: LeaderViewPart[] = []
  for (const block of content) {
    if (block.type === 'text') parts.push({ type: 'text', text: block.text })
    else if (block.type === 'thinking') parts.push({ type: 'reasoning', text: block.thinking })
    else if (block.type === 'toolCall') {
      parts.push({
        type: `tool-${block.name}`,
        toolName: block.name,
        toolCallId: block.id,
        state: 'input-available',
        input: block.arguments,
      })
    }
  }
  return parts
}

export function userText(message: LeaderChatMessage): string {
  if (typeof message.content === 'string') return message.content.trim()
  if (!Array.isArray(message.content)) return ''
  return message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim()
}

export function hasVisibleContent(message: LeaderChatMessage): boolean {
  if (message.role === 'user') return userText(message).length > 0
  if (typeof message.content === 'string') return message.content.trim().length > 0
  if (!Array.isArray(message.content)) return Boolean(message.custom)
  return message.content.some((block) => {
    if (block.type === 'text') return block.text.trim().length > 0
    if (block.type === 'thinking') return block.thinking.trim().length > 0
    return block.type === 'toolCall' || block.type === 'image'
  })
}

function lastIndex(
  messages: LeaderChatMessage[],
  match: (item: LeaderChatMessage, index: number) => boolean,
): number {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (match(messages[index]!, index)) return index
  }
  return -1
}

function lastAssistantInCurrentTurn(messages: LeaderChatMessage[]): number {
  const userIndex = lastIndex(messages, (item) => item.role === 'user')
  return lastIndex(messages, (item, index) => item.role === 'assistant' && index > userIndex)
}

/** All assistant / tool rows between two user turns belong to one Leader bubble. */
export function toLeaderViewMessages(
  messages: LeaderChatMessage[],
  options: { streaming?: boolean } = {},
): LeaderViewMessage[] {
  const views: LeaderViewMessage[] = []
  let current: LeaderViewMessage | undefined
  const toolIndex = new Map<string, { message: LeaderViewMessage; part: number }>()

  const startAssistant = (id: string, timestamp: number) => {
    current = { id, role: 'assistant', timestamp, parts: [] }
    views.push(current)
    return current
  }

  const indexTools = (view: LeaderViewMessage) => {
    view.parts.forEach((part, index) => {
      if ('toolCallId' in part && part.toolCallId) {
        toolIndex.set(part.toolCallId, { message: view, part: index })
      }
    })
  }

  for (const message of messages) {
    if (message.role === 'user') {
      const text = userText(message)
      const lastUser = [...views].reverse().find((item) => item.role === 'user')
      const lastUserText = lastUser
        ? lastUser.parts
            .filter((part) => part.type === 'text')
            .map((part) => part.text)
            .join('')
            .trim()
        : ''
      if (lastUser && lastUserText === text && views[views.length - 1]?.role === 'user') continue
      current = undefined
      views.push({
        id: message.id,
        role: 'user',
        timestamp: message.timestamp,
        parts: blocksToParts(message.content),
      })
      continue
    }
    if (message.role === 'assistant') {
      const last = views[views.length - 1]
      if (last?.role === 'assistant') {
        last.parts = [...last.parts, ...blocksToParts(message.content)]
        current = last
        indexTools(last)
        continue
      }
      const view = startAssistant(message.id, message.timestamp)
      view.parts.push(...blocksToParts(message.content))
      indexTools(view)
      continue
    }
    if (message.role === 'toolResult') {
      const toolId = message.id
      const target = toolIndex.get(toolId)
      const output = unwrapToolPayload(message.content)
      if (target) {
        const part = target.message.parts[target.part] as Extract<
          LeaderViewPart,
          { type: `tool-${string}` }
        >
        target.message.parts[target.part] = {
          ...part,
          state: 'output-available',
          output,
        }
      } else if (current) {
        current.parts.push({
          type: 'tool-result',
          toolName: 'tool',
          toolCallId: toolId,
          state: 'output-available',
          output,
        })
      }
      continue
    }
    if (message.role === 'custom' && message.custom) {
      if (!current) startAssistant(message.id, message.timestamp)
      if (message.custom.kind === 'worker-run') {
        current!.parts.push({ type: 'data-worker-run', data: message.custom.data })
      } else if (message.custom.kind === 'task-list') {
        current!.parts.push({
          type: 'data-signal',
          data: {
            tagName: 'current-task-list',
            metadata: { value: { tasks: message.custom.data as LeaderTaskItem[] } },
          },
        })
      } else if (message.custom.kind === 'leader-run-meta') {
        current!.parts.push({ type: 'data-leader-run-meta', data: message.custom.data })
      }
    }
  }
  const tail = views.at(-1)
  const lastPart = tail?.parts.at(-1)
  if (options.streaming && tail?.role === 'assistant' && lastPart?.type === 'reasoning') {
    lastPart.state = 'streaming'
  }
  return views
}

export function mergeLeaderSnapshot(
  existing: LeaderChatMessage[],
  snapshot: LeaderChatMessage[],
): LeaderChatMessage[] {
  if (snapshot.length === 0) return existing
  if (existing.length === 0) return snapshot

  const remaining = new Map<string, number>()
  for (const message of snapshot) {
    if (message.role !== 'user') continue
    const text = userText(message)
    remaining.set(text, (remaining.get(text) ?? 0) + 1)
  }

  const extra: LeaderChatMessage[] = []
  for (const message of existing) {
    if (message.role !== 'user') continue
    const text = userText(message)
    const left = remaining.get(text) ?? 0
    if (left > 0) remaining.set(text, left - 1)
    else extra.push(message)
  }

  const merged = [...snapshot, ...extra]
  const lastExistingUser = lastIndex(existing, (item) => item.role === 'user')
  const liveIndex = lastIndex(
    existing,
    (item) => item.role === 'assistant' && item.id === 'assistant-live' && hasVisibleContent(item),
  )
  if (liveIndex > lastExistingUser) {
    const live = existing[liveIndex]!
    const current = lastAssistantInCurrentTurn(merged)
    if (current >= 0) merged[current] = { ...live, id: merged[current]!.id }
    else merged.push(live)
  }
  return merged
}

export function applyLeaderChatEvent(
  messages: LeaderChatMessage[],
  event: LeaderChatEvent,
): LeaderChatMessage[] {
  if (event.type === 'snapshot') {
    return mergeLeaderSnapshot(messages, event.messages)
  }
  if (
    event.type === 'message_start' ||
    event.type === 'message_update' ||
    event.type === 'message_end'
  ) {
    if (
      event.type === 'message_start' &&
      event.message.role === 'assistant' &&
      !hasVisibleContent(event.message)
    ) {
      return messages
    }
    const index = messages.findIndex((item) => item.id === event.message.id)
    if (index >= 0) {
      const next = messages.slice()
      next[index] = event.message
      return next
    }
    if (event.message.role === 'user') {
      const lastUserIndex = lastIndex(messages, (item) => item.role === 'user')
      if (lastUserIndex >= 0 && userText(messages[lastUserIndex]!) === userText(event.message)) {
        const hasAssistantAfter = messages
          .slice(lastUserIndex + 1)
          .some((item) => item.role === 'assistant' && hasVisibleContent(item))
        if (!hasAssistantAfter) return messages
      }
    }
    if (event.message.role === 'assistant') {
      const live = event.message.id === 'assistant-live'
      const current = lastAssistantInCurrentTurn(messages)
      if (live && current >= 0) {
        const next = messages.slice()
        next[current] = { ...event.message, id: next[current]!.id }
        return next
      }
    }
    return [...messages, event.message]
  }
  return messages
}

export function coalesceLeaderMessages(messages: LeaderChatMessage[]): LeaderChatMessage[] {
  const out: LeaderChatMessage[] = []
  const seen = new Set<string>()
  for (const message of messages) {
    if (seen.has(message.id)) {
      const index = out.findIndex((item) => item.id === message.id)
      if (index >= 0) out[index] = message
      continue
    }
    if (message.role === 'user') {
      const lastUserIndex = lastIndex(out, (item) => item.role === 'user')
      if (lastUserIndex >= 0 && userText(out[lastUserIndex]!) === userText(message)) {
        const hasAssistantAfter = out
          .slice(lastUserIndex + 1)
          .some((item) => item.role === 'assistant' && hasVisibleContent(item))
        if (!hasAssistantAfter) continue
      }
    }
    seen.add(message.id)
    out.push(message)
  }
  return out
}

function tryJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

/** Pi persists tool results as text blocks; expanders need the parsed payload. */
export function unwrapToolPayload(value: unknown): unknown {
  if (typeof value === 'string') return tryJson(value)
  if (!Array.isArray(value)) return value
  const texts: string[] = []
  for (const item of value) {
    if (typeof item === 'string') texts.push(item)
    else if (item && typeof item === 'object' && (item as { type?: unknown }).type === 'text') {
      const text = (item as { text?: unknown }).text
      if (typeof text === 'string') texts.push(text)
    }
  }
  if (texts.length === 0) return value
  return tryJson(texts.join('\n'))
}
