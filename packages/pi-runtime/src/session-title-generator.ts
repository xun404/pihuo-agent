/**
 * First-task auto-naming helpers. Live naming is done by the Leader
 * set-session-title tool; this module only keeps the pure text helpers.
 */
import type { ChatMessage } from './session-title-generator.types.js'

const TITLE_MAX_CHARS = 80

export function extractFirstUserText(messages: unknown): string | null {
  if (!Array.isArray(messages)) return null
  for (const raw of messages) {
    if (!raw || typeof raw !== 'object') continue
    const msg = raw as ChatMessage
    if (msg.role !== 'user') continue
    const text = readMessageText(msg)
    const trimmed = text.trim()
    if (trimmed) return trimmed
  }
  return null
}

function readMessageText(msg: ChatMessage): string {
  if (typeof msg.content === 'string') return msg.content
  if (Array.isArray(msg.parts)) {
    return msg.parts
      .map((part) =>
        part && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string'
          ? part.text.trim()
          : '',
      )
      .filter((chunk) => chunk.length > 0)
      .join('\n')
      .trim()
  }
  return ''
}

export function cleanTitle(raw: string | null | undefined): string | null {
  if (!raw) return null
  const stripped = raw
    .replace(/^["'“”«»]+|["'“”«»]+$/g, '')
    .replace(/^(title|标题)\s*[:：]\s*/i, '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.。]$/, '')
    .trim()
  if (!stripped) return null
  return stripped.length > TITLE_MAX_CHARS ? stripped.slice(0, TITLE_MAX_CHARS) : stripped
}
