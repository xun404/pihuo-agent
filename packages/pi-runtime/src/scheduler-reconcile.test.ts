import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getSharedStore, globalActivityLog, resetSharedStoreForTests } from '@pihuo-agent/core'
import { WorkerScheduler } from './scheduler.js'
import { emitWorkerEvent, getWorkerEventEmitter } from './worker-events.js'

describe('WorkerScheduler.reconcileOrphanJobs', () => {
  let dir: string
  let prevState: string | undefined

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sched-reconcile-'))
    prevState = process.env.PIHUO_AGENT_AGENTS_STATE
    process.env.PIHUO_AGENT_AGENTS_STATE = join(dir, 'state.json')
    resetSharedStoreForTests()
    globalActivityLog.clear()
  })

  afterEach(() => {
    if (prevState !== undefined) process.env.PIHUO_AGENT_AGENTS_STATE = prevState
    else delete process.env.PIHUO_AGENT_AGENTS_STATE
    resetSharedStoreForTests()
    globalActivityLog.clear()
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

  it('uses Job-aware approval CAS and emits approval_resolved before RUNTIME_RESTARTED', () => {
    const store = getSharedStore({ mode: 'owner' })
    const project = store.upsertProject({ name: 'P', rootPath: dir })
    const session = store.createSession({ projectId: project.id, title: 'S' })
    const job = store.createJob({
      sessionId: session.id,
      projectId: project.id,
      workerId: 'w1',
      workerName: 'W',
      role: 'coder',
      task: 'left pending',
      cwd: dir,
      status: 'running',
      source: 'api',
    })
    const approval = store.createJobApproval({
      id: 'orphan-approval',
      jobId: job.id,
      sessionId: session.id,
      title: 'Permission',
      options: [{ optionId: 'reject', name: 'Reject', kind: 'reject_once' }],
    })
    emitWorkerEvent(job.id, {
      type: 'started',
      jobId: job.id,
      workerId: job.workerId,
      workerName: job.workerName,
      role: job.role,
    })

    const result = new WorkerScheduler().reconcileOrphanJobs()
    assert.deepEqual(result, { failed: 1, clearedApprovals: 1 })
    assert.equal(store.listApprovals().find((item) => item.id === approval.id)?.status, 'cancelled')
    assert.equal(store.getJob(job.id)?.errorCode, 'RUNTIME_RESTARTED')

    const events = getWorkerEventEmitter()
      .getJournal(job.id, 0)
      .map((entry) => entry.event)
    assert.deepEqual(
      events.map((event) => event.type),
      ['started', 'approval_resolved', 'failed'],
    )
    assert.equal(events[2]?.errorCode, 'RUNTIME_RESTARTED')
  })

  it('retries a residual orphan approval after a per-item CAS failure', () => {
    const store = getSharedStore({ mode: 'owner' })
    const project = store.upsertProject({ name: 'P', rootPath: dir })
    const session = store.createSession({ projectId: project.id, title: 'S' })
    const job = store.createJob({
      sessionId: session.id,
      projectId: project.id,
      workerId: 'w1',
      workerName: 'W',
      role: 'coder',
      task: 'left pending',
      cwd: dir,
      status: 'running',
      source: 'api',
    })
    const approval = store.createJobApproval({
      id: 'retry-orphan-approval',
      jobId: job.id,
      sessionId: session.id,
      title: 'Permission',
      options: [{ optionId: 'reject', name: 'Reject', kind: 'reject_once' }],
    })

    const originalTryResolve = store.tryResolveJobApproval.bind(store)
    let attempts = 0
    ;(store as any).tryResolveJobApproval = (...args: Parameters<typeof store.tryResolveJobApproval>) => {
      attempts += 1
      if (attempts === 1) throw new Error('/private/state.json')
      return originalTryResolve(...args)
    }

    try {
      const first = new WorkerScheduler().reconcileOrphanJobs()
      assert.deepEqual(first, { failed: 1, clearedApprovals: 0 })
      assert.equal(store.getJob(job.id)?.status, 'failed')
      assert.equal(store.listApprovals().find((item) => item.id === approval.id)?.status, 'pending')
      const cleanupFailure = globalActivityLog
        .list(50)
        .find((event) => event.message === 'Orphan approval cleanup failed')
      assert.ok(cleanupFailure)
      assert.equal(cleanupFailure.meta?.errorType, 'Error')
      assert.doesNotMatch(JSON.stringify(cleanupFailure), /private\/state\.json/u)

      // A later reconcile must inspect terminalized restart jobs as well; the
      // durable Approval cannot be left pending merely because the first CAS
      // attempt failed.
      const scheduler = new WorkerScheduler()
      const second = scheduler.reconcileOrphanJobs()
      assert.deepEqual(second, { failed: 0, clearedApprovals: 1 })
      assert.equal(store.listApprovals().find((item) => item.id === approval.id)?.status, 'cancelled')
      assert.equal(attempts, 2)
    } finally {
      ;(store as any).tryResolveJobApproval = originalTryResolve
    }
  })
})
