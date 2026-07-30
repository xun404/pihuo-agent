import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  symlinkSync,
  rmSync,
  unlinkSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import * as filesystem from './acp-filesystem.js'

const { resolveContainedPath, resolveContainedParent, readContainedText, writeContainedText } =
  filesystem

describe('ACP filesystem permission API', () => {
  it('exports unrestricted reads and permission-gated writes', () => {
    assert.equal(typeof filesystem.readAcpTextFile, 'function')
    assert.equal(typeof filesystem.writeAcpTextFileWithPermission, 'function')
  })

  it('reads ordinary files outside the project while preserving size and file checks', () => {
    const root = mkdtempSync(join(tmpdir(), 'acp-read-root-'))
    const outside = mkdtempSync(join(tmpdir(), 'acp-read-outside-'))
    try {
      const file = join(outside, 'public.txt')
      writeFileSync(file, 'outside content')
      const result = filesystem.readAcpTextFile(root, file)
      assert.equal(result.ok, true)
      if (result.ok) assert.equal(result.content, 'outside content')

      mkdirSync(join(outside, 'directory'))
      assert.equal(filesystem.readAcpTextFile(root, join(outside, 'directory')).ok, false)
      assert.equal(filesystem.readAcpTextFile(root, file, 2).ok, false)
    } finally {
      rmSync(root, { recursive: true, force: true })
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('writes project-local files without asking permission', async () => {
    const root = mkdtempSync(join(tmpdir(), 'acp-write-local-'))
    try {
      let asked = false
      const result = await filesystem.writeAcpTextFileWithPermission({
        projectRoot: root,
        target: 'local.txt',
        content: 'local',
        requestPermission: async () => {
          asked = true
          return { outcome: 'cancelled' as const }
        },
      })
      assert.equal(result.ok, true)
      assert.equal(asked, false)
      assert.equal(readFileSync(join(root, 'local.txt'), 'utf8'), 'local')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('asks with one-shot synthetic options before writing outside the project', async () => {
    const root = mkdtempSync(join(tmpdir(), 'acp-write-root-'))
    const outside = mkdtempSync(join(tmpdir(), 'acp-write-outside-'))
    try {
      const target = join(outside, 'approved.txt')
      let captured: Record<string, unknown> | undefined
      const result = await filesystem.writeAcpTextFileWithPermission({
        projectRoot: root,
        target,
        content: 'approved',
        requestPermission: async (request) => {
          captured = request as unknown as Record<string, unknown>
          return { outcome: 'selected' as const, optionId: 'router_fs_allow_once' }
        },
      })

      assert.equal(result.ok, true)
      assert.equal(readFileSync(target, 'utf8'), 'approved')
      assert.equal(captured?.source, 'client_fs')
      assert.equal(captured?.kind, 'edit')
      assert.deepEqual(
        (captured?.options as Array<{ optionId: string; kind: string }>).map((option) => [
          option.optionId,
          option.kind,
        ]),
        [
          ['router_fs_allow_once', 'allow_once'],
          ['router_fs_reject_once', 'reject_once'],
        ],
      )
      assert.equal('rawInput' in (captured ?? {}), false)
      assert.equal('rawOutput' in (captured ?? {}), false)
      assert.equal('_meta' in (captured ?? {}), false)
    } finally {
      rmSync(root, { recursive: true, force: true })
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('does not write outside on rejection, cancellation, or a missing callback', async () => {
    const root = mkdtempSync(join(tmpdir(), 'acp-write-deny-root-'))
    const outside = mkdtempSync(join(tmpdir(), 'acp-write-deny-outside-'))
    try {
      const rejected = join(outside, 'rejected.txt')
      const cancelled = join(outside, 'cancelled.txt')
      const unbound = join(outside, 'unbound.txt')
      let requestCount = 0
      const rejectResult = await filesystem.writeAcpTextFileWithPermission({
        projectRoot: root,
        target: rejected,
        content: 'no',
        requestPermission: async () => {
          requestCount++
          return {
            outcome: 'selected' as const,
            optionId: 'router_fs_reject_once',
          }
        },
      })
      const cancelResult = await filesystem.writeAcpTextFileWithPermission({
        projectRoot: root,
        target: cancelled,
        content: 'no',
        requestPermission: async () => {
          requestCount++
          return { outcome: 'cancelled' as const }
        },
      })
      const unboundResult = await filesystem.writeAcpTextFileWithPermission({
        projectRoot: root,
        target: unbound,
        content: 'no',
      })

      assert.equal(rejectResult.ok, false)
      assert.equal(cancelResult.ok, false)
      assert.equal(unboundResult.ok, false)
      assert.equal(requestCount, 2)
      assert.equal(existsSync(rejected), false)
      assert.equal(existsSync(cancelled), false)
      assert.equal(existsSync(unbound), false)
    } finally {
      rmSync(root, { recursive: true, force: true })
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('rejects an approved write when its symlink target changes before I/O', async () => {
    const root = mkdtempSync(join(tmpdir(), 'acp-write-race-root-'))
    const outsideA = mkdtempSync(join(tmpdir(), 'acp-write-race-a-'))
    const outsideB = mkdtempSync(join(tmpdir(), 'acp-write-race-b-'))
    const link = join(root, 'external')
    symlinkSync(outsideA, link)
    try {
      let asked = false
      const result = await filesystem.writeAcpTextFileWithPermission({
        projectRoot: root,
        target: join(link, 'changed.txt'),
        content: 'must not land',
        requestPermission: async () => {
          asked = true
          unlinkSync(link)
          symlinkSync(outsideB, link)
          return { outcome: 'selected' as const, optionId: 'router_fs_allow_once' }
        },
      })
      assert.equal(result.ok, false)
      assert.equal(asked, true)
      assert.equal(existsSync(join(outsideA, 'changed.txt')), false)
      assert.equal(existsSync(join(outsideB, 'changed.txt')), false)
    } finally {
      rmSync(root, { recursive: true, force: true })
      rmSync(outsideA, { recursive: true, force: true })
      rmSync(outsideB, { recursive: true, force: true })
    }
  })
})

describe('resolveContainedPath', () => {
  let tmp: string
  let inside: string
  let outside: string

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'fs-test-'))
    inside = join(tmp, 'inside')
    outside = join(tmpdir(), 'fs-test-outside')
    mkdirSync(inside, { recursive: true })
    mkdirSync(outside, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
    try {
      rmSync(outside, { recursive: true, force: true })
    } catch {}
  })

  it('resolves direct child', () => {
    writeFileSync(join(inside, 'f.txt'), 'hi')
    const r = resolveContainedPath(inside, 'f.txt')
    assert.equal(r.ok, true)
    if (r.ok) {
      assert.ok(r.resolved.endsWith('f.txt'))
    }
  })

  it('rejects ../ escape', () => {
    writeFileSync(join(outside, 'esc.txt'), 'x')
    const r = resolveContainedPath(inside, '../outside/esc.txt')
    assert.equal(r.ok, false)
  })

  it('rejects absolute outside path', () => {
    writeFileSync(join(outside, 'esc.txt'), 'x')
    const r = resolveContainedPath(inside, join(tmpdir(), 'fs-test-outside/esc.txt'))
    assert.equal(r.ok, false)
  })

  it('rejects null bytes', () => {
    const r = resolveContainedPath(inside, 'foo\0bar')
    assert.equal(r.ok, false)
  })

  it('rejects empty target', () => {
    const r = resolveContainedPath(inside, '')
    assert.equal(r.ok, false)
  })

  it('rejects missing file', () => {
    const r = resolveContainedPath(inside, 'nowhere')
    assert.equal(r.ok, false)
  })

  it('rejects symlink escaping cwd', () => {
    writeFileSync(join(outside, 'esc.txt'), 'x')
    symlinkSync(join(outside, 'esc.txt'), join(inside, 'link'))
    const r = resolveContainedPath(inside, 'link')
    assert.equal(r.ok, false)
  })
})

describe('readContainedText', () => {
  let tmp: string
  let cwd: string

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'fs-read-'))
    cwd = join(tmp, 'cwd')
    mkdirSync(cwd, { recursive: true })
  })

  afterEach(() => rmSync(tmp, { recursive: true, force: true }))

  it('reads a file inside cwd', () => {
    writeFileSync(join(cwd, 'hello.txt'), 'world')
    const r = readContainedText(cwd, 'hello.txt')
    assert.equal(r.ok, true)
    if (r.ok) assert.equal(r.content, 'world')
  })

  it('rejects directories', () => {
    mkdirSync(join(cwd, 'dir'))
    const r = readContainedText(cwd, 'dir')
    assert.equal(r.ok, false)
  })

  it('rejects oversized file', () => {
    const buf = Buffer.alloc(2000, 'a')
    writeFileSync(join(cwd, 'big.txt'), buf)
    const r = readContainedText(cwd, 'big.txt', 1000)
    assert.equal(r.ok, false)
    if (!r.ok) assert.match(r.error, /exceeds/i)
  })
})

describe('writeContainedText', () => {
  let tmp: string
  let cwd: string

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'fs-write-'))
    cwd = join(tmp, 'cwd')
    mkdirSync(cwd, { recursive: true })
  })

  afterEach(() => rmSync(tmp, { recursive: true, force: true }))

  it('writes a file inside cwd', () => {
    const r = writeContainedText(cwd, 'new.txt', 'data')
    assert.equal(r.ok, true)
  })

  it('rejects ../ escape on write', () => {
    const r = writeContainedText(cwd, '../outside.txt', 'data')
    assert.equal(r.ok, false)
  })

  it('rejects oversized content', () => {
    const r = writeContainedText(cwd, 'big.txt', 'x'.repeat(2000), 1000)
    assert.equal(r.ok, false)
  })
})
