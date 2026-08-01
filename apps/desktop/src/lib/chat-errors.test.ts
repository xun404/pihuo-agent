import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { formatChatError, serializeChatErrorForSticky } from './chat-errors'

const copy = {
  missingKey: 'missing-key',
  billing: 'billing-failed',
  network: 'network-failed',
  offline: 'offline',
  model: 'model-failed',
  generic: 'generic-failed',
}

describe('formatChatError', () => {
  it('maps OpenCode insufficient balance to billing and keeps original detail', () => {
    const msg =
      'Insufficient balance. Manage your billing here: https://opencode.ai/workspace/wrk_x/billing'
    const friendly = formatChatError(msg, copy, { log: false })
    assert.equal(friendly.kind, 'billing')
    assert.equal(friendly.message, 'billing-failed')
    assert.equal(friendly.detail, msg)
    assert.equal(friendly.href, 'https://opencode.ai/workspace/wrk_x/billing')
    assert.equal(friendly.action, 'open_settings')
  })

  it('maps missing API key', () => {
    const friendly = formatChatError('Missing API key for provider', copy, { log: false })
    assert.equal(friendly.kind, 'missing_key')
    assert.equal(friendly.action, 'open_settings')
    assert.match(friendly.detail ?? '', /Missing API key/i)
  })

  it('surfaces China opt-in provider text as the primary message (not generic model copy)', () => {
    const msg =
      'The latest version of this model is only available hosted in China and requires explicit opt in: https://opencode.ai/workspace/wrk_x/go'
    const friendly = formatChatError(msg, copy, { log: false })
    assert.equal(friendly.kind, 'model')
    assert.equal(friendly.message, msg)
    assert.equal(friendly.action, 'open_settings')
    assert.equal(friendly.href, 'https://opencode.ai/workspace/wrk_x/go')
    // detail omitted when identical to message
    assert.equal(friendly.detail, undefined)
  })

  it('rehydrates sticky summary+detail payload', () => {
    const sticky = serializeChatErrorForSticky({
      kind: 'billing',
      message: 'billing-failed',
      detail: 'Insufficient balance at provider',
    })
    const friendly = formatChatError(sticky, copy, { log: false })
    assert.equal(friendly.kind, 'billing')
    assert.equal(friendly.message, 'billing-failed')
    assert.equal(friendly.detail, 'Insufficient balance at provider')
  })
})
