import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getSharedStore, resetSharedStoreForTests } from '@swarmdesk-agent/core'
import { WorkerScheduler } from './scheduler.js'

describe('WorkerScheduler.reconcileOrphanJobs', () => {
  let dir: string
  let prevState: string | undefined

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sched-reconcile-'))
    prevState = process.env.SWARMDESK_AGENT_AGENTS_STATE
    process.env.SWARMDESK_AGENT_AGENTS_STATE = join(dir, 'state.json')
    resetSharedStoreForTests()
  })

  afterEach(() => {
    if (prevState !== undefined) process.env.SWARMDESK_AGENT_AGENTS_STATE = prevState
    else delete process.env.SWARMDESK_AGENT_AGENTS_STATE
    resetSharedStoreForTests()
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* ok */
    }
  })

  it('marks durable running jobs without runtime entry as failed RUNTIME_RESTARTED', () => {
    const store = getSharedStore({ mode: 'owner' })
    const project = store.upsertProject({ name: 'P', rootPath: dir })
    const session = store.createSession({ projectId: project.id, title: 'S' })

    const orphan = store.createJob({
      sessionId: session.id,
      projectId: project.id,
      workerId: 'w1',
      workerName: 'W',
      role: 'coder',
      task: 'left running',
      cwd: dir,
      status: 'running',
      source: 'api',
      startedAt: new Date().toISOString(),
    })
    const queued = store.createJob({
      sessionId: session.id,
      projectId: project.id,
      workerId: 'w1',
      workerName: 'W',
      role: 'coder',
      task: 'still queued',
      cwd: dir,
      status: 'queued',
      source: 'api',
    })

    const sched = new WorkerScheduler()
    const result = sched.reconcileOrphanJobs()
    assert.equal(result.failed, 1)

    const afterOrphan = store.getJob(orphan.id)!
    const afterQueued = store.getJob(queued.id)!
    assert.equal(afterOrphan.status, 'failed')
    assert.match(afterOrphan.error ?? '', /RUNTIME_RESTARTED/)
    assert.equal(afterQueued.status, 'queued', 'queued jobs must remain queued')
  })

  it('is idempotent', () => {
    const store = getSharedStore({ mode: 'owner' })
    const project = store.upsertProject({ name: 'P', rootPath: dir })
    const session = store.createSession({ projectId: project.id, title: 'S' })
    store.createJob({
      sessionId: session.id,
      projectId: project.id,
      workerId: 'w1',
      workerName: 'W',
      role: 'coder',
      task: 'running',
      cwd: dir,
      status: 'running',
      source: 'api',
    })

    const sched = new WorkerScheduler()
    assert.equal(sched.reconcileOrphanJobs().failed, 1)
    assert.equal(sched.reconcileOrphanJobs().failed, 0)
  })
})
