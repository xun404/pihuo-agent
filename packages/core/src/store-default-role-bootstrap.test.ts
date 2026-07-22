import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WorkerRegistration, WorkerRole } from '@swarmdesk-agent/shared'
import { LocalStore } from './store.js'

describe('Worker default role Session bootstrap', () => {
  let dir: string
  let statePath: string
  let store: LocalStore

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ra-default-role-'))
    statePath = join(dir, 'state.json')
    store = new LocalStore(statePath)
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  function worker(id: string, enabled = true): WorkerRegistration {
    return {
      id,
      name: id === 'worker-enabled' ? 'Codex' : 'Disabled Worker',
      kind: 'custom',
      command: 'agent',
      args: [],
      primaryRole: 'general',
      roles: ['general'],
      capabilities: ['general'],
      enabled,
      scope: 'global',
      description: '',
      health: 'unknown',
    }
  }

  it('normalizes a general default role from the Worker name', () => {
    const saved = store.upsertWorker(worker('worker-enabled'))

    assert.deepEqual((saved as WorkerRegistration & { defaultRole?: unknown }).defaultRole, {
      name: 'Codex',
      roleType: 'general',
      instructions: '作为通用执行角色，完成 Leader 委派的任务并返回清晰、可验证的结果。',
    })
  })

  it('atomically clones enabled Worker defaults into a new Session', () => {
    store.upsertWorker(worker('worker-enabled'))
    store.upsertWorker(worker('worker-disabled', false))
    const project = store.upsertProject({ name: 'P', rootPath: join(dir, 'project') })

    const session = store.createSession({ projectId: project.id })
    const roles = store.listRoleDefinitions(session.id)

    assert.equal(
      (session as typeof session & { roleReviewState?: string }).roleReviewState,
      'pending',
    )
    assert.deepEqual(
      roles.map((role) => role.workerId),
      ['worker-enabled'],
    )
    assert.equal(roles[0]?.name, 'Codex')
    assert.equal(roles[0]?.roleType, 'general')
    assert.equal(roles[0]?.model, undefined)
    assert.equal(roles[0]?.revision, 1)
  })

  it('keeps copied roles independent from later Worker default changes', () => {
    store.upsertWorker(worker('worker-enabled'))
    const project = store.upsertProject({ name: 'P', rootPath: join(dir, 'project') })
    const first = store.createSession({ projectId: project.id })

    const mutableStore = store as LocalStore & {
      setWorkerDefaultRole: (
        workerId: string,
        input: { name: string; roleType: WorkerRole; instructions: string },
      ) => WorkerRegistration
    }
    mutableStore.setWorkerDefaultRole('worker-enabled', {
      name: '实现者',
      roleType: 'coder',
      instructions: '实现并验证任务。',
    })
    const second = store.createSession({ projectId: project.id })

    assert.equal(store.listRoleDefinitions(first.id)[0]?.name, 'Codex')
    assert.equal(store.listRoleDefinitions(second.id)[0]?.name, '实现者')
    assert.equal(store.listRoleDefinitions(second.id)[0]?.roleType, 'coder')
  })

  it('marks a new Session prompted without changing an old Session back to pending', () => {
    store.upsertWorker(worker('worker-enabled'))
    const project = store.upsertProject({ name: 'P', rootPath: join(dir, 'project') })
    const session = store.createSession({ projectId: project.id })
    const mutableStore = store as LocalStore & {
      markSessionRoleReviewPrompted: (sessionId: string) => typeof session | null
    }

    const prompted = mutableStore.markSessionRoleReviewPrompted(session.id)
    assert.equal(prompted?.roleReviewState, 'prompted')
    assert.equal(typeof prompted?.roleReviewPromptedAt, 'string')
    assert.equal(mutableStore.markSessionRoleReviewPrompted('missing'), null)
  })

  it('normalizes legacy Sessions as already prompted', () => {
    writeFileSync(
      statePath,
      JSON.stringify({
        projects: [
          {
            id: 'project-legacy',
            name: 'Legacy',
            rootPath: join(dir, 'legacy-project'),
            workerIds: [],
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        sessions: [
          {
            id: 'session-legacy',
            projectId: 'project-legacy',
            title: 'Legacy',
            status: 'idle',
            mode: 'build',
            activeWorkerIds: [],
            memoryThreadId: 'thread-legacy',
            approvalPolicy: 'manual',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        workers: [],
        roleDefinitions: [],
        approvals: [],
        jobs: [],
        activeProjectId: 'project-legacy',
        activeSessionId: 'session-legacy',
        locale: 'zh',
      }),
    )

    const legacy = new LocalStore(statePath).snapshot().sessions[0]
    assert.equal(legacy?.roleReviewState, 'prompted')
  })
})
