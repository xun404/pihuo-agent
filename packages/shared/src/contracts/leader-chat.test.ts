import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  isLeaderChatEvent,
  isLeaderChatMessage,
  isLeaderWorkMode,
  normalizeLeaderWorkMode,
  parseLeaderChatStartBody,
  userTextFromLeaderMessage,
} from './leader-chat.js'

const followUp = {
  deliveryId: '11111111-1111-4111-8111-111111111111',
  clientRunId: '22222222-2222-4222-8222-222222222222',
  source: 'direct' as const,
}

describe('leader-chat contract', () => {
  it('accepts coordinate and coding work modes', () => {
    assert.equal(isLeaderWorkMode('coordinate'), true)
    assert.equal(isLeaderWorkMode('coding'), true)
    assert.equal(isLeaderWorkMode('mastra'), false)
    assert.equal(normalizeLeaderWorkMode(undefined), 'coordinate')
  })

  it('parses a start body without AI SDK messages', () => {
    const parsed = parseLeaderChatStartBody({
      text: 'hello',
      followUp,
      model: 'openai/gpt-5',
      thinking: 'low',
      workMode: 'coordinate',
    })
    assert.equal(parsed.ok, true)
    if (parsed.ok) {
      assert.equal(parsed.body.text, 'hello')
      assert.equal(parsed.body.model, 'openai/gpt-5')
    }
  })

  it('rejects a start body that still looks like an AI SDK payload', () => {
    const parsed = parseLeaderChatStartBody({
      messages: [{ id: followUp.deliveryId, role: 'user', parts: [] }],
      followUp,
    })
    assert.equal(parsed.ok, false)
    if (!parsed.ok) assert.equal(parsed.code, 'LEADER_CHAT_TEXT_REQUIRED')
  })

  it('validates snapshot messages and events', () => {
    const message = {
      id: followUp.deliveryId,
      role: 'user' as const,
      timestamp: 1,
      content: [{ type: 'text' as const, text: 'hello' }],
    }
    assert.equal(isLeaderChatMessage(message), true)
    assert.equal(userTextFromLeaderMessage(message), 'hello')
    assert.equal(isLeaderChatEvent({ type: 'snapshot', messages: [message] }), true)
    assert.equal(isLeaderChatEvent({ type: 'text-delta' }), false)
  })
})
