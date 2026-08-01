import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import { LocalStore } from './store.js'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type {
  SessionApprovalPolicy,
  SessionPermissionMode,
  WorkerJob,
} from '@swarmdesk-agent/shared'

const VALID_POLICIES: SessionApprovalPolicy[] = [
  'manual',
  'allow_once',
  'allow_always',
  'reject_once',
  'reject_always',
]

describe('Session approval policy', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ra-policy-'))
  const path = join(dir, 'state.json')
  const store = new LocalStore(path)

  after(() => {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  it('old snapshot without permission fields migrates fail-closed', () => {
    const project = store.upsertProject({
      name: 'P',
      rootPath: join(dir, 'proj'),
    })
    // Write a raw snapshot without approvalPolicy on sessions
    const raw = {
      projects: [project],
      sessions: [
        {
          id: 's1',
          projectId: project.id,
          title: 'Old Session',
          status: 'idle',
          mode: 'build',
          activeWorkerIds: [],
          memoryThreadId: 'mt1',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      workers: [],
      approvals: [],
      jobs: [],
      activeProjectId: project.id,
      activeSessionId: 's1',
    }
    writeFileSync(path, JSON.stringify(raw), 'utf8')
    const store2 = new LocalStore(path)
    const sessions = store2.snapshot().sessions
    assert.equal(sessions.length, 1)
    assert.equal(sessions[0]!.approvalPolicy, 'manual')
    assert.equal(sessions[0]!.permissionMode, 'default')
  })

  it('creates build sessions with default permission unless auto is explicit', () => {
    const project = store.upsertProject({
      name: 'Q',
      rootPath: join(dir, 'proj2'),
    })
    // createSession doesn't accept approvalPolicy
    const session = store.createSession({
      projectId: project.id,
      title: 'No Policy',
    })
    assert.equal(session.approvalPolicy, 'manual')
    assert.equal(session.permissionMode, 'default')
    assert.equal(session.mode, 'build')

    const auto = store.createSession({
      projectId: project.id,
      title: 'Auto Permission',
      mode: 'review',
      permissionMode: 'auto',
    })
    assert.equal(auto.permissionMode, 'auto')
    assert.equal(auto.mode, 'build')
  })

  it('updates permission mode atomically and rejects invalid values', () => {
    const project = store.upsertProject({ name: 'Permission Mode', rootPath: join(dir, 'mode') })
    const session = store.createSession({ projectId: project.id })

    const updated = store.updateSessionPermissionMode(session.id, 'auto')
    assert.equal(updated.permissionMode, 'auto')
    assert.equal(store.snapshot().sessions.find((s) => s.id === session.id)?.permissionMode, 'auto')

    assert.throws(
      () => store.updateSessionPermissionMode(session.id, 'manual' as SessionPermissionMode),
      /Invalid permission mode/i,
    )
    assert.throws(
      () => store.updateSessionPermissionMode('missing', 'default'),
      /Session not found/i,
    )
  })

  it('updateSessionApprovalPolicy rejects invalid values', () => {
    const project = store.upsertProject({
      name: 'R',
      rootPath: join(dir, 'proj3'),
    })
    const session = store.createSession({
      projectId: project.id,
      title: 'Policy Test',
    })

    const invalidValues = ['auto', '', 'MANUAL', null, undefined] as const
    for (const v of invalidValues) {
      assert.throws(
        () => store.updateSessionApprovalPolicy(session.id, v as unknown as SessionApprovalPolicy),
        /Invalid approval policy/i,
      )
    }
  })

  it('updateSessionApprovalPolicy rejects session not found', () => {
    assert.throws(
      () => store.updateSessionApprovalPolicy('nonexistent', 'allow_once'),
      /Session not found/,
    )
  })

  it('updateSessionApprovalPolicy preserves mode, activeWorkerIds, memoryThreadId', () => {
    const project = store.upsertProject({
      name: 'S',
      rootPath: join(dir, 'proj4'),
    })
    const session = store.createSession({
      projectId: project.id,
      title: 'Keep Fields',
      mode: 'review',
    })
    assert.equal(session.mode, 'build')

    const updated = store.updateSessionApprovalPolicy(session.id, 'allow_always')

    assert.equal(updated.id, session.id)
    assert.equal(updated.mode, 'build')
    assert.equal(updated.activeWorkerIds.length, session.activeWorkerIds.length)
    assert.equal(updated.memoryThreadId, session.memoryThreadId)
    assert.equal(updated.approvalPolicy, 'allow_always')
    assert.equal(updated.permissionMode, 'auto')
  })

  it('updateSessionApprovalPolicy accepts all 5 valid policies', () => {
    const project = store.upsertProject({
      name: 'T',
      rootPath: join(dir, 'proj5'),
    })
    const session = store.createSession({
      projectId: project.id,
      title: 'All Policies',
    })

    for (const policy of VALID_POLICIES) {
      const updated = store.updateSessionApprovalPolicy(session.id, policy)
      assert.equal(updated.approvalPolicy, policy)
      assert.equal(
        updated.permissionMode,
        policy === 'allow_once' || policy === 'allow_always' ? 'auto' : 'default',
      )
      const snap = store.snapshot().sessions.find((s) => s.id === session.id)
      assert.equal(snap?.approvalPolicy, policy)
    }
  })

  it('WorkerJob gets policy snapshot at enqueue; later Session change does not affect existing Job', () => {
    const project = store.upsertProject({
      name: 'U',
      rootPath: join(dir, 'proj6'),
    })
    const session = store.createSession({
      projectId: project.id,
      title: 'Job Freeze',
    })

    // Set session to allow_always
    store.updateSessionApprovalPolicy(session.id, 'allow_always')

    const job = store.createJob({
      sessionId: session.id,
      projectId: project.id,
      workerId: 'w1',
      workerName: 'W1',
      task: 'do thing',
      cwd: project.rootPath,
      source: 'api',
      status: 'queued',
    })
    assert.equal(job.approvalPolicy, 'allow_always')

    // Change session policy after job created
    store.updateSessionApprovalPolicy(session.id, 'reject_always')
    const sessionAfter = store.snapshot().sessions.find((s) => s.id === session.id)
    assert.equal(sessionAfter?.approvalPolicy, 'reject_always')

    // Job should still have the frozen policy
    const jobAfter = store.getJob(job.id)
    assert.equal(jobAfter?.approvalPolicy, 'allow_always')
  })

  it('old WorkerJob without approvalPolicy migrates to manual', () => {
    // Create state with a job missing approvalPolicy
    const project = store.upsertProject({
      name: 'V',
      rootPath: join(dir, 'proj7'),
    })
    const rawJob: Omit<WorkerJob, 'approvalPolicy'> = {
      id: 'old-job',
      sessionId: 'sx',
      projectId: project.id,
      workerId: 'w2',
      workerName: 'W2',
      task: 'migrate me',
      cwd: project.rootPath,
      status: 'succeeded',
      createdAt: new Date().toISOString(),
      source: 'api',
    }
    const raw = {
      projects: [project],
      sessions: [],
      workers: [],
      approvals: [],
      jobs: [rawJob],
      activeProjectId: project.id,
      activeSessionId: null,
    }
    writeFileSync(path, JSON.stringify(raw), 'utf8')
    const store2 = new LocalStore(path)
    const jobs = store2.snapshot().jobs ?? []
    assert.equal(jobs.length, 1)
    assert.equal(jobs[0]!.approvalPolicy, 'manual')
  })

  it('invalid persisted session and job policies migrate to manual', () => {
    const project = store.upsertProject({
      name: 'Invalid Policy',
      rootPath: join(dir, 'proj-invalid-policy'),
    })
    const createdAt = new Date().toISOString()
    const raw = {
      projects: [project],
      sessions: [
        {
          id: 'invalid-policy-session',
          projectId: project.id,
          title: 'Invalid Policy Session',
          status: 'idle',
          mode: 'build',
          activeWorkerIds: [],
          memoryThreadId: 'invalid-policy-thread',
          approvalPolicy: 'allow_everything',
          createdAt,
          updatedAt: createdAt,
        },
      ],
      workers: [],
      approvals: [],
      jobs: [
        {
          id: 'invalid-policy-job',
          sessionId: 'invalid-policy-session',
          projectId: project.id,
          workerId: 'w-invalid',
          workerName: 'Invalid Worker',
          task: 'must migrate safely',
          cwd: project.rootPath,
          status: 'queued',
          source: 'api',
          approvalPolicy: 'allow_everything',
          createdAt,
        },
      ],
      activeProjectId: project.id,
      activeSessionId: 'invalid-policy-session',
    }
    writeFileSync(path, JSON.stringify(raw), 'utf8')

    const migrated = new LocalStore(path).snapshot()
    assert.equal(migrated.sessions[0]?.approvalPolicy, 'manual')
    assert.equal(migrated.sessions[0]?.permissionMode, 'default')
    assert.equal(migrated.jobs?.[0]?.approvalPolicy, 'manual')
  })

  it('migrates explicit legacy policies to the two permission modes', () => {
    const project = store.upsertProject({ name: 'Legacy Matrix', rootPath: join(dir, 'legacy') })
    const createdAt = new Date().toISOString()
    const policies = VALID_POLICIES
    const raw = {
      projects: [project],
      sessions: policies.map((approvalPolicy, index) => ({
        id: `legacy-${index}`,
        projectId: project.id,
        title: approvalPolicy,
        status: 'idle',
        mode: 'build',
        activeWorkerIds: [],
        memoryThreadId: `thread-${index}`,
        approvalPolicy,
        createdAt,
        updatedAt: createdAt,
      })),
      workers: [],
      approvals: [],
      jobs: [],
      activeProjectId: project.id,
      activeSessionId: null,
    }
    writeFileSync(path, JSON.stringify(raw), 'utf8')

    const modes = new LocalStore(path).snapshot().sessions.map((session) => session.permissionMode)
    assert.deepEqual(modes, ['default', 'auto', 'auto', 'default', 'default'])
  })

  it('updateSessionApprovalPolicy is atomic (snapshot consistent after save)', () => {
    const project = store.upsertProject({
      name: 'W',
      rootPath: join(dir, 'proj8'),
    })
    const session = store.createSession({
      projectId: project.id,
      title: 'Atomic Test',
    })

    store.updateSessionApprovalPolicy(session.id, 'reject_once')
    const snap = store.snapshot()
    const s = snap.sessions.find((x) => x.id === session.id)
    assert.equal(s?.approvalPolicy, 'reject_once')
  })
})
