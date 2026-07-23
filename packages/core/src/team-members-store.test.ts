import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WorkerRegistration } from '@swarmdesk-agent/shared'
import { LocalStore } from './store.js'

describe('LocalStore Team members', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ra-team-members-'))
  const store = new LocalStore(join(dir, 'state.json'))

  after(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('starts without implicit workers, Team members, or templates', () => {
    const snapshot = store.snapshot()
    assert.deepEqual(snapshot.workers, [])
    assert.deepEqual(snapshot.teamMembers, [])
    assert.deepEqual(snapshot.teamTemplates, [])
  })

  it('keeps Team members Chat-scoped with execution revisions', () => {
    const worker: WorkerRegistration = {
      id: 'worker-custom-acp',
      name: 'Custom ACP',
      kind: 'custom',
      command: '/opt/custom-acp',
      args: [],
      primaryRole: 'general',
      roles: ['general'],
      capabilities: ['general'],
      enabled: false,
      scope: 'global',
      description: 'Custom ACP worker',
      defaultRoleType: 'general',
      health: 'healthy',
      model: 'worker-default-model',
      source: { type: 'custom' },
      runtimeProfile: 'generic-acp',
    }
    store.upsertWorker(worker)

    const project = store.upsertProject({ name: 'P', rootPath: join(dir, 'project') })
    const firstChat = store.createSession({ projectId: project.id, title: 'First chat' })
    const secondChat = store.createSession({ projectId: project.id, title: 'Second chat' })
    const enabledWorker = store.setWorkerEnabled(worker.id, true)

    const role = store.createTeamMember({
      chatSessionId: firstChat.id,
      workerId: worker.id,
      name: 'Implementer',
      roleType: 'coder',
      instructions: 'Implement the requested change.',
    })

    assert.equal(role.revision, 1)
    assert.equal(role.enabled, true)
    assert.equal(role.model, undefined)
    assert.deepEqual(store.listTeamMembers(firstChat.id), [role])
    assert.deepEqual(store.listTeamMembers(secondChat.id), [])

    const renamed = store.updateTeamMember(firstChat.id, role.id, {
      name: 'Senior implementer',
      expectedRevision: 1,
    })
    assert.equal(renamed.revision, 1)

    const revised = store.updateTeamMember(firstChat.id, role.id, {
      instructions: 'Implement and verify the requested change.',
      model: 'role-specific-model',
      expectedRevision: 1,
    })
    assert.equal(revised.revision, 2)
    assert.equal(revised.model, 'role-specific-model')

    assert.throws(
      () =>
        store.updateTeamMember(secondChat.id, role.id, {
          name: 'Cross-chat mutation',
          expectedRevision: 2,
        }),
      /Team member not found/,
    )
    assert.throws(
      () =>
        store.updateTeamMember(firstChat.id, role.id, {
          name: 'Stale mutation',
          expectedRevision: 1,
        }),
      /Team member revision conflict/,
    )

    assert.throws(
      () => store.removeWorker(worker.id),
      /Worker is referenced by active Team members/,
    )
    assert.throws(
      () => store.compareAndRemoveWorker(enabledWorker),
      /Worker is referenced by active Team members/,
    )

    const archived = store.archiveTeamMember(firstChat.id, role.id, 2)
    assert.equal(archived.enabled, false)
    assert.ok(archived.archivedAt)
    assert.deepEqual(store.listTeamMembers(firstChat.id), [])
    assert.deepEqual(store.listTeamMembers(firstChat.id, { includeArchived: true }), [archived])

    assert.equal(store.removeWorker(worker.id).id, worker.id)

    store.deleteSession(firstChat.id)
    assert.deepEqual(store.listTeamMembers(firstChat.id, { includeArchived: true }), [])
  })
})
