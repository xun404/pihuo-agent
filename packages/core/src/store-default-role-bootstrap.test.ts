import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WorkerRegistration } from '@pihuo-agent/shared'
import { DEFAULT_PROMPT_SETTINGS } from '@pihuo-agent/shared'
import { LocalStore } from './store.js'

describe('Worker default role type Team bootstrap', () => {
  let dir: string
  let store: LocalStore

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ra-default-role-type-'))
    store = new LocalStore(join(dir, 'state.json'))
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
      defaultRoleType: 'general',
      health: 'unknown',
    }
  }

  it('stores only the Worker default role type and defaults new Workers to general', () => {
    const input = worker('worker-enabled')
    const saved = store.upsertWorker({
      ...input,
      defaultRoleType: undefined,
    } as unknown as WorkerRegistration)

    assert.equal(saved.defaultRoleType, 'general')
    assert.equal('defaultRole' in saved, false)
    assert.equal(store.setWorkerDefaultRoleType(saved.id, 'coder').defaultRoleType, 'coder')
  })

  it('does not auto-seed registered Workers into a new Chat Team', () => {
    store.upsertWorker({ ...worker('worker-enabled'), defaultRoleType: 'coder' })
    store.upsertWorker(worker('worker-disabled', false))
    const project = store.upsertProject({ name: 'P', rootPath: join(dir, 'project') })

    const session = store.createSession({
      projectId: project.id,
      rolePrompts: DEFAULT_PROMPT_SETTINGS.roles,
    })
    const members = store.listTeamMembers(session.id)

    assert.equal(session.teamRevision, 1)
    assert.equal(session.roleReviewState, 'pending')
    assert.equal(members.length, 0)
  })

  it('creates exactly a resolved initial Team in the Session commit', () => {
    store.upsertWorker(worker('worker-default'))
    const selected = store.upsertWorker(worker('worker-selected'))
    const project = store.upsertProject({ name: 'P', rootPath: join(dir, 'project') })

    const session = store.createSession({
      projectId: project.id,
      initialTeamMembers: [
        {
          workerId: selected.id,
          name: 'Review Team',
          roleType: 'review',
          instructions: 'Review carefully.',
          model: 'model-a',
        },
      ],
    })

    assert.equal(session.teamRevision, 1)
    assert.deepEqual(
      store.listTeamMembers(session.id).map((member) => ({
        workerId: member.workerId,
        name: member.name,
        roleType: member.roleType,
        instructions: member.instructions,
        model: member.model,
      })),
      [
        {
          workerId: selected.id,
          name: 'Review Team',
          roleType: 'review',
          instructions: 'Review carefully.',
          model: 'model-a',
        },
      ],
    )
  })

  it('allows an empty initial Team without creating members', () => {
    store.upsertWorker(worker('worker-enabled'))
    const project = store.upsertProject({ name: 'P', rootPath: join(dir, 'project') })

    const session = store.createSession({ projectId: project.id, initialTeamMembers: [] })
    assert.equal(store.listSessions().length, 1)
    assert.equal(store.listTeamMembers(session.id).length, 0)
  })

  it('applies Worker defaultRoleType only when a member is created later', () => {
    store.upsertWorker({ ...worker('worker-enabled'), defaultRoleType: 'coder' })
    const project = store.upsertProject({ name: 'P', rootPath: join(dir, 'project') })
    const session = store.createSession({ projectId: project.id })

    const member = store.createTeamMember({
      chatSessionId: session.id,
      workerId: 'worker-enabled',
      name: 'Codex',
      roleType: 'coder',
      instructions: 'Project coder default.',
    })

    store.setWorkerDefaultRoleType('worker-enabled', 'review')
    assert.equal(member.roleType, 'coder')
    assert.equal(store.listTeamMembers(session.id)[0]?.roleType, 'coder')
  })

  it('increments Team revision for persisted member mutations', () => {
    store.upsertWorker(worker('worker-enabled'))
    const project = store.upsertProject({ name: 'P', rootPath: join(dir, 'project') })
    const session = store.createSession({ projectId: project.id })
    assert.equal(session.teamRevision, 1)

    const member = store.createTeamMember({
      chatSessionId: session.id,
      workerId: 'worker-enabled',
      name: 'Generalist',
      roleType: 'general',
      instructions: 'Help out.',
    })
    assert.equal(
      store.listSessions().find((candidate) => candidate.id === session.id)?.teamRevision,
      2,
    )

    const updated = store.updateTeamMember(session.id, member.id, {
      name: 'Generalist+',
      expectedRevision: member.revision,
    })
    assert.equal(
      store.listSessions().find((candidate) => candidate.id === session.id)?.teamRevision,
      3,
    )

    store.archiveTeamMember(session.id, member.id, updated.revision)
    assert.equal(
      store.listSessions().find((candidate) => candidate.id === session.id)?.teamRevision,
      4,
    )
  })
})
