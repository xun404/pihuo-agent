import { isFollowUpRequestMeta, type FollowUpRequestMeta } from './chat-run.js'
import type { WorkerRunEvent } from './worker-events.js'

export const LEADER_WORK_MODES = ['coordinate', 'coding'] as const
export type LeaderWorkMode = (typeof LEADER_WORK_MODES)[number]

export const DEFAULT_LEADER_WORK_MODE: LeaderWorkMode = 'coordinate'

export const LEADER_THINKING_INTENSITIES = [
  'off',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const
export type LeaderThinkingIntensity = (typeof LEADER_THINKING_INTENSITIES)[number]

export const LEADER_CHAT_ROLES = ['user', 'assistant', 'toolResult', 'custom'] as const
export type LeaderChatRole = (typeof LEADER_CHAT_ROLES)[number]

export const LEADER_CUSTOM_KINDS = [
  'worker-run',
  'leader-run-meta',
  'task-list',
  'compaction',
  'project-memory',
] as const
export type LeaderCustomKind = (typeof LEADER_CUSTOM_KINDS)[number]

export const LEADER_TASK_STATUSES = ['pending', 'in_progress', 'completed'] as const
export type LeaderTaskStatus = (typeof LEADER_TASK_STATUSES)[number]

export type LeaderTaskItem = {
  id: string
  content: string
  status: LeaderTaskStatus
  activeForm?: string
}

export type LeaderTextBlock = { type: 'text'; text: string }
export type LeaderThinkingBlock = { type: 'thinking'; thinking: string }
export type LeaderImageBlock = { type: 'image'; data: string; mimeType: string }
export type LeaderToolCallBlock = {
  type: 'toolCall'
  id: string
  name: string
  arguments: Record<string, unknown>
}

export type LeaderContentBlock =
  | LeaderTextBlock
  | LeaderThinkingBlock
  | LeaderImageBlock
  | LeaderToolCallBlock

export type LeaderRunMeta = {
  runId: string
  model: string
  thinking?: LeaderThinkingIntensity
  startedAt: string
  completedAt: string
}

export type LeaderChatCustom = {
  kind: LeaderCustomKind
  data: unknown
}

export type LeaderChatMessage = {
  id: string
  role: LeaderChatRole
  timestamp: number
  content?: string | LeaderContentBlock[]
  custom?: LeaderChatCustom
}

export type LeaderChatStartBody = {
  text: string
  followUp: FollowUpRequestMeta
  model: string
  thinking?: LeaderThinkingIntensity
  workMode?: LeaderWorkMode
}

export type LeaderChatEvent =
  | { type: 'run_status'; status: import('./chat-run.js').ChatRunStatus }
  | { type: 'snapshot'; messages: LeaderChatMessage[] }
  | { type: 'agent_start' }
  | { type: 'agent_end'; error?: string }
  | { type: 'turn_start' }
  | { type: 'turn_end' }
  | { type: 'message_start'; message: LeaderChatMessage }
  | { type: 'message_update'; message: LeaderChatMessage }
  | { type: 'message_end'; message: LeaderChatMessage }
  | { type: 'tool_start'; toolCallId: string; name: string; args: unknown }
  | { type: 'tool_update'; toolCallId: string; partial: unknown }
  | { type: 'tool_end'; toolCallId: string; isError: boolean; result: unknown }
  | { type: 'worker_run'; event: WorkerRunEvent }
  | { type: 'task_list'; tasks: LeaderTaskItem[] }
  | { type: 'compaction_start' }
  | { type: 'compaction_end'; summary?: string }
  | { type: 'queue_update'; steering: number; followUp: number }
  | { type: 'error'; message: string; code?: string }
  | {
      type: 'usage'
      inputTokens: number
      outputTokens: number
      cachedInputTokens?: number
    }

export const LEADER_CHAT_EVENT_TYPES = [
  'run_status',
  'snapshot',
  'agent_start',
  'agent_end',
  'turn_start',
  'turn_end',
  'message_start',
  'message_update',
  'message_end',
  'tool_start',
  'tool_update',
  'tool_end',
  'worker_run',
  'task_list',
  'compaction_start',
  'compaction_end',
  'queue_update',
  'error',
  'usage',
] as const

export function isLeaderWorkMode(value: unknown): value is LeaderWorkMode {
  return typeof value === 'string' && (LEADER_WORK_MODES as readonly string[]).includes(value)
}

export function normalizeLeaderWorkMode(value: unknown): LeaderWorkMode {
  return isLeaderWorkMode(value) ? value : DEFAULT_LEADER_WORK_MODE
}

export function isLeaderThinkingIntensity(value: unknown): value is LeaderThinkingIntensity {
  return (
    typeof value === 'string' && (LEADER_THINKING_INTENSITIES as readonly string[]).includes(value)
  )
}

export function isLeaderChatRole(value: unknown): value is LeaderChatRole {
  return typeof value === 'string' && (LEADER_CHAT_ROLES as readonly string[]).includes(value)
}

export function isLeaderCustomKind(value: unknown): value is LeaderCustomKind {
  return typeof value === 'string' && (LEADER_CUSTOM_KINDS as readonly string[]).includes(value)
}

export function isLeaderTaskItem(value: unknown): value is LeaderTaskItem {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.id === 'string' &&
    record.id.length > 0 &&
    typeof record.content === 'string' &&
    typeof record.status === 'string' &&
    (LEADER_TASK_STATUSES as readonly string[]).includes(record.status)
  )
}

export function isLeaderChatMessage(value: unknown): value is LeaderChatMessage {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  if (typeof record.id !== 'string' || record.id.length === 0) return false
  if (!isLeaderChatRole(record.role)) return false
  if (typeof record.timestamp !== 'number' || !Number.isFinite(record.timestamp)) return false
  if (record.content !== undefined) {
    const okContent =
      typeof record.content === 'string' ||
      (Array.isArray(record.content) && record.content.every(isLeaderContentBlock))
    if (!okContent) return false
  }
  if (record.custom !== undefined) {
    if (!record.custom || typeof record.custom !== 'object') return false
    const custom = record.custom as Record<string, unknown>
    if (!isLeaderCustomKind(custom.kind)) return false
  }
  return true
}

export function isLeaderContentBlock(value: unknown): value is LeaderContentBlock {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  if (record.type === 'text') return typeof record.text === 'string'
  if (record.type === 'thinking') return typeof record.thinking === 'string'
  if (record.type === 'image') {
    return typeof record.data === 'string' && typeof record.mimeType === 'string'
  }
  if (record.type === 'toolCall') {
    return (
      typeof record.id === 'string' &&
      typeof record.name === 'string' &&
      !!record.arguments &&
      typeof record.arguments === 'object'
    )
  }
  return false
}

export function isLeaderChatEvent(value: unknown): value is LeaderChatEvent {
  if (!value || typeof value !== 'object') return false
  const type = (value as { type?: unknown }).type
  return typeof type === 'string' && (LEADER_CHAT_EVENT_TYPES as readonly string[]).includes(type)
}

export function parseLeaderChatStartBody(
  value: unknown,
): { ok: true; body: LeaderChatStartBody } | { ok: false; error: string; code: string } {
  if (!value || typeof value !== 'object') {
    return { ok: false, error: 'chat body is required', code: 'LEADER_CHAT_BODY_REQUIRED' }
  }
  const record = value as Record<string, unknown>
  if (typeof record.text !== 'string' || record.text.trim().length === 0) {
    return { ok: false, error: 'text is required', code: 'LEADER_CHAT_TEXT_REQUIRED' }
  }
  if (!isFollowUpRequestMeta(record.followUp)) {
    return {
      ok: false,
      error: 'followUp delivery metadata is required',
      code: 'CHAT_FOLLOW_UP_METADATA_REQUIRED',
    }
  }
  if (typeof record.model !== 'string' || !record.model.includes('/')) {
    return { ok: false, error: 'model must be provider/model', code: 'LEADER_CHAT_MODEL_INVALID' }
  }
  if (record.thinking !== undefined && !isLeaderThinkingIntensity(record.thinking)) {
    return { ok: false, error: 'thinking is invalid', code: 'LEADER_CHAT_THINKING_INVALID' }
  }
  if (record.workMode !== undefined && !isLeaderWorkMode(record.workMode)) {
    return { ok: false, error: 'workMode is invalid', code: 'LEADER_CHAT_WORK_MODE_INVALID' }
  }
  return {
    ok: true,
    body: {
      text: record.text,
      followUp: record.followUp,
      model: record.model.trim(),
      ...(record.thinking ? { thinking: record.thinking } : {}),
      ...(record.workMode ? { workMode: record.workMode } : {}),
    },
  }
}

export function userTextFromLeaderMessage(message: LeaderChatMessage): string {
  if (typeof message.content === 'string') return message.content
  if (!Array.isArray(message.content)) return ''
  return message.content
    .filter((block): block is LeaderTextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
}
