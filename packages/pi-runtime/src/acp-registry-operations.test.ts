import assert from 'node:assert/strict'
import { setImmediate as delayImmediate } from 'node:timers/promises'
import { describe, it } from 'node:test'
import { RegistryOperationManager } from './acp-registry-operations.js'
import { assertRegistryOperationId } from './acp-registry-input.js'

describe('RegistryOperationManager', () => {
  it('always generates operation ids accepted by the public route validator', () => {
    const manager = new RegistryOperationManager({ maxOperations: 1_100 })
    for (let index = 0; index < 1_000; index += 1) {
      const created = manager.start({
        kind: 'prepare',
        run: async () => index,
        mapError: () => ({ code: 'ACP_INSTALL_FAILED', error: 'failed' }),
      })
      assert.doesNotThrow(() => assertRegistryOperationId(created.operationId))
    }
  })

  it('returns an id before work finishes and records ordered public state events', async () => {
    let release!: (value: { installationId: string }) => void
    const pending = new Promise<{ installationId: string }>((resolve) => {
      release = resolve
    })
    const manager = new RegistryOperationManager({ maxOperations: 4, maxEvents: 8 })

    const created = manager.start({
      kind: 'prepare',
      run: async (_signal, report) => {
        report({ stage: 'resolving_runner', progress: 0.25 })
        return pending
      },
      mapError: () => ({ code: 'ACP_INSTALL_FAILED', error: 'Registry operation failed' }),
    })

    assert.match(created.operationId, /^[A-Za-z0-9_-]{32,}$/)
    assert.equal(created.status, 'queued')
    assert.equal(created.events[0]?.sequence, 1)

    await delayImmediate()
    const running = manager.get(created.operationId)
    assert.equal(running?.status, 'running')
    assert.deepEqual(
      running?.events.map((event) => event.sequence),
      [1, 2, 3],
    )
    assert.equal(running?.events[2]?.stage, 'resolving_runner')

    release({ installationId: 'installation-1' })
    await delayImmediate()
    const succeeded = manager.get(created.operationId)
    assert.equal(succeeded?.status, 'succeeded')
    assert.deepEqual(succeeded?.result, { installationId: 'installation-1' })
    assert.equal(succeeded?.events.at(-1)?.status, 'succeeded')
  })

  it('publishes only the mapped public error and never the private cause', async () => {
    const manager = new RegistryOperationManager()
    const created = manager.start({
      kind: 'prepare',
      run: async () => {
        throw new Error('/Users/private/download?token=secret')
      },
      mapError: () => ({
        code: 'ACP_INSTALL_FAILED',
        error: 'Registry operation failed',
      }),
    })

    await delayImmediate()
    const failed = manager.get(created.operationId)
    assert.equal(failed?.status, 'failed')
    assert.equal(failed?.code, 'ACP_INSTALL_FAILED')
    assert.equal(failed?.error, 'Registry operation failed')
    assert.doesNotMatch(JSON.stringify(failed), /Users|token=secret/)
  })

  it('aborts cancellation-aware work and a late result cannot overwrite cancelled', async () => {
    let release!: () => void
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    const manager = new RegistryOperationManager()
    const created = manager.start({
      kind: 'prepare',
      run: async (signal) => {
        await pending
        if (signal.aborted) throw signal.reason
        return { ok: true }
      },
      mapError: () => ({ code: 'ACP_INSTALL_FAILED', error: 'failed' }),
    })
    await delayImmediate()

    const cancelled = manager.cancel(created.operationId)
    assert.equal(cancelled.status, 'cancelled')
    release()
    await delayImmediate()
    assert.equal(manager.get(created.operationId)?.status, 'cancelled')
    assert.equal(manager.get(created.operationId)?.result, undefined)
  })

  it('bounds retained operations/events and expires terminal operations', async () => {
    let now = Date.parse('2026-07-17T00:00:00.000Z')
    const manager = new RegistryOperationManager({
      now: () => now,
      maxOperations: 2,
      maxEvents: 3,
      terminalTtlMs: 1_000,
    })
    const start = (id: number) =>
      manager.start({
        kind: 'prepare' as const,
        run: async (_signal: AbortSignal, report: (event: { stage: string }) => void) => {
          report({ stage: `one-${id}` })
          report({ stage: `two-${id}` })
          report({ stage: `three-${id}` })
          return id
        },
        mapError: () => ({ code: 'ACP_INSTALL_FAILED', error: 'failed' }),
      })

    const first = start(1)
    await delayImmediate()
    const second = start(2)
    await delayImmediate()
    const third = start(3)
    await delayImmediate()

    assert.equal(manager.get(first.operationId), undefined)
    assert.equal(manager.get(second.operationId)?.events.length, 3)
    assert.equal(manager.get(third.operationId)?.events.length, 3)

    now += 1_001
    manager.prune()
    assert.equal(manager.get(second.operationId), undefined)
    assert.equal(manager.get(third.operationId), undefined)
  })
})
