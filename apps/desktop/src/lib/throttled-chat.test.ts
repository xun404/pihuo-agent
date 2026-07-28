import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { UIMessage, UIMessageChunk } from 'ai'
import { ThrottledChat } from './throttled-chat'

const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms))

/**
 * Fake ChatTransport streaming a fast burst of chunks (the pathological case
 * that used to drive React's "Maximum update depth exceeded": one store
 * mutation per chunk, faster than any render cycle).
 */
function burstTransport(deltaCount: number) {
  return {
    sendMessages: () =>
      Promise.resolve(
        new ReadableStream<UIMessageChunk>({
          start(controller) {
            controller.enqueue({ type: 'start', messageId: 'asst-1' })
            controller.enqueue({ type: 'start-step' })
            controller.enqueue({ type: 'text-start', id: 't1' })
            for (let i = 0; i < deltaCount; i++) {
              controller.enqueue({ type: 'text-delta', id: 't1', delta: `d${i} ` })
            }
            controller.enqueue({ type: 'text-end', id: 't1' })
            controller.enqueue({ type: 'finish-step' })
            controller.enqueue({ type: 'finish' })
            controller.close()
          },
        }),
      ),
    reconnectToStream: () => Promise.resolve(null),
  } as any
}

async function waitForReady(chat: ThrottledChat, timeoutMs = 3000) {
  const start = Date.now()
  while (chat.status !== 'ready' && chat.status !== 'error') {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out in status ${chat.status}`)
    await tick(5)
  }
  if (chat.status === 'error') throw chat.error
}

describe('ThrottledChat', () => {
  it('publishes snapshot swaps at most once per window during a chunk burst', async () => {
    const WINDOW = 80
    const chat = new ThrottledChat(
      { id: 'thread-1', transport: burstTransport(120) },
      { windowMs: WINDOW },
    )
    const publishedRefs: UIMessage[][] = []
    let notifications = 0
    const unsubscribe = chat['~registerMessagesCallback'](() => {
      notifications++
      const snap = chat.messages
      if (publishedRefs[publishedRefs.length - 1] !== snap) publishedRefs.push(snap)
    }, undefined)

    await chat.sendMessage({ text: 'hello' })
    await waitForReady(chat)
    // Give the trailing publish a chance to fire.
    await tick(WINDOW * 2)
    unsubscribe()

    // 120 chunks arrive within a few ms; an unthrottled state would notify
    // 100+ times. Throttled publishes must stay tiny.
    assert.ok(notifications <= 4, `expected ≤4 notifications for a burst, got ${notifications}`)
    // The final published snapshot must contain the complete streamed text.
    const last = chat.messages[chat.messages.length - 1]
    assert.equal(last?.role, 'assistant')
    const text = last!.parts
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p) => p.text)
      .join('')
    assert.equal(text, Array.from({ length: 120 }, (_, i) => `d${i} `).join(''))
    // Every published reference must be a distinct array (stable between publishes).
    assert.equal(new Set(publishedRefs).size, publishedRefs.length)
  })

  it('setMessages (messages setter) is visible synchronously', async () => {
    const chat = new ThrottledChat(
      { id: 'thread-2', transport: burstTransport(0) },
      { windowMs: 80 },
    )
    const before = chat.messages
    chat.messages = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'persisted' }] } as UIMessage,
    ]
    assert.notEqual(chat.messages, before)
    assert.equal(chat.messages.length, 1)
    assert.equal(chat.messages[0]!.id, 'u1')
  })

  it('does not notify after React unsubscribes', async () => {
    const chat = new ThrottledChat(
      { id: 'thread-3', transport: burstTransport(50) },
      { windowMs: 40 },
    )
    let notifications = 0
    const unsubscribe = chat['~registerMessagesCallback'](() => notifications++, undefined)
    unsubscribe()
    await chat.sendMessage({ text: 'hi' })
    await waitForReady(chat)
    await tick(100)
    assert.equal(notifications, 0)
  })

  // Regression for the live-observed crash: a leading-edge publish notified
  // React synchronously from inside replaceMessage; under heavy renders every
  // such notify landed mid-render (forceStoreRerender nested-update ++) until
  // React threw "Maximum update depth exceeded". The notify MUST be deferred
  // to a macrotask — never fired synchronously from the store mutation.
  it('never notifies React synchronously from a store mutation', async () => {
    const chat = new ThrottledChat(
      { id: 'thread-4', transport: burstTransport(0) },
      { windowMs: 20 },
    )
    let notifications = 0
    chat['~registerMessagesCallback'](() => notifications++, undefined)
    // White-box: drive the inner state the same way streaming chunks do.
    const state = (chat as unknown as { state: { pushMessage: (m: UIMessage) => void } }).state
    state.pushMessage({ id: 'u1', role: 'user', parts: [] } as UIMessage)
    state.pushMessage({ id: 'a1', role: 'assistant', parts: [] } as UIMessage)
    assert.equal(notifications, 0, 'notify must be deferred, not synchronous')
    await tick(30)
    assert.equal(notifications, 1)
    assert.equal(chat.messages.length, 2)
  })
})
