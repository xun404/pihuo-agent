import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { TeamMember, WorkerRegistration } from '@swarmdesk-agent/shared'
import { buildTeamMemberDispatchSnapshot } from './scheduler.js'

const worker: WorkerRegistration = {
  id: 'worker-a',
  name: 'ACP Worker',
  kind: 'custom',
  command: 'agent-acp',
  args: [],
  primaryRole: 'general',
  roles: ['general'],
  capabilities: ['general'],
  enabled: true,
  scope: 'global',
  description: '',
  health: 'healthy',
  model: 'worker-default-model',
}

const role: TeamMember = {
  id: 'role-implementer',
  chatSessionId: 'chat-a',
  workerId: worker.id,
  name: 'Implementer',
  roleType: 'coder',
  instructions: 'Implement carefully and verify the result.',
  enabled: true,
  revision: 3,
  createdAt: '2026-07-22T00:00:00.000Z',
  updatedAt: '2026-07-22T00:00:00.000Z',
}

test('role dispatch snapshots identity, instructions, revision, and inherited Worker model', () => {
  assert.deepEqual(buildTeamMemberDispatchSnapshot(role, worker, 'Add the feature.'), {
    teamMemberId: 'role-implementer',
    teamMemberName: 'Implementer',
    roleType: 'coder',
    teamMemberRevision: 3,
    effectiveModel: 'worker-default-model',
    instructionsSnapshot: 'Implement carefully and verify the result.',
    effectivePrompt: 'Implement carefully and verify the result.\n\nTask:\nAdd the feature.',
  })
})

test('role model override wins over the Worker default model', () => {
  const snapshot = buildTeamMemberDispatchSnapshot(
    { ...role, model: 'role-specific-model' },
    worker,
    'Review the feature.',
  )
  assert.equal(snapshot.effectiveModel, 'role-specific-model')
})
