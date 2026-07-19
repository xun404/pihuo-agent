import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  BoundedTerminalOutputQueue,
  createTerminalAuthFrameSender,
  disposeTerminalAuthSession,
  encodeTerminalAuthClientFrame,
  parseTerminalAuthServerFrame,
  TerminalTransportGuard,
} from './WorkerAuthTerminalModal.js'

describe('WorkerAuthTerminalModal transport primitives', () => {
  it('encodes only typed input, resize and cancel frames', () => {
    assert.equal(
      encodeTerminalAuthClientFrame({ type: 'input', data: 'secret\r' }),
      JSON.stringify({ type: 'input', data: 'secret\r' }),
    )
    assert.equal(
      encodeTerminalAuthClientFrame({ type: 'resize', cols: 120, rows: 40 }),
      JSON.stringify({ type: 'resize', cols: 120, rows: 40 }),
    )
    assert.equal(
      encodeTerminalAuthClientFrame({ type: 'cancel' }),
      JSON.stringify({ type: 'cancel' }),
    )
    assert.throws(
      () => encodeTerminalAuthClientFrame({ type: 'input', data: 'x'.repeat(9 * 1024) }),
      /frame/u,
    )
  })

  it('strictly parses bounded public server frames', () => {
    assert.deepEqual(
      parseTerminalAuthServerFrame(
        JSON.stringify({
          type: 'output',
          data: 'hello',
        }),
      ),
      { type: 'output', data: 'hello' },
    )
    assert.deepEqual(
      parseTerminalAuthServerFrame(
        JSON.stringify({
          type: 'exit',
          code: 0,
          status: 'exited',
          nextAction: 're-probe',
        }),
      ),
      { type: 'exit', code: 0, status: 'exited', nextAction: 're-probe' },
    )
    assert.throws(
      () => parseTerminalAuthServerFrame('{"type":"output","data":"ok","extra":1}'),
      /frame/u,
    )
    assert.throws(
      () =>
        parseTerminalAuthServerFrame(
          JSON.stringify({
            type: 'output',
            data: 'x'.repeat(129 * 1024),
          }),
        ),
      /frame/u,
    )
  })

  it('batches output through one bounded animation frame without React state', () => {
    const writes: string[] = []
    const scheduled: Array<() => void> = []
    let limited = 0
    const queue = new BoundedTerminalOutputQueue({
      maxQueuedBytes: 8,
      maxTotalBytes: 10,
      write: (value) => writes.push(value),
      requestFrame: (callback) => {
        scheduled.push(callback)
        return scheduled.length
      },
      cancelFrame: () => {},
      onLimit: () => {
        limited += 1
      },
    })

    assert.equal(queue.enqueue('abc'), true)
    assert.equal(queue.enqueue('de'), true)
    assert.equal(scheduled.length, 1)
    scheduled.shift()!()
    assert.deepEqual(writes, ['abcde'])
    assert.equal(queue.enqueue('123456'), false)
    assert.equal(limited, 1)
    assert.equal(queue.totalBytes, 5)
  })

  it('performs idempotent StrictMode cleanup with typed cancel and no token persistence', () => {
    const sent: string[] = []
    let closed = 0
    let terminalDisposed = 0
    let fitDisposed = 0
    let observerDisconnected = 0
    let queueDisposed = 0
    const resources = {
      socket: {
        readyState: 1,
        send: (value: string) => sent.push(value),
        close: () => {
          closed += 1
        },
      },
      terminal: {
        dispose: () => {
          terminalDisposed += 1
        },
      },
      fitAddon: {
        dispose: () => {
          fitDisposed += 1
        },
      },
      resizeObserver: {
        disconnect: () => {
          observerDisconnected += 1
        },
      },
      outputQueue: {
        dispose: () => {
          queueDisposed += 1
        },
      },
      disposed: false,
    }

    disposeTerminalAuthSession(resources)
    disposeTerminalAuthSession(resources)

    assert.deepEqual(sent, [JSON.stringify({ type: 'cancel' })])
    assert.equal(closed, 1)
    assert.equal(terminalDisposed, 1)
    assert.equal(fitDisposed, 1)
    assert.equal(observerDisconnected, 1)
    assert.equal(queueDisposed, 1)
    assert.equal(JSON.stringify(resources).includes('token'), false)
  })

  it('turns oversized terminal input into one controlled cancel/close failure', () => {
    const sent: string[] = []
    let closed = 0
    let failed = 0
    const socket = {
      readyState: 1,
      send: (value: string) => sent.push(value),
      close: () => {
        closed += 1
      },
    }
    const send = createTerminalAuthFrameSender(socket, () => {
      failed += 1
    })

    assert.equal(send({ type: 'input', data: 'x'.repeat(9 * 1024) }), false)
    assert.deepEqual(sent, [JSON.stringify({ type: 'cancel' })])
    assert.equal(closed, 1)
    assert.equal(failed, 1)
  })

  it('fails a premature socket close once but ignores close after an exit frame', () => {
    let failures = 0
    const guard = new TerminalTransportGuard()
    assert.equal(
      guard.failOnce(() => {
        failures += 1
      }),
      true,
    )
    assert.equal(
      guard.failOnce(() => {
        failures += 1
      }),
      false,
    )
    assert.equal(failures, 1)

    const exited = new TerminalTransportGuard()
    exited.markTerminal()
    assert.equal(
      exited.failOnce(() => {
        failures += 1
      }),
      false,
    )
    assert.equal(failures, 1)
  })
})
