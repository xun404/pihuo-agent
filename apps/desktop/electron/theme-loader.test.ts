import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { loadCustomThemeFiles, MAX_THEME_FILE_BYTES, MAX_THEME_FILES } from './theme-loader.js'

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'pihuo-themes-'))
}

describe('custom theme loader', () => {
  it('returns an empty result when the directory is missing', () => {
    const result = loadCustomThemeFiles(join(tempDir(), 'missing'))
    assert.deepEqual(result.themes, [])
    assert.equal(result.errors.length, 0)
  })

  it('loads valid json, isolates malformed json, and skips non-json files', () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'valid.json'), '{"metadata":{"id":"custom"}}')
    writeFileSync(join(dir, 'broken.json'), '{')
    writeFileSync(join(dir, 'notes.txt'), '{}')

    const result = loadCustomThemeFiles(dir)
    assert.deepEqual(result.themes.map((theme) => theme.filename), ['valid.json'])
    assert.equal(result.errors.length, 1)
    assert.equal(result.errors[0]?.filename, 'broken.json')
  })

  it('bounds oversized files and the number of candidates', () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'large.json'), 'x'.repeat(MAX_THEME_FILE_BYTES + 1))
    for (let i = 0; i < MAX_THEME_FILES + 2; i += 1) {
      writeFileSync(join(dir, `theme-${String(i).padStart(3, '0')}.json`), '{}')
    }

    const result = loadCustomThemeFiles(dir)
    assert.ok(result.skipped >= 3)
    assert.ok(result.errors.some((error) => error.filename === 'large.json'))
    assert.ok(result.themes.length <= MAX_THEME_FILES)
  })

  it('does not follow directory or file symlinks', () => {
    const dir = tempDir()
    const outside = tempDir()
    writeFileSync(join(outside, 'outside.json'), '{}')
    mkdirSync(join(outside, 'nested'))
    writeFileSync(join(outside, 'nested', 'nested.json'), '{}')
    symlinkSync(join(outside, 'outside.json'), join(dir, 'linked.json'))
    symlinkSync(join(outside, 'nested'), join(dir, 'linked-dir'))

    const result = loadCustomThemeFiles(dir)
    assert.deepEqual(result.themes, [])
    assert.equal(result.errors.length, 0)
    assert.equal(result.skipped, 1)
  })
})

