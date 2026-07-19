import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getSharedStore, resetSharedStoreForTests } from '@router-agents/core'
import { WorkerScheduler } from './scheduler.js'
import { getWorkerEventEmitter } from './worker-events.js'
import type { WorkerJob } from '@router-agents/shared'

describe('WorkerScheduler terminal persistence and shutdown admission', () => {
  let dir: string
  let previousState: string | undefined

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'scheduler-lifecycle-'))
    previousState = process.env.ROUTER_AGENTS_STATE
    process.env.ROUTER_AGENTS_STATE = join(dir, 'state.json')
    resetSharedStoreForTests()
  })

  afterEach(() => {
    if (previousState === undefined) delete process.env.ROUTER_AGENTS_STATE
    else process.env.ROUTER_AGENTS_STATE = previousState
    resetSharedStoreForTests()
    rmSync(dir, { recursive: true, force: true })
  })

  function createJob(status: WorkerJob['status']): WorkerJob {
    const store = getSharedStore({ mode: 'owner' })
    const project = store.upsertProject({ name: 'P', rootPath: dir })
    const session = store.createSession({ projectId: project.id, title: 'S' })
    return store.createJob({
      sessionId: session.id,
      projectId: project.id,
      workerId: 'worker-1',
      workerName: 'Worker',
      role: 'coder',
      task: 'work',
      cwd: dir,
      source: 'api',
      status,
    })
  }

  it('persists queued cancellation before publishing the terminal event', async () => {
    const store = getSharedStore({ mode: 'owner' })
    const scheduler = new WorkerScheduler()
    const job = createJob('queued')
    const observed: string[] = []
    getWorkerEventEmitter().subscribe(job.id, (event) => {
      if (event.type === 'cancelled') observed.push(store.getJob(job.id)?.status ?? 'missing')
    })

    await scheduler.cancel(job.id)
    assert.deepEqual(observed, ['cancelled'])
  })

  it('persists running cancellation before publishing and retains no queued admission', async () => {
    const store = getSharedStore({ mode: 'owner' })
    const scheduler = new WorkerScheduler()
    const job = createJob('running')
    const observed: string[] = []
    getWorkerEventEmitter().subscribe(job.id, (event) => {
      if (event.type === 'cancelled') observed.push(store.getJob(job.id)?.status ?? 'missing')
    })

    await scheduler.cancel(job.id)
    assert.deepEqual(observed, ['cancelled'])
  })

  it('persists shutdown cancellation before publishing its terminal event', async () => {
    const store = getSharedStore({ mode: 'owner' })
    const scheduler = new WorkerScheduler()
    const job = createJob('queued')
    const observed: string[] = []
    getWorkerEventEmitter().subscribe(job.id, (event) => {
      if (event.type === 'cancelled') observed.push(store.getJob(job.id)?.status ?? 'missing')
    })

    await scheduler.shutdown({ deadlineMs: 20 })
    assert.deepEqual(observed, ['cancelled'])
    assert.equal(scheduler.getLifecycleState(), 'closed')
  })

  it('rejects new work once shutdown starts and leaves no queued orphan', async () => {
    const store = getSharedStore({ mode: 'owner' })
    const scheduler = new WorkerScheduler()
    const shutdown = scheduler.shutdown({ deadlineMs: 20 })
    await assert.rejects(
      scheduler.enqueue({ task: 'too late', cwd: dir }),
      /RUNTIME_(SHUTTING_DOWN|CLOSED)/,
    )
    await shutdown
    assert.equal(store.listJobs({ status: 'queued' }).length, 0)
  })
})
