import assert from 'node:assert/strict'
import { setImmediate as delayImmediate } from 'node:timers/promises'
import { describe, it } from 'node:test'
import { RegistryOperationManager } from './acp-registry-operations.js'
import {
  apiCancelRegistryOperation,
  apiGetRegistryOperation,
  apiStartAuthenticateRegistry,
  apiStartPrepareRegistry,
  RegistryApiError,
} from './acp-registry-api.js'

const validBody = {
  registryId: 'fixture-agent',
  version: '1.0.0',
  distribution: 'npx' as const,
  manifestDigest: `sha256:${'a'.repeat(64)}`,
}

describe('Registry prepare operation API', () => {
  it('returns a queued operation immediately and publishes the eventual result', async () => {
    let release!: () => void
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    const manager = new RegistryOperationManager()
    const created = apiStartPrepareRegistry(validBody, {
      manager,
      prepare: async (_body, options) => {
        assert.equal(options?.signal?.aborted, false)
        await pending
        return { installationId: 'inst_result' } as never
      },
    })

    assert.equal(created.status, 'queued')
    assert.equal(created.result, undefined)
    await delayImmediate()
    assert.equal(apiGetRegistryOperation(created.operationId, { manager }).status, 'running')

    release()
    await delayImmediate()
    const succeeded = apiGetRegistryOperation(created.operationId, { manager })
    assert.equal(succeeded.status, 'succeeded')
    assert.deepEqual(succeeded.result, { installationId: 'inst_result' })
    assert.ok(succeeded.events.some((event) => event.stage === 'preparing'))
  })

  it('cancels the active product signal and late completion cannot overwrite cancelled', async () => {
    let observedSignal: AbortSignal | undefined
    let release!: () => void
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    const manager = new RegistryOperationManager()
    const created = apiStartPrepareRegistry(validBody, {
      manager,
      prepare: async (_body, options) => {
        observedSignal = options?.signal
        await pending
        return { installationId: 'late' } as never
      },
    })
    await delayImmediate()

    const cancelled = apiCancelRegistryOperation(created.operationId, { manager })
    assert.equal(cancelled.status, 'cancelled')
    assert.equal(observedSignal?.aborted, true)
    release()
    await delayImmediate()
    assert.equal(apiGetRegistryOperation(created.operationId, { manager }).status, 'cancelled')
  })

  it('rejects malformed input before allocating work and bounds missing operation errors', () => {
    const manager = new RegistryOperationManager()
    assert.throws(
      () => apiStartPrepareRegistry({ ...validBody, registryId: '../escape' }, { manager }),
      (error: unknown) =>
        error instanceof RegistryApiError &&
        error.code === 'ACP_REGISTRY_ENTRY_INVALID' &&
        error.httpStatus === 400,
    )
    assert.throws(
      () => apiGetRegistryOperation('missing-operation', { manager }),
      (error: unknown) =>
        error instanceof RegistryApiError &&
        error.code === 'WORKER_NOT_READY' &&
        error.httpStatus === 404,
    )
  })

  it('runs advertised agent authentication as a cancellable operation', async () => {
    let observedSignal: AbortSignal | undefined
    let release!: () => void
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    const manager = new RegistryOperationManager()
    const created = apiStartAuthenticateRegistry(
      {
        workerId: 'worker-fixture',
        methodId: 'oauth',
      },
      {
        manager,
        authenticate: async (_input, deps) => {
          observedSignal = deps?.signal
          await pending
          return { worker: { id: 'worker-fixture' } } as never
        },
      },
    )
    assert.equal(created.kind, 'authenticate')
    assert.equal(created.status, 'queued')
    await delayImmediate()

    const cancelled = apiCancelRegistryOperation(created.operationId, { manager })
    assert.equal(cancelled.status, 'cancelled')
    assert.equal(observedSignal?.aborted, true)
    release()
    await delayImmediate()
    assert.equal(apiGetRegistryOperation(created.operationId, { manager }).status, 'cancelled')
  })

  it('rejects malformed agent-auth identities before allocating an operation', () => {
    const manager = new RegistryOperationManager()
    assert.throws(
      () =>
        apiStartAuthenticateRegistry(
          {
            workerId: '../worker',
            methodId: 'oauth',
          },
          { manager },
        ),
      (error: unknown) =>
        error instanceof RegistryApiError && error.code === 'ACP_REGISTRY_ENTRY_INVALID',
    )
    assert.throws(
      () =>
        apiStartAuthenticateRegistry(
          {
            workerId: 'worker-fixture',
            methodId: 'oauth/value',
          },
          { manager },
        ),
      (error: unknown) =>
        error instanceof RegistryApiError && error.code === 'ACP_REGISTRY_ENTRY_INVALID',
    )
  })
})
