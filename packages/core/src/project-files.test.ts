import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { listProjectFiles } from './project-files.js'

describe('listProjectFiles', () => {
  let dir: string

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'ra-files-'))
    mkdirSync(join(dir, 'src'))
    writeFileSync(join(dir, 'src', 'index.ts'), 'export {}\n')
    writeFileSync(join(dir, 'README.md'), '# t\n')
    mkdirSync(join(dir, 'node_modules', 'pkg'), { recursive: true })
    writeFileSync(join(dir, 'node_modules', 'pkg', 'x.js'), '')
  })

  after(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('lists real children and skips node_modules', () => {
    const result = listProjectFiles(dir, { maxDepth: 2, maxEntries: 100 })
    assert.equal(result.ok, true)
    const names = result.entries.map((e) => e.name)
    assert.ok(names.includes('src'))
    assert.ok(names.includes('README.md'))
    assert.ok(!names.includes('node_modules'))
    const src = result.entries.find((e) => e.name === 'src')
    assert.equal(src?.type, 'directory')
    assert.ok(src?.children?.some((c) => c.name === 'index.ts'))
  })

  it('errors on missing path', () => {
    const result = listProjectFiles(join(dir, 'nope-missing'))
    assert.equal(result.ok, false)
    assert.ok(result.error)
  })
})
