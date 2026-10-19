import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createLeaderEventStream } from './leader-chat-stream.js'
import { piMessageToLeader } from './pi-messages.js'
import type { AgentSession } from '@earendil-works/pi-coding-agent'

function makeFakeSession(overrides: Partial<Record<string, unknown>> = {}) {
  const sent: Array<{ customType: string; details?: unknown }> = []
  const session = {
    messages: [],
    subscribe: () => () => undefined,
    agent: { state: {} },
    prompt: async () => undefined,
    steer: async () => undefined,
    abort: async () => undefined,
    sendCustomMessage: async (message: { customType: string; details?: unknown }) => {
      sent.push(message)
    },
    ...overrides,
  }
  return { session: session as unknown as AgentSession, sent }
}

async function drain(stream: ReadableStream<unknown>): Promise<unknown[]> {
  const reader = stream.getReader()
  const events: unknown[] = []
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    events.push(value)
  }
  return events
}

describe('createLeaderEventStream run-meta persistence', () => {
  it('appends a leader-run-meta custom message when the turn finishes', async () => {
    const { session, sent } = makeFakeSession()
    const events = await drain(
      createLeaderEventStream({
        session,
        text: 'hi',
        mode: 'prompt',
        abortSignal: new AbortController().signal,
        modelId: 'opencode/big-pickle',
        thinking: 'high',
      }),
    )
    assert.equal(sent.length, 1)
    assert.equal(sent[0]!.customType, 'leader-run-meta')
    const details = sent[0]!.details as { startedAt: number; completedAt: number; model?: string }
    assert.equal(details.model, 'opencode/big-pickle')
    assert.equal(typeof details.startedAt, 'number')
    assert.ok(details.completedAt >= details.startedAt)
  })

  it('emits meta even when the turn fails, and never throws into the stream', async () => {
    const { session, sent } = makeFakeSession({
      prompt: async () => {
        throw new Error('boom')
      },
    })
    const events = await drain(
      createLeaderEventStream({
        session,
        text: 'hi',
        mode: 'prompt',
        abortSignal: new AbortController().signal,
        modelId: 'm',
      }),
    )
    assert.equal(sent.length, 1)
    assert.equal((events.at(-1) as { type: string }).type, 'error')
  })
})

describe('piMessageToLeader custom hydration', () => {
  it('maps hydrated customType entries to leader custom messages', () => {
    const hydrated = {
      role: 'custom',
      customType: 'leader-run-meta',
      details: { startedAt: 123, completedAt: 456, model: 'm' },
      timestamp: 1787809976339,
    }
    const msg = piMessageToLeader(hydrated, 'fallback')
    assert.ok(msg)
    assert.equal(msg!.custom?.kind, 'leader-run-meta')
    assert.deepEqual(msg!.custom?.data, hydrated.details)
  })

  it('still maps live-event kind payloads', () => {
    const live = { role: 'custom', kind: 'task-list', data: { tasks: [] }, timestamp: 1 }
    const msg = piMessageToLeader(live, 'fallback')
    assert.equal(msg!.custom?.kind, 'task-list')
  })
})
