import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildSuccessfulReasoningCatalogEntry,
  markReasoningCatalogEntryFailed,
  publicReasoningDiscoveryError,
} from './worker-reasoning.js'

test('successful reasoning discovery records the last-known-good timestamp', () => {
  const fetchedAt = '2026-07-29T01:02:03.000Z'
  const entry = buildSuccessfulReasoningCatalogEntry(
    'model-a',
    {
      supported: true,
      selector: {
        configId: 'reasoning_effort',
        options: [{ value: 'high', name: 'High' }],
      },
    },
    fetchedAt,
  )

  assert.equal(entry.fetchedAt, fetchedAt)
  assert.equal(entry.lastSuccessfulFetchedAt, fetchedAt)
  assert.equal(entry.lastErrorCode, undefined)
})

test('failed refresh preserves last-known-good data and records the failure code', () => {
  const cached = buildSuccessfulReasoningCatalogEntry(
    undefined,
    { supported: false },
    '2026-07-29T01:02:03.000Z',
  )
  const failed = markReasoningCatalogEntryFailed(cached, 'ACP_REASONING_CONFIGURATION_FAILED')

  assert.deepEqual(failed.selector, cached.selector)
  assert.equal(failed.supported, cached.supported)
  assert.equal(failed.fetchedAt, cached.fetchedAt)
  assert.equal(failed.lastSuccessfulFetchedAt, cached.lastSuccessfulFetchedAt)
  assert.equal(failed.lastErrorCode, 'ACP_REASONING_CONFIGURATION_FAILED')
})

test('reasoning discovery failures never expose the Agent error', () => {
  const error = publicReasoningDiscoveryError(
    new Error('spawn /private/workspace with OPENAI_API_KEY=secret failed'),
  )
  assert.equal(error, 'Failed to discover ACP reasoning options.')
  assert.doesNotMatch(error, /private|secret|OPENAI_API_KEY/)
})
