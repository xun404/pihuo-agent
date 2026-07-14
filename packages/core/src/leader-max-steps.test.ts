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
  describe('DEFAULT_LEADER_MAX_STEPS', () => {
    it('is 500', () => {
      assert.equal(DEFAULT_LEADER_MAX_STEPS, 500)
    })
  })

  describe('MIN_LEADER_MAX_STEPS', () => {
    it('is 10', () => {
      assert.equal(MIN_LEADER_MAX_STEPS, 10)
    })
  })

  describe('MAX_LEADER_MAX_STEPS', () => {
    it('is 1000', () => {
      assert.equal(MAX_LEADER_MAX_STEPS, 1000)
    })
  })

  describe('resolveLeaderMaxSteps', () => {
    it('returns default 500 for undefined', () => {
      assert.equal(resolveLeaderMaxSteps(undefined), 500)
    })

    it('returns default 500 for null', () => {
      assert.equal(resolveLeaderMaxSteps(null), 500)
    })

    it('returns the value for valid input 10', () => {
      assert.equal(resolveLeaderMaxSteps(10), 10)
    })

    it('returns the value for valid input 500', () => {
      assert.equal(resolveLeaderMaxSteps(500), 500)
    })

    it('returns the value for valid input 1000', () => {
      assert.equal(resolveLeaderMaxSteps(1000), 1000)
    })

    it('returns fallback for value below min (9)', () => {
      assert.equal(resolveLeaderMaxSteps(9), 500)
    })

    it('returns fallback for value above max (1001)', () => {
      assert.equal(resolveLeaderMaxSteps(1001), 500)
    })

    it('returns fallback for non-integer (10.5)', () => {
      assert.equal(resolveLeaderMaxSteps(10.5), 500)
    })

    it('returns fallback for NaN', () => {
      assert.equal(resolveLeaderMaxSteps(NaN), 500)
    })

    it('returns fallback for Infinity', () => {
      assert.equal(resolveLeaderMaxSteps(Infinity), 500)
      assert.equal(resolveLeaderMaxSteps(-Infinity), 500)
    })

    it('returns fallback for string', () => {
      assert.equal(resolveLeaderMaxSteps('500'), 500)
    })

    it('uses custom fallback when provided', () => {
      assert.equal(resolveLeaderMaxSteps(9, 300), 300)
      assert.equal(resolveLeaderMaxSteps(1001, 300), 300)
      assert.equal(resolveLeaderMaxSteps(undefined, 300), 300)
      assert.equal(resolveLeaderMaxSteps(NaN, 300), 300)
      assert.equal(resolveLeaderMaxSteps(10, 300), 10)
    })
  })

  describe('parseLeaderMaxStepsInput', () => {
    it('accepts 10 (minimum)', () => {
      assert.equal(parseLeaderMaxStepsInput(10), 10)
    })

    it('accepts 500', () => {
      assert.equal(parseLeaderMaxStepsInput(500), 500)
    })

    it('accepts 1000 (maximum)', () => {
      assert.equal(parseLeaderMaxStepsInput(1000), 1000)
    })

    it('throws RangeError for 9 (below min)', () => {
      assert.throws(() => parseLeaderMaxStepsInput(9), RangeError)
    })

    it('throws RangeError for 1001 (above max)', () => {
      assert.throws(() => parseLeaderMaxStepsInput(1001), RangeError)
    })

    it('throws RangeError for non-integer 10.5', () => {
      assert.throws(() => parseLeaderMaxStepsInput(10.5), RangeError)
    })

    it('throws RangeError for NaN', () => {
      assert.throws(() => parseLeaderMaxStepsInput(NaN), RangeError)
    })

    it('throws RangeError for Infinity', () => {
      assert.throws(() => parseLeaderMaxStepsInput(Infinity), RangeError)
    })

    it('throws RangeError for -Infinity', () => {
      assert.throws(() => parseLeaderMaxStepsInput(-Infinity), RangeError)
    })

    it('throws RangeError for string "abc"', () => {
      assert.throws(() => parseLeaderMaxStepsInput('abc'), RangeError)
    })

    it('throws RangeError for undefined', () => {
      assert.throws(() => parseLeaderMaxStepsInput(undefined), RangeError)
    })

    it('throws RangeError for null', () => {
      assert.throws(() => parseLeaderMaxStepsInput(null), RangeError)
    })

    it('error message includes the valid range', () => {
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
})
