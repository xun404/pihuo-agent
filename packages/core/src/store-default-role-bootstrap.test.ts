import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PromptSettings, WorkerRegistration } from '@swarmdesk-agent/shared'
import { DEFAULT_PROMPT_SETTINGS } from '@swarmdesk-agent/shared'
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

  it('atomically seeds enabled Workers from their role prompt defaults', () => {
    store.upsertWorker({ ...worker('worker-enabled'), defaultRoleType: 'coder' })
    store.upsertWorker(worker('worker-disabled', false))
    const project = store.upsertProject({ name: 'P', rootPath: join(dir, 'project') })
    const prompts: PromptSettings['roles'] = {
      ...DEFAULT_PROMPT_SETTINGS.roles,
      coder: 'Project coder default.',
    }

    const session = store.createSession({ projectId: project.id, rolePrompts: prompts })
    const members = store.listTeamMembers(session.id)

    assert.equal(session.teamRevision, 1)
    assert.equal(session.roleReviewState, 'pending')
    assert.equal(members.length, 1)
    assert.equal(members[0]?.workerId, 'worker-enabled')
    assert.equal(members[0]?.name, 'Codex')
    assert.equal(members[0]?.roleType, 'coder')
    assert.equal(members[0]?.instructions, 'Project coder default.')
    assert.equal(members[0]?.model, undefined)
    assert.equal(members[0]?.revision, 1)
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

  it('rejects an explicitly empty initial Team without creating a Session', () => {
    const project = store.upsertProject({ name: 'P', rootPath: join(dir, 'project') })

    assert.throws(
      () => store.createSession({ projectId: project.id, initialTeamMembers: [] }),
      /Team requires at least one member/u,
    )
    assert.equal(store.listSessions().length, 0)
  })

  it('keeps an existing Session prompt independent from later defaults', () => {
    store.upsertWorker({ ...worker('worker-enabled'), defaultRoleType: 'coder' })
    const project = store.upsertProject({ name: 'P', rootPath: join(dir, 'project') })
    const first = store.createSession({
      projectId: project.id,
      rolePrompts: { ...DEFAULT_PROMPT_SETTINGS.roles, coder: 'First coder prompt.' },
    })

    store.setWorkerDefaultRoleType('worker-enabled', 'review')
    const second = store.createSession({
      projectId: project.id,
      rolePrompts: { ...DEFAULT_PROMPT_SETTINGS.roles, review: 'Current review prompt.' },
    })

    assert.equal(store.listTeamMembers(first.id)[0]?.instructions, 'First coder prompt.')
    assert.equal(store.listTeamMembers(first.id)[0]?.roleType, 'coder')
    assert.equal(store.listTeamMembers(second.id)[0]?.instructions, 'Current review prompt.')
    assert.equal(store.listTeamMembers(second.id)[0]?.roleType, 'review')
  })

  it('increments Team revision for persisted member mutations', () => {
    store.upsertWorker(worker('worker-enabled'))
    const project = store.upsertProject({ name: 'P', rootPath: join(dir, 'project') })
    const session = store.createSession({ projectId: project.id })
    const member = store.listTeamMembers(session.id)[0]!

    const updated = store.updateTeamMember(session.id, member.id, {
      name: 'Generalist',
      expectedRevision: member.revision,
    })
    assert.equal(
      store.listSessions().find((candidate) => candidate.id === session.id)?.teamRevision,
      2,
    )

    store.archiveTeamMember(session.id, member.id, updated.revision)
    assert.equal(
      store.listSessions().find((candidate) => candidate.id === session.id)?.teamRevision,
      3,
    )
  })
})
