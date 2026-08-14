import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resolveWorkerPeriodicInterval } from './workers-health.js'

describe('worker periodic interval boundary', () => {
  it('falls back for missing, non-finite, zero, negative, and sub-minimum values', () => {
    for (const value of [undefined, '', 'nope', 'Infinity', 0, -1, 999]) {
      assert.equal(resolveWorkerPeriodicInterval(value, 300_000), 300_000)
    }
  })

  it('uses integer milliseconds and caps values at the Node timer maximum', () => {
    assert.equal(resolveWorkerPeriodicInterval('1234.9', 300_000), 1234)
    assert.equal(resolveWorkerPeriodicInterval('999999999999', 300_000), 2_147_483_647)
  })
})
