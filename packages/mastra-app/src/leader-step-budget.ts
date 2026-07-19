import type { LeaderStepBudgetEvent } from '@swarmdesk-agent/shared'

export const LEADER_STEP_BUDGET_PART_TYPE = 'data-leader-step-budget'

export function detectLeaderStepBudgetExhaustion(input: {
  maxSteps: number
  steps: ReadonlyArray<unknown>
  finishReason: string
  runId: string
  occurredAt?: string
}): LeaderStepBudgetEvent | null {
  const { maxSteps, steps, finishReason, runId, occurredAt } = input
  if (steps.length >= maxSteps && finishReason === 'tool-calls') {
    return {
      type: LEADER_STEP_BUDGET_PART_TYPE,
      data: {
        reason: 'max_steps',
        maxSteps,
        usedSteps: steps.length,
        runId,
        occurredAt: occurredAt ?? new Date().toISOString(),
      },
    }
  }
  return null
}

export function appendLeaderStepBudgetPart<T extends Record<string, unknown>>(
  message: T,
  event: LeaderStepBudgetEvent,
): T {
  const parts = (message.parts ?? []) as unknown[]
  const alreadyExists = parts.some(
    (p: unknown) =>
      (p as Record<string, unknown>)?.type === LEADER_STEP_BUDGET_PART_TYPE &&
      ((p as Record<string, unknown>)?.data as Record<string, unknown>)?.runId === event.data.runId,
  )
  if (alreadyExists) return message
  return {
    ...message,
    parts: [...parts, { ...event, data: { ...event.data } }],
  }
}

export function getPartsFromMessage(message: Record<string, unknown>): unknown[] {
  return (message.parts ?? (message.content as Record<string, unknown>)?.parts ?? []) as unknown[]
}

export function messageHasBudgetPart(message: Record<string, unknown>, runId: string): boolean {
  const parts = getPartsFromMessage(message)
  return parts.some(
    (p: unknown) =>
      (p as Record<string, unknown>)?.type === LEADER_STEP_BUDGET_PART_TYPE &&
      ((p as Record<string, unknown>)?.data as Record<string, unknown>)?.runId === runId,
  )
}

export function appendBudgetPartToMastraMessage<T extends Record<string, unknown>>(
  message: T,
  event: LeaderStepBudgetEvent,
): T | null {
  if (messageHasBudgetPart(message, event.data.runId)) return null
  const content = (message.content ?? {}) as Record<string, unknown>
  const parts = (content.parts ?? []) as unknown[]
  return {
    ...message,
    content: {
      ...content,
      parts: [...parts, { ...event, data: { ...event.data } }],
    },
  }
}

export function createBudgetMarkerMessage(input: {
  threadId: string
  resourceId: string
  event: LeaderStepBudgetEvent
  createdAt?: Date
}): Record<string, unknown> {
  const event = {
    ...input.event,
    data: { ...input.event.data },
  }
  return {
    id: `leader-budget:${event.data.runId}`,
    role: 'assistant',
    createdAt: input.createdAt ?? new Date(),
    threadId: input.threadId,
    resourceId: input.resourceId,
    content: {
      format: 2,
      parts: [event],
    },
  }
}
