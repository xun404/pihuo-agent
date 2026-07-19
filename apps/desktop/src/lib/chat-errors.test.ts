import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { formatChatError } from './chat-errors'

const copy = {
  missingKey: 'missing-key',
  billing: 'billing-failed',
  network: 'network-failed',
  offline: 'offline',
  model: 'model-failed',
  generic: 'generic-failed',
}

describe('formatChatError', () => {
  it('maps OpenCode insufficient balance to billing', () => {
    const msg =
      'Insufficient balance. Manage your billing here: https://opencode.ai/workspace/wrk_x/billing'
    const friendly = formatChatError(msg, copy, { log: false })
    assert.equal(friendly.kind, 'billing')
    assert.equal(friendly.message, 'billing-failed')
    assert.equal(friendly.href, 'https://opencode.ai/workspace/wrk_x/billing')
    assert.equal(friendly.action, 'open_settings')
  })

  it('maps missing API key', () => {
    const friendly = formatChatError('Missing API key for provider', copy, { log: false })
    assert.equal(friendly.kind, 'missing_key')
    assert.equal(friendly.action, 'open_settings')
  })
})
