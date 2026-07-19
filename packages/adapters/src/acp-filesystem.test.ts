import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  resolveContainedPath,
  resolveContainedParent,
  readContainedText,
  writeContainedText,
} from './acp-filesystem.js'

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
