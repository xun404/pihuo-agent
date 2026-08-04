import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { api } from './api.js'

describe('approval API request contract', () => {
  it('omits optionId from a cancel request even when a stale option is supplied', async () => {
    const originalFetch = globalThis.fetch
    let capturedInit: RequestInit | undefined
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedInit = init
      return new Response(JSON.stringify({ approval: {}, snapshot: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch

    try {
      await api.resolveApproval('approval-cancel', 'cancel', 'stale-option', 'panel')
    } finally {
      globalThis.fetch = originalFetch
    }

    assert.ok(capturedInit)
    const body = JSON.parse(String(capturedInit!.body)) as Record<string, unknown>
    assert.equal(body.decision, 'cancel')
    assert.equal(body.surface, 'panel')
    assert.equal(Object.prototype.hasOwnProperty.call(body, 'optionId'), false)
  })
})
