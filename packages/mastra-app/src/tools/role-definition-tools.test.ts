import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import type { RoleDefinition } from '@swarmdesk-agent/shared'
import {
  archiveRoleDefinitionTool,
  createRoleDefinitionTool,
  listRoleDefinitionsTool,
  resetRoleSessionTool,
  updateRoleDefinitionTool,
} from './session-tools.js'
import {
  resetRuntimeDispatchPortForTests,
  setRuntimeDispatchPort,
  type RuntimeDispatchPort,
} from '../runtime-dispatch-port.js'

const role: RoleDefinition = {
  id: 'role-1',
  chatSessionId: 'session-1',
  workerId: 'worker-1',
  name: 'Implementer',
  roleType: 'coder',
  instructions: 'Implement carefully.',
  enabled: true,
  revision: 1,
  createdAt: '2026-07-22T00:00:00.000Z',
  updatedAt: '2026-07-22T00:00:00.000Z',
}

const context = {
  requestContext: {
    get(key: string) {
      return {
        routerSessionId: 'session-1',
        routerProjectId: 'project-1',
        routerProjectRoot: '/tmp/project-1',
        memoryThreadId: 'thread-1',
      }[key]
    },
  },
}

afterEach(() => resetRuntimeDispatchPortForTests())

test('Chat role-definition tools use the trusted bound session through RuntimeDispatchPort', async () => {
  const calls: string[] = []
  const port = {
    resolveSessionContext: async () => null,
    dispatch: async () => {
      throw new Error('not used')
    },
    events: async function* () {},
    cancel: async () => {},
    resolveApproval: async () => {},
    listRoleDefinitions: async () => {
      calls.push('list')
      return [role]
    },
    createRoleDefinition: async () => {
      calls.push('create')
      return role
    },
    updateRoleDefinition: async () => {
      calls.push('update')
      return { ...role, revision: 2, model: 'role-model' }
    },
    archiveRoleDefinition: async () => {
      calls.push('archive')
      return { ...role, enabled: false, archivedAt: '2026-07-22T01:00:00.000Z' }
    },
    resetRoleSession: async () => {
      calls.push('reset')
      return { deleted: true }
    },
  } satisfies RuntimeDispatchPort
  setRuntimeDispatchPort(port)

  const listed = await listRoleDefinitionsTool.execute!({}, context as never)
  const created = await createRoleDefinitionTool.execute!(
    {
      workerId: 'worker-1',
      name: 'Implementer',
      roleType: 'coder',
      instructions: 'Implement carefully.',
    },
    context as never,
  )
  const updated = await updateRoleDefinitionTool.execute!(
    { roleDefinitionId: 'role-1', model: 'role-model', expectedRevision: 1 },
    context as never,
  )
  const reset = await resetRoleSessionTool.execute!(
    { roleDefinitionId: 'role-1' },
    context as never,
  )
  const archived = await archiveRoleDefinitionTool.execute!(
    { roleDefinitionId: 'role-1', expectedRevision: 2 },
    context as never,
  )

  assert.deepEqual(calls, ['list', 'create', 'update', 'reset', 'archive'])
  assert.equal((listed as { roleDefinitions: RoleDefinition[] }).roleDefinitions[0]?.id, role.id)
  assert.equal((created as { roleDefinition: RoleDefinition }).roleDefinition.id, role.id)
  assert.equal((updated as { roleDefinition: RoleDefinition }).roleDefinition.revision, 2)
  assert.deepEqual(reset, { deleted: true })
  assert.ok((archived as { roleDefinition: RoleDefinition }).roleDefinition.archivedAt)
})
