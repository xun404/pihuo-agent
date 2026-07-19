import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { LocalStore } from './store.js'

describe('LocalStore zero-length file recovery', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ra-empty-store-'))
  const path = join(dir, 'state.json')

  after(() => {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* ok */
    }
  })

  it('isolates empty file and remains writable', () => {
    writeFileSync(path, '', { mode: 0o600 })
    const store = new LocalStore(path)
    // Must not be stuck in permanent corrupt refuse-write
    const project = store.upsertProject({ name: 'P', rootPath: join(dir, 'proj') })
    assert.ok(project.id)
    assert.ok(existsSync(path))
    const body = readdirSync(dir)
    assert.ok(
      body.some((f) => f.includes('corrupt') || f.includes('empty')),
      `expected isolated empty file, got ${body.join(',')}`,
    )
  })
})
