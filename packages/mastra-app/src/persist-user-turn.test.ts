import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildUserTurnDbMessages,
  persistUserTurnUpFront,
  type UserTurnMemoryStore,
} from './persist-user-turn.js'

const NOW = new Date('2026-07-28T08:00:00.000Z')

describe('buildUserTurnDbMessages', () => {
  it('maps user UIMessages to MastraDBMessage-shaped rows, preserving id and parts', () => {
    const rows = buildUserTurnDbMessages({
      messages: [
        { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hello' }] },
        { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'skip me' }] },
        { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'second' }] },
      ],
      threadId: 'thread-1',
      resourceId: 'proj-1',
      now: NOW,
    })
    assert.equal(rows.length, 2)
    assert.deepEqual(rows[0], {
      id: 'u1',
      role: 'user',
      createdAt: NOW,
      threadId: 'thread-1',
      resourceId: 'proj-1',
      content: { format: 2, parts: [{ type: 'text', text: 'hello' }] },
    })
    assert.equal(rows[1]!.id, 'u2')
  })

  it('skips malformed entries and non-array input', () => {
    assert.deepEqual(
      buildUserTurnDbMessages({ messages: 'nope', threadId: 't', resourceId: 'r' }),
      [],
    )
    assert.deepEqual(
      buildUserTurnDbMessages({
        messages: [null, 42, { role: 'user' }, { id: 7, role: 'user' }, { id: '', role: 'user' }],
        threadId: 't',
        resourceId: 'r',
      }),
      [],
    )
  })

  it('defaults parts to an empty array when missing or not an array', () => {
    const rows = buildUserTurnDbMessages({
      messages: [{ id: 'u1', role: 'user' }],
      threadId: 't',
      resourceId: 'r',
    })
    assert.deepEqual((rows[0]!.content as { parts: unknown[] }).parts, [])
  })
})

describe('persistUserTurnUpFront', () => {
  function fakeMemory(opts: { hasThread: boolean }) {
    const calls: string[] = []
    const store: UserTurnMemoryStore & { calls: string[] } = {
      calls,
      async getThreadById() {
        calls.push('getThreadById')
        return opts.hasThread ? { id: 'thread-1' } : null
      },
      async createThread() {
        calls.push('createThread')
        return { id: 'thread-1' }
      },
      async saveMessages(input) {
        calls.push(`saveMessages:${input.messages.length}`)
        return input.messages
      },
    }
    return store
  }

  it('creates the thread when missing, then saves the user messages', async () => {
    const memory = fakeMemory({ hasThread: false })
    const saved = await persistUserTurnUpFront(memory, {
      messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
      threadId: 'thread-1',
      resourceId: 'proj-1',
    })
    assert.equal(saved, 1)
    assert.deepEqual(memory.calls, ['getThreadById', 'createThread', 'saveMessages:1'])
  })

  it('skips thread creation when the thread already exists', async () => {
    const memory = fakeMemory({ hasThread: true })
    await persistUserTurnUpFront(memory, {
      messages: [{ id: 'u1', role: 'user', parts: [] }],
      threadId: 'thread-1',
      resourceId: 'proj-1',
    })
    assert.deepEqual(memory.calls, ['getThreadById', 'saveMessages:1'])
  })

  it('does nothing when there is no user message', async () => {
    const memory = fakeMemory({ hasThread: false })
    const saved = await persistUserTurnUpFront(memory, {
      messages: [{ id: 'a1', role: 'assistant', parts: [] }],
      threadId: 'thread-1',
      resourceId: 'proj-1',
    })
    assert.equal(saved, 0)
    assert.deepEqual(memory.calls, [])
  })
})
