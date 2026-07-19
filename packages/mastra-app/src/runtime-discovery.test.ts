import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  existsSync,
  mkdtempSync,
  rmSync,
  statSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  writeRuntimeDiscovery,
  readRuntimeDiscovery,
  clearRuntimeDiscovery,
  resolveDesktopToken,
  resolveInternalToken,
  resolveStudioToken,
  RuntimeDiscoveryError,
} from './runtime-discovery.js'

describe('runtime discovery', () => {
  let dir: string
  let path: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'runtime-discovery-'))
    path = join(dir, 'runtime.json')
  })

  afterEach(() => {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* ok */
    }
  })

  it('writes mode 0600 runtime.json with three distinct capability tokens', () => {
    const result = writeRuntimeDiscovery({
      path,
      port: 4111,
      pid: 12345,
      startedAt: '2026-07-15T12:00:00.000Z',
      workspaceId: 'a'.repeat(64),
    })
    assert.equal(result.port, 4111)
    assert.equal(result.pid, 12345)
    assert.equal(result.startedAt, '2026-07-15T12:00:00.000Z')
    assert.equal(result.workspaceId, 'a'.repeat(64))
    assert.equal(typeof result.token, 'string')
    assert.ok(result.token.length >= 32)
    assert.equal(result.version, 3)
    assert.equal(resolveInternalToken(result), result.internalToken)
    assert.equal(resolveDesktopToken(result), result.desktopToken)
    assert.equal(resolveStudioToken(result), result.studioToken)
    assert.equal(new Set([result.internalToken, result.desktopToken, result.studioToken]).size, 3)

    const loaded = readRuntimeDiscovery(path)
    assert.ok(loaded)
    assert.equal(loaded!.port, 4111)
    assert.equal(loaded!.pid, 12345)
    assert.equal(loaded!.token, result.token)
    assert.equal(loaded!.studioToken, result.studioToken)
    assert.equal(loaded!.workspaceId, 'a'.repeat(64))

    if (process.platform !== 'win32') {
      const mode = statSync(path).mode & 0o777
      assert.equal(mode, 0o600)
    }
  })

  it('rotates token on each write', () => {
    const first = writeRuntimeDiscovery({
      path,
      port: 4111,
      pid: 1,
      startedAt: '2026-07-15T12:00:00.000Z',
    })
    const second = writeRuntimeDiscovery({
      path,
      port: 4111,
      pid: 1,
      startedAt: '2026-07-15T12:01:00.000Z',
    })
    assert.notEqual(first.token, second.token)
    assert.notEqual(first.studioToken, second.studioToken)
    const loaded = readRuntimeDiscovery(path)
    assert.equal(loaded!.token, second.token)
  })

  it('rejects a v3 discovery record with missing or shared capability tokens', () => {
    const common = {
      version: 3,
      port: 4111,
      pid: 42,
      startedAt: '2026-07-15T12:00:00.000Z',
      ownerEpoch: '42:2026-07-15T12:00:00.000Z',
      token: 'i'.repeat(32),
      internalToken: 'i'.repeat(32),
      desktopToken: 'd'.repeat(32),
    }
    writeFileSync(path, JSON.stringify(common))
    assert.equal(readRuntimeDiscovery(path), null)

    writeFileSync(
      path,
      JSON.stringify({
        ...common,
        studioToken: common.desktopToken,
      }),
    )
    assert.equal(readRuntimeDiscovery(path), null)
  })

  it('fails closed when callers explicitly collapse token boundaries', () => {
    assert.throws(
      () =>
        writeRuntimeDiscovery({
          path,
          port: 4111,
          internalToken: 'x'.repeat(32),
          desktopToken: 'x'.repeat(32),
          studioToken: 's'.repeat(32),
        }),
      (error: unknown) =>
        error instanceof RuntimeDiscoveryError && error.code === 'RUNTIME_TOKEN_BOUNDARY_INVALID',
    )
  })

  it('never includes token in error messages', () => {
    const written = writeRuntimeDiscovery({
      path,
      port: 4111,
      pid: 1,
      startedAt: '2026-07-15T12:00:00.000Z',
    })
    const err = new RuntimeDiscoveryError('SWARMDESK_AGENT_RUNTIME_UNAVAILABLE', 'runtime unavailable')
    assert.equal(err.message, 'runtime unavailable')
    assert.equal(err.code, 'SWARMDESK_AGENT_RUNTIME_UNAVAILABLE')
    assert.ok(!err.message.includes(written.token))
    assert.ok(!String(err).includes(written.token))
    // read of invalid path must not throw token-bearing errors
    const bad = readRuntimeDiscovery(dir)
    assert.equal(bad, null)
  })

  it('clear removes runtime.json only when pid matches', () => {
    writeRuntimeDiscovery({ path, port: 4111, pid: 42, startedAt: '2026-07-15T12:00:00.000Z' })
    clearRuntimeDiscovery(path, 99)
    assert.equal(existsSync(path), true)
    clearRuntimeDiscovery(path, 42)
    assert.equal(existsSync(path), false)
  })

  it('cleans its temporary file when atomic replacement fails', () => {
    mkdirSync(path)
    assert.throws(() => writeRuntimeDiscovery({ path, port: 4111 }))
    assert.equal(
      readdirSync(dir).some((name) => name.startsWith('runtime.json.tmp.')),
      false,
    )
  })
})
