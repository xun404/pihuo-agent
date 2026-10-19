import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mapSessionEvent } from './leader-chat-stream.js'
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent'

function asSessionEvent(value: unknown): AgentSessionEvent {
  return value as AgentSessionEvent
}

function assistantErrorStop(errorMessage?: string) {
  return {
    id: 'msg-1',
    role: 'assistant',
    stopReason: 'error',
    ...(errorMessage !== undefined ? { errorMessage } : {}),
  }
}

describe('mapSessionEvent agent_end error surfacing', () => {
  it('emits an error event when retries are exhausted on a failed turn', () => {
    const events = mapSessionEvent(
      asSessionEvent({
        type: 'agent_end',
        messages: [assistantErrorStop('400: Model is unavailable.')],
        willRetry: false,
      }),
    )
    assert.equal(events.length, 2)
    assert.deepEqual(events[0], { type: 'agent_end' })
    assert.deepEqual(events[1], {
      type: 'error',
      message: '400: Model is unavailable.',
    })
  })

  it('holds the error back while another retry is scheduled', () => {
    const events = mapSessionEvent(
      asSessionEvent({
        type: 'agent_end',
        messages: [assistantErrorStop('429: Rate limit exceeded.')],
        willRetry: true,
      }),
    )
    assert.equal(events.length, 1)
    assert.deepEqual(events[0], { type: 'agent_end' })
  })

  it('emits no error event when the turn finished normally', () => {
    const events = mapSessionEvent(
      asSessionEvent({
        type: 'agent_end',
        messages: [{ id: 'msg-1', role: 'assistant', stopReason: 'stop' }],
        willRetry: false,
      }),
    )
    assert.equal(events.length, 1)
    assert.deepEqual(events[0], { type: 'agent_end' })
  })

  it('treats an aborted turn as non-error', () => {
    const events = mapSessionEvent(
      asSessionEvent({
        type: 'agent_end',
        messages: [{ id: 'msg-1', role: 'assistant', stopReason: 'aborted' }],
        willRetry: false,
      }),
    )
    assert.equal(events.length, 1)
    assert.deepEqual(events[0], { type: 'agent_end' })
  })

  it('falls back to a generic message when errorMessage is missing', () => {
    const events = mapSessionEvent(
      asSessionEvent({
        type: 'agent_end',
        messages: [{ id: 'msg-1', role: 'assistant', stopReason: 'error' }],
        willRetry: false,
      }),
    )
    assert.equal(events.length, 2)
    assert.equal((events[1] as { type: string }).type, 'error')
    assert.match((events[1] as { message: string }).message, /stopReason: error/)
  })

  it('inspects the last assistant entry of a multi-message run', () => {
    const events = mapSessionEvent(
      asSessionEvent({
        type: 'agent_end',
        messages: [
          { id: 'a', role: 'assistant', stopReason: 'stop' },
          { id: 't', role: 'toolResult', stopReason: 'stop' },
          assistantErrorStop('500: upstream exploded.'),
        ],
        willRetry: false,
      }),
    )
    assert.equal(events.length, 2)
    assert.equal((events[1] as { message?: string }).message, '500: upstream exploded.')
  })
})
