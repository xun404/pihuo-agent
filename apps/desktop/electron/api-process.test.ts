import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { describe, it } from 'node:test'
import { createManagedApiProcess } from './api-process.js'

class FakeProcess extends EventEmitter {
  pid: number | undefined
  stdout = null
  stderr = null
  killCalls = 0
  killArgs: unknown[][] = []

  kill(...args: unknown[]): boolean {
    this.killCalls += 1
    this.killArgs.push(args)
    return true
  }
}

describe('managed desktop API process', () => {
  it('waits for spawn, tracks exit, and refuses to kill an exited process', async () => {
    const source = new FakeProcess()
    const process = createManagedApiProcess(source)

    const spawned = process.waitForSpawn(100)
    source.pid = 4242
    source.emit('spawn')

    assert.equal(await spawned, 4242)
    assert.equal(process.pid, 4242)
    assert.equal(process.exited, false)

    source.emit('exit', 0)
    assert.equal(await process.waitForExit(20), true)
    assert.equal(process.exited, true)
    assert.equal(process.kill(), false)
    assert.equal(source.killCalls, 0)
  })

  it('resolves spawn immediately when a pid already exists', async () => {
    const source = new FakeProcess()
    source.pid = 81092
    const process = createManagedApiProcess(source)

    assert.equal(await process.waitForSpawn(20), 81092)
    assert.equal(source.listenerCount('spawn'), 0)
  })

  it('times out without leaking spawn or exit listeners', async () => {
    const source = new FakeProcess()
    const process = createManagedApiProcess(source)

    assert.equal(await process.waitForSpawn(5), undefined)
    assert.equal(source.listenerCount('spawn'), 0)

    assert.equal(await process.waitForExit(5), false)
    assert.equal(source.listenerCount('exit'), 1)
  })

  it('forwards error and exit notifications through stable callbacks', () => {
    const source = new FakeProcess()
    const process = createManagedApiProcess(source)
    const seen: unknown[] = []
    const exits: Array<number | null> = []

    process.onError((error) => seen.push(error))
    process.onExit((code) => exits.push(code))
    const error = new Error('boom')
    source.emit('error', error)
    source.emit('exit', 7)

    assert.deepEqual(seen, [error])
    assert.deepEqual(exits, [7])
  })

  it('normalizes graceful and forced termination for child-process sources', () => {
    const source = new FakeProcess()
    const process = createManagedApiProcess(source)

    assert.equal(process.kill(), true)
    assert.equal(process.kill(true), true)
    assert.deepEqual(source.killArgs, [[], ['SIGKILL']])
  })
})
