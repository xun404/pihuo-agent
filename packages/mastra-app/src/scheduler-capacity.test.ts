import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getSharedStore, resetSharedStoreForTests } from '@swarmdesk-agent/core'
import * as schedulerModule from './scheduler.js'
import { getWorkerEventEmitter } from './worker-events.js'

afterEach(() => {
  resetSharedStoreForTests()
})

describe('capacityRetryDelay', () => {
  it('retries capacity exhaustion with a bounded positive delay', () => {
    const fn = (schedulerModule as Record<string, unknown>).capacityRetryDelay
    assert.equal(typeof fn, 'function')
    assert.equal(
      (fn as (error: string | undefined, raw?: string) => number | null)(
        'capacity_exhausted',
        '25',
      ),
      25,
    )
    assert.equal(
      (fn as (error: string | undefined, raw?: string) => number | null)(
        'capacity_exhausted',
        '25.9',
      ),
      25,
    )
    assert.equal(
      (fn as (error: string | undefined, raw?: string) => number | null)(
        'capacity_exhausted',
        '-1',
      ),
      250,
    )
    assert.equal(
      (fn as (error: string | undefined, raw?: string) => number | null)(
        'capacity_exhausted',
        '999999999999',
      ),
      2_147_483_647,
    )
  })

  it('does not retry ordinary worker failures', () => {
    const fn = (schedulerModule as Record<string, unknown>).capacityRetryDelay
    assert.equal(typeof fn, 'function')
    assert.equal(
      (fn as (error: string | undefined, raw?: string) => number | null)('transport failed', '25'),
      null,
    )
  })
})

describe('Worker queue timeout', () => {
  it('reads the immutable timeout snapshot from Job metadata', () => {
    const timeouts = {
      jobTimeoutMs: 1_200_000,
      queueTimeoutMs: 900_000,
    }
    const snapshot = schedulerModule.workerTimeoutSnapshotFromJob({
      meta: { workerTimeouts: timeouts },
    })
    assert.deepEqual(snapshot, timeouts)
  })

  it('terminalizes an expired queued Job with a stable error code', () => {
    const dir = mkdtempSync(join(tmpdir(), 'scheduler-queue-timeout-'))
    const previousState = process.env.SWARMDESK_AGENT_AGENTS_STATE
    process.env.SWARMDESK_AGENT_AGENTS_STATE = join(dir, 'state.json')
    resetSharedStoreForTests()
    try {
      const store = getSharedStore({ mode: 'owner' })
      const project = store.upsertProject({ name: 'P', rootPath: dir })
      const session = store.createSession({ projectId: project.id, title: 'S' })
      const job = store.createJob({
        sessionId: session.id,
        projectId: project.id,
        workerId: 'worker-1',
        workerName: 'Worker',
        task: 'wait',
        cwd: dir,
        source: 'api',
        status: 'queued',
        meta: {
          workerTimeouts: {
            jobTimeoutMs: 600_000,
            queueTimeoutMs: 60_000,
          },
        },
      })
      const scheduler = new schedulerModule.WorkerScheduler()
      ;(scheduler as unknown as { expireQueuedJobs: (nowMs: number) => void }).expireQueuedJobs(
        Date.parse(job.createdAt) + 60_001,
      )

      const terminal = store.getJob(job.id)!
      assert.equal(terminal.status, 'timed_out')
      assert.equal(terminal.errorCode, 'WORKER_QUEUE_TIMEOUT')
      assert.equal(getWorkerEventEmitter().getJournal(job.id, 0).at(-1)?.event.type, 'timed_out')
    } finally {
      if (previousState === undefined) delete process.env.SWARMDESK_AGENT_AGENTS_STATE
      else process.env.SWARMDESK_AGENT_AGENTS_STATE = previousState
      resetSharedStoreForTests()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('checks the durable queued state before a capacity retry can write queued again', () => {
    const source = readFileSync(new URL('./scheduler.ts', import.meta.url), 'utf8')
    const sessionCapacityBranch = source.indexOf('if (!sessionMgr.canAccept(reuseKey))')
    const durableStateCheck = source.indexOf('const latestQueued = store().getJob(jobId)')
    assert.ok(durableStateCheck >= 0)
    assert.ok(sessionCapacityBranch >= 0)
    assert.ok(
      durableStateCheck < sessionCapacityBranch,
      'queue timeout/cancel must win before capacity_exhausted writes queued status',
    )
  })

  it('pauses idle Job timer in pending_approval and re-arms a full window after resume', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'scheduler-active-timeout-'))
    const previousState = process.env.SWARMDESK_AGENT_AGENTS_STATE
    process.env.SWARMDESK_AGENT_AGENTS_STATE = join(dir, 'state.json')
    resetSharedStoreForTests()
    try {
      const store = getSharedStore({ mode: 'owner' })
      const project = store.upsertProject({ name: 'P', rootPath: dir })
      const session = store.createSession({ projectId: project.id, title: 'S' })
      const job = store.createJob({
        sessionId: session.id,
        projectId: project.id,
        workerId: 'worker-1',
        workerName: 'Worker',
        task: 'pause',
        cwd: dir,
        source: 'api',
        status: 'running',
      })
      const scheduler = new schedulerModule.WorkerScheduler()
      let fired = 0
      const internals = scheduler as unknown as {
        runtime: Map<
          string,
          {
            abort: AbortController
            timeout?: ReturnType<typeof setTimeout>
            timeoutPaused?: boolean
            timeoutDurationMs?: number
          }
        >
        startJobTimeout: (jobId: string, durationMs: number, handler: () => void) => void
        pauseJobTimeout: (jobId: string) => void
        pauseWhilePersistingApproval: <T>(jobId: string, persist: () => T) => T
        resumeJobTimeout: (jobId: string) => void
        touchJobTimeout: (jobId: string) => void
      }
      internals.runtime.set(job.id, { abort: new AbortController() })
      internals.startJobTimeout(job.id, 50, () => {
        fired += 1
      })
      internals.pauseJobTimeout(job.id)
      await new Promise((resolve) => setTimeout(resolve, 80))
      assert.equal(fired, 0, 'pending approval must not consume idle Job time')
      assert.equal(internals.runtime.get(job.id)?.timeout, undefined)
      assert.equal(internals.runtime.get(job.id)?.timeoutPaused, true)

      internals.resumeJobTimeout(job.id)
      assert.equal(internals.runtime.get(job.id)?.timeoutPaused, false)
      await new Promise((resolve) => setTimeout(resolve, 100))
      assert.equal(fired, 1, 'fresh idle window after approval must eventually fire without ACP activity')

      // ACP activity re-arms a full idle window (no cumulative wall-clock burn).
      fired = 0
      internals.startJobTimeout(job.id, 60, () => {
        fired += 1
      })
      await new Promise((resolve) => setTimeout(resolve, 40))
      internals.touchJobTimeout(job.id)
      await new Promise((resolve) => setTimeout(resolve, 40))
      assert.equal(fired, 0, 'activity must reset the idle Job timer')
      await new Promise((resolve) => setTimeout(resolve, 40))
      assert.equal(fired, 1, 'idle timeout fires only after a full silent window')

      // A failed waiter reservation / durable Approval create must restore the
      // idle timer because no pending_approval transition became durable.
      let failed = false
      internals.startJobTimeout(job.id, 40, () => {
        failed = true
      })
      assert.throws(
        () =>
          internals.pauseWhilePersistingApproval(job.id, () => {
            throw new Error('disk full')
          }),
        /disk full/,
      )
      await new Promise((resolve) => setTimeout(resolve, 80))
      assert.equal(failed, true, 'failed Approval persistence must not leave the Job timer paused')
    } finally {
      if (previousState === undefined) delete process.env.SWARMDESK_AGENT_AGENTS_STATE
      else process.env.SWARMDESK_AGENT_AGENTS_STATE = previousState
      resetSharedStoreForTests()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
