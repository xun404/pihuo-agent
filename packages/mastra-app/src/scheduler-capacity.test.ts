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
      approvalTimeoutMs: 180_000,
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
            approvalTimeoutMs: 120_000,
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
})
