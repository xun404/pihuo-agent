import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import {
  registerChatRun,
  getChatRun,
  attachChatRunSubscriber,
  _resetChatRunHubsForTest,
} from './chat-run-hub.js'

/** Minimal ServerResponse fake: records writes, emits 'close' like a socket. */
class FakeResponse extends EventEmitter {
  headers: Record<string, string> | null = null
  statusCode = 0
  writes: string[] = []
  ended = false
  destroyed = false

  writeHead(status: number, headers?: Record<string, string>) {
    this.statusCode = status
    this.headers = headers ?? null
    return this
  }
  write(chunk: string) {
    if (this.destroyed) throw new Error('write after destroy')
    this.writes.push(chunk)
    return true
  }
  end() {
    this.ended = true
    this.emit('close')
  }
  destroy() {
    this.destroyed = true
    this.emit('close')
  }
  body(): string {
    return this.writes.join('')
  }
}

function streamFrom(chunks: unknown[], opts?: { delayMs?: number }): ReadableStream<unknown> {
  const delay = opts?.delayMs ?? 0
  let i = 0
  return new ReadableStream({
    async pull(controller) {
      if (delay > 0) await new Promise((r) => setTimeout(r, delay))
      if (i < chunks.length) {
        controller.enqueue(chunks[i++])
      } else {
        controller.close()
      }
    },
  })
}

/** Stream that blocks until cancelled; records cancellation. */
function neverEndingStream(state: { cancelled: boolean }): ReadableStream<unknown> {
  return new ReadableStream({
    start() {
      // never enqueues
    },
    cancel() {
      state.cancelled = true
    },
  })
}

function failingStream(error: unknown, chunksBefore = 1): ReadableStream<unknown> {
  let i = 0
  return new ReadableStream({
    pull(controller) {
      if (i < chunksBefore) {
        controller.enqueue({ type: 'text-delta', id: 't', delta: `d${i++}` })
      } else {
        controller.error(error)
      }
    },
  })
}

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms))

describe('chat-run-hub', () => {
  it('drains the source stream without any subscriber and buffers SSE lines', async () => {
    _resetChatRunHubsForTest()
    const chunks = [
      { type: 'start', messageId: 'm1' },
      { type: 'text-delta', id: 'a', delta: 'hello' },
      { type: 'finish' },
    ]
    registerChatRun('t1', streamFrom(chunks), new AbortController(), { gracePeriodMs: 5_000 })
    await tick()
    const hub = getChatRun('t1')
    assert.ok(hub)
    assert.equal(hub!.done, true)
    const res = new FakeResponse()
    attachChatRunSubscriber(hub!, res as never)
    const body = res.body()
    assert.ok(body.includes('data: {"type":"start","messageId":"m1"}'))
    assert.ok(body.includes('"delta":"hello"'))
    assert.ok(body.endsWith('data: [DONE]\n\n'))
    assert.equal(res.ended, true)
  })

  it('replays buffered chunks to a late subscriber, then streams live chunks', async () => {
    _resetChatRunHubsForTest()
    const chunks = [
      { type: 'start', messageId: 'm1' },
      { type: 'text-delta', id: 'a', delta: 'one' },
      { type: 'text-delta', id: 'a', delta: 'two' },
      { type: 'finish' },
    ]
    // Slow source: attach after the first chunk(s) were already buffered.
    registerChatRun('t2', streamFrom(chunks, { delayMs: 5 }), new AbortController(), {
      gracePeriodMs: 5_000,
    })
    await tick(12)
    const hub = getChatRun('t2')!
    const res = new FakeResponse()
    attachChatRunSubscriber(hub, res as never)
    await tick(40)
    const body = res.body()
    // Whatever was buffered must appear exactly once and in order.
    assert.equal(body.match(/"delta":"one"/g)?.length, 1)
    assert.equal(body.match(/"delta":"two"/g)?.length, 1)
    assert.ok(body.indexOf('"delta":"one"') < body.indexOf('"delta":"two"'))
    assert.ok(body.endsWith('data: [DONE]\n\n'))
    assert.equal(res.ended, true)
    assert.equal(res.headers?.['content-type'], 'text/event-stream')
    assert.equal(res.headers?.['x-vercel-ai-ui-message-stream'], 'v1')
  })

  it('detaches a closed subscriber without cancelling the source stream', async () => {
    _resetChatRunHubsForTest()
    const state = { cancelled: false }
    const chunks = [{ type: 'text-delta', id: 'a', delta: 'x' }]
    registerChatRun('t3', streamFrom(chunks, { delayMs: 5 }), new AbortController(), {
      gracePeriodMs: 5_000,
    })
    const hub = getChatRun('t3')!
    const res = new FakeResponse()
    attachChatRunSubscriber(hub, res as never)
    res.destroy() // client went away mid-run
    await tick(40)
    assert.equal(state.cancelled, false)
    assert.equal(hub.done, true)
  })

  it('does not let a subscriber disconnect cancel the source controller', async () => {
    _resetChatRunHubsForTest()
    const controller = new AbortController()
    const state = { cancelled: false }
    registerChatRun('t4', neverEndingStream(state), controller, { gracePeriodMs: 5_000 })
    const hub = getChatRun('t4')!
    const res = new FakeResponse()
    attachChatRunSubscriber(hub, res as never)
    res.destroy()
    await tick(20)
    assert.equal(controller.signal.aborted, false)
    assert.equal(state.cancelled, false)
  })

  it('emits an SSE error chunk before [DONE] when the source stream fails', async () => {
    _resetChatRunHubsForTest()
    registerChatRun('t5', failingStream(new Error('boom')), new AbortController(), {
      gracePeriodMs: 5_000,
    })
    await tick()
    const hub = getChatRun('t5')!
    assert.equal(hub.done, true)
    const res = new FakeResponse()
    attachChatRunSubscriber(hub, res as never)
    const body = res.body()
    assert.ok(body.includes('"type":"error"'))
    assert.ok(body.includes('boom'))
    assert.ok(body.endsWith('data: [DONE]\n\n'))
  })

  it('evicts the hub after the grace period once done', async () => {
    _resetChatRunHubsForTest()
    registerChatRun('t6', streamFrom([{ type: 'finish' }]), new AbortController(), {
      gracePeriodMs: 60,
    })
    await tick()
    assert.ok(getChatRun('t6'))
    await tick(120)
    assert.equal(getChatRun('t6'), undefined)
  })

  it('rejects duplicate live clientRunId registration without aborting the previous run', async () => {
    _resetChatRunHubsForTest()
    const first = new AbortController()
    registerChatRun('t7', neverEndingStream({ cancelled: false }), first, {
      gracePeriodMs: 5_000,
    })
    assert.throws(
      () =>
        registerChatRun('t7', streamFrom([{ type: 'finish' }]), new AbortController(), {
          gracePeriodMs: 5_000,
        }),
      /CHAT_RUN_HUB_ALREADY_REGISTERED/,
    )
    assert.equal(first.signal.aborted, false)
  })
})
