import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WorkerRegistration } from '@swarmdesk-agent/shared'
import { LocalStore } from './store.js'

describe('LocalStore role definitions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ra-role-definitions-'))
  const store = new LocalStore(join(dir, 'state.json'))

  after(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('starts without implicit workers or role definitions', () => {
    const snapshot = store.snapshot()
    assert.deepEqual(snapshot.workers, [])
    assert.deepEqual(snapshot.roleDefinitions, [])
  })

  it('keeps role definitions chat-scoped and revisions execution semantics', () => {
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

    const role = store.createRoleDefinition({
      chatSessionId: firstChat.id,
      workerId: worker.id,
      name: 'Implementer',
      roleType: 'coder',
      instructions: 'Implement the requested change.',
    })

    assert.equal(role.revision, 1)
    assert.equal(role.enabled, true)
    assert.equal(role.model, undefined)
    assert.deepEqual(store.listRoleDefinitions(firstChat.id), [role])
    assert.deepEqual(store.listRoleDefinitions(secondChat.id), [])

    const renamed = store.updateRoleDefinition(firstChat.id, role.id, {
      name: 'Senior implementer',
      expectedRevision: 1,
    })
    assert.equal(renamed.revision, 1)

    const revised = store.updateRoleDefinition(firstChat.id, role.id, {
      instructions: 'Implement and verify the requested change.',
      model: 'role-specific-model',
      expectedRevision: 1,
    })
    assert.equal(revised.revision, 2)
    assert.equal(revised.model, 'role-specific-model')

    assert.throws(
      () =>
        store.updateRoleDefinition(secondChat.id, role.id, {
          name: 'Cross-chat mutation',
          expectedRevision: 2,
        }),
      /Role definition not found/,
    )
    assert.throws(
      () =>
        store.updateRoleDefinition(firstChat.id, role.id, {
          name: 'Stale mutation',
          expectedRevision: 1,
        }),
      /Role definition revision conflict/,
    )

    assert.throws(
      () => store.removeWorker(worker.id),
      /Worker is referenced by active role definitions/,
    )
    assert.throws(
      () => store.compareAndRemoveWorker(enabledWorker),
      /Worker is referenced by active role definitions/,
    )

    const archived = store.archiveRoleDefinition(firstChat.id, role.id, 2)
    assert.equal(archived.enabled, false)
    assert.ok(archived.archivedAt)
    assert.deepEqual(store.listRoleDefinitions(firstChat.id), [])
    assert.deepEqual(store.listRoleDefinitions(firstChat.id, { includeArchived: true }), [archived])

    assert.equal(store.removeWorker(worker.id).id, worker.id)

    store.deleteSession(firstChat.id)
    assert.deepEqual(store.listRoleDefinitions(firstChat.id, { includeArchived: true }), [])
  })
})
