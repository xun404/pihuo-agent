import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { LocalStore } from './store.js'

describe('Project memory switch persistence', () => {
  let dir: string
  let statePath: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ra-project-memory-'))
    statePath = join(dir, 'state.json')
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('backfills legacy projects to enabled without changing their identity', () => {
    writeFileSync(
      statePath,
      JSON.stringify({
        projects: [
          {
            id: 'project-legacy',
            name: 'Legacy project',
            rootPath: join(dir, 'project'),
            workerIds: [],
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        sessions: [],
        workers: [],
        approvals: [],
        jobs: [],
      }),
    )

    const snapshot = new LocalStore(statePath).snapshot()
    assert.equal(snapshot.projects[0]?.id, 'project-legacy')
    assert.equal(snapshot.projects[0]?.memoryEnabled, true)
  })

  it('persists the switch and only updates the selected project', () => {
    const store = new LocalStore(statePath)
    const first = store.upsertProject({ name: 'First', rootPath: join(dir, 'first') })
    const second = store.upsertProject({ name: 'Second', rootPath: join(dir, 'second') })

    const updated = store.setProjectMemoryEnabled(first.id, false)
    assert.equal(updated.memoryEnabled, false)
    assert.equal(store.snapshot().projects.find((p) => p.id === second.id)?.memoryEnabled, true)

    const raw = JSON.parse(readFileSync(statePath, 'utf8')) as {
      projects: Array<{ id: string; memoryEnabled?: boolean }>
    }
    assert.equal(raw.projects.find((p) => p.id === first.id)?.memoryEnabled, false)
    assert.throws(
      () => store.setProjectMemoryEnabled('project-missing', true),
      /Project not found/u,
    )
  })
})
