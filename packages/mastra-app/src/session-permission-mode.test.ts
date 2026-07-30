import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { LocalStore } from '@swarmdesk-agent/core'
import * as schedulerModule from './scheduler.js'
import {
  decidePermissionForJobInStore,
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
      status: 'pending_approval',
    })
    const allow = store.enqueueApproval({
      title: 'Allow me',
      sessionId: session.id,
      jobId: job.id,
      options: [
        { optionId: 'always', name: 'Allow always', kind: 'allow_always' },
        { optionId: 'once', name: 'Allow once', kind: 'allow_once' },
      ],
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
    const cancelled = store.listApprovals().find((item) => item.id === cancel.id)!
    assert.equal(result.session.permissionMode, 'auto')
    assert.equal(allowed.status, 'allowed')
    assert.equal(allowed.selectedOptionId, 'once')
    assert.equal(allowed.resolutionSource, 'policy')
    assert.equal(cancelled.status, 'cancelled')
    assert.equal(cancelled.resolutionSource, 'system')
    assert.equal(store.listApprovals().find((item) => item.id === untouched.id)?.status, 'pending')
    assert.equal(store.getJob(job.id)?.status, 'running')
    assert.deepEqual(new Set(events), new Set([allow.id, cancel.id]))
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
    const originalTryResolve = store.tryResolveApproval.bind(store)
    let injected = false
    store.tryResolveApproval = ((id, decision, optionId, metadata) => {
      if (!injected && id === first.id) {
        injected = true
        originalTryResolve(id, 'cancel', undefined, {
          resolutionSource: 'manual_panel',
          resolutionReason: 'Concurrent winner',
        })
      }
      return originalTryResolve(id, decision, optionId, metadata)
    }) as LocalStore['tryResolveApproval']

    const result = setSessionPermissionModeInStore({
      store,
      sessionId: session.id,
      permissionMode: 'auto',
    })

    assert.equal(store.listApprovals().find((item) => item.id === first.id)?.status, 'cancelled')
    assert.equal(store.listApprovals().find((item) => item.id === second.id)?.status, 'allowed')
    assert.equal(result.approvals.some((item) => item.id === second.id), true)
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

  it('fails closed for missing scope evidence, missing state, and missing allow options', () => {
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
    assert.equal(noAllow.decision.mode, 'cancelled')

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
