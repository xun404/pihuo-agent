import type { LeaderViewPart } from './leader-chat-view'

export type ImActivitySummary = {
  thoughtLive: boolean
  thoughtDone: boolean
  toolCount: number
  firstToolName?: string
  dispatchNames: string[]
}

type ActivityT = (key: string, vars?: Record<string, string | number>) => string

function isDispatchTool(name: string): boolean {
  return /dispatch/i.test(name)
}

function toolNameOf(part: LeaderViewPart): string {
  const record = part as { toolName?: unknown; type: string }
  if (typeof record.toolName === 'string' && record.toolName.trim()) return record.toolName
  return part.type.replace(/^tool-/, '') || 'tool'
}

function stringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = (value as Record<string, unknown>)[key]
  return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined
}

export function dispatchNameFromPart(part: LeaderViewPart): string | undefined {
  const record = part as { input?: unknown; output?: unknown }
  return (
    stringField(record.input, 'teamMemberName') ||
    stringField(record.input, 'memberName') ||
    stringField(record.output, 'teamMemberName') ||
    stringField(record.output, 'workerName')
  )
}

export function summarizeLeaderActivity(
  parts: readonly LeaderViewPart[],
  indexes: readonly number[],
): ImActivitySummary {
  const summary: ImActivitySummary = {
    thoughtLive: false,
    thoughtDone: false,
    toolCount: 0,
    dispatchNames: [],
  }
  for (const index of indexes) {
    const part = parts[index]
    if (!part) continue
    if (part.type === 'reasoning') {
      const record = part as { text?: string; state?: string }
      const live = record.state === 'streaming'
      const hasText = Boolean(record.text?.trim())
      if (live) summary.thoughtLive = true
      else if (hasText || record.state === 'done') summary.thoughtDone = true
      continue
    }
    if (!part.type.startsWith('tool-')) continue
    const name = toolNameOf(part)
    if (isDispatchTool(name)) {
      const dispatched = dispatchNameFromPart(part)
      if (dispatched && !summary.dispatchNames.includes(dispatched)) {
        summary.dispatchNames.push(dispatched)
      } else {
        summary.toolCount += 1
        summary.firstToolName ??= name
      }
      continue
    }
    summary.toolCount += 1
    summary.firstToolName ??= name
  }
  return summary
}

export function hasImActivity(summary: ImActivitySummary): boolean {
  return (
    summary.thoughtLive ||
    summary.thoughtDone ||
    summary.toolCount > 0 ||
    summary.dispatchNames.length > 0
  )
}

export function formatImActivityLabel(summary: ImActivitySummary, t: ActivityT): string {
  const bits: string[] = []
  if (summary.thoughtLive) bits.push(t('chat.activityThoughtLive'))
  else if (summary.thoughtDone) bits.push(t('chat.activityThought'))
  if (summary.toolCount === 1 && summary.firstToolName && summary.dispatchNames.length === 0) {
    bits.push(t('chat.activityTool', { name: summary.firstToolName }))
  } else if (summary.toolCount > 0) {
    bits.push(t('chat.activityTools', { count: summary.toolCount }))
  }
  for (const name of summary.dispatchNames) {
    bits.push(t('chat.activityDispatched', { name }))
  }
  return bits.join(' · ')
}

export function thinkMetaKey(messageId: string, partIndex: number): string {
  return `think:${messageId}:${partIndex}`
}

export function toolMetaKey(
  part: LeaderViewPart,
  messageId: string,
  partIndex: number,
): string {
  const id = (part as { toolCallId?: unknown }).toolCallId
  return `tool:${typeof id === 'string' && id ? id : `${messageId}:${partIndex}`}`
}
