import type { LeaderStepBudgetEvent } from '@swarmdesk-agent/shared'
import { LEADER_STEP_BUDGET_PART_TYPE } from '@swarmdesk-agent/shared'

export function extractBudgetEvents(
  messages: Array<{ role: string; parts?: unknown[]; metadata?: unknown }>,
): {
  event: LeaderStepBudgetEvent
  messageIndex: number
}[] {
  const results: { event: LeaderStepBudgetEvent; messageIndex: number }[] = []
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (!msg.parts) continue
    for (const part of msg.parts as { type: string; data?: unknown }[]) {
      if (part.type === LEADER_STEP_BUDGET_PART_TYPE && part.data) {
        results.push({
          event: {
            type: LEADER_STEP_BUDGET_PART_TYPE,
            data: part.data as LeaderStepBudgetEvent['data'],
          },
          messageIndex: i,
        })
      }
    }
  }
  return results
}

export function findLatestActionableBudget(
  messages: Array<{ role: string; parts?: unknown[]; metadata?: unknown }>,
): LeaderStepBudgetEvent | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role === 'user') return null

    // Check real-time metadata first (available immediately, before history reload)
    const meta = msg.metadata as Record<string, unknown> | undefined
    if (meta?.leaderStepBudget) {
      const data = meta.leaderStepBudget as LeaderStepBudgetEvent['data']
      return {
        type: LEADER_STEP_BUDGET_PART_TYPE,
        data,
      }
    }

    // Fall back to persisted data part (available on history reload)
    if (msg.parts) {
      for (const part of msg.parts as { type: string; data?: unknown }[]) {
        if (part.type === LEADER_STEP_BUDGET_PART_TYPE && part.data) {
          return {
            type: LEADER_STEP_BUDGET_PART_TYPE,
            data: part.data as LeaderStepBudgetEvent['data'],
          }
        }
      }
    }
  }
  return null
}

export function buildContinuePrompt(locale: string = 'zh'): string {
  if (locale === 'en' || locale.startsWith('en')) {
    return 'Continue the unfinished task from the previous turn. Process the latest tool result first, and do not repeat completed steps.'
  }
  return '继续完成上一轮未完成的任务。请先处理最后一个工具结果，不要重复已完成步骤。'
}
