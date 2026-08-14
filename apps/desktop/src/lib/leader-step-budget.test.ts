import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  findLatestActionableBudget,
  extractBudgetEvents,
  buildContinuePrompt,
} from './leader-step-budget'
import { LEADER_STEP_BUDGET_PART_TYPE } from '@pihuo-agent/shared'
import type { LeaderStepBudgetEvent } from '@pihuo-agent/shared'

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
  it('extracts budget events and ignores empty or part-less messages', () => {
    const messages = [
      mkMsg('user', [{ type: 'text', data: null }]),
      mkMsg('assistant', [
        { type: 'text', data: null },
        {
          type: LEADER_STEP_BUDGET_PART_TYPE,
          data: {
            reason: 'max_steps',
            maxSteps: 10,
            usedSteps: 10,
            runId: 'r1',
            occurredAt: '2026-01-01',
          },
        },
      ]),
      mkMsg('assistant', [
        {
          type: LEADER_STEP_BUDGET_PART_TYPE,
          data: {
            reason: 'max_steps',
            maxSteps: 20,
            usedSteps: 20,
            runId: 'r2',
            occurredAt: '2026-01-02',
          },
        },
      ]),
    ]
    const events = extractBudgetEvents(messages)
    assert.equal(events.length, 2)
    assert.equal(events[0].event.data.runId, 'r1')
    assert.equal(events[0].messageIndex, 1)
    assert.equal(events[1].event.data.runId, 'r2')
    assert.equal(events[1].messageIndex, 2)

    assert.deepEqual(
      extractBudgetEvents([
        mkMsg('user', [{ type: 'text', data: null }]),
        mkMsg('assistant', [{ type: 'text', data: null }]),
      ]),
      [],
    )
    assert.deepEqual(extractBudgetEvents([]), [])

    const withMissingParts = extractBudgetEvents([
      { role: 'user' },
      mkMsg('assistant', mkBudgetParts()),
    ])
    assert.equal(withMissingParts.length, 1)
    assert.equal(withMissingParts[0].event.data.runId, 'run-1')
  })
})

describe('findLatestActionableBudget', () => {
  it('returns the latest unprocessed assistant budget, or null when blocked/missing', () => {
    const open = findLatestActionableBudget([
      mkMsg('user', [{ type: 'text', data: null }]),
      mkMsg('assistant', mkBudgetParts({ maxSteps: 15, usedSteps: 15 })),
    ])
    assert.ok(open)
    assert.equal(open.data.maxSteps, 15)
    assert.equal(open.data.reason, 'max_steps')

    assert.equal(
      findLatestActionableBudget([
        mkMsg('user', [{ type: 'text', data: null }]),
        mkMsg('assistant', mkBudgetParts()),
        mkMsg('user', [{ type: 'text', data: null }]),
      ]),
      null,
    )

    assert.equal(
      findLatestActionableBudget([
        mkMsg('assistant', mkBudgetParts({ runId: 'first', maxSteps: 10, usedSteps: 10 })),
        mkMsg('assistant', mkBudgetParts({ runId: 'second', maxSteps: 20, usedSteps: 20 })),
      ])?.data.runId,
      'second',
    )

    assert.equal(
      findLatestActionableBudget([
        mkMsg('assistant', mkBudgetParts({ runId: 'first', maxSteps: 10, usedSteps: 10 })),
        mkMsg('user', [{ type: 'text', data: null }]),
        mkMsg('assistant', mkBudgetParts({ runId: 'second', maxSteps: 20, usedSteps: 20 })),
      ])?.data.runId,
      'second',
    )

    assert.equal(
      findLatestActionableBudget([
        mkMsg('user', [{ type: 'text', data: null }]),
        mkMsg('assistant', [{ type: 'text', data: null }]),
      ]),
      null,
    )
    assert.equal(findLatestActionableBudget([]), null)
    assert.equal(
      findLatestActionableBudget([
        mkMsg('assistant', [{ type: 'text', data: null }]),
        mkMsg('user', [{ type: 'text', data: null }]),
      ]),
      null,
    )
    assert.equal(
      findLatestActionableBudget([
        mkMsg('assistant', [{ type: 'text', data: null }]),
        mkMsg('assistant', mkBudgetParts({ runId: 'last', maxSteps: 30, usedSteps: 30 })),
      ])?.data.runId,
      'last',
    )
    assert.equal(
      findLatestActionableBudget([
        mkMsg('user', mkBudgetParts({ runId: 'weird', maxSteps: 5, usedSteps: 5 })),
      ]),
      null,
    )
  })
})

describe('buildContinuePrompt', () => {
  it('localizes the continuation instruction', () => {
    assert.match(buildContinuePrompt('zh'), /继续完成/)
    assert.match(buildContinuePrompt('en'), /Continue the unfinished task/)
  })
})
