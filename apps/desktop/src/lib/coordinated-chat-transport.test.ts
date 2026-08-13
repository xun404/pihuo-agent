import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ChatTransport, UIMessageChunk } from 'ai'
import { CoordinatedChatTransport } from './coordinated-chat-transport.js'

const meta = { deliveryId: 'delivery-00000001', clientRunId: 'run-000000000001' }

function sendOptions() {
  return { body: { followUp: { ...meta, source: 'queue' } } } as never
}

function emptyStream(): ReadableStream<UIMessageChunk> {
  return new ReadableStream<UIMessageChunk>({
    start(controller) {
      controller.close()
    },
  })
}

describe('CoordinatedChatTransport', () => {
  it('acknowledges exactly once after the inner transport opens a response stream', async () => {
    const accepted: unknown[] = []
    const failures: unknown[] = []
    const inner = {
      sendMessages: async () => emptyStream(),
      reconnectToStream: async () => null,
    } as ChatTransport
    const transport = new CoordinatedChatTransport(inner, {
      accepted: (value) => accepted.push(value),
      initialFailure: (_value, error) => failures.push(error),
    })

    const stream = await transport.sendMessages(sendOptions())
    assert.ok(stream instanceof ReadableStream)
    assert.deepEqual(accepted, [meta])
    assert.equal(failures.length, 0)
  })

  it('reports initial HTTP / preparation failures and rethrows them', async () => {
    const accepted: unknown[] = []
    const failures: unknown[] = []
    const inner = {
      sendMessages: async () => {
        throw new Error('HTTP 500')
      },
      reconnectToStream: async () => null,
    } as ChatTransport
    const transport = new CoordinatedChatTransport(inner, {
      accepted: (value) => accepted.push(value),
      initialFailure: (value, error) => failures.push({ value, error }),
    })

    await assert.rejects(() => transport.sendMessages(sendOptions()), /HTTP 500/u)
    assert.equal(accepted.length, 0)
    assert.equal(failures.length, 1)
    assert.deepEqual((failures[0] as { value: unknown }).value, meta)
  })

  it('does not reinterpret a stream parser error as an initial delivery failure', async () => {
    const accepted: unknown[] = []
    const failures: unknown[] = []
    const stream = new ReadableStream<UIMessageChunk>({
      start(controller) {
        controller.error(new Error('parser/network failure after response'))
      },
    })
    const inner = {
      sendMessages: async () => stream,
      reconnectToStream: async () => null,
    } as ChatTransport
    const transport = new CoordinatedChatTransport(inner, {
      accepted: (value) => accepted.push(value),
      initialFailure: (_value, error) => failures.push(error),
    })

    const result = await transport.sendMessages(sendOptions())
    await assert.rejects(() => result.getReader().read(), /parser\/network failure/u)
    assert.deepEqual(accepted, [meta])
    assert.equal(failures.length, 0)
  })

  it('forwards tokenized reconnect requests unchanged', async () => {
    const expected = emptyStream()
    let reconnectOptions: unknown
    const inner = {
      sendMessages: async () => emptyStream(),
      reconnectToStream: async (options: unknown) => {
        reconnectOptions = options
        return expected
      },
    } as ChatTransport
    const transport = new CoordinatedChatTransport(inner, {
      accepted: () => undefined,
      initialFailure: () => undefined,
    })
    const options = { api: '/chat/swarmdesk-leader/thread/stream?clientRunId=run' } as never

    assert.equal(await transport.reconnectToStream(options), expected)
    assert.equal(reconnectOptions, options)
  })
})
