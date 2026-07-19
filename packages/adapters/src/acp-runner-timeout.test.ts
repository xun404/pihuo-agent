import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resolveWorkerModelsTimeoutMs } from './acp-runner.js'

describe('worker model discovery timeout normalization', () => {
  it('falls back for missing, non-finite, zero, and negative values', () => {
    for (const raw of [undefined, '', 'NaN', 'Infinity', '0', '-1']) {
      assert.equal(resolveWorkerModelsTimeoutMs(raw), 90_000)
    }
  })

  it('uses integer milliseconds and applies a five-minute hard cap', () => {
    assert.equal(resolveWorkerModelsTimeoutMs('123.9'), 123)
    assert.equal(resolveWorkerModelsTimeoutMs('999999999'), 300_000)
  })
})
