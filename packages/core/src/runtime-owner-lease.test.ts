import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  openSync,
  closeSync,
  fsyncSync,
  unlinkSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  acquireOwnerLease,
  type OwnerLeaseDeps,
  type OwnerLeaseFile,
} from './runtime-owner-lease.js'

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'owner-lease-test-'))
}

function writeLease(path: string, lease: OwnerLeaseFile): void {
  const fd = openSync(path, 'w', 0o600)
  try {
    writeFileSync(fd, JSON.stringify(lease, null, 2))
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

describe('RuntimeOwnerLease', () => {
  let dir: string
  let catalogPath: string
  let leasePath: string
  let clock: number
  let alive: Map<number, boolean>
  let startedAt: Map<number, string>
  let deps: OwnerLeaseDeps

  beforeEach(() => {
    dir = tmpDir()
    catalogPath = join(dir, 'sessions.json')
    leasePath = `${catalogPath}.owner`
    clock = Date.parse('2026-07-15T12:00:00.000Z')
    alive = new Map([[1001, true]])
    startedAt = new Map([[1001, '2026-07-15T11:00:00.000Z']])
    deps = {
      now: () => clock,
      pid: 1001,
      processStartedAt: '2026-07-15T11:00:00.000Z',
      isProcessAlive: (pid) => alive.get(pid) ?? false,
      getProcessStartedAt: (pid) => startedAt.get(pid) ?? null,
      staleMs: 30_000,
    }
  })

  afterEach(() => {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* ok */
    }
  })

  it('allows only one exclusive owner for the same catalog path', () => {
    const first = acquireOwnerLease(catalogPath, deps)
    assert.equal(first.ok, true)
    if (!first.ok) return

    const second = acquireOwnerLease(catalogPath, {
      ...deps,
      pid: 2002,
      processStartedAt: '2026-07-15T11:30:00.000Z',
    })
    assert.equal(second.ok, false)
    if (second.ok) return
    assert.equal(second.errorCode, 'RUNTIME_OWNER_EXISTS')

    first.lease.release()
  })

  it('does not steal while pid is alive and heartbeat fresh', () => {
    const first = acquireOwnerLease(catalogPath, deps)
    assert.equal(first.ok, true)
    if (!first.ok) return

    clock += 10_000
    const second = acquireOwnerLease(catalogPath, {
      ...deps,
      pid: 2002,
      processStartedAt: '2026-07-15T11:30:00.000Z',
    })
    assert.equal(second.ok, false)
    if (second.ok) return
    assert.equal(second.errorCode, 'RUNTIME_OWNER_EXISTS')
    assert.equal(existsSync(leasePath), true)

    first.lease.release()
  })

  it('does not steal while pid is alive even if heartbeat is stale', () => {
    const first = acquireOwnerLease(catalogPath, deps)
    assert.equal(first.ok, true)
    if (!first.ok) return

    clock += 60_000
    const second = acquireOwnerLease(catalogPath, {
      ...deps,
      pid: 2002,
      processStartedAt: '2026-07-15T11:30:00.000Z',
    })
    assert.equal(second.ok, false)
    if (second.ok) return
    assert.equal(second.errorCode, 'RUNTIME_OWNER_EXISTS')

    first.lease.release()
  })

  it('takes over when pid dead and heartbeat expired', () => {
    const first = acquireOwnerLease(catalogPath, deps)
    assert.equal(first.ok, true)
    if (!first.ok) return
    // Simulate crash: do not release, mark pid dead
    alive.set(1001, false)
    clock += 60_000

    const second = acquireOwnerLease(catalogPath, {
      ...deps,
      pid: 2002,
      processStartedAt: '2026-07-15T12:01:00.000Z',
    })
    assert.equal(second.ok, true)
    if (!second.ok) return

    second.lease.release()
  })

  it('recovers from stale takeover mutex left by crashed competitor', () => {
    // Simulate crash-after-mutex: leave .takeover without completing lease create
    const mutexPath = `${leasePath}.takeover`
    writeFileSync(
      mutexPath,
      JSON.stringify({
        pid: 9999,
        processStartedAt: '2026-07-15T10:00:00.000Z',
        token: 'deadbeef',
        at: new Date(clock - 60_000).toISOString(),
      }),
    )
    alive.set(9999, false)
    const r = acquireOwnerLease(catalogPath, deps)
    assert.equal(r.ok, true, 'stale mutex must not permanently block takeover')
    if (r.ok) r.lease.release()
  })

  it('does not steal takeover mutex from live same-identity holder even if wall-clock stale', () => {
    // Dead owner lease is takeable, but a live competitor holds the takeover mutex.
    writeLease(leasePath, {
      version: 1,
      pid: 9991,
      processStartedAt: '2026-07-15T10:00:00.000Z',
      ownerTokenHash: 'dead',
      createdAt: new Date(clock - 120_000).toISOString(),
      heartbeatAt: new Date(clock - 120_000).toISOString(),
    })
    alive.set(9991, false)

    const mutexPath = `${leasePath}.takeover`
    const holderStart = '2026-07-15T11:00:00.000Z'
    writeFileSync(
      mutexPath,
      JSON.stringify({
        pid: 4242,
        processStartedAt: holderStart,
        token: 'live-token',
        at: new Date(clock - 60_000).toISOString(), // past TAKEOVER_STALE_MS wall-clock
      }),
    )
    alive.set(4242, true)
    startedAt.set(4242, holderStart)

    const r = acquireOwnerLease(catalogPath, {
      ...deps,
      pid: 5555,
      processStartedAt: '2026-07-15T12:00:00.000Z',
    })
    assert.equal(r.ok, false, 'must not steal from live same-identity mutex holder')
    assert.equal(existsSync(mutexPath), true)
  })

  it('treats fresh empty/partial takeover mutex as occupied during takeover', () => {
    writeLease(leasePath, {
      version: 1,
      pid: 9992,
      processStartedAt: '2026-07-15T10:00:00.000Z',
      ownerTokenHash: 'dead',
      createdAt: new Date(clock - 120_000).toISOString(),
      heartbeatAt: new Date(clock - 120_000).toISOString(),
    })
    alive.set(9992, false)

    const mutexPath = `${leasePath}.takeover`
    // Partial write: empty file with fresh wall-clock mtime
    writeFileSync(mutexPath, '')
    const r = acquireOwnerLease(catalogPath, {
      ...deps,
      pid: 5556,
      processStartedAt: '2026-07-15T12:00:00.000Z',
    })
    assert.equal(r.ok, false, 'fresh empty mutex must block takeover')
  })

  it('release requires exact mutex token (foreign token does not delete)', () => {
    const first = acquireOwnerLease(catalogPath, deps)
    assert.equal(first.ok, true)
    if (!first.ok) return
    first.lease.release()
    const second = acquireOwnerLease(catalogPath, {
      ...deps,
      pid: 2002,
      processStartedAt: '2026-07-15T12:01:00.000Z',
    })
    assert.equal(second.ok, true)
    if (second.ok) second.lease.release()
  })

  it('two real Node child processes: only one becomes owner (barrier)', async () => {
    const { spawn } = await import('node:child_process')
    const { fileURLToPath } = await import('node:url')
    const barrier = join(dir, 'barrier')
    const releaseHold = join(dir, 'release-hold')
    const leaseMod = join(fileURLToPath(new URL('.', import.meta.url)), 'runtime-owner-lease.ts')
    const scriptPath = join(dir, 'compete.mjs')
    writeFileSync(
      scriptPath,
      `
import { writeFileSync, existsSync } from 'node:fs'
import { acquireOwnerLease } from ${JSON.stringify(leaseMod)}
const catalogPath = process.env.CATALOG
const barrier = process.env.BARRIER
const releaseHold = process.env.RELEASE_HOLD
const resultFile = process.env.RESULT_FILE
const t0 = Date.now()
while (!existsSync(barrier) && Date.now() - t0 < 8000) {
  await new Promise(r => setTimeout(r, 5))
}
const r = acquireOwnerLease(catalogPath)
const label = r.ok ? 'OWNER' : 'CLIENT'
writeFileSync(resultFile, label)
process.stdout.write(label + '\\n')
if (r.ok) {
  // Hold lease until parent signals release so the other child cannot take over mid-test
  const t1 = Date.now()
  while (!existsSync(releaseHold) && Date.now() - t1 < 10000) {
    await new Promise(r => setTimeout(r, 20))
  }
  r.lease.release()
}
process.exit(0)
`,
    )
    const resultA = join(dir, 'result-a')
    const resultB = join(dir, 'result-b')
    const run = (resultFile: string) =>
      new Promise<string>((resolve, reject) => {
        const child = spawn(process.execPath, ['--import', 'tsx', scriptPath], {
          env: {
            ...process.env,
            CATALOG: catalogPath,
            BARRIER: barrier,
            RELEASE_HOLD: releaseHold,
            RESULT_FILE: resultFile,
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        })
        let out = ''
        child.stdout?.on('data', (d) => (out += d))
        child.stderr?.on('data', (d) => (out += d))
        child.on('exit', (code) => {
          if (code !== 0) reject(new Error(`child exit ${code}: ${out}`))
          else resolve(out.trim())
        })
      })
    const p1 = run(resultA)
    const p2 = run(resultB)
    await new Promise((r) => setTimeout(r, 80))
    writeFileSync(barrier, 'go')
    // Wait until both wrote result files while winner still holds lease
    const tWait = Date.now()
    while ((!existsSync(resultA) || !existsSync(resultB)) && Date.now() - tWait < 8000) {
      await new Promise((r) => setTimeout(r, 20))
    }
    writeFileSync(releaseHold, 'go')
    await Promise.all([p1, p2])
    // Across processes, existence can become visible after open/truncate but
    // before the synchronous write's bytes are observable. Read only after
    // both children have exited so the result snapshots cannot be partial.
    const a = existsSync(resultA) ? readFileSync(resultA, 'utf8') : ''
    const b = existsSync(resultB) ? readFileSync(resultB, 'utf8') : ''
    const labels = [a, b]
    assert.equal(
      labels.filter((x) => x === 'OWNER').length,
      1,
      `exactly one OWNER, got ${JSON.stringify(labels)}`,
    )
    assert.equal(
      labels.filter((x) => x === 'CLIENT').length,
      1,
      `exactly one CLIENT, got ${JSON.stringify(labels)}`,
    )
  })

  it('takes over when same pid number but different start-time and heartbeat expired', () => {
    const first = acquireOwnerLease(catalogPath, deps)
    assert.equal(first.ok, true)
    if (!first.ok) return

    // PID recycled: same number, different start time
    startedAt.set(1001, '2026-07-15T12:00:30.000Z')
    clock += 60_000

    const second = acquireOwnerLease(catalogPath, {
      ...deps,
      pid: 1001,
      processStartedAt: '2026-07-15T12:00:30.000Z',
    })
    assert.equal(second.ok, true)
    if (!second.ok) return

    second.lease.release()
  })

  it('release only deletes lease when owner token matches', () => {
    const first = acquireOwnerLease(catalogPath, deps)
    assert.equal(first.ok, true)
    if (!first.ok) return

    const raw = JSON.parse(readFileSync(leasePath, 'utf8')) as OwnerLeaseFile
    writeLease(leasePath, {
      ...raw,
      ownerTokenHash: 'not-the-original-hash',
    })

    first.lease.release()
    assert.equal(existsSync(leasePath), true)

    // Clean up for afterEach
    try {
      unlinkSync(leasePath)
    } catch {
      /* ok */
    }
  })

  it('second acquire returns RUNTIME_OWNER_EXISTS', () => {
    const first = acquireOwnerLease(catalogPath, deps)
    assert.equal(first.ok, true)
    if (!first.ok) return

    const second = acquireOwnerLease(catalogPath, {
      ...deps,
      pid: 9999,
      processStartedAt: '2026-07-15T11:59:00.000Z',
    })
    assert.deepEqual(second, { ok: false, errorCode: 'RUNTIME_OWNER_EXISTS' })

    first.lease.release()
  })

  it('heartbeat updates heartbeatAt without changing owner token hash', () => {
    const first = acquireOwnerLease(catalogPath, deps)
    assert.equal(first.ok, true)
    if (!first.ok) return

    const before = JSON.parse(readFileSync(leasePath, 'utf8')) as OwnerLeaseFile
    clock += 5_000
    first.lease.heartbeat()
    const after = JSON.parse(readFileSync(leasePath, 'utf8')) as OwnerLeaseFile

    assert.equal(after.ownerTokenHash, before.ownerTokenHash)
    assert.equal(after.pid, before.pid)
    assert.notEqual(after.heartbeatAt, before.heartbeatAt)
    assert.equal(after.heartbeatAt, new Date(clock).toISOString())

    first.lease.release()
  })

  it('release deletes lease when token still matches', () => {
    const first = acquireOwnerLease(catalogPath, deps)
    assert.equal(first.ok, true)
    if (!first.ok) return
    first.lease.release()
    assert.equal(existsSync(leasePath), false)
  })
})
