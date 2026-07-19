import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as schedulerModule from './scheduler.js'

describe('capacityRetryDelay', () => {
  it('retries capacity exhaustion with a bounded positive delay', () => {
    const fn = (schedulerModule as Record<string, unknown>).capacityRetryDelay
    assert.equal(typeof fn, 'function')
    assert.equal(
      (fn as (error: string | undefined, raw?: string) => number | null)(
        'capacity_exhausted',
        '25',
      ),
      25,
    )
    assert.equal(
      (fn as (error: string | undefined, raw?: string) => number | null)(
        'capacity_exhausted',
        '25.9',
      ),
      25,
    )
    assert.equal(
      (fn as (error: string | undefined, raw?: string) => number | null)(
        'capacity_exhausted',
        '-1',
      ),
      250,
    )
    assert.equal(
      (fn as (error: string | undefined, raw?: string) => number | null)(
        'capacity_exhausted',
        '999999999999',
      ),
      2_147_483_647,
    )
  })

  it('does not retry ordinary worker failures', () => {
    const fn = (schedulerModule as Record<string, unknown>).capacityRetryDelay
    assert.equal(typeof fn, 'function')
    assert.equal(
      (fn as (error: string | undefined, raw?: string) => number | null)('transport failed', '25'),
      null,
    )
  })
})
