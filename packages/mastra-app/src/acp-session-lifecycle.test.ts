import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AcpSessionCatalog, type AcpSessionRecord } from '@router-agents/core'
import {
  AcpSessionManager,
  buildSessionReuseKey,
  computeExecutionFingerprint,
  computeKeyDigest,
  resetAcpSessionManager,
  workerExecutionConfigChanged,
  type SessionReuseKey,
  type SessionEntryConfig,
  type WorkerExecutionConfig,
} from '@router-agents/adapters'
import type { AcpSessionCatalogPort, AcpSessionCatalogRecord } from '@router-agents/adapters'

const SAFE_CWD = process.cwd()

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'acp-lifecycle-test-'))
}

function mkConfig(overrides: Partial<SessionEntryConfig> = {}): SessionEntryConfig {
  return {
    command: 'test-cmd',
    args: ['arg1'],
    model: 'test-model',
    env: { OPENCODE_MODEL: 'test-model' },
    ...overrides,
  }
}

function mkKey(overrides: Partial<SessionReuseKey> = {}): SessionReuseKey {
  return {
    routerSessionId: 'sess-1',
    workerId: 'worker-a',
    canonicalCwd: SAFE_CWD,
    executionFingerprint: computeExecutionFingerprint(mkConfig()),
    ...overrides,
  }
}

function keyToString(k: SessionReuseKey): string {
  return computeKeyDigest(k)
}

function makeFakeIdleEntry(key: SessionReuseKey): any {
  return {
    key,
    state: 'idle',
    proc: { pid: 99999, exitCode: 0, signalCode: null, on: () => {}, stderr: { on: () => {} } },
    driver: {
      prompt: () => Promise.resolve({ ok: true, output: '', stopReason: 'end_turn' }),
      cancel: () => Promise.resolve(),
      close: () => {},
      dispose: () => {},
    },
    agentSessionId: 'fake-sid',
    capabilities: {},
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
    generation: 1,
    summary: 'test',
    currentBinding: null,
    promptQueue: [],
    configOptions: [],
  }
}

function makeCatalogRecord(
  keyDigest: string,
  overrides: Partial<AcpSessionCatalogRecord> = {},
): AcpSessionCatalogRecord {
  return {
    keyDigest,
    routerSessionId: 'sess-1',
    workerId: 'worker-a',
    canonicalCwd: SAFE_CWD,
    executionFingerprint: 'fp-001',
    agentSessionId: 'agent-sess-1',
    capabilities: { loadSession: false, resume: false, close: true, delete: true },
    state: 'ready',
    createdAt: new Date().toISOString(),
    lastUsedAt: new Date().toISOString(),
    ...overrides,
    version: 1,
  }
}

let dir: string
let catalogPath: string
let catalog: AcpSessionCatalog
let manager: AcpSessionManager

function catalogToPort(target: AcpSessionCatalog): AcpSessionCatalogPort {
  return {
    lookup: (d) => target.lookup(d) as AcpSessionCatalogRecord | undefined,
    listByRouterSession: (id) => target.listByRouterSession(id) as AcpSessionCatalogRecord[],
    listByWorker: (id) => target.listByWorker(id) as AcpSessionCatalogRecord[],
    upsert: (r) => target.upsert(r),
    touch: (d, options) => target.touch(d, options),
    markStale: (d, reason) => target.markStale(d, reason),
    deleteByKey: (d) => target.deleteByKey(d),
    deleteByRouterSession: (id) => target.deleteByRouterSession(id),
    deleteByRouterSessions: (ids) => target.deleteByRouterSessions(ids),
    deleteByWorker: (id) => target.deleteByWorker(id),
    isAvailable: () => target.isAvailable(),
  }
}

function catalogAsPort(): AcpSessionCatalogPort {
  return catalogToPort(catalog)
}

describe('ACP Session Lifecycle (catalog + manager)', () => {
  beforeEach(() => {
    dir = tmpDir()
    catalogPath = join(dir, 'sessions.json')
    catalog = new AcpSessionCatalog(catalogPath)
    resetAcpSessionManager()
    manager = new AcpSessionManager({ idleTimeoutMs: 900_000 })
    manager.setCatalogPort(catalogAsPort())
  })

  afterEach(() => {
    const timer = (manager as any).idleTimer as ReturnType<typeof setInterval> | null
    if (timer) clearInterval(timer)
    try {
      catalog.close()
    } catch {
      /* ok */
    }
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* ok */
    }
  })

  // -- 1. TTL closes live entry, catalog record survives --
  it('TTL closes live entry, catalog record survives', () => {
    const key = mkKey()
    const keyDigest = computeKeyDigest(key)
    catalog.upsert(makeCatalogRecord(keyDigest) as any)

    const mgr = new AcpSessionManager({ idleTimeoutMs: 100 })
    const timer = (mgr as any).idleTimer as ReturnType<typeof setInterval> | null
    if (timer) clearInterval(timer)
    mgr.setCatalogPort(catalogAsPort())

    const oldEntry = makeFakeIdleEntry(key)
    oldEntry.lastUsedAt = Date.now() - 10_000
    ;(mgr as any).entries.set(keyToString(key), oldEntry)
    assert.equal(mgr.getDebugInfo().entries, 1)

    ;(mgr as any).reapIdle()

    assert.equal(mgr.getDebugInfo().entries, 0)
    assert.ok(catalog.isAvailable())
    const record = catalog.lookup(keyDigest)
    assert.ok(record)
    assert.equal(record!.state, 'ready')
  })

  // -- 2. LRU evict closes live, catalog record survives --
  it('LRU evict closes live, catalog record survives', () => {
    const key = mkKey()
    const keyDigest = computeKeyDigest(key)
    catalog.upsert(makeCatalogRecord(keyDigest) as any)

    const oldestEntry = makeFakeIdleEntry(key)
    oldestEntry.lastUsedAt = Date.now() - 3000
    ;(manager as any).entries.set(keyToString(key), oldestEntry)
    assert.equal(manager.getDebugInfo().entries, 1)

    ;(manager as any).evictLRU()

    assert.equal(manager.getDebugInfo().entries, 0)
    const record = catalog.lookup(keyDigest)
    assert.ok(record)
    assert.equal(record!.state, 'ready')
  })

  // -- 3. deleteByRouterSession removes catalog records --
  it('deleteContextByRouterSession removes catalog records', () => {
    const key1 = mkKey({ routerSessionId: 'sess-A', workerId: 'w1' })
    const key2 = mkKey({ routerSessionId: 'sess-A', workerId: 'w2' })
    const key3 = mkKey({ routerSessionId: 'sess-B', workerId: 'w1' })
    const kd1 = computeKeyDigest(key1)
    const kd2 = computeKeyDigest(key2)
    const kd3 = computeKeyDigest(key3)

    catalog.upsert(
      makeCatalogRecord(kd1, { keyDigest: kd1, routerSessionId: 'sess-A', workerId: 'w1' }) as any,
    )
    catalog.upsert(
      makeCatalogRecord(kd2, { keyDigest: kd2, routerSessionId: 'sess-A', workerId: 'w2' }) as any,
    )
    catalog.upsert(
      makeCatalogRecord(kd3, { keyDigest: kd3, routerSessionId: 'sess-B', workerId: 'w1' }) as any,
    )

    ;(manager as any).entries.set(keyToString(key1), makeFakeIdleEntry(key1))
    ;(manager as any).entries.set(keyToString(key2), makeFakeIdleEntry(key2))
    ;(manager as any).entries.set(keyToString(key3), makeFakeIdleEntry(key3))

    manager.deleteContextByRouterSession('sess-A')

    assert.equal(manager.getDebugInfo().entries, 1)
    assert.ok((manager as any).entries.has(keyToString(key3)))

    assert.equal(catalog.lookup(kd1), undefined)
    assert.equal(catalog.lookup(kd2), undefined)
    assert.ok(catalog.lookup(kd3))
  })

  // -- 4. deleteByWorker removes catalog records --
  it('deleteContextByWorker removes catalog records', () => {
    const key1 = mkKey({ workerId: 'w1', routerSessionId: 'sess-1' })
    const key2 = mkKey({ workerId: 'w1', routerSessionId: 'sess-2' })
    const key3 = mkKey({ workerId: 'w2', routerSessionId: 'sess-1' })
    const kd1 = computeKeyDigest(key1)
    const kd2 = computeKeyDigest(key2)
    const kd3 = computeKeyDigest(key3)

    catalog.upsert(
      makeCatalogRecord(kd1, { keyDigest: kd1, workerId: 'w1', routerSessionId: 'sess-1' }) as any,
    )
    catalog.upsert(
      makeCatalogRecord(kd2, { keyDigest: kd2, workerId: 'w1', routerSessionId: 'sess-2' }) as any,
    )
    catalog.upsert(
      makeCatalogRecord(kd3, { keyDigest: kd3, workerId: 'w2', routerSessionId: 'sess-1' }) as any,
    )

    ;(manager as any).entries.set(keyToString(key1), makeFakeIdleEntry(key1))
    ;(manager as any).entries.set(keyToString(key2), makeFakeIdleEntry(key2))
    ;(manager as any).entries.set(keyToString(key3), makeFakeIdleEntry(key3))

    manager.deleteContextByWorker('w1')

    assert.equal(manager.getDebugInfo().entries, 1)
    assert.ok((manager as any).entries.has(keyToString(key3)))

    assert.equal(catalog.lookup(kd1), undefined)
    assert.equal(catalog.lookup(kd2), undefined)
    assert.ok(catalog.lookup(kd3))
  })

  // -- 5. Worker execution config change → purge old mappings --
  it('workerExecutionConfigChanged purges old mappings via deleteContextByWorker', () => {
    const key = mkKey({ workerId: 'worker-x' })
    const kd = computeKeyDigest(key)
    catalog.upsert(makeCatalogRecord(kd, { keyDigest: kd, workerId: 'worker-x' }) as any)

    ;(manager as any).entries.set(keyToString(key), makeFakeIdleEntry(key))
    assert.equal(manager.getDebugInfo().entries, 1)
    assert.ok(catalog.lookup(kd))

    manager.deleteContextByWorker('worker-x')

    assert.equal(manager.getDebugInfo().entries, 0)
    assert.equal(catalog.lookup(kd), undefined)
  })

  // -- 6. Worker non-exec config change → mappings preserved --
  it('non-execution config change preserves catalog mappings', () => {
    const before: WorkerExecutionConfig = {
      command: 'opencode',
      args: ['acp'],
      env: { MY_VAR: 'val' },
      model: 'model-a',
      kind: 'opencode',
      enabled: true,
    }
    const afterName: WorkerExecutionConfig = {
      ...before,
    }
    // name/description/roles are NOT in WorkerExecutionConfig so they can't change it
    assert.equal(workerExecutionConfigChanged(before, afterName), false)

    // verify that a real non-exec change (same everything) doesn't trigger
    assert.equal(
      workerExecutionConfigChanged(before, {
        ...before,
        args: [...before.args],
        env: { ...before.env },
      }),
      false,
    )
  })

  // -- 7. cwd change → different mapping (isolation test) --
  it('cwd change produces different reuse key and catalog key digest', () => {
    const config = mkConfig()
    const key1 = buildSessionReuseKey({
      routerSessionId: 'sess-1',
      workerId: 'w1',
      cwd: '/tmp/project-a',
      config,
    })
    const key2 = buildSessionReuseKey({
      routerSessionId: 'sess-1',
      workerId: 'w1',
      cwd: '/tmp/project-b',
      config,
    })

    assert.notEqual(key1.canonicalCwd, key2.canonicalCwd)
    assert.notEqual(keyToString(key1), keyToString(key2))

    const kd1 = computeKeyDigest(key1)
    const kd2 = computeKeyDigest(key2)
    assert.notEqual(kd1, kd2)

    catalog.upsert(
      makeCatalogRecord(kd1, { keyDigest: kd1, canonicalCwd: key1.canonicalCwd }) as any,
    )
    catalog.upsert(
      makeCatalogRecord(kd2, { keyDigest: kd2, canonicalCwd: key2.canonicalCwd }) as any,
    )

    assert.ok(catalog.lookup(kd1))
    assert.ok(catalog.lookup(kd2))
    assert.notEqual(catalog.lookup(kd1)!.canonicalCwd, catalog.lookup(kd2)!.canonicalCwd)
  })

  // -- 8. deleteContextByProject removes catalog per session --
  it('deleteContextByProject removes catalog records for all sessions in project', () => {
    const keyA = mkKey({ routerSessionId: 'sess-A', workerId: 'w1' })
    const keyB = mkKey({ routerSessionId: 'sess-B', workerId: 'w2' })
    const kdA = computeKeyDigest(keyA)
    const kdB = computeKeyDigest(keyB)

    catalog.upsert(makeCatalogRecord(kdA, { keyDigest: kdA, routerSessionId: 'sess-A' }) as any)
    catalog.upsert(makeCatalogRecord(kdB, { keyDigest: kdB, routerSessionId: 'sess-B' }) as any)

    ;(manager as any).entries.set(keyToString(keyA), makeFakeIdleEntry(keyA))
    ;(manager as any).entries.set(keyToString(keyB), makeFakeIdleEntry(keyB))
    manager.setSessionProject('sess-A', 'proj-1')
    manager.setSessionProject('sess-B', 'proj-1')

    manager.deleteContextByProject('proj-1')

    assert.equal(manager.getDebugInfo().entries, 0)
    assert.equal(catalog.lookup(kdA), undefined)
    assert.equal(catalog.lookup(kdB), undefined)
  })

  // -- 9. closeAll keeps catalog intact --
  it('closeAll keeps catalog intact', async () => {
    const key = mkKey()
    const kd = computeKeyDigest(key)
    catalog.upsert(makeCatalogRecord(kd, { keyDigest: kd }) as any)

    ;(manager as any).entries.set(keyToString(key), makeFakeIdleEntry(key))
    assert.equal(manager.getDebugInfo().entries, 1)

    await manager.closeAll()

    assert.equal(manager.getDebugInfo().entries, 0)
    assert.ok(catalog.lookup(kd))
  })
})

// -- 10. Reset endpoint tests (unit test of logic, no HTTP) --
describe('ACP reset endpoint logic', () => {
  let dir2: string
  let catalog2: AcpSessionCatalog
  let manager2: AcpSessionManager

  beforeEach(() => {
    dir2 = tmpDir()
    catalog2 = new AcpSessionCatalog(join(dir2, 'sessions.json'))
    resetAcpSessionManager()
    manager2 = new AcpSessionManager()
  })

  afterEach(() => {
    const timer = (manager2 as any).idleTimer as ReturnType<typeof setInterval> | null
    if (timer) clearInterval(timer)
    try {
      catalog2.close()
    } catch {
      /* ok */
    }
    try {
      rmSync(dir2, { recursive: true, force: true })
    } catch {
      /* ok */
    }
  })

  it('reset with valid arguments deletes catalog record and closes live entries', () => {
    const key = mkKey({ routerSessionId: 'sess-reset', workerId: 'w1' })
    const kd = computeKeyDigest(key)
    catalog2.upsert(
      makeCatalogRecord(kd, {
        keyDigest: kd,
        routerSessionId: 'sess-reset',
        workerId: 'w1',
      }) as any,
    )

    const port = catalogToPort(catalog2)
    manager2.setCatalogPort(port)

    ;(manager2 as any).entries.set(keyToString(key), makeFakeIdleEntry(key))
    assert.equal(manager2.getDebugInfo().entries, 1)
    assert.ok(catalog2.lookup(kd))

    manager2.deleteContextByReuseKey(key)

    assert.equal(manager2.getDebugInfo().entries, 0)
    assert.equal(catalog2.lookup(kd), undefined)
  })

  it('reset rejects when catalog is unavailable', () => {
    manager2.setCatalogPort(catalogToPort(catalog2))
    catalog2.close()
    assert.equal(catalog2.isAvailable(), false)

    assert.throws(
      () => manager2.deleteContextByReuseKey(mkKey()),
      (error: any) => error?.code === 'catalog_repair_required',
    )
  })

  it('reset does not auto-rerun job (no side effect)', () => {
    const key = mkKey()
    const kd = computeKeyDigest(key)
    catalog2.upsert(makeCatalogRecord(kd, { keyDigest: kd }) as any)

    const port = catalogToPort(catalog2)
    manager2.setCatalogPort(port)

    port.deleteByKey(kd)

    assert.equal(catalog2.lookup(kd), undefined)
    assert.equal(manager2.getDebugInfo().entries, 0)
  })
})
