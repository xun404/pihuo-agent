import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildSuccessfulReasoningCatalogEntry,
  evaluateWorkerReasoningSelection,
  markReasoningCatalogEntryFailed,
  publicReasoningDiscoveryError,
  putReasoningCatalogEntry,
  reasoningEntryFromCatalog,
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

test('missing reasoning catalog returns a soft unsupported error without raw worker id noise', () => {
  const result = evaluateWorkerReasoningSelection(
    'worker_missing_reasoning_xyz',
    'opencode-go/deepseek-v4-flash',
    'low',
    { scopeKey: 'scope-test' },
  )
  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'ACP_REASONING_UNSUPPORTED')
  assert.match(result.error ?? '', /not loaded|options/i)
  assert.doesNotMatch(result.error ?? '', /worker_missing_reasoning_xyz/)
})

test('putReasoningCatalogEntry is readable under a different project scope via global fallback', () => {
  const workerId = `worker_reasoning_${Date.now()}`
  const model = 'opencode-go/deepseek-v4-flash'
  const entry = buildSuccessfulReasoningCatalogEntry(
    model,
    {
      supported: true,
      selector: {
        configId: 'reasoning_effort',
        options: [
          { value: 'low', name: 'Low' },
          { value: 'high', name: 'High' },
        ],
      },
    },
    new Date(Date.now() + 60_000).toISOString(),
  )
  // Fix fetched/expiry so isEntryFresh-style windows are irrelevant for evaluate.
  const lasting = {
    ...entry,
    fetchedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    lastSuccessfulFetchedAt: new Date().toISOString(),
  }

  putReasoningCatalogEntry(workerId, model, lasting, undefined)

  assert.ok(reasoningEntryFromCatalog(workerId, model, 'project-scope-digest'))
  assert.equal(
    evaluateWorkerReasoningSelection(workerId, model, 'low', { scopeKey: 'project-scope-digest' })
      .ok,
    true,
  )
  assert.equal(
    evaluateWorkerReasoningSelection(workerId, model, 'medium', {
      scopeKey: 'project-scope-digest',
    }).ok,
    false,
  )
})
