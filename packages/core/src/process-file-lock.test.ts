import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  getProcessStartIdentity,
  tryAcquireProcessFileLock,
  releaseProcessFileLock,
} from './process-file-lock.js'

describe('tryAcquireProcessFileLock', () => {
  let dir: string
  let lockPath: string
  let clock: number
  let alive: Map<number, boolean>
  let startedAt: Map<number, string>

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'proc-lock-'))
    lockPath = join(dir, 'file.lock')
    clock = Date.parse('2026-07-15T12:00:00.000Z')
    alive = new Map([[1001, true]])
    startedAt = new Map([[1001, '2026-07-15T11:00:00.000Z']])
  })

  afterEach(() => {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* ok */
    }
  })

  const deps = () => ({
    now: () => clock,
    pid: 1001,
    processStartedAt: '2026-07-15T11:00:00.000Z',
    isProcessAlive: (pid: number) => alive.get(pid) ?? false,
    getProcessStartedAt: (pid: number) => startedAt.get(pid) ?? null,
    staleMs: 15_000,
  })

  it('exclusive create succeeds when free', () => {
    const h = tryAcquireProcessFileLock(lockPath, deps())
    assert.ok(h)
    assert.ok(existsSync(lockPath))
    h!.release()
    assert.equal(existsSync(lockPath), false)
  })

  it('second acquire fails while first holds', () => {
    const a = tryAcquireProcessFileLock(lockPath, deps())
    assert.ok(a)
    const b = tryAcquireProcessFileLock(lockPath, {
      ...deps(),
      pid: 2002,
      processStartedAt: '2026-07-15T12:00:00.000Z',
    })
    assert.equal(b, null)
    a!.release()
  })

  it('fresh empty lock is treated as occupied', () => {
    writeFileSync(lockPath, '')
    const h = tryAcquireProcessFileLock(lockPath, deps())
    assert.equal(h, null)
  })

  it('does not steal from live same-identity holder even if wall-clock stale', () => {
    writeFileSync(
      lockPath,
      JSON.stringify({
        pid: 4242,
        processStartedAt: '2026-07-15T11:00:00.000Z',
        token: 'live',
        at: new Date(clock - 60_000).toISOString(),
      }),
    )
    alive.set(4242, true)
    startedAt.set(4242, '2026-07-15T11:00:00.000Z')
    const h = tryAcquireProcessFileLock(lockPath, {
      ...deps(),
      pid: 5555,
      processStartedAt: '2026-07-15T12:00:00.000Z',
    })
    assert.equal(h, null)
    assert.equal(existsSync(lockPath), true)
  })

  it('fails closed when the holder pid is alive but its start identity is unavailable', () => {
    writeFileSync(
      lockPath,
      JSON.stringify({
        pid: 4242,
        processStartedAt: 'opaque-start-identity',
        token: 'live-unknown-start',
        at: new Date(clock - 60_000).toISOString(),
      }),
    )
    alive.set(4242, true)
    const h = tryAcquireProcessFileLock(lockPath, {
      ...deps(),
      pid: 5555,
      processStartedAt: 'contender',
      getProcessStartedAt: () => null,
    })
    assert.equal(h, null)
    assert.equal(existsSync(lockPath), true)
  })

  it('reclaims dead holder past grace', () => {
    writeFileSync(
      lockPath,
      JSON.stringify({
        pid: 9999,
        processStartedAt: '2026-07-15T10:00:00.000Z',
        token: 'dead',
        at: new Date(clock - 60_000).toISOString(),
      }),
    )
    alive.set(9999, false)
    const h = tryAcquireProcessFileLock(lockPath, deps())
    assert.ok(h)
    h!.release()
  })

  it('release requires exact token', () => {
    const h = tryAcquireProcessFileLock(lockPath, deps())
    assert.ok(h)
    releaseProcessFileLock(lockPath, 'wrong-token')
    assert.equal(existsSync(lockPath), true)
    const body = JSON.parse(readFileSync(lockPath, 'utf8')) as { token: string }
    releaseProcessFileLock(lockPath, body.token)
    assert.equal(existsSync(lockPath), false)
  })

  it('uses a stable OS process-start identity on supported platforms', () => {
    if (process.platform !== 'linux' && process.platform !== 'darwin') return
    const first = getProcessStartIdentity(process.pid)
    const second = getProcessStartIdentity(process.pid)
    assert.ok(first)
    assert.equal(second, first)
  })
})
