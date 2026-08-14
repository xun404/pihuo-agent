import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { LocalStore } from '@pihuo-agent/core'
import * as schedulerModule from './scheduler.js'
import {
  decidePermissionForJobInStore,
  reconcileSessionPendingApprovalsInStore,
  setSessionPermissionModeInStore,
} from './session-permission-mode.js'

const cleanup: string[] = []

function createStore(): LocalStore {
  const dir = mkdtempSync(join(tmpdir(), 'session-permission-mode-'))
  cleanup.push(dir)
  return new LocalStore(join(dir, 'state.json'))
}

afterEach(() => {
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('Session permission mode service', () => {
  it('exports the store-level transition service', () => {
    assert.equal(typeof schedulerModule.setSessionPermissionModeInStore, 'function')
    assert.equal(typeof schedulerModule.decidePermissionForJobInStore, 'function')
  })

  it('persists default without changing existing pending approvals', () => {
    const store = createStore()
    const project = store.upsertProject({ name: 'p', rootPath: tmpdir() })
    const session = store.createSession({ projectId: project.id, permissionMode: 'auto' })
    const pending = store.enqueueApproval({
      title: 'Pending edit',
      sessionId: session.id,
      options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
    })

    const result = setSessionPermissionModeInStore({
      store,
      sessionId: session.id,
      permissionMode: 'default',
    })

    assert.equal(result.session.permissionMode, 'default')
    assert.equal(store.listApprovals().find((item) => item.id === pending.id)?.status, 'pending')
    assert.deepEqual(result.approvals, [])
  })

  it('enabling auto resolves this session pending items and restores waiting jobs', () => {
    const store = createStore()
    const project = store.upsertProject({ name: 'p', rootPath: tmpdir() })
    const session = store.createSession({ projectId: project.id })
    const other = store.createSession({ projectId: project.id })
    const job = store.createJob({
      sessionId: session.id,
      projectId: project.id,
      workerId: 'worker',
      workerName: 'Worker',
      task: 'edit',
      cwd: project.rootPath,
      source: 'api',
      status: 'running',
    })
    const allow = store.createJobApproval({
      jobId: job.id,
      title: 'Allow me',
      sessionId: session.id,
      options: [
        { optionId: 'always', name: 'Allow always', kind: 'allow_always' },
        { optionId: 'once', name: 'Allow once', kind: 'allow_once' },
      ],
    })
    const secondAllow = store.createJobApproval({
      jobId: job.id,
      title: 'Allow me too',
      sessionId: session.id,
      options: [{ optionId: 'second-once', name: 'Allow once', kind: 'allow_once' }],
    })
    const cancel = store.enqueueApproval({
      title: 'No allow option',
      sessionId: session.id,
      options: [{ optionId: 'reject', name: 'Reject', kind: 'reject_once' }],
    })
    const untouched = store.enqueueApproval({
      title: 'Other session',
      sessionId: other.id,
      options: [{ optionId: 'other-allow', name: 'Allow', kind: 'allow_once' }],
    })
    const events: string[] = []

    const result = setSessionPermissionModeInStore({
      store,
      sessionId: session.id,
      permissionMode: 'auto',
      onApprovalResolved: (item) => events.push(item.id),
    })

    const allowed = store.listApprovals().find((item) => item.id === allow.id)!
    const secondAllowed = store.listApprovals().find((item) => item.id === secondAllow.id)!
    const cancelled = store.listApprovals().find((item) => item.id === cancel.id)!
    assert.equal(result.session.permissionMode, 'auto')
    assert.equal(allowed.status, 'allowed')
    assert.equal(allowed.selectedOptionId, 'once')
    assert.equal(allowed.resolutionSource, 'policy')
    assert.equal(secondAllowed.status, 'allowed')
    assert.equal(secondAllowed.selectedOptionId, 'second-once')
    assert.equal(cancelled.status, 'cancelled')
    assert.equal(cancelled.resolutionSource, 'system')
    assert.equal(store.listApprovals().find((item) => item.id === untouched.id)?.status, 'pending')
    assert.equal(store.getJob(job.id)?.status, 'running')
    assert.deepEqual(new Set(events), new Set([allow.id, secondAllow.id, cancel.id]))
    assert.equal(result.failures.length, 0)
  })

  it('continues resolving later approvals when one item loses the CAS race', () => {
    const store = createStore()
    const project = store.upsertProject({ name: 'p', rootPath: tmpdir() })
    const session = store.createSession({ projectId: project.id })
    const first = store.enqueueApproval({
      title: 'Race loser',
      sessionId: session.id,
      options: [{ optionId: 'allow-1', name: 'Allow', kind: 'allow_once' }],
    })
    const second = store.enqueueApproval({
      title: 'Still resolves',
      sessionId: session.id,
      options: [{ optionId: 'allow-2', name: 'Allow', kind: 'allow_once' }],
    })
    const originalTryResolve = store.tryResolveJobApproval.bind(store)
    let injected = false
    store.tryResolveJobApproval = ((id, decision, optionId, metadata) => {
      if (!injected && id === first.id) {
        injected = true
        originalTryResolve(id, 'cancel', undefined, {
          resolutionSource: 'manual_panel',
          resolutionReason: 'Concurrent winner',
        })
      }
      return originalTryResolve(id, decision, optionId, metadata)
    }) as LocalStore['tryResolveJobApproval']

    const result = setSessionPermissionModeInStore({
      store,
      sessionId: session.id,
      permissionMode: 'auto',
    })

    assert.equal(store.listApprovals().find((item) => item.id === first.id)?.status, 'cancelled')
    assert.equal(store.listApprovals().find((item) => item.id === second.id)?.status, 'allowed')
    assert.equal(
      result.approvals.some((item) => item.id === second.id),
      true,
    )
  })

  it('reports a per-approval failure and continues reconciling the same Session', () => {
    const store = createStore()
    const project = store.upsertProject({ name: 'p', rootPath: tmpdir() })
    const session = store.createSession({ projectId: project.id })
    const other = store.createSession({ projectId: project.id })
    const resolved = store.enqueueApproval({
      title: 'Still resolves',
      sessionId: session.id,
      options: [{ optionId: 'allow-resolved', name: 'Allow', kind: 'allow_once' }],
    })
    // Approvals are newest-first, so persist the injected failure second to
    // prove reconciliation continues to the older item after the exception.
    const failed = store.enqueueApproval({
      title: 'Injected failure',
      sessionId: session.id,
      options: [{ optionId: 'allow-failed', name: 'Allow', kind: 'allow_once' }],
    })
    const untouched = store.enqueueApproval({
      title: 'Other Session',
      sessionId: other.id,
      options: [{ optionId: 'allow-other', name: 'Allow', kind: 'allow_once' }],
    })
    const originalTryResolve = store.tryResolveJobApproval.bind(store)
    store.tryResolveJobApproval = ((id, decision, optionId, metadata) => {
      if (id === failed.id) throw new Error('/private/workspace/state.json injected durable failure')
      return originalTryResolve(id, decision, optionId, metadata)
    }) as LocalStore['tryResolveJobApproval']

    const result = setSessionPermissionModeInStore({
      store,
      sessionId: session.id,
      permissionMode: 'auto',
    })

    assert.equal(result.session.permissionMode, 'auto')
    assert.deepEqual(result.failures, [
      {
        approvalId: failed.id,
        error: 'Approval resolution failed; retry this Session.',
      },
    ])
    assert.doesNotMatch(result.failures[0]!.error, /private|state\.json|injected/u)
    assert.deepEqual(
      result.approvals.map((approval) => approval.id),
      [resolved.id],
    )
    assert.equal(
      store.listApprovals().find((approval) => approval.id === failed.id)?.status,
      'pending',
    )
    assert.equal(
      store.listApprovals().find((approval) => approval.id === resolved.id)?.status,
      'allowed',
    )
    assert.equal(
      store.listApprovals().find((approval) => approval.id === untouched.id)?.status,
      'pending',
    )
  })

  it('does not report a durable resolution as failed when notification delivery throws', () => {
    const store = createStore()
    const project = store.upsertProject({ name: 'p', rootPath: tmpdir() })
    const session = store.createSession({ projectId: project.id })
    const pending = store.enqueueApproval({
      title: 'Permission',
      sessionId: session.id,
      options: [{ optionId: 'once', name: 'Allow once', kind: 'allow_once' }],
    })
    store.updateSessionPermissionMode(session.id, 'auto')

    const result = reconcileSessionPendingApprovalsInStore({
      store,
      sessionId: session.id,
      onApprovalResolved: () => {
        throw new Error('/private/event-stream')
      },
    })

    assert.deepEqual(result.failures, [])
    assert.equal(result.approvals[0]?.id, pending.id)
    assert.equal(store.listApprovals().find((item) => item.id === pending.id)?.status, 'allowed')
  })

  it('reconciles an approval persisted after the Session already switched to auto', () => {
    const store = createStore()
    const project = store.upsertProject({ name: 'p', rootPath: tmpdir() })
    const session = store.createSession({ projectId: project.id })
    store.updateSessionPermissionMode(session.id, 'auto')

    // Models the race where the permission callback read default first, while
    // the shield switched to auto just before this late Approval committed.
    const late = store.enqueueApproval({
      title: 'Late approval',
      sessionId: session.id,
      options: [{ optionId: 'late-once', name: 'Allow once', kind: 'allow_once' }],
    })
    const events: string[] = []

    const result = reconcileSessionPendingApprovalsInStore({
      store,
      sessionId: session.id,
      onApprovalResolved: (approval) => events.push(approval.id),
    })

    const resolved = store.listApprovals().find((approval) => approval.id === late.id)
    assert.equal(resolved?.status, 'allowed')
    assert.equal(resolved?.selectedOptionId, 'late-once')
    assert.deepEqual(events, [late.id])
    assert.deepEqual(
      result.approvals.map((approval) => approval.id),
      [late.id],
    )
    assert.deepEqual(result.failures, [])
  })

  it('reads the current Session mode instead of the Job legacy snapshot', () => {
    const store = createStore()
    const projectRoot = mkdtempSync(join(tmpdir(), 'permission-project-'))
    const outside = mkdtempSync(join(tmpdir(), 'permission-outside-'))
    cleanup.push(projectRoot, outside)
    const project = store.upsertProject({ name: 'p', rootPath: projectRoot })
    const session = store.createSession({ projectId: project.id })
    store.updateSessionApprovalPolicy(session.id, 'allow_always')
    const job = store.createJob({
      sessionId: session.id,
      projectId: project.id,
      workerId: 'worker',
      workerName: 'Worker',
      task: 'edit',
      cwd: project.rootPath,
      source: 'api',
      status: 'running',
    })
    store.updateSessionPermissionMode(session.id, 'default')

    const request = {
      source: 'agent' as const,
      kind: 'edit',
      title: 'Outside edit',
      locations: [{ path: join(outside, 'file.txt') }],
      options: [{ optionId: 'allow', name: 'Allow once', kind: 'allow_once' as const }],
    }
    const defaultDecision = decidePermissionForJobInStore({ store, jobId: job.id, request })
    assert.equal(job.approvalPolicy, 'allow_always')
    assert.equal(defaultDecision.permissionMode, 'default')
    assert.equal(defaultDecision.targetScope, 'outside_project')
    assert.equal(defaultDecision.decision.mode, 'manual')

    store.updateSessionPermissionMode(session.id, 'auto')
    const autoDecision = decidePermissionForJobInStore({ store, jobId: job.id, request })
    assert.equal(autoDecision.permissionMode, 'auto')
    assert.equal(autoDecision.decision.mode, 'automatic')
  })

  it('requires approval for unknown evidence and routes missing auto allow options through durable resolution', () => {
    const store = createStore()
    const projectRoot = mkdtempSync(join(tmpdir(), 'permission-unknown-project-'))
    cleanup.push(projectRoot)
    const project = store.upsertProject({ name: 'p', rootPath: projectRoot })
    const session = store.createSession({ projectId: project.id })
    const job = store.createJob({
      sessionId: session.id,
      projectId: project.id,
      workerId: 'worker',
      workerName: 'Worker',
      task: 'run',
      cwd: project.rootPath,
      source: 'api',
      status: 'running',
    })

    const unknown = decidePermissionForJobInStore({
      store,
      jobId: job.id,
      request: {
        source: 'agent',
        kind: 'execute',
        locations: [],
        options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
      },
    })
    assert.equal(unknown.targetScope, 'unknown')
    assert.equal(unknown.decision.mode, 'manual')

    const noAllow = decidePermissionForJobInStore({
      store,
      jobId: job.id,
      request: {
        source: 'agent',
        kind: 'read',
        locations: [],
        options: [{ optionId: 'reject', name: 'Reject', kind: 'reject_once' }],
      },
    })
    assert.equal(noAllow.decision.mode, 'manual')

    store.updateSessionPermissionMode(session.id, 'auto')
    const noAutoAllow = decidePermissionForJobInStore({
      store,
      jobId: job.id,
      request: {
        source: 'agent',
        kind: 'read',
        locations: [],
        options: [{ optionId: 'reject', name: 'Reject', kind: 'reject_once' }],
      },
    })
    assert.equal(noAutoAllow.decision.mode, 'manual')

    const missing = decidePermissionForJobInStore({
      store,
      jobId: 'missing-job',
      request: {
        source: 'agent',
        kind: 'read',
        locations: [],
        options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
      },
    })
    assert.equal(missing.decision.mode, 'cancelled')

    store.deleteSession(session.id)
    const missingSession = decidePermissionForJobInStore({
      store,
      jobId: job.id,
      request: {
        source: 'agent',
        kind: 'read',
        locations: [],
        options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
      },
    })
    assert.equal(missingSession.permissionMode, 'default')
    assert.equal(missingSession.targetScope, 'unknown')
    assert.equal(missingSession.decision.mode, 'cancelled')
  })
})
