import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { TeamMember, WorkerRegistration } from '@swarmdesk-agent/shared'
import {
  buildTeamMemberDispatchSnapshot,
  buildWorkerExecutionSnapshot,
  toPublicWorkerJobErrorCode,
} from './scheduler.js'

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
    effectiveReasoning: undefined,
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

test('role reasoning override wins over Worker default, TeamMember precedence first', () => {
  const workerWithReasoning = { ...worker, reasoning: 'low' }
  const roleWithReasoning = { ...role, reasoning: 'high' }

  const roleWins = buildTeamMemberDispatchSnapshot(
    roleWithReasoning,
    workerWithReasoning,
    'Plan it.',
  )
  assert.equal(roleWins.effectiveReasoning, 'high')

  const workerDefault = buildTeamMemberDispatchSnapshot(role, workerWithReasoning, 'Code it.')
  assert.equal(workerDefault.effectiveReasoning, 'low')

  const agentDefault = buildTeamMemberDispatchSnapshot(role, worker, 'Test it.')
  assert.equal(agentDefault.effectiveReasoning, undefined)
})

test('plain Worker dispatch freezes trimmed model and reasoning defaults', () => {
  assert.deepEqual(
    buildWorkerExecutionSnapshot({
      ...worker,
      model: '  worker-default-model  ',
      reasoning: '  high  ',
    }),
    {
      effectiveModel: 'worker-default-model',
      effectiveReasoning: 'high',
    },
  )
})

test('reasoning runtime failures use stable public job error codes', () => {
  assert.equal(toPublicWorkerJobErrorCode('acp_reasoning_unsupported'), 'ACP_REASONING_UNSUPPORTED')
  assert.equal(
    toPublicWorkerJobErrorCode('acp_reasoning_value_unavailable'),
    'ACP_REASONING_VALUE_UNAVAILABLE',
  )
  assert.equal(
    toPublicWorkerJobErrorCode('acp_reasoning_configuration_failed'),
    'ACP_REASONING_CONFIGURATION_FAILED',
  )
  assert.equal(toPublicWorkerJobErrorCode('auth_failed'), 'auth_failed')
  assert.equal(toPublicWorkerJobErrorCode(undefined), undefined)
})
