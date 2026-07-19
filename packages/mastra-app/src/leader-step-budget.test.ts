import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  detectLeaderStepBudgetExhaustion,
  appendLeaderStepBudgetPart,
  LEADER_STEP_BUDGET_PART_TYPE,
} from './leader-step-budget.js'
import * as budgetModule from './leader-step-budget.js'
import type { LeaderStepBudgetEvent } from '@router-agents/shared'

function makeEvent(overrides?: Partial<LeaderStepBudgetEvent['data']>): LeaderStepBudgetEvent {
  return {
    type: LEADER_STEP_BUDGET_PART_TYPE,
    data: {
      reason: 'max_steps',
      maxSteps: 20,
      usedSteps: 20,
      runId: 'run-1',
      occurredAt: '2025-01-15T00:00:00.000Z',
      ...overrides,
    },
  }
}

describe('detectLeaderStepBudgetExhaustion', () => {
  it('returns event when steps.length === maxSteps and finishReason is "tool-calls"', () => {
    const event = detectLeaderStepBudgetExhaustion({
      maxSteps: 20,
      steps: new Array(20).fill({}),
      finishReason: 'tool-calls',
      runId: 'run-1',
      occurredAt: '2025-01-15T00:00:00.000Z',
    })
    assert.ok(event)
    assert.equal(event!.type, LEADER_STEP_BUDGET_PART_TYPE)
    assert.equal(event!.data.reason, 'max_steps')
    assert.equal(event!.data.maxSteps, 20)
    assert.equal(event!.data.usedSteps, 20)
    assert.equal(event!.data.runId, 'run-1')
  })

  it('returns event when steps.length > maxSteps and finishReason is "tool-calls"', () => {
    const event = detectLeaderStepBudgetExhaustion({
      maxSteps: 20,
      steps: new Array(25).fill({}),
      finishReason: 'tool-calls',
      runId: 'run-2',
    })
    assert.ok(event)
    assert.equal(event!.data.usedSteps, 25)
  })

  it('returns null when steps.length < maxSteps and finishReason is "tool-calls"', () => {
    const event = detectLeaderStepBudgetExhaustion({
      maxSteps: 20,
      steps: new Array(10).fill({}),
      finishReason: 'tool-calls',
      runId: 'run-3',
    })
    assert.equal(event, null)
  })

  it('returns null when steps.length >= maxSteps but finishReason is "stop"', () => {
    const event = detectLeaderStepBudgetExhaustion({
      maxSteps: 20,
      steps: new Array(20).fill({}),
      finishReason: 'stop',
      runId: 'run-4',
    })
    assert.equal(event, null)
  })

  it('returns null when steps.length >= maxSteps but finishReason is "error"', () => {
    const event = detectLeaderStepBudgetExhaustion({
      maxSteps: 20,
      steps: new Array(30).fill({}),
      finishReason: 'error',
      runId: 'run-5',
    })
    assert.equal(event, null)
  })

  it('returns null when steps.length >= maxSteps but finishReason is "length"', () => {
    const event = detectLeaderStepBudgetExhaustion({
      maxSteps: 20,
      steps: new Array(20).fill({}),
      finishReason: 'length',
      runId: 'run-length',
    })
    assert.equal(event, null)
  })

  it('returns null when steps.length === 0 with any reason', () => {
    const event = detectLeaderStepBudgetExhaustion({
      maxSteps: 20,
      steps: [],
      finishReason: 'tool-calls',
      runId: 'run-6',
    })
    assert.equal(event, null)
  })

  it('returns null when steps array is empty and finishReason is "stop"', () => {
    const event = detectLeaderStepBudgetExhaustion({
      maxSteps: 20,
      steps: [],
      finishReason: 'stop',
      runId: 'run-7',
    })
    assert.equal(event, null)
  })

  it('preserves custom occurredAt if provided', () => {
    const event = detectLeaderStepBudgetExhaustion({
      maxSteps: 20,
      steps: new Array(20).fill({}),
      finishReason: 'tool-calls',
      runId: 'run-custom',
      occurredAt: '2025-07-01T12:00:00.000Z',
    })
    assert.equal(event!.data.occurredAt, '2025-07-01T12:00:00.000Z')
  })

  it('generates occurredAt if not provided', () => {
    const before = new Date().toISOString()
    const event = detectLeaderStepBudgetExhaustion({
      maxSteps: 20,
      steps: new Array(20).fill({}),
      finishReason: 'tool-calls',
      runId: 'run-auto',
    })
    const after = new Date().toISOString()
    assert.ok(event!.data.occurredAt >= before)
    assert.ok(event!.data.occurredAt <= after)
  })
})

describe('appendLeaderStepBudgetPart', () => {
  it('adds budget part to message with no parts', () => {
    const event = makeEvent()
    const message: Record<string, unknown> = { role: 'assistant', id: 'msg-1' }
    const updated = appendLeaderStepBudgetPart(message, event)

    assert.ok(Array.isArray(updated.parts))
    assert.equal((updated.parts as unknown[]).length, 1)
    assert.equal(
      ((updated.parts as unknown[])[0] as Record<string, unknown>).type,
      LEADER_STEP_BUDGET_PART_TYPE,
    )
  })

  it('appends budget part to message with existing parts, preserving originals', () => {
    const event = makeEvent()
    const existingPart = { type: 'text' as const, text: 'hello' }
    const message: Record<string, unknown> = {
      role: 'assistant',
      id: 'msg-2',
      parts: [existingPart],
    }
    const updated = appendLeaderStepBudgetPart(message, event)

    const parts = updated.parts as unknown[]
    assert.equal(parts.length, 2)
    assert.equal(parts[0], existingPart)
    assert.equal((parts[1] as Record<string, unknown>).type, LEADER_STEP_BUDGET_PART_TYPE)
  })

  it('returns same object reference when same runId already exists (idempotency)', () => {
    const event = makeEvent()
    const message: Record<string, unknown> = { role: 'assistant', id: 'msg-3', parts: [] }
    const first = appendLeaderStepBudgetPart(message, event)
    const second = appendLeaderStepBudgetPart(first, event)

    assert.strictEqual(first, second)
  })

  it('returns original reference when message already has budget part with same runId', () => {
    const event = makeEvent({ runId: 'run-dup' })
    const message: Record<string, unknown> = {
      role: 'assistant',
      id: 'msg-4',
      parts: [{ type: LEADER_STEP_BUDGET_PART_TYPE, data: { runId: 'run-dup' } }],
    }
    const updated = appendLeaderStepBudgetPart(message, event)
    assert.strictEqual(updated, message)
  })

  it('adds budget part when message has a different budget runId', () => {
    const event = makeEvent({ runId: 'run-new' })
    const message: Record<string, unknown> = {
      role: 'assistant',
      id: 'msg-5',
      parts: [{ type: LEADER_STEP_BUDGET_PART_TYPE, data: { runId: 'run-old' } }],
    }
    const updated = appendLeaderStepBudgetPart(message, event)

    assert.notStrictEqual(updated, message)
    assert.equal((updated.parts as unknown[]).length, 2)
  })

  it('treats undefined/null parts as empty array', () => {
    const event = makeEvent()
    const message: Record<string, unknown> = { role: 'assistant', id: 'msg-6' }
    const updated = appendLeaderStepBudgetPart(message, event)

    assert.equal((updated.parts as unknown[]).length, 1)
  })

  it('deep clones the event (modifying input after append does not affect stored part)', () => {
    const event = makeEvent({ maxSteps: 100 })
    const message: Record<string, unknown> = { role: 'assistant', id: 'msg-7', parts: [] }
    const updated = appendLeaderStepBudgetPart(message, event)

    event.data.maxSteps = 999
    event.data.reason = 'max_steps'
    event.data.runId = 'changed'

    const storedPart = (updated.parts as unknown[])[0] as Record<string, unknown>
    assert.equal((storedPart.data as Record<string, number>).maxSteps, 100)
    assert.equal((storedPart.data as Record<string, string>).runId, 'run-1')
  })

  it('preserves other message fields unchanged', () => {
    const event = makeEvent()
    const message: Record<string, unknown> = {
      role: 'assistant',
      id: 'msg-8',
      createdAt: new Date('2025-01-01'),
      threadId: 't1',
    }
    const updated = appendLeaderStepBudgetPart(message, event)

    assert.equal(updated.id, 'msg-8')
    assert.equal(updated.role, 'assistant')
    assert.equal(updated.threadId, 't1')
  })
})

describe('durable budget marker message', () => {
  it('creates a run-bound standalone message instead of mutating the last assistant response', () => {
    const createMarker = (budgetModule as Record<string, unknown>).createBudgetMarkerMessage
    assert.equal(typeof createMarker, 'function')
    const event = makeEvent({ runId: 'run-concurrent' })
    const createdAt = new Date('2026-07-14T00:00:00.000Z')
    const message = (
      createMarker as (input: {
        threadId: string
        resourceId: string
        event: LeaderStepBudgetEvent
        createdAt: Date
      }) => Record<string, unknown>
    )({
      threadId: 'thread-1',
      resourceId: 'resource-1',
      event,
      createdAt,
    })

    assert.equal(message.id, 'leader-budget:run-concurrent')
    assert.equal(message.threadId, 'thread-1')
    assert.equal(message.resourceId, 'resource-1')
    assert.equal(message.role, 'assistant')
    assert.equal(message.createdAt, createdAt)
    const content = message.content as { format: number; parts: unknown[] }
    assert.equal(content.format, 2)
    assert.deepEqual(content.parts, [event])
  })
})
