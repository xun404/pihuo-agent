import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('ACP runtime bootstrap', () => {
  it('normalizes timer-backed runtime configuration', async () => {
    const runtimeModule = await import('./acp-runtime.js')
    assert.equal(runtimeModule.resolveAcpRuntimeTimerMs(undefined, 10_000), 10_000)
    assert.equal(runtimeModule.resolveAcpRuntimeTimerMs(-1, 10_000), 10_000)
    assert.equal(runtimeModule.resolveAcpRuntimeTimerMs(123.9, 10_000), 123)
    assert.equal(runtimeModule.resolveAcpRuntimeTimerMs(999_999_999_999, 10_000), 2_147_483_647)
  })

  it('is idempotent for the same composition and rejects incompatible reconfiguration', async () => {
    const runtimeModule = await import('./acp-runtime.js')
    const dir = mkdtempSync(join(tmpdir(), 'acp-runtime-test-'))
    const catalogPath = join(dir, 'sessions.json')
    try {
      await runtimeModule.resetAcpRuntimeForTests()
      const first = runtimeModule.initializeAcpRuntime({
        catalogPath,
        applySecrets: false,
        registerProcessHandlers: false,
      })
      const second = runtimeModule.initializeAcpRuntime({
        catalogPath,
        applySecrets: false,
        registerProcessHandlers: false,
      })
      assert.strictEqual(first, second)
      assert.equal(first.mode, 'owner')
      assert.ok(first.manager)
      assert.strictEqual(first.manager, second.manager)
      assert.equal(first.manager!.getCatalogPort()?.isAvailable(), true)
      assert.ok(first.lease)

      assert.throws(
        () =>
          runtimeModule.initializeAcpRuntime({
            catalogPath: join(dir, 'different.json'),
            applySecrets: false,
            registerProcessHandlers: false,
          }),
        /incompatible/i,
      )

      // Same signature is idempotent even with alternate store injection after init
      const again = runtimeModule.initializeAcpRuntime({
        catalogPath,
        applySecrets: false,
        registerProcessHandlers: false,
        store: { listWorkers: () => [] },
      })
      assert.strictEqual(again, first)
    } finally {
      await runtimeModule.resetAcpRuntimeForTests()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('builds stable production reuse keys through the configured manager', async () => {
    const runtimeModule = await import('./acp-runtime.js')
    const dir = mkdtempSync(join(tmpdir(), 'acp-runtime-key-test-'))
    try {
      await runtimeModule.resetAcpRuntimeForTests()
      const runtime = runtimeModule.initializeAcpRuntime({
        catalogPath: join(dir, 'sessions.json'),
        applySecrets: false,
        registerProcessHandlers: false,
      })
      const params = {
        routerSessionId: 'session',
        workerId: 'worker',
        cwd: process.cwd(),
        config: { command: 'agent', args: ['acp'], model: 'm1', env: { A: 'b|C=d' } },
      }
      assert.ok(runtime.manager)
      assert.deepEqual(
        runtime.manager!.buildReuseKey(params),
        runtime.manager!.buildReuseKey(params),
      )
    } finally {
      await runtimeModule.resetAcpRuntimeForTests()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('client-only never acquires lease or creates local manager', async () => {
    const runtimeModule = await import('./acp-runtime.js')
    const dir = mkdtempSync(join(tmpdir(), 'acp-runtime-client-'))
    const catalogPath = join(dir, 'sessions.json')
    try {
      await runtimeModule.resetAcpRuntimeForTests()
      const runtime = runtimeModule.initializeAcpRuntime({
        catalogPath,
        applySecrets: false,
        registerProcessHandlers: false,
        role: 'client-only',
      })
      assert.equal(runtime.mode, 'remote-client')
      assert.equal(runtime.manager, null)
      assert.equal(runtime.catalog, null)
      assert.equal(runtime.lease, null)
    } finally {
      await runtimeModule.resetAcpRuntimeForTests()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('owner role throws when lease is already held', async () => {
    const runtimeModule = await import('./acp-runtime.js')
    const { acquireOwnerLease } = await import('@swarmdesk-agent/core')
    const dir = mkdtempSync(join(tmpdir(), 'acp-runtime-owner-fail-'))
    const catalogPath = join(dir, 'sessions.json')
    const held = acquireOwnerLease(catalogPath, {
      pid: 4242,
      processStartedAt: '2026-07-15T10:00:00.000Z',
      isProcessAlive: () => true,
      getProcessStartedAt: () => '2026-07-15T10:00:00.000Z',
      now: () => Date.parse('2026-07-15T12:00:00.000Z'),
    })
    assert.equal(held.ok, true)
    try {
      await runtimeModule.resetAcpRuntimeForTests()
      assert.throws(
        () =>
          runtimeModule.initializeAcpRuntime({
            catalogPath,
            applySecrets: false,
            registerProcessHandlers: false,
            role: 'owner',
            leaseDeps: {
              pid: 9999,
              processStartedAt: '2026-07-15T11:00:00.000Z',
              isProcessAlive: () => true,
              getProcessStartedAt: (pid) =>
                pid === 4242 ? '2026-07-15T10:00:00.000Z' : '2026-07-15T11:00:00.000Z',
              now: () => Date.parse('2026-07-15T12:00:00.000Z'),
            },
          }),
        /RUNTIME_OWNER_EXISTS/,
      )
    } finally {
      await runtimeModule.resetAcpRuntimeForTests()
      if (held.ok) held.lease.release()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('enters remote-client mode when owner lease is held', async () => {
    const runtimeModule = await import('./acp-runtime.js')
    const { acquireOwnerLease } = await import('@swarmdesk-agent/core')
    const dir = mkdtempSync(join(tmpdir(), 'acp-runtime-lease-'))
    const catalogPath = join(dir, 'sessions.json')
    const held = acquireOwnerLease(catalogPath, {
      pid: 4242,
      processStartedAt: '2026-07-15T10:00:00.000Z',
      isProcessAlive: () => true,
      getProcessStartedAt: () => '2026-07-15T10:00:00.000Z',
      now: () => Date.parse('2026-07-15T12:00:00.000Z'),
    })
    assert.equal(held.ok, true)
    try {
      await runtimeModule.resetAcpRuntimeForTests()
      const runtime = runtimeModule.initializeAcpRuntime({
        catalogPath,
        applySecrets: false,
        registerProcessHandlers: false,
        leaseDeps: {
          pid: 9999,
          processStartedAt: '2026-07-15T11:00:00.000Z',
          isProcessAlive: () => true,
          getProcessStartedAt: (pid) =>
            pid === 4242 ? '2026-07-15T10:00:00.000Z' : '2026-07-15T11:00:00.000Z',
          now: () => Date.parse('2026-07-15T12:00:00.000Z'),
        },
      })
      assert.equal(runtime.mode, 'remote-client')
      assert.equal(runtime.manager, null)
      assert.equal(runtime.catalog, null)
      assert.equal(runtime.lease, null)
    } finally {
      await runtimeModule.resetAcpRuntimeForTests()
      if (held.ok) held.lease.release()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
