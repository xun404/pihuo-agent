/**
 * Helpers for Supervisor turn footer: duration, model, thinking, start time.
 */

import { parseRouterUserMessage } from './user-message-display'

export type LeaderRunMeta = {
  model?: string
  thinking?: string
  startedAt?: number
  endedAt?: number
}

/** Client-side seal for a Supervisor turn (UI messages strip wire context) */
export type ClientTurnMeta = {
  startedAt: number
  endedAt?: number
  model?: string
  thinking?: string
}

type RunMetaPartData = {
  startedAt?: unknown
  completedAt?: unknown
  model?: unknown
  thinking?: unknown
}

type RunMessage = {
  id: string
  role: string
  metadata?: unknown
  parts?: Array<{
    type?: string
    text?: string
    state?: string
    toolName?: string
    output?: unknown
    errorText?: string
    data?: unknown
  }>
}

/**
 * Return only an assistant that belongs to the latest user turn. While a new
 * request is waiting for its first assistant chunk, this deliberately returns
 * undefined instead of reusing (and overwriting timing for) the previous turn.
 */
export function findCurrentTurnAssistant<T extends { role: string }>(
  messages: T[],
): T | undefined {
  let lastUserIndex = -1
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') {
      lastUserIndex = index
      break
    }
  }
  if (lastUserIndex < 0) return undefined
  for (let index = messages.length - 1; index > lastUserIndex; index -= 1) {
    if (messages[index]?.role === 'assistant') return messages[index]
  }
  return undefined
}

export function shortModelId(model?: string): string {
  if (!model?.trim()) return ''
  const m = model.trim()
  return m.includes('/') ? m.slice(m.indexOf('/') + 1) : m
}

/** Best-effort timestamp from UI / memory message shape */
export function parseMessageTimestamp(msg: unknown): number | null {
  if (!msg || typeof msg !== 'object') return null
  const m = msg as Record<string, unknown>
  const meta =
    m.metadata && typeof m.metadata === 'object' ? (m.metadata as Record<string, unknown>) : null
  const candidates: unknown[] = [m.createdAt, m.created_at, meta?.createdAt, meta?.created_at]
  for (const c of candidates) {
    if (c instanceof Date && !Number.isNaN(c.getTime())) return c.getTime()
    if (typeof c === 'number' && Number.isFinite(c) && c > 0) {
      // seconds vs ms
      return c < 1e12 ? c * 1000 : c
    }
    if (typeof c === 'string' && c.trim()) {
      const t = Date.parse(c)
      if (!Number.isNaN(t)) return t
    }
  }
  return null
}

function parseTimestampValue(value: unknown): number | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.getTime()
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value < 1e12 ? value * 1000 : value
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? null : parsed
  }
  return null
}

function durableRunMeta(msg: RunMessage): LeaderRunMeta {
  const parts = Array.isArray(msg.parts) ? msg.parts : []
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index]
    if (part?.type !== 'data-leader-run-meta' || !part.data || typeof part.data !== 'object') {
      continue
    }
    const data = part.data as RunMetaPartData
    return {
      startedAt: parseTimestampValue(data.startedAt) ?? undefined,
      endedAt: parseTimestampValue(data.completedAt) ?? undefined,
      model: typeof data.model === 'string' && data.model.trim() ? data.model.trim() : undefined,
      thinking:
        typeof data.thinking === 'string' && data.thinking.trim()
          ? data.thinking.trim()
          : undefined,
    }
  }
  return {}
}

function assistantMetadataModel(msg: RunMessage): string | undefined {
  if (!msg.metadata || typeof msg.metadata !== 'object') return undefined
  const metadata = msg.metadata as Record<string, unknown>
  const provider =
    typeof metadata.provider === 'string' && metadata.provider.trim()
      ? metadata.provider.trim()
      : undefined
  const modelId =
    typeof metadata.modelId === 'string' && metadata.modelId.trim()
      ? metadata.modelId.trim()
      : typeof metadata.modelID === 'string' && metadata.modelID.trim()
        ? metadata.modelID.trim()
        : undefined
  if (!modelId) return undefined
  return provider ? `${provider}/${modelId}` : modelId
}

function precedingUserTimestamp(messages: RunMessage[], assistantIndex: number): number | undefined {
  for (let index = assistantIndex - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role !== 'user') continue
    return parseMessageTimestamp(message) ?? undefined
  }
  return undefined
}

/** Current Leader footer activity. Unknown or idle states deliberately fall back to Thinking. */
export function resolveLeaderActivity(parts: Array<Record<string, unknown>>): string {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index]
    const type = typeof part.type === 'string' ? part.type : ''
    if (type === 'reasoning' && part.state === 'streaming') return 'Thinking'
    if (!type.startsWith('tool-') && type !== 'dynamic-tool') continue

    const done =
      part.state === 'result' ||
      part.state === 'output-available' ||
      part.state === 'output-error' ||
      part.output != null ||
      Boolean(part.errorText)
    if (done) continue

    const toolName =
      (typeof part.toolName === 'string' && part.toolName) || type.replace(/^tool-/, '')
    if (/(?:bash|shell|command|exec|terminal)/i.test(toolName)) return 'Command'
    if (/(?:task|dispatch|worker|team)/i.test(toolName)) return 'Task'
    if (/(?:read|get|list|search|find|grep|glob|fetch)/i.test(toolName)) return 'Read'
    if (/(?:write|edit|patch|create|update|set)/i.test(toolName)) return 'Edit'
    return 'Thinking'
  }
  return 'Thinking'
}

function userTextFromMessage(msg: { parts?: Array<{ type?: string; text?: string }> }): string {
  if (!Array.isArray(msg.parts)) return ''
  return msg.parts
    .filter((p) => p.type === 'text' && typeof p.text === 'string')
    .map((p) => p.text!)
    .join('\n')
}

/** Model / thinking from the user turn that triggered this assistant reply */
export function extractPrecedingUserMeta(
  messages: Array<{ role: string; parts?: Array<{ type?: string; text?: string }> }>,
  assistantIndex: number,
): { model?: string; thinking?: string } {
  for (let i = assistantIndex - 1; i >= 0; i--) {
    const m = messages[i]
    if (!m || m.role !== 'user') continue
    const { meta } = parseRouterUserMessage(userTextFromMessage(m))
    return {
      model: meta.model,
      thinking: meta.thinking,
    }
  }
  return {}
}

/** 统一用中国标准时间（Asia/Shanghai, UTC+8）展示 */
export const DISPLAY_TIME_ZONE = 'Asia/Shanghai'

/**
 * 开始时间：年月日 + 时分秒 + 时区标签（默认 CST）。
 * 数值始终按 Asia/Shanghai 换算；文案 locale / tzLabel 支持国际化。
 * 例：2026/07/16 18:51:33 CST
 */
export function formatClockTime(
  ts: number,
  locale: string,
  opts?: { timeZoneLabel?: string; timeZone?: string },
): string {
  const tz = opts?.timeZone ?? DISPLAY_TIME_ZONE
  const tzLabel = opts?.timeZoneLabel ?? 'CST'
  try {
    const loc = locale === 'zh' || locale.startsWith('zh') ? 'zh-CN' : 'en-US'
    const formatted = new Date(ts).toLocaleString(loc, {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
    return `${formatted} ${tzLabel}`.trim()
  } catch {
    // Fallback: still force +08:00 offset roughly via ISO (UTC) + label
    return `${new Date(ts).toISOString().replace('T', ' ').slice(0, 19)} UTC ${tzLabel}`.trim()
  }
}

/**
 * Seed / update timings from message list + optional live client map.
 * - History: startedAt from the preceding user; endedAt from the persisted assistant timestamp
 * - Client map: wall-clock + model/thinking captured at turn start
 *   (local user bubbles strip wire [context], so client seal is primary for first chats)
 */
export function resolveLeaderRunMeta(
  messages: RunMessage[],
  assistantIndex: number,
  clientTimings: Map<string, ClientTurnMeta>,
  opts: {
    live: boolean
    now: number
    /** Fallback when neither wire context nor client seal has model/thinking */
    fallbackModel?: string
    fallbackThinking?: string
  },
): LeaderRunMeta {
  const msg = messages[assistantIndex]
  if (!msg || msg.role === 'user' || msg.role === 'system') return {}

  const fromUser = extractPrecedingUserMeta(messages, assistantIndex)
  const client = clientTimings.get(msg.id)
  const durable = durableRunMeta(msg)
  const msgTs = parseMessageTimestamp(msg)

  const startedAt =
    durable.startedAt ?? client?.startedAt ?? precedingUserTimestamp(messages, assistantIndex) ?? msgTs ?? undefined
  let endedAt = durable.endedAt ?? client?.endedAt

  // Legacy history has no data-leader-run-meta marker. Mastra persists the
  // assistant message when the run completes, so its createdAt is the closest
  // durable completion boundary. Prefer it over the next user message: the
  // latter includes arbitrary time the user spent reading before sending again.
  if (endedAt == null && !opts.live && msgTs != null && (startedAt == null || msgTs >= startedAt)) {
    endedAt = msgTs
  }

  if (endedAt == null && !opts.live) {
    for (let j = assistantIndex + 1; j < messages.length; j++) {
      const t = parseMessageTimestamp(messages[j])
      if (t != null) {
        endedAt = t
        break
      }
    }
  }

  // Live turn still running: duration uses wall clock "now"
  if (opts.live && startedAt != null && endedAt == null) {
    endedAt = opts.now
  }

  return {
    model:
      durable.model ||
      assistantMetadataModel(msg) ||
      fromUser.model ||
      client?.model ||
      opts.fallbackModel,
    thinking: durable.thinking || fromUser.thinking || client?.thinking || opts.fallbackThinking,
    startedAt,
    endedAt,
  }
}
