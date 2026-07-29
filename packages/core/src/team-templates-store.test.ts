import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WorkerRegistration } from '@swarmdesk-agent/shared'
import { LocalStore } from './store.js'

describe('LocalStore Team templates', () => {
  let dir: string
  let store: LocalStore

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ra-team-templates-'))
    store = new LocalStore(join(dir, 'state.json'))
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  function addWorker(id: string): WorkerRegistration {
    return store.upsertWorker({
      id,
      name: id,
      kind: 'custom',
      command: 'agent',
      args: [],
      primaryRole: 'general',
      roles: ['general'],
      capabilities: ['general'],
      enabled: true,
      scope: 'global',
      description: '',
      defaultRoleType: 'general',
      health: 'healthy',
    })
  }

  it('creates, updates, lists, and deletes global Team templates', () => {
    addWorker('worker-1')
    const created = store.createTeamTemplate({
      name: 'Delivery Team',
      members: [
        {
          name: 'Implementer',
          preferredWorkerId: 'worker-1',
          roleType: 'coder',
          instructions: 'Implement and verify.',
        },
      ],
    })

    assert.equal(store.listTeamTemplates()[0]?.id, created.id)
    const updated = store.updateTeamTemplate(created.id, {
      name: 'Product Delivery',
      description: 'Reusable across projects.',
    })
    assert.equal(updated.name, 'Product Delivery')
    assert.equal(updated.description, 'Reusable across projects.')
    assert.equal(store.deleteTeamTemplate(created.id).id, created.id)
    assert.deepEqual(store.listTeamTemplates(), [])
  })

  it('atomically archives the old Team and creates independent template members', () => {
    addWorker('worker-1')
    addWorker('worker-2')
    const project = store.upsertProject({ name: 'P', rootPath: join(dir, 'project') })
    const session = store.createSession({ projectId: project.id })
    const oldIds = store.listTeamMembers(session.id).map((member) => member.id)

    const result = store.replaceTeamMembers({
      chatSessionId: session.id,
      expectedTeamRevision: session.teamRevision,
      members: [
        {
          workerId: 'worker-2',
          name: 'Reviewer',
          roleType: 'review',
          instructions: 'Review independently.',
          model: 'review-model',
        },
      ],
    })

    assert.equal(result.session.teamRevision, session.teamRevision + 1)
    assert.equal(result.members.length, 1)
    assert.equal(result.members[0]?.revision, 1)
    assert.equal(result.members[0]?.model, 'review-model')
    assert.ok(!oldIds.includes(result.members[0]!.id))
    assert.ok(
      store
        .listTeamMembers(session.id, { includeArchived: true })
        .filter((member) => oldIds.includes(member.id))
        .every((member) => Boolean(member.archivedAt)),
    )
  })

  it('rejects stale replacement without archiving the current Team', () => {
    addWorker('worker-1')
    const project = store.upsertProject({ name: 'P', rootPath: join(dir, 'project') })
    const session = store.createSession({ projectId: project.id })
    const before = store.listTeamMembers(session.id)

    assert.throws(
      () =>
        store.replaceTeamMembers({
          chatSessionId: session.id,
          expectedTeamRevision: session.teamRevision + 1,
          members: [
            {
              workerId: 'worker-1',
              name: 'Replacement',
              roleType: 'general',
              instructions: 'Replace.',
            },
          ],
        }),
      /Team revision conflict/u,
    )
    assert.deepEqual(store.listTeamMembers(session.id), before)
  })

  it('preserves reasoning on template members through round-trip', () => {
    addWorker('worker-1')
    const created = store.createTeamTemplate({
      name: 'Reasoning Team',
      members: [
        {
          name: 'Planner',
          preferredWorkerId: 'worker-1',
          roleType: 'plan',
          instructions: 'Plan carefully.',
          reasoning: 'high',
        },
      ],
    })
    assert.equal(created.members[0]?.reasoning, 'high')

    const updated = store.updateTeamTemplate(created.id, {
      members: [
        {
          name: 'Planner',
          preferredWorkerId: 'worker-1',
          roleType: 'plan',
          instructions: 'Plan carefully.',
          reasoning: 'low',
        },
      ],
    })
    assert.equal(updated.members[0]?.reasoning, 'low')

    const list = store.listTeamTemplates()
    assert.equal(list[0]?.members[0]?.reasoning, 'low')
  })
})
