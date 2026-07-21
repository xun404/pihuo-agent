import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ignoreBrokenHostPipe,
  isIgnorableHostWriteError,
  writeHostLog,
  type HostWriteStream,
} from './host-log.js'

describe('host-log', () => {
  it('treats EPIPE and destroyed streams as ignorable', () => {
    assert.equal(isIgnorableHostWriteError(Object.assign(new Error('pipe'), { code: 'EPIPE' })), true)
    assert.equal(
      isIgnorableHostWriteError(Object.assign(new Error('gone'), { code: 'ERR_STREAM_DESTROYED' })),
      true,
    )
    assert.equal(isIgnorableHostWriteError(Object.assign(new Error('disk'), { code: 'ENOSPC' })), false)
  })

  it('skips writes when the host stream is not writable', () => {
    let wrote = 0
    const stream: HostWriteStream = {
      writable: false,
      write() {
        wrote += 1
      },
    }
    assert.equal(writeHostLog(stream, '[api] ', 'hello'), false)
    assert.equal(wrote, 0)
  })

  it('forwards logs when the host stream accepts writes', () => {
    const chunks: string[] = []
    const stream: HostWriteStream = {
      writable: true,
      write(chunk) {
        chunks.push(String(chunk))
      },
    }
    assert.equal(writeHostLog(stream, '[api] ', 'ready\n'), true)
    assert.deepEqual(chunks, ['[api] ready\n'])
  })

  it('swallows synchronous EPIPE from write instead of throwing', () => {
    const stream: HostWriteStream = {
      writable: true,
      write() {
        const err = new Error('write EPIPE') as NodeJS.ErrnoException
        err.code = 'EPIPE'
        throw err
      },
    }
    assert.equal(writeHostLog(stream, '[api] ', 'noise'), false)
  })

  it('registers an error listener that ignores broken-pipe emissions', () => {
    const listeners: Array<(error: NodeJS.ErrnoException) => void> = []
    const stream: HostWriteStream = {
      write() {},
      on(_event, listener) {
        listeners.push(listener)
      },
    }
    ignoreBrokenHostPipe(stream)
    assert.equal(listeners.length, 1)
    assert.doesNotThrow(() =>
      listeners[0]!({ name: 'Error', message: 'write EPIPE', code: 'EPIPE' }),
    )
  })
})
