import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isChatRunAbortIntent,
  isChatRunIdentifier,
  isFollowUpRequestMeta,
  isFollowUpSource,
} from './chat-run.js'

const deliveryId = '11111111-1111-4111-8111-111111111111'
const clientRunId = '22222222-2222-4222-8222-222222222222'

describe('chat run shared contract validation', () => {
  it('accepts only bounded delivery metadata and known sources', () => {
    assert.equal(
      isFollowUpRequestMeta({
        deliveryId,
        clientRunId,
        source: 'queue',
      }),
      true,
    )
    assert.equal(isFollowUpRequestMeta({ deliveryId: 'short', clientRunId }), false)
    assert.equal(
      isFollowUpRequestMeta({
        deliveryId: 'delivery with spaces',
        clientRunId,
        source: 'queue',
      }),
      false,
    )
    assert.equal(
      isFollowUpRequestMeta({
        deliveryId,
        clientRunId,
        source: 'replace-other-run',
      }),
      false,
    )
    assert.equal(isChatRunIdentifier(deliveryId), true)
    assert.equal(isChatRunIdentifier('delivery-00000001'), false)
  })

  it('accepts only stop / steer abort intents and the declared sources', () => {
    assert.equal(isChatRunAbortIntent('stop'), true)
    assert.equal(isChatRunAbortIntent('steer'), true)
    assert.equal(isChatRunAbortIntent('abort-everything'), false)
    assert.equal(isFollowUpSource('direct'), true)
    assert.equal(isFollowUpSource('budget_continue'), true)
    assert.equal(isFollowUpSource('unknown'), false)
  })
})
