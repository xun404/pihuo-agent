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
 * - History: startedAt from message createdAt; endedAt ≈ next message createdAt
 * - Client map: wall-clock + model/thinking captured at turn start
 *   (local user bubbles strip wire [context], so client seal is primary for first chats)
 */
export function resolveLeaderRunMeta(
  messages: Array<{
    id: string
    role: string
    parts?: Array<{ type?: string; text?: string }>
  }>,
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
  const msgTs = parseMessageTimestamp(msg)

  const startedAt = client?.startedAt ?? msgTs ?? undefined
  let endedAt = client?.endedAt

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
    model: fromUser.model || client?.model || opts.fallbackModel,
    thinking: fromUser.thinking || client?.thinking || opts.fallbackThinking,
    startedAt,
    endedAt,
  }
}
