import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  ApprovalWaitRegistry,
  LocalStore,
  globalApprovalWaiters,
  getSharedStore,
  resetSharedStoreForTests,
} from '@pihuo-agent/core'
import { AcpSessionRuntimeError } from '@pihuo-agent/adapters'
import * as schedulerModule from './scheduler.js'
import { getWorkerEventEmitter } from './worker-events.js'

describe('scheduler detached run boundary', () => {
  it('routes a rejected runJob promise into the terminal failure handler', async () => {
    const scheduler = new schedulerModule.WorkerScheduler()
    const observed: Array<{ jobId: string; error: unknown }> = []
    ;(scheduler as any).runJob = async () => {
      throw new Error('startup failure')
    }
    ;(scheduler as any).handleRunJobFailure = (jobId: string, error: unknown) => {
      observed.push({ jobId, error })
    }

    ;(scheduler as any).launchJob('job-detached')
    await new Promise((resolve) => setImmediate(resolve))

    assert.equal(observed.length, 1)
    assert.equal(observed[0]?.jobId, 'job-detached')
    assert.match(String(observed[0]?.error), /startup failure/)
  })
})

// ---------------------------------------------------------------------------
// Tests: ApprovalWaitRegistry — waiter registration, settle, cancel
// ---------------------------------------------------------------------------

describe('ApprovalWaitRegistry — waiter registration before persistence', () => {
  it('register resolves on settle', async () => {
    const reg = new ApprovalWaitRegistry()
    const p = reg.register('appr_1')
    setTimeout(() => reg.settle('appr_1', 'allow', 'opt-1'), 10)
    const result = await p
    assert.equal(result.outcome, 'selected')
    if (result.outcome === 'selected') {
      assert.equal(result.decision, 'allow')
      assert.equal(result.optionId, 'opt-1')
    }
  })

  it('does not manufacture a future waiter result when settle had no waiter', async () => {
    const reg = new ApprovalWaitRegistry()
    assert.equal(reg.settle('appr_2', 'allow', 'opt-2'), false)
    const outcome = await Promise.race([
      reg.register('appr_2').then(() => 'unexpected' as const),
      new Promise<'not-settled'>((resolve) => setTimeout(() => resolve('not-settled'), 20)),
    ])
    reg.clear()
    assert.equal(outcome, 'not-settled')
  })

  it('dual settle: second is ignored', async () => {
    const reg = new ApprovalWaitRegistry()
    const p = reg.register('appr_3')
    setTimeout(() => {
      reg.settle('appr_3', 'allow', 'first')
      const secondOk = reg.settle('appr_3', 'deny')
      assert.equal(secondOk, false)
    }, 10)
    const result = await p
    assert.equal(result.outcome, 'selected')
  })

  it('cancel rejects waiter', async () => {
    const reg = new ApprovalWaitRegistry()
    const p = reg.register('appr_4')
    setTimeout(() => reg.cancel('appr_4', 'system cancel'), 10)
    await assert.rejects(p, /system cancel/)
  })

  it('cancelMany rejects all waiters with reason', async () => {
    const reg = new ApprovalWaitRegistry()
    const p1 = reg.register('a1')
    const p2 = reg.register('a2')
    setTimeout(() => reg.cancelMany(['a1', 'a2'], 'session closed'), 10)
    await assert.rejects(p1, /session closed/)
    await assert.rejects(p2, /session closed/)
    assert.equal(reg.size(), 0)
  })
})

// ---------------------------------------------------------------------------
// Tests: Store — approval resolve validation
// ---------------------------------------------------------------------------

describe('store.resolveApproval — validation', () => {
  let tmpDir: string
  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'router-test-'))
  })
  after(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true })
    } catch {}
  })

  function createStore() {
    return new LocalStore(join(tmpDir, `state-${Date.now()}.json`))
  }

  it('resolves pending approval with valid optionId', () => {
    const store = createStore()
    const project = store.upsertProject({ name: 'test', rootPath: tmpDir })
    store.createSession({ projectId: project.id, title: 'test' })
    const item = store.enqueueApproval({
      title: 'Write file',
      options: [
        { optionId: 'allow_once', name: 'Allow Once', kind: 'allow_once' },
        { optionId: 'deny', name: 'Deny', kind: 'reject_once' },
      ],
    })
    const resolved = store.resolveApproval(item.id, 'allow', 'allow_once')
    assert.equal(resolved.status, 'allowed')
    assert.equal(resolved.selectedOptionId, 'allow_once')
  })

  it('rejects invalid optionId', () => {
    const store = createStore()
    const project = store.upsertProject({ name: 'test2', rootPath: tmpDir })
    store.createSession({ projectId: project.id, title: 'test2' })
    const item = store.enqueueApproval({
      title: 'Write file',
      options: [{ optionId: 'allow_once', name: 'Allow Once', kind: 'allow_once' }],
    })
    assert.throws(() => store.resolveApproval(item.id, 'allow', 'nonexistent'), /does not belong/)
  })

  it('already resolved returns error', () => {
    const store = createStore()
    const project = store.upsertProject({ name: 'test3', rootPath: tmpDir })
    store.createSession({ projectId: project.id, title: 'test3' })
    const item = store.enqueueApproval({
      title: 'Delete file',
      options: [{ optionId: 'allow_once', name: 'Allow Once', kind: 'allow_once' }],
    })
    store.resolveApproval(item.id, 'allow', 'allow_once')
    assert.throws(() => store.resolveApproval(item.id, 'deny'), /already/)
  })

  it('cancel resolves without optionId', () => {
    const store = createStore()
    const project = store.upsertProject({ name: 'test4', rootPath: tmpDir })
    store.createSession({ projectId: project.id, title: 'test4' })
    const item = store.enqueueApproval({
      title: 'Move file',
      options: [{ optionId: 'allow_once', name: 'Allow Once', kind: 'allow_once' }],
    })
    const resolved = store.resolveApproval(item.id, 'cancel')
    assert.equal(resolved.status, 'cancelled')
  })

  it('createResolvedApproval skips pending state', () => {
    const store = createStore()
    const resolved = store.createResolvedApproval({
      title: 'Read file',
      workerId: 'w1',
      workerName: 'test-worker',
      option: { optionId: 'allow_once', name: 'Allow Once', kind: 'allow_once' },
      decision: 'allow',
      reason: 'auto-approved read',
    })
    assert.equal(resolved.status, 'allowed')
    assert.notEqual(resolved.createdAt, '')
    assert.notEqual(resolved.resolvedAt, '')
  })
})

describe('scheduler atomic Job approval transitions', () => {
  it('keeps a Job pending until its final Approval and cleans orphan approvals atomically', async () => {
    const previousDataDir = process.env.PIHUO_AGENT_DATA_DIR
    const dataDir = mkdtempSync(join(tmpdir(), 'scheduler-atomic-'))
    process.env.PIHUO_AGENT_DATA_DIR = dataDir
    resetSharedStoreForTests()
    globalApprovalWaiters.clear()
    try {
      const shared = getSharedStore()
      const project = shared.upsertProject({ name: 'atomic', rootPath: dataDir })
      const session = shared.createSession({ projectId: project.id, title: 'atomic' })
      const job = shared.createJob({
        sessionId: session.id,
        projectId: project.id,
        workerId: 'worker-atomic',
        workerName: 'Atomic Worker',
        task: 'two requests',
        cwd: dataDir,
        source: 'api',
        status: 'running',
      })
      const scheduler = new schedulerModule.WorkerScheduler()
      const first = shared.createJobApproval({
        id: 'atomic-first',
        jobId: job.id,
        sessionId: session.id,
        title: 'first',
        options: [
          { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
          { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
        ],
      })
      const second = shared.createJobApproval({
        id: 'atomic-second',
        jobId: job.id,
        sessionId: session.id,
        title: 'second',
        options: [
          { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
          { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
        ],
      })

      scheduler.resolveApproval(second.id, 'allow', { optionId: 'allow', surface: 'panel' })
      assert.equal(shared.getJob(job.id)?.status, 'pending_approval')
      scheduler.resolveApproval(first.id, 'deny', { optionId: 'reject', surface: 'chat' })
      assert.equal(shared.getJob(job.id)?.status, 'running')

      const cleanup = shared.createJobApproval({
        id: 'atomic-cleanup',
        jobId: job.id,
        sessionId: session.id,
        title: 'cleanup',
        options: [{ optionId: 'cancel', name: 'Cancel', kind: 'reject_once' }],
      })
      scheduler.cleanupPendingApprovals(job.id, 'test cleanup')
      assert.equal(shared.getJob(job.id)?.status, 'running')
      assert.equal(shared.getJob(job.id)?.approvalIds?.includes(cleanup.id), true)
      assert.equal(shared.listApprovals().find((item) => item.id === cleanup.id)?.status, 'cancelled')

      const cancelledJob = shared.createJob({
        sessionId: session.id,
        projectId: project.id,
        workerId: 'worker-cancel',
        workerName: 'Cancel Worker',
        task: 'cancel race',
        cwd: dataDir,
        source: 'api',
        status: 'running',
      })
      const cancelledApproval = shared.createJobApproval({
        id: 'atomic-job-cancel',
        jobId: cancelledJob.id,
        sessionId: session.id,
        title: 'cancel race',
        options: [{ optionId: 'cancel', name: 'Cancel', kind: 'reject_once' }],
      })
      await scheduler.cancel(cancelledJob.id)
      assert.equal(shared.getJob(cancelledJob.id)?.status, 'cancelled')
      assert.equal(
        shared.listApprovals().find((item) => item.id === cancelledApproval.id)?.status,
        'cancelled',
      )

      const orphanJob = shared.createJob({
        sessionId: session.id,
        projectId: project.id,
        workerId: 'worker-orphan',
        workerName: 'Orphan Worker',
        task: 'restart',
        cwd: dataDir,
        source: 'api',
        status: 'pending_approval',
      })
      const orphan = shared.createJobApproval({
        id: 'atomic-reconcile',
        jobId: orphanJob.id,
        sessionId: session.id,
        title: 'reconcile',
        options: [{ optionId: 'cancel', name: 'Cancel', kind: 'reject_once' }],
      })
      const result = scheduler.reconcileOrphanJobs()
      assert.equal(result.clearedApprovals, 1)
      assert.equal(shared.listApprovals().find((item) => item.id === orphan.id)?.status, 'cancelled')
      assert.equal(shared.getJob(orphanJob.id)?.status, 'failed')
    } finally {
      globalApprovalWaiters.clear()
      resetSharedStoreForTests()
      if (previousDataDir === undefined) delete process.env.PIHUO_AGENT_DATA_DIR
      else process.env.PIHUO_AGENT_DATA_DIR = previousDataDir
      rmSync(dataDir, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------
// Tests: Legacy Job policy snapshot compatibility
// ---------------------------------------------------------------------------

describe('legacy job policy snapshot', () => {
  let tmpDir: string
  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'router-test-'))
  })
  after(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true })
    } catch {}
  })

  function createStore(stateFile: string) {
    return new LocalStore(stateFile)
  }

  it('job copies session approvalPolicy at creation time', () => {
    const fp = join(tmpDir, `state-policy-${Date.now()}.json`)
    const store = createStore(fp)
    const project = store.upsertProject({ name: 'p1', rootPath: tmpDir })
    const session = store.createSession({ projectId: project.id, title: 's1' })

    // Set session policy
    store.updateSessionApprovalPolicy(session.id, 'allow_always')

    // Create job — should freeze policy
    const job = store.createJob({
      sessionId: session.id,
      projectId: project.id,
      workerId: 'w1',
      workerName: 'test-worker',
      task: 'read some files',
      cwd: tmpDir,
      source: 'api',
      status: 'queued',
    })
    assert.equal(job.approvalPolicy, 'allow_always')

    // Change session policy; job should be unchanged
    store.updateSessionApprovalPolicy(session.id, 'manual')
    const reloaded = store.getJob(job.id)
    assert.equal(reloaded?.approvalPolicy, 'allow_always')
  })
})

// ---------------------------------------------------------------------------
// P0-2: Waiter ID must match the approval item.id (not a separate id)
// ---------------------------------------------------------------------------

describe('P0-2 — waiter and approval use the same ID', () => {
  it('registers the waiter before the pending approval becomes observable', async () => {
    const reg = new ApprovalWaitRegistry()
    const approvalId = 'appr_reserved_before_persist'

    const { item, waiterPromise } = schedulerModule.persistApprovalWithReservedWaiter({
      approvalId,
      waiters: reg,
      persist: () => {
        assert.equal(reg.has(approvalId), true)
        reg.settle(approvalId, 'allow', 'allow-once')
        return { id: approvalId }
      },
    })

    assert.equal(item.id, approvalId)
    assert.deepEqual(await waiterPromise, {
      outcome: 'selected',
      decision: 'allow',
      optionId: 'allow-once',
    })
  })

  it('cancels the reserved waiter when persistence fails', async () => {
    const reg = new ApprovalWaitRegistry()
    const approvalId = 'appr_persist_failure'

    assert.throws(
      () =>
        schedulerModule.persistApprovalWithReservedWaiter({
          approvalId,
          waiters: reg,
          persist: () => {
            throw new Error('disk full')
          },
        }),
      /disk full/,
    )
    assert.equal(reg.has(approvalId), false)
  })

  it('register with item.id and settle with same id resolves', async () => {
    const reg = new ApprovalWaitRegistry()
    const approvalId = 'appr_kx1abc' // the id generated by store.enqueueApproval

    const p = reg.register(approvalId)
    setTimeout(() => reg.settle(approvalId, 'allow', 'opt-1'), 10)
    const result = await p
    assert.equal(result.outcome, 'selected')
  })

  it('register with one id and settle with different id never resolves', async () => {
    const reg = new ApprovalWaitRegistry()
    const registrationId = 'appr_123'
    const settlementId = 'appr_456'

    const p = reg.register(registrationId)
    setTimeout(() => reg.settle(settlementId, 'allow', 'opt-1'), 10)

    let resolved = false
    p.then(() => {
      resolved = true
    }).catch(() => {})
    await new Promise((r) => setTimeout(r, 30))
    assert.equal(resolved, false, 'waiter with mismatched IDs should not resolve')
  })

  it('store.resolveApproval settles same id that enqueueApproval created', () => {
    const reg = new ApprovalWaitRegistry()
    const approvalId = 'appr_kx1abc'

    // Simulate: enqueue creates item with this id, register waiter with same id
    const p = reg.register(approvalId)

    // Simulate: store.resolveApproval settles with same id
    reg.settle(approvalId, 'allow', 'opt-x')

    // Should be immediately resolved
    assert.equal(reg.has(approvalId), false, 'waiter should be cleared after settle')
  })
})

describe('scheduler ACP error boundary', () => {
  it('normalizes circular unknown errors without leaking internal fields', () => {
    const thrown: Record<string, unknown> = {
      agentSessionId: 'private-agent-session',
      cwd: '/private/workspace',
      env: { OPENAI_API_KEY: 'private-key' },
    }
    thrown.self = thrown

    const result = (schedulerModule as any).toPublicAcpFailure(thrown)
    const serialized = JSON.stringify(result)
    assert.doesNotMatch(serialized, /private-agent-session|private\/workspace|private-key/)
    assert.equal(result.error, 'ACP agent failed while processing the task.')
    assert.equal(result.recoveryError, undefined)
  })

  it('only exposes the safe fields of a typed recovery error', () => {
    const error = new AcpSessionRuntimeError(
      'recovery_failed',
      'The previous ACP context could not be recovered. Reset the ACP context and retry.',
      true,
      { cause: new Error('private-agent-session') },
    )
    const result = (schedulerModule as any).toPublicAcpFailure(error)
    assert.equal(result.error, error.publicMessage)
    assert.equal(result.recoveryError, error.publicMessage)
    assert.equal(result.canResetAcpContext, true)
    assert.equal(result.errorCode, 'recovery_failed')
    assert.doesNotMatch(JSON.stringify(result), /private-agent-session/)
  })

  it('persists and emits the typed errorCode when an unexpected run failure terminalizes', () => {
    const previousData = process.env.PIHUO_AGENT_DATA_DIR
    const dataDir = mkdtempSync(join(tmpdir(), 'scheduler-error-code-'))
    process.env.PIHUO_AGENT_DATA_DIR = dataDir
    resetSharedStoreForTests()
    try {
      const shared = getSharedStore()
      const project = shared.upsertProject({ name: 'p', rootPath: dataDir })
      const session = shared.createSession({ projectId: project.id, title: 's' })
      const job = shared.createJob({
        sessionId: session.id,
        projectId: project.id,
        workerId: 'worker_auth',
        workerName: 'Registry Agent',
        task: 'run',
        cwd: dataDir,
        source: 'api',
        status: 'queued',
      })
      const scheduler = new schedulerModule.WorkerScheduler()
      ;(scheduler as unknown as { lifecycle: string }).lifecycle = 'stopped'
      ;(
        scheduler as unknown as { handleRunJobFailure: (id: string, error: unknown) => void }
      ).handleRunJobFailure(
        job.id,
        new AcpSessionRuntimeError(
          'recovery_failed',
          'The previous ACP context could not be recovered.',
          true,
        ),
      )
      assert.equal(shared.getJob(job.id)?.errorCode, 'recovery_failed')
      const terminal = getWorkerEventEmitter().getJournal(job.id, 0).at(-1)?.event
      assert.equal(terminal?.type, 'failed')
      assert.equal(terminal?.errorCode, 'recovery_failed')
    } finally {
      resetSharedStoreForTests()
      if (previousData === undefined) delete process.env.PIHUO_AGENT_DATA_DIR
      else process.env.PIHUO_AGENT_DATA_DIR = previousData
      rmSync(dataDir, { recursive: true, force: true })
    }
  })
})
