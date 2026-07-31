import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import {
  parseGitStatusPorcelain,
  parseGitNumstat,
  parseGitNumstatByPath,
  getGitStatus,
  getGitFileDiff,
  resolveRepoRelativePath,
} from './git-status.js'

describe('parseGitStatusPorcelain', () => {
  it('parses modified, added, untracked, and renames', () => {
    const raw = [
      ' M src/a.ts',
      'M  src/b.ts',
      'A  src/new.ts',
      '?? untracked.md',
      'R  old.ts -> new-name.ts',
      ' D gone.ts',
    ].join('\n')
    const files = parseGitStatusPorcelain(raw)
    assert.ok(files.some((f) => f.path === 'src/a.ts'))
    assert.ok(files.some((f) => f.path === 'untracked.md' && f.status === '??'))
    assert.ok(files.some((f) => f.path === 'new-name.ts'))
    assert.ok(files.some((f) => f.path === 'gone.ts'))
  })
})

describe('parseGitNumstat', () => {
  it('sums insertions and deletions', () => {
    const raw = '10\t2\ta.ts\n3\t0\tb.ts\n-\t-\tbin.png\n'
    const r = parseGitNumstat(raw)
    assert.equal(r.insertions, 13)
    assert.equal(r.deletions, 2)
  })
})

describe('parseGitNumstatByPath', () => {
  it('maps per-path stats and merges renames to new path', () => {
    const raw = '10\t2\tsrc/a.ts\n1\t1\told.ts => new.ts\n-\t-\tbin.png\n'
    const m = parseGitNumstatByPath(raw)
    assert.deepEqual(m.get('src/a.ts'), { insertions: 10, deletions: 2 })
    assert.deepEqual(m.get('new.ts'), { insertions: 1, deletions: 1 })
    assert.deepEqual(m.get('bin.png'), { insertions: 0, deletions: 0 })
  })
})

describe('getGitStatus real repo', () => {
  let dir: string

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'ra-git-'))
    execFileSync('git', ['init'], { cwd: dir })
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir })
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir })
    writeFileSync(join(dir, 'hello.txt'), 'hello\n')
    execFileSync('git', ['add', 'hello.txt'], { cwd: dir })
    execFileSync('git', ['commit', '-m', 'init'], { cwd: dir })
    writeFileSync(join(dir, 'hello.txt'), 'hello world\n')
    writeFileSync(join(dir, 'extra.txt'), 'extra\n')
  })

  after(() => {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  it('returns changed files from real git working tree', async () => {
    const status = await getGitStatus(dir)
    assert.equal(status.ok, true)
    assert.equal(status.isRepo, true)
    assert.ok(status.files.length >= 1)
    const paths = status.files.map((f) => f.path)
    assert.ok(paths.includes('hello.txt') || paths.includes('extra.txt'))
    assert.ok(typeof status.insertions === 'number')
    assert.ok(typeof status.deletions === 'number')
    const hello = status.files.find((f) => f.path === 'hello.txt')
    if (hello) {
      assert.ok((hello.insertions ?? 0) + (hello.deletions ?? 0) > 0)
    }
  })

  it('returns structured failure for non-repo path', async () => {
    const bare = mkdtempSync(join(tmpdir(), 'ra-nogit-'))
    try {
      const status = await getGitStatus(bare)
      assert.equal(status.ok, false)
      assert.equal(status.isRepo, false)
      assert.ok(status.error)
    } finally {
      rmSync(bare, { recursive: true, force: true })
    }
  })

  it('getGitFileDiff returns patch for modified tracked file', async () => {
    const diff = await getGitFileDiff(dir, 'hello.txt')
    assert.equal(diff.ok, true)
    assert.equal(diff.isUntracked, false)
    assert.ok(diff.patch.includes('hello') || diff.patch.includes('+'), diff.patch.slice(0, 200))
  })

  it('getGitFileDiff handles untracked file as add', async () => {
    const diff = await getGitFileDiff(dir, 'extra.txt')
    assert.equal(diff.ok, true)
    assert.equal(diff.isUntracked, true)
    assert.ok(diff.patch.includes('+') || diff.insertions > 0, diff.patch.slice(0, 200))
  })

  it('resolveRepoRelativePath rejects traversal', () => {
    const bad = resolveRepoRelativePath('/repo', '../etc/passwd')
    assert.equal(bad.ok, false)
  })
})
