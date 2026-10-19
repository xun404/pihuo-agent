import assert from 'node:assert/strict'
import { it } from 'node:test'
import { LeaderChatStore } from './leader-chat-store.js'

it('publishes a new React snapshot for each chat update and keeps idle reads stable', () => {
  const store = new LeaderChatStore('snapshot-fixture')
  const initial = store.getSnapshot()
  assert.equal(store.getSnapshot(), initial)
  let notified = 0
  const unsubscribe = store.subscribe(() => {
    notified += 1
  })
  store.status = 'streaming'
  store.apply({
    type: 'message_update',
    message: {
      id: 'assistant-1',
      role: 'assistant',
      timestamp: 1,
      content: [{ type: 'thinking', thinking: 'Inspect the project.' }],
    },
  })
  const thinking = store.getSnapshot()
  assert.notEqual(thinking, initial)
  assert.equal(store.getSnapshot(), thinking)
  assert.equal(initial.messages.length, 0)
  assert.equal(thinking.viewMessages[0]?.parts[0]?.type, 'reasoning')
  assert.deepEqual(thinking.viewMessages[0]?.parts[0], {
    type: 'reasoning',
    text: 'Inspect the project.',
    state: 'streaming',
  })
  store.apply({
    type: 'message_update',
    message: { id: 'assistant-1', role: 'assistant', timestamp: 1, content: 'Complete.' },
  })
  const complete = store.getSnapshot()
  assert.notEqual(complete, thinking)
  assert.deepEqual(complete.viewMessages[0]?.parts, [{ type: 'text', text: 'Complete.' }])
  assert.equal(notified, 2)
  unsubscribe()
  store.apply({ type: 'error', message: 'Fixture provider error' })
  assert.equal(store.getSnapshot().status, 'error')
  assert.equal(notified, 2)
})
