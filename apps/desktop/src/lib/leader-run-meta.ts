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

/**
 * Footer activity codes while the Leader turn is live.
 * Activity phrases (searching / delegating / composing …) map to i18n keys
 * under chat.activity.*. Unknown tools and empty parts fall back to thinking.
 */
export type LeaderActivityKey =
  | 'chat.activity.thinking'
  | 'chat.activity.composing'
  | 'chat.activity.command'
  | 'chat.activity.searching'
  | 'chat.activity.reading'
  | 'chat.activity.editing'
  | 'chat.activity.delegating'
  | 'chat.activity.updatingTodos'
  | 'chat.activity.listingWorkers'
  | 'chat.activity.listingTeam'
  | 'chat.activity.listingProjects'
  | 'chat.activity.managingTeam'
  | 'chat.activity.managingJobs'
  | 'chat.activity.managingTemplates'
  | 'chat.activity.readingContext'
  | 'chat.activity.web'
  | 'chat.activity.namingSession'

/** Normalize AI SDK / Mastra tool ids: tool-dispatch-team-member → dispatch-team-member */
export function normalizeLeaderToolName(typeOrName: string): string {
  return typeOrName
    .trim()
    .replace(/^tool-/i, '')
    .replace(/Tool$/i, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .toLowerCase()
}

/**
 * Map a concrete tool name to a footer activity.
 * Order matters: more specific router tools before broad CLI patterns.
 */
export function mapToolNameToLeaderActivity(toolName: string): LeaderActivityKey {
  const n = normalizeLeaderToolName(toolName)
  if (!n) return 'chat.activity.thinking'

  // —— Router session tools (exact / specific) ——
  if (n.includes('dispatch') && (n.includes('team') || n.includes('member') || n.includes('worker')))
    return 'chat.activity.delegating'
  if (n.includes('dispatch')) return 'chat.activity.delegating'

  if (n.includes('list') && n.includes('worker')) return 'chat.activity.listingWorkers'
  if (n.includes('list') && n.includes('team') && n.includes('template'))
    return 'chat.activity.managingTemplates'
  if (n.includes('list') && n.includes('team')) return 'chat.activity.listingTeam'
  if (n.includes('list') && n.includes('project')) return 'chat.activity.listingProjects'
  if (n.includes('list') && n.includes('job')) return 'chat.activity.managingJobs'

  if (
    (n.includes('add') || n.includes('update') || n.includes('archive') || n.includes('reset')) &&
    n.includes('team') &&
    n.includes('member')
  )
    return 'chat.activity.managingTeam'
  if (
    (n.includes('save') || n.includes('delete') || n.includes('apply')) &&
    n.includes('template')
  )
    return 'chat.activity.managingTemplates'

  if (n.includes('get') && n.includes('job')) return 'chat.activity.managingJobs'
  if (n.includes('cancel') && n.includes('job')) return 'chat.activity.managingJobs'
  if (n.includes('context')) return 'chat.activity.readingContext'
  if (n.includes('session') && n.includes('title')) return 'chat.activity.namingSession'

  // —— Mastra task list signals (TaskSignalProvider) ——
  if (
    n.includes('task-write') ||
    n.includes('task-update') ||
    n.includes('task-complete') ||
    n.includes('task-check') ||
    n.includes('task_write') ||
    n.includes('task_update') ||
    n.includes('task_complete') ||
    n.includes('todowrite') ||
    n.includes('todoread') ||
    n.includes('todo-write') ||
    n.includes('todo-read')
  )
    return 'chat.activity.updatingTodos'

  // —— Generic ACP / CLI tools ——
  if (
    n.includes('bash') ||
    n.includes('shell') ||
    n.includes('terminal') ||
    n.includes('exec') ||
    n.includes('command')
  )
    return 'chat.activity.command'
  if (
    n.includes('grep') ||
    n.includes('glob') ||
    n.includes('search') ||
    n.includes('find') ||
    n.includes('codesearch')
  )
    return 'chat.activity.searching'
  if (
    n.includes('webfetch') ||
    n.includes('websearch') ||
    n.includes('web-fetch') ||
    n.includes('web-search') ||
    (n.includes('fetch') && n.includes('url')) ||
    n.includes('http') ||
    n.includes('curl')
  )
    return 'chat.activity.web'
  if (
    n.includes('write') ||
    n.includes('edit') ||
    n.includes('patch') ||
    n.includes('multiedit') ||
    n.includes('str-replace') ||
    n.includes('str_replace') ||
    n.includes('apply-patch')
  )
    return 'chat.activity.editing'
  if (
    n.includes('read') ||
    n.includes('view') ||
    n.includes('cat') ||
    n.includes('list') ||
    n.includes('ls')
  )
    return 'chat.activity.reading'
  if (n.includes('task') || n.includes('agent')) return 'chat.activity.delegating'

  // Unknown tool — still show thinking rather than a raw tool id
  return 'chat.activity.thinking'
}

function isToolPartDone(part: Record<string, unknown>): boolean {
  return (
    part.state === 'result' ||
    part.state === 'output-available' ||
    part.state === 'output-error' ||
    part.output != null ||
    Boolean(part.errorText)
  )
}

/**
 * Current Leader footer activity while the turn is live.
 * Scan newest → oldest; active tool / reasoning / streaming text win;
 * empty or unknown states fall back to thinking.
 */
export function resolveLeaderActivity(parts: Array<Record<string, unknown>>): LeaderActivityKey {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index]
    if (!part) continue
    const type = typeof part.type === 'string' ? part.type : ''

    if (type === 'reasoning') {
      if (part.state === 'streaming') return 'chat.activity.thinking'
      continue
    }

    if (type.startsWith('tool-') || type === 'dynamic-tool') {
      if (isToolPartDone(part)) continue
      const toolName =
        (typeof part.toolName === 'string' && part.toolName) || type.replace(/^tool-/i, '')
      return mapToolNameToLeaderActivity(toolName)
    }

    if (type === 'text') {
      // Composing reply body.
      const text = typeof part.text === 'string' ? part.text : ''
      if (part.state === 'streaming' || (text.trim() && part.state !== 'done')) {
        return 'chat.activity.composing'
      }
    }
  }
  return 'chat.activity.thinking'
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

/**
 * Format a run start time with the **system local timezone** (no CST / fixed-zone label).
 * Example: 2026/08/01 09:20:06
 *
 * Optional `timeZone` overrides the zone (IANA). Labels like "CST" are intentionally omitted.
 */
export function formatClockTime(
  ts: number,
  locale: string,
  opts?: { timeZone?: string },
): string {
  try {
    const loc = locale === 'zh' || locale.startsWith('zh') ? 'zh-CN' : 'en-US'
    return new Date(ts).toLocaleString(loc, {
      ...(opts?.timeZone ? { timeZone: opts.timeZone } : {}),
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
  } catch {
    return new Date(ts).toISOString().replace('T', ' ').slice(0, 19)
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
