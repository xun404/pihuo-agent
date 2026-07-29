import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isWorkerReasoningSelectionValid } from './WorkerReasoningSelect.js'

test('Agent default remains valid without discovery', () => {
  assert.equal(isWorkerReasoningSelectionValid('', null, true), true)
})

test('an explicit reasoning value is invalid while loading or unavailable', () => {
  assert.equal(isWorkerReasoningSelectionValid('high', null, true), false)
  assert.equal(
    isWorkerReasoningSelectionValid(
      'high',
      { ok: true, supported: true, cached: false, stale: false, selector: undefined },
      false,
    ),
    false,
  )
})

test('an explicit reasoning value is valid only when advertised by the current selector', () => {
  const result = {
    ok: true,
    supported: true,
    cached: false,
    stale: false,
    selector: {
      configId: 'reasoning_effort',
      options: [{ value: 'high', name: 'High' }],
    },
  }
  assert.equal(isWorkerReasoningSelectionValid('high', result, false), true)
  assert.equal(isWorkerReasoningSelectionValid('low', result, false), false)
})
