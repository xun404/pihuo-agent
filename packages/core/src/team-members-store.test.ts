import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
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

    // Reasoning: set via create
    const reasonRole = store.createTeamMember({
      chatSessionId: firstChat.id,
      workerId: worker.id,
      name: 'Reasoner',
      roleType: 'plan',
      instructions: 'Plan with reasoning.',
      reasoning: 'high',
    })
    assert.equal(reasonRole.revision, 1)
    assert.equal(reasonRole.reasoning, 'high')

    // Reasoning change is an execution change
    const reasonRevised = store.updateTeamMember(firstChat.id, reasonRole.id, {
      reasoning: 'low',
      expectedRevision: 1,
    })
    assert.equal(reasonRevised.revision, 2)
    assert.equal(reasonRevised.reasoning, 'low')

    // Reasoning: clear via null
    const reasonCleared = store.updateTeamMember(firstChat.id, reasonRole.id, {
      reasoning: null,
      expectedRevision: 2,
    })
    assert.equal(reasonCleared.revision, 3)
    assert.equal(reasonCleared.reasoning, undefined)

    // Reasoning: undefined in patch means keep current
    const reasonKept = store.updateTeamMember(firstChat.id, reasonRole.id, {
      name: 'Renamed Reasoner',
      expectedRevision: 3,
    })
    assert.equal(reasonKept.revision, 3)
    assert.equal(reasonKept.reasoning, undefined)
    assert.equal(reasonKept.name, 'Renamed Reasoner')

    // Old snapshot without reasoning field still loads
    const workerWithoutReasoning: WorkerRegistration = {
      id: 'worker-no-reasoning',
      name: 'No Reasoning Worker',
      kind: 'custom',
      command: '/opt/custom-acp',
      args: [],
      primaryRole: 'general',
      roles: ['general'],
      capabilities: ['general'],
      enabled: true,
      scope: 'global',
      description: 'Worker without reasoning field',
      defaultRoleType: 'general',
      health: 'healthy',
      model: 'model-1',
      source: { type: 'custom' },
      runtimeProfile: 'generic-acp',
    }
    // Ensure no reasoning field
    assert.equal((workerWithoutReasoning as unknown as Record<string, unknown>).reasoning, undefined)

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

    // Archive the reasoning role too before testing empty list
    const reasonArchived = store.archiveTeamMember(firstChat.id, reasonRole.id, 3)
    assert.equal(reasonArchived.enabled, false)
    assert.ok(reasonArchived.archivedAt)

    assert.deepEqual(store.listTeamMembers(firstChat.id), [])
    assert.equal(store.listTeamMembers(firstChat.id, { includeArchived: true }).length, 2)

    assert.equal(store.removeWorker(worker.id).id, worker.id)

    store.deleteSession(firstChat.id)
    assert.deepEqual(store.listTeamMembers(firstChat.id, { includeArchived: true }), [])
  })
})
