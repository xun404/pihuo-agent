import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  findLatestActionableBudget,
  extractBudgetEvents,
  buildContinuePrompt,
} from './leader-step-budget'
import { LEADER_STEP_BUDGET_PART_TYPE } from '@router-agents/shared'
import type { LeaderStepBudgetEvent } from '@router-agents/shared'

type MsgParts = { type: string; data?: unknown }[]

function mkMsg(role: string, parts: MsgParts) {
  return { role, parts }
}

function mkBudgetParts(overrides: Partial<LeaderStepBudgetEvent['data']> = {}): MsgParts {
  return [
    {
      type: LEADER_STEP_BUDGET_PART_TYPE,
      data: {
        reason: 'max_steps' as const,
        maxSteps: 20,
        usedSteps: 20,
        runId: 'run-1',
        occurredAt: '2026-07-14T00:00:00Z',
        ...overrides,
      },
    },
  ]
}

describe('extractBudgetEvents', () => {
  it('extracts budget events from mixed messages', () => {
    const messages = [
      mkMsg('user', [{ type: 'text', data: null }]),
      mkMsg('assistant', [
        { type: 'text', data: null },
        { type: LEADER_STEP_BUDGET_PART_TYPE, data: { reason: 'max_steps', maxSteps: 10, usedSteps: 10, runId: 'r1', occurredAt: '2026-01-01' } },
      ]),
      mkMsg('assistant', [
        { type: LEADER_STEP_BUDGET_PART_TYPE, data: { reason: 'max_steps', maxSteps: 20, usedSteps: 20, runId: 'r2', occurredAt: '2026-01-02' } },
      ]),
    ]
    const events = extractBudgetEvents(messages)
    assert.equal(events.length, 2)
    assert.equal(events[0].event.data.runId, 'r1')
    assert.equal(events[0].messageIndex, 1)
    assert.equal(events[1].event.data.runId, 'r2')
    assert.equal(events[1].messageIndex, 2)
  })

  it('returns empty array for messages without budget parts', () => {
    const messages = [
      mkMsg('user', [{ type: 'text', data: null }]),
      mkMsg('assistant', [{ type: 'text', data: null }]),
    ]
    assert.deepEqual(extractBudgetEvents(messages), [])
  })

  it('returns empty array for empty messages', () => {
    assert.deepEqual(extractBudgetEvents([]), [])
  })

  it('skips messages without parts', () => {
    const messages = [
      { role: 'user' },
      mkMsg('assistant', mkBudgetParts()),
    ]
    const events = extractBudgetEvents(messages)
    assert.equal(events.length, 1)
    assert.equal(events[0].event.data.runId, 'run-1')
  })
})

describe('findLatestActionableBudget', () => {
  it('messages end with assistant + budget part: returns event', () => {
    const messages = [
      mkMsg('user', [{ type: 'text', data: null }]),
      mkMsg('assistant', mkBudgetParts({ maxSteps: 15, usedSteps: 15 })),
    ]
    const result = findLatestActionableBudget(messages)
    assert.ok(result)
    assert.equal(result.data.maxSteps, 15)
    assert.equal(result.data.reason, 'max_steps')
  })

  it('messages end with user message after assistant+budget: returns null', () => {
    const messages = [
      mkMsg('user', [{ type: 'text', data: null }]),
      mkMsg('assistant', mkBudgetParts()),
      mkMsg('user', [{ type: 'text', data: null }]),
    ]
    assert.equal(findLatestActionableBudget(messages), null)
  })

  it('two budget markers, no user after either: returns latest', () => {
    const messages = [
      mkMsg('assistant', mkBudgetParts({ runId: 'first', maxSteps: 10, usedSteps: 10 })),
      mkMsg('assistant', mkBudgetParts({ runId: 'second', maxSteps: 20, usedSteps: 20 })),
    ]
    const result = findLatestActionableBudget(messages)
    assert.ok(result)
    assert.equal(result.data.runId, 'second')
  })

  it('two budget markers, user after first: returns second (latest unprocessed)', () => {
    const messages = [
      mkMsg('assistant', mkBudgetParts({ runId: 'first', maxSteps: 10, usedSteps: 10 })),
      mkMsg('user', [{ type: 'text', data: null }]),
      mkMsg('assistant', mkBudgetParts({ runId: 'second', maxSteps: 20, usedSteps: 20 })),
    ]
    const result = findLatestActionableBudget(messages)
    assert.ok(result)
    assert.equal(result.data.runId, 'second')
  })

  it('no budget parts: returns null', () => {
    const messages = [
      mkMsg('user', [{ type: 'text', data: null }]),
      mkMsg('assistant', [{ type: 'text', data: null }]),
    ]
    assert.equal(findLatestActionableBudget(messages), null)
  })

  it('empty messages: returns null', () => {
    assert.equal(findLatestActionableBudget([]), null)
  })

  it('assistant without budget part + user: returns null', () => {
    const messages = [
      mkMsg('assistant', [{ type: 'text', data: null }]),
      mkMsg('user', [{ type: 'text', data: null }]),
    ]
    assert.equal(findLatestActionableBudget(messages), null)
  })

  it('multiple assistants, only last has budget: returns that one', () => {
    const messages = [
      mkMsg('assistant', [{ type: 'text', data: null }]),
      mkMsg('assistant', mkBudgetParts({ runId: 'last', maxSteps: 30, usedSteps: 30 })),
    ]
    const result = findLatestActionableBudget(messages)
    assert.ok(result)
    assert.equal(result.data.runId, 'last')
  })

  it('budget event in non-assistant message: user blocks, returns null', () => {
    const messages = [
      mkMsg('user', mkBudgetParts({ runId: 'weird', maxSteps: 5, usedSteps: 5 })),
    ]
    assert.equal(findLatestActionableBudget(messages), null)
  })
})

describe('buildContinuePrompt', () => {
  it('returns a Chinese continuation instruction for zh', () => {
    assert.match(buildContinuePrompt('zh'), /继续完成/)
  })

  it('returns an English continuation instruction for en', () => {
    assert.match(buildContinuePrompt('en'), /Continue the unfinished task/)
  })
})
