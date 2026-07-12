import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import { LocalStore } from './store.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('LocalStore jobs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ra-jobs-'))
  const path = join(dir, 'state.json')
  const store = new LocalStore(path)

  after(() => {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  it('creates and updates jobs; recomputes session status', () => {
    const project = store.upsertProject({
      name: 'P',
      rootPath: join(dir, 'proj'),
    })
    const session = store.createSession({
      projectId: project.id,
      title: 'S',
    })

    const job = store.createJob({
      sessionId: session.id,
      projectId: project.id,
      workerId: 'w1',
      workerName: 'W',
      task: 'do thing',
      cwd: project.rootPath,
      source: 'api',
      status: 'queued',
    })
    assert.equal(job.status, 'queued')
    assert.equal(store.getJob(job.id)?.status, 'queued')

    store.updateJob(job.id, {
      status: 'running',
      startedAt: new Date().toISOString(),
    })
    const s1 = store.snapshot().sessions.find((x) => x.id === session.id)
    assert.equal(s1?.status, 'running')

    store.updateJob(job.id, {
      status: 'succeeded',
      finishedAt: new Date().toISOString(),
      output: 'ok',
    })
    const s2 = store.snapshot().sessions.find((x) => x.id === session.id)
    assert.equal(s2?.status, 'idle')
  })
})
