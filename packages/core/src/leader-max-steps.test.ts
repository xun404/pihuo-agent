import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_LEADER_MAX_STEPS,
  MIN_LEADER_MAX_STEPS,
  MAX_LEADER_MAX_STEPS,
  resolveLeaderMaxSteps,
  parseLeaderMaxStepsInput,
} from './leader-max-steps.js'

describe('leader-max-steps', () => {
  it('exposes the public bounds and default', () => {
    assert.equal(DEFAULT_LEADER_MAX_STEPS, 500)
    assert.equal(MIN_LEADER_MAX_STEPS, 10)
    assert.equal(MAX_LEADER_MAX_STEPS, 1000)
  })

  it('resolveLeaderMaxSteps accepts bounds and falls back otherwise', () => {
    for (const value of [10, 500, 1000]) {
      assert.equal(resolveLeaderMaxSteps(value), value)
    }
    for (const value of [undefined, null, 9, 1001, 10.5, NaN, Infinity, -Infinity, '500']) {
      assert.equal(resolveLeaderMaxSteps(value as never), 500)
    }
    assert.equal(resolveLeaderMaxSteps(9, 300), 300)
    assert.equal(resolveLeaderMaxSteps(1001, 300), 300)
    assert.equal(resolveLeaderMaxSteps(undefined, 300), 300)
    assert.equal(resolveLeaderMaxSteps(NaN, 300), 300)
    assert.equal(resolveLeaderMaxSteps(10, 300), 10)
  })

  it('parseLeaderMaxStepsInput accepts bounds and rejects invalid input', () => {
    for (const value of [10, 500, 1000]) {
      assert.equal(parseLeaderMaxStepsInput(value), value)
    }
    for (const value of [9, 1001, 10.5, NaN, Infinity, -Infinity, 'abc', undefined, null]) {
      assert.throws(() => parseLeaderMaxStepsInput(value as never), RangeError)
    }
    assert.throws(
      () => parseLeaderMaxStepsInput(9),
      (err: RangeError) => err.message.includes('10') && err.message.includes('1000'),
    )
    assert.throws(
      () => parseLeaderMaxStepsInput('abc'),
      (err: RangeError) => err.message.includes('10') && err.message.includes('1000'),
    )
  })
})
