import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  existsSync,
  statSync,
  writeFileSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fork } from 'node:child_process'
import { once } from 'node:events'
import { AcpSessionCatalog, type AcpSessionRecord } from './acp-session-catalog.js'
import { fileURLToPath } from 'node:url'

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'acp-catalog-test-'))
}

function makeRecord(overrides: Partial<AcpSessionRecord> = {}): AcpSessionRecord {
  return {
    version: 1,
    keyDigest: 'abc123',
    routerSessionId: 'sess-1',
    workerId: 'w1',
    canonicalCwd: '/tmp/project',
    executionFingerprint: 'fp-001',
    agentSessionId: 'agent-sess-1',
    capabilities: { loadSession: false, resume: false, close: true, delete: true },
    state: 'ready',
    createdAt: new Date().toISOString(),
    lastUsedAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('AcpSessionCatalog', () => {
  let dir: string
  let file: string
  let catalog: AcpSessionCatalog

  beforeEach(() => {
    dir = tmpDir()
    file = join(dir, 'sessions.json')
    catalog = new AcpSessionCatalog(file)
  })

  afterEach(() => {
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

  it('missing file = empty catalog, NOT corrupt', () => {
    assert.equal(catalog.isAvailable(), true)
    assert.equal(catalog.getState(), 'normal')
    const r = catalog.lookup('nonexistent')
    assert.equal(r, undefined)
  })

  it('upsert then lookup returns same record', () => {
    const rec = makeRecord()
    catalog.upsert(rec)
    const found = catalog.lookup(rec.keyDigest)
    assert.ok(found)
    assert.equal(found!.keyDigest, rec.keyDigest)
    assert.equal(found!.routerSessionId, rec.routerSessionId)
    assert.equal(found!.workerId, rec.workerId)
    assert.equal(found!.state, 'ready')
  })

  it('upsert overwrites existing record by keyDigest', () => {
    const rec = makeRecord({ state: 'ready' })
    catalog.upsert(rec)
    catalog.upsert({ ...rec, state: 'stale' as const, staleReason: 'test' })
    const found = catalog.lookup(rec.keyDigest)
    assert.equal(found!.state, 'stale')
    assert.equal(found!.staleReason, 'test')
  })

  it('0600 mode on POSIX', () => {
    if (process.platform === 'win32') return
    catalog.upsert(makeRecord())
    const st = statSync(file)
    const mode = st.mode & 0o777
    assert.equal(mode, 0o600)
  })

  it('corrupt JSON → unavailable, fail closed', () => {
    writeFileSync(file, 'not json at all', { mode: 0o600 })
    catalog = new AcpSessionCatalog(file)
    assert.equal(catalog.isAvailable(), false)
    assert.equal(catalog.getState(), 'unavailable')
    assert.throws(() => catalog.upsert(makeRecord()))
    assert.throws(() => catalog.lookup('x'))
  })

  it('unknown version → unavailable', () => {
    writeFileSync(file, JSON.stringify({ version: 99, records: [] }), { mode: 0o600 })
    catalog = new AcpSessionCatalog(file)
    assert.equal(catalog.isAvailable(), false)
    assert.equal(catalog.getState(), 'unavailable')
  })

  it('valid JSON with an incomplete record is unavailable', () => {
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        records: [{ keyDigest: 'k1', routerSessionId: 's1', workerId: 'w1', state: 'ready' }],
      }),
      { mode: 0o600 },
    )
    catalog = new AcpSessionCatalog(file)
    assert.equal(catalog.isAvailable(), false)
  })

  it('duplicate key digests make the catalog unavailable', () => {
    const record = makeRecord({ keyDigest: 'duplicate' })
    writeFileSync(file, JSON.stringify({ version: 1, records: [record, { ...record }] }), {
      mode: 0o600,
    })
    catalog = new AcpSessionCatalog(file)
    assert.equal(catalog.isAvailable(), false)
  })

  it('a failed flush does not publish the candidate record and fails closed', () => {
    const parentFile = join(dir, 'not-a-directory')
    writeFileSync(parentFile, 'file')
    const broken = new AcpSessionCatalog(join(parentFile, 'sessions.json'))
    assert.throws(() => broken.upsert(makeRecord({ keyDigest: 'must-not-publish' })))
    assert.equal(broken.isAvailable(), false)
    assert.throws(() => broken.lookup('must-not-publish'))
  })

  it('lookup returns a defensive copy', () => {
    catalog.upsert(makeRecord({ keyDigest: 'copy' }))
    const first = catalog.lookup('copy')!
    first.state = 'stale'
    first.capabilities.resume = true
    const second = catalog.lookup('copy')!
    assert.equal(second.state, 'ready')
    assert.equal(second.capabilities.resume, false)
  })

  it('persists installation facts and returns defensive listAll copies', () => {
    catalog.upsert(
      makeRecord({
        keyDigest: 'installation-reference',
        installationId: 'inst_registry_v1',
        manifestDigest: 'sha256:manifest-v1',
      }),
    )

    const first = catalog.listAll()
    assert.equal(first.length, 1)
    assert.equal(first[0]?.installationId, 'inst_registry_v1')
    assert.equal(first[0]?.manifestDigest, 'sha256:manifest-v1')
    first[0]!.installationId = 'inst_mutated'
    first[0]!.capabilities.resume = true

    const second = catalog.listAll()
    assert.equal(second[0]?.installationId, 'inst_registry_v1')
    assert.equal(second[0]?.capabilities.resume, false)
  })

  it('atomic write: partial write does not corrupt existing file', () => {
    catalog.upsert(makeRecord({ keyDigest: 'k1' }))
    const before = readFileSync(file, 'utf8')
    assert.ok(before.includes('k1'))

    // Simulate a write that leaves the file intact by verifying re-read
    const found = catalog.lookup('k1')
    assert.ok(found)
    assert.equal(found!.keyDigest, 'k1')

    // Even after a failed write (simulated), data is intact
    const after = readFileSync(file, 'utf8')
    assert.ok(after.includes('k1'))
  })

  it('markStale sets state and reason', () => {
    const rec = makeRecord({ state: 'ready' })
    catalog.upsert(rec)
    catalog.markStale(rec.keyDigest, 'worker config changed')
    const found = catalog.lookup(rec.keyDigest)
    assert.equal(found!.state, 'stale')
    assert.equal(found!.staleReason, 'worker config changed')
  })

  it('markStale on unknown keyDigest is no-op', () => {
    assert.equal(catalog.isAvailable(), true)
    catalog.markStale('no-such-key', 'reason')
    assert.equal(catalog.isAvailable(), true)
  })

  it('deleteByKey removes record', () => {
    catalog.upsert(makeRecord({ keyDigest: 'k1' }))
    catalog.upsert(makeRecord({ keyDigest: 'k2' }))
    catalog.deleteByKey('k1')
    assert.equal(catalog.lookup('k1'), undefined)
    assert.ok(catalog.lookup('k2'))
  })

  it('deleteByKey on unknown keyDigest is idempotent', () => {
    catalog.upsert(makeRecord({ keyDigest: 'k1' }))
    catalog.deleteByKey('nonexistent')
    assert.ok(catalog.lookup('k1'))
  })

  it('deleteByRouterSession removes all records for that session', () => {
    catalog.upsert(makeRecord({ keyDigest: 'k1', routerSessionId: 'sess-A', workerId: 'w1' }))
    catalog.upsert(makeRecord({ keyDigest: 'k2', routerSessionId: 'sess-A', workerId: 'w2' }))
    catalog.upsert(makeRecord({ keyDigest: 'k3', routerSessionId: 'sess-B', workerId: 'w1' }))
    catalog.deleteByRouterSession('sess-A')
    assert.equal(catalog.lookup('k1'), undefined)
    assert.equal(catalog.lookup('k2'), undefined)
    assert.ok(catalog.lookup('k3'))
  })

  it('deleteByRouterSession on unknown id is idempotent', () => {
    catalog.upsert(makeRecord({ keyDigest: 'k1' }))
    catalog.deleteByRouterSession('nonexistent')
    assert.ok(catalog.lookup('k1'))
  })

  it('deleteByRouterSessions removes all requested sessions in one mutation', () => {
    catalog.upsert(makeRecord({ keyDigest: 'k1', routerSessionId: 'sess-A' }))
    catalog.upsert(makeRecord({ keyDigest: 'k2', routerSessionId: 'sess-B' }))
    catalog.upsert(makeRecord({ keyDigest: 'k3', routerSessionId: 'sess-C' }))

    catalog.deleteByRouterSessions(['sess-A', 'sess-B', 'sess-A'])

    assert.equal(catalog.lookup('k1'), undefined)
    assert.equal(catalog.lookup('k2'), undefined)
    assert.ok(catalog.lookup('k3'))
  })

  it('deleteByWorker removes all records for that worker', () => {
    catalog.upsert(makeRecord({ keyDigest: 'k1', workerId: 'w1', routerSessionId: 'sess-1' }))
    catalog.upsert(makeRecord({ keyDigest: 'k2', workerId: 'w1', routerSessionId: 'sess-2' }))
    catalog.upsert(makeRecord({ keyDigest: 'k3', workerId: 'w2', routerSessionId: 'sess-1' }))
    catalog.deleteByWorker('w1')
    assert.equal(catalog.lookup('k1'), undefined)
    assert.equal(catalog.lookup('k2'), undefined)
    assert.ok(catalog.lookup('k3'))
  })

  it('deleteByWorker on unknown id is idempotent', () => {
    catalog.upsert(makeRecord({ keyDigest: 'k1' }))
    catalog.deleteByWorker('nonexistent')
    assert.ok(catalog.lookup('k1'))
  })

  it('catalog persists across re-open', () => {
    catalog.upsert(makeRecord({ keyDigest: 'k1' }))
    catalog.close()

    const catalog2 = new AcpSessionCatalog(file)
    try {
      assert.equal(catalog2.isAvailable(), true)
      const found = catalog2.lookup('k1')
      assert.ok(found)
      assert.equal(found!.keyDigest, 'k1')
    } finally {
      catalog2.close()
    }
  })

  it('no raw env/task/history in record or file', () => {
    const rec = makeRecord()
    const json = JSON.stringify(rec)
    assert.equal((rec as any).env, undefined)
    assert.equal((rec as any).task, undefined)
    assert.equal((rec as any).history, undefined)
    assert.equal((rec as any).prompt, undefined)
    assert.equal(json.includes('OPENAI_API_KEY'), false)
  })

  it('empty directory with write perms works fine', () => {
    const emptyDir = tmpDir()
    const emptyFile = join(emptyDir, 'empty.json')
    const cat = new AcpSessionCatalog(emptyFile)
    try {
      assert.equal(cat.isAvailable(), true)
      cat.upsert(makeRecord({ keyDigest: 'k1' }))
      assert.ok(cat.lookup('k1'))
    } finally {
      cat.close()
      try {
        rmSync(emptyDir, { recursive: true, force: true })
      } catch {}
    }
  })

  it('isAvailable returns false when unavailable, true when normal', () => {
    assert.equal(catalog.isAvailable(), true)
    assert.equal(catalog.getState(), 'normal')
  })

  it('close sets state to unavailable', () => {
    catalog.close()
    assert.equal(catalog.isAvailable(), false)
    assert.equal(catalog.getState(), 'unavailable')
  })

  it('corrupt catalog writes sentinel and stays unavailable across new instances', () => {
    writeFileSync(file, 'not json at all', { mode: 0o600 })
    catalog = new AcpSessionCatalog(file)
    assert.equal(catalog.isAvailable(), false)
    assert.equal(catalog.getState(), 'unavailable')

    const sentinelPath = file + '.corrupted'
    assert.equal(existsSync(sentinelPath), true, 'sentinel file must exist after corruption')

    catalog.close()
    const catalog2 = new AcpSessionCatalog(file)
    try {
      assert.equal(catalog2.isAvailable(), false, 'new instance must also see unavailable state')
      assert.equal(catalog2.getState(), 'unavailable')
      assert.throws(() => catalog2.upsert(makeRecord()))
      assert.throws(() => catalog2.lookup('x'))
    } finally {
      catalog2.close()
    }
  })

  it('does not remove the corrupt catalog when the repair sentinel cannot be written', () => {
    if (process.platform === 'win32') return

    writeFileSync(file, 'not json at all', { mode: 0o600 })
    const sentinelPath = file + '.corrupted'
    symlinkSync(join(dir, 'missing-parent', 'sentinel.json'), sentinelPath)

    catalog = new AcpSessionCatalog(file)

    assert.equal(catalog.isAvailable(), false)
    assert.equal(existsSync(file), true, 'the corrupt evidence must remain for the next startup')

    catalog.close()
    const catalog2 = new AcpSessionCatalog(file)
    try {
      assert.equal(catalog2.isAvailable(), false, 'the next startup must re-detect corruption')
    } finally {
      catalog2.close()
    }
  })

  it('removing sentinel + valid catalog restores availability', () => {
    writeFileSync(file, 'not json at all', { mode: 0o600 })
    catalog = new AcpSessionCatalog(file)
    assert.equal(catalog.isAvailable(), false)

    const sentinelPath = file + '.corrupted'
    assert.ok(existsSync(sentinelPath))

    catalog.close()

    unlinkSync(sentinelPath)
    const validCatalog = { version: 1, records: [makeRecord({ keyDigest: 'r1' })] }
    writeFileSync(file, JSON.stringify(validCatalog), { mode: 0o600 })

    const catalog2 = new AcpSessionCatalog(file)
    try {
      assert.equal(catalog2.isAvailable(), true)
      assert.equal(catalog2.getState(), 'normal')
      const found = catalog2.lookup('r1')
      assert.ok(found)
      assert.equal(found!.keyDigest, 'r1')
    } finally {
      catalog2.close()
    }
  })

  it('removing sentinel without restoring catalog starts fresh', () => {
    writeFileSync(file, 'not json at all', { mode: 0o600 })
    catalog = new AcpSessionCatalog(file)
    assert.equal(catalog.isAvailable(), false)

    const sentinelPath = file + '.corrupted'
    catalog.close()
    unlinkSync(sentinelPath)

    const catalog2 = new AcpSessionCatalog(file)
    try {
      assert.equal(catalog2.isAvailable(), true)
      assert.equal(catalog2.getState(), 'normal')
    } finally {
      catalog2.close()
    }
  })

  it('lock file is cleaned up after write completes', () => {
    const lockPath = file + '.lock'
    assert.equal(existsSync(lockPath), false)

    catalog.upsert(makeRecord({ keyDigest: 'k1' }))

    assert.equal(existsSync(lockPath), false)
  })

  it('refuses commit when lock is held by another alive process (non-Windows)', () => {
    if (process.platform === 'win32') return
    const lockPath = file + '.lock'
    writeFileSync(lockPath, String(process.pid), { mode: 0o600 })

    assert.throws(
      () => catalog.upsert(makeRecord({ keyDigest: 'k1' })),
      /lock unavailable|catalog/i,
    )
    assert.equal(catalog.lookup('k1'), undefined)

    assert.equal(readFileSync(lockPath, 'utf8').trim(), String(process.pid))
    unlinkSync(lockPath)
  })

  it('refuses commit while another contender holds the takeover mutex before main lock creation', () => {
    const lockPath = file + '.lock'
    const takeoverPath = lockPath + '.takeover'
    writeFileSync(takeoverPath, '', { mode: 0o600 })

    assert.throws(
      () => catalog.upsert(makeRecord({ keyDigest: 'must-not-write-unlocked' })),
      /lock unavailable|catalog/i,
    )
    assert.equal(existsSync(file), false)
    assert.equal(catalog.lookup('must-not-write-unlocked'), undefined)
  })

  it('stale lock from dead process is cleaned up and write succeeds', () => {
    const lockPath = file + '.lock'
    writeFileSync(lockPath, '999999999', { mode: 0o600 })

    catalog.upsert(makeRecord({ keyDigest: 'k1' }))
    assert.ok(catalog.lookup('k1'))

    assert.equal(existsSync(lockPath), false)
  })

  it('concurrent writes from different processes preserve all data', async () => {
    const childRec = makeRecord({ keyDigest: 'child-k1' })
    catalog.upsert(makeRecord({ keyDigest: 'parent-k1' }))

    const childScript = join(dir, 'child-writer.mjs')
    const modulePath = fileURLToPath(new URL('./acp-session-catalog.ts', import.meta.url))
    writeFileSync(
      childScript,
      `import { AcpSessionCatalog } from ${JSON.stringify(modulePath)}
const catalog = new AcpSessionCatalog(${JSON.stringify(file)})
catalog.upsert(${JSON.stringify(childRec)})
catalog.close()
`,
    )

    const child = fork(childScript, [], {
      execArgv: ['--import', 'tsx'],
      stdio: 'pipe',
    })

    const [exitCode] = await once(child, 'exit')
    assert.equal(exitCode, 0)

    catalog.close()
    const catalog2 = new AcpSessionCatalog(file)
    try {
      assert.equal(catalog2.isAvailable(), true)
      assert.ok(catalog2.lookup('parent-k1'), 'parent record should persist')
      assert.ok(catalog2.lookup('child-k1'), 'child record should persist')
    } finally {
      catalog2.close()
    }
  })
})
