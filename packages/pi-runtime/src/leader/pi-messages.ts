import type {
  LeaderChatMessage,
  LeaderContentBlock,
  LeaderCustomKind,
} from '@pihuo-agent/shared'

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function contentBlocks(value: unknown): string | LeaderContentBlock[] | undefined {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return undefined
  const blocks: LeaderContentBlock[] = []
  for (const item of value) {
    const record = asRecord(item)
    if (!record) continue
    if (record.type === 'text' && typeof record.text === 'string') {
      blocks.push({ type: 'text', text: record.text })
    } else if (record.type === 'thinking' && typeof record.thinking === 'string') {
      blocks.push({ type: 'thinking', thinking: record.thinking })
    } else if (record.type === 'image' && typeof record.data === 'string') {
      blocks.push({
        type: 'image',
        data: record.data,
        mimeType: typeof record.mimeType === 'string' ? record.mimeType : 'image/png',
      })
    } else if (record.type === 'toolCall' && typeof record.id === 'string') {
      blocks.push({
        type: 'toolCall',
        id: record.id,
        name: typeof record.name === 'string' ? record.name : 'tool',
        arguments:
          record.arguments && typeof record.arguments === 'object'
            ? (record.arguments as Record<string, unknown>)
            : {},
      })
    }
  }
  return blocks
}

export function piMessageToLeader(message: unknown, fallbackId: string): LeaderChatMessage | null {
  const record = asRecord(message)
  if (!record) return null
  const role =
    record.role === 'user' ||
    record.role === 'assistant' ||
    record.role === 'toolResult' ||
    record.role === 'custom'
      ? record.role
      : null
  if (!role) return null
  const timestamp =
    typeof record.timestamp === 'number' && Number.isFinite(record.timestamp)
      ? record.timestamp
      : Date.now()
  const id =
    typeof record.id === 'string' && record.id.length > 0
      ? record.id
      : typeof record.toolCallId === 'string'
        ? record.toolCallId
        : fallbackId
  const customKind = record.kind
  if (role === 'custom' && typeof customKind === 'string') {
    return {
      id,
      role: 'custom',
      timestamp,
      custom: { kind: customKind as LeaderCustomKind, data: record.data ?? record },
    }
  }
  return {
    id,
    role,
    timestamp,
    content: contentBlocks(record.content) ?? (typeof record.content === 'string' ? record.content : undefined),
  }
}

export function snapshotLeaderMessages(messages: readonly unknown[]): LeaderChatMessage[] {
  return messages
    .map((message, index) => piMessageToLeader(message, `msg-${index}`))
    .filter((message): message is LeaderChatMessage => message !== null)
}
