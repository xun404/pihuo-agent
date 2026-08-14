import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import type { TeamMember } from '@pihuo-agent/shared'
import {
  archiveTeamMemberTool,
  applyTeamTemplateTool,
  addTeamMemberTool,
  deleteTeamTemplateTool,
  listTeamTool,
  listTeamTemplatesTool,
  resetTeamMemberSessionTool,
  saveTeamTemplateTool,
  updateTeamMemberTool,
} from './session-tools.js'
import {
  resetRuntimeDispatchPortForTests,
  setRuntimeDispatchPort,
  type RuntimeDispatchPort,
} from '../runtime-dispatch-port.js'

const role: TeamMember = {
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

test('Chat Team tools use the trusted bound session through RuntimeDispatchPort', async () => {
  const calls: string[] = []
  const port = {
    resolveSessionContext: async () => null,
    dispatch: async () => {
      throw new Error('not used')
    },
    events: async function* () {},
    cancel: async () => {},
    resolveApproval: async () => {},
    listTeamMembers: async () => {
      calls.push('list')
      return [role]
    },
    getTeamRevision: async () => 4,
    createTeamMember: async () => {
      calls.push('create')
      return role
    },
    updateTeamMember: async () => {
      calls.push('update')
      return { ...role, revision: 2, model: 'role-model' }
    },
    archiveTeamMember: async () => {
      calls.push('archive')
      return { ...role, enabled: false, archivedAt: '2026-07-22T01:00:00.000Z' }
    },
    resetTeamMemberSession: async () => {
      calls.push('reset')
      return { deleted: true }
    },
    listTeamTemplates: async () => {
      calls.push('list-templates')
      return []
    },
    saveTeamTemplate: async () => {
      calls.push('save-template')
      return {
        id: 'template-1',
        name: 'Build team',
        members: [
          {
            preferredWorkerId: role.workerId,
            name: role.name,
            roleType: role.roleType,
            instructions: role.instructions,
          },
        ],
        createdAt: role.createdAt,
        updatedAt: role.updatedAt,
      }
    },
    applyTeamTemplate: async () => {
      calls.push('apply-template')
      return { members: [role], teamRevision: 5 }
    },
    deleteTeamTemplate: async () => {
      calls.push('delete-template')
      return {
        id: 'template-1',
        name: 'Build team',
        members: [],
        createdAt: role.createdAt,
        updatedAt: role.updatedAt,
      }
    },
  } satisfies RuntimeDispatchPort
  setRuntimeDispatchPort(port)

  const listed = await listTeamTool.execute!({}, context as never)
  const created = await addTeamMemberTool.execute!(
    {
      workerId: 'worker-1',
      name: 'Implementer',
      roleType: 'coder',
      instructions: 'Implement carefully.',
    },
    context as never,
  )
  const updated = await updateTeamMemberTool.execute!(
    { teamMemberId: 'role-1', model: 'role-model', expectedRevision: 1 },
    context as never,
  )
  const reset = await resetTeamMemberSessionTool.execute!(
    { teamMemberId: 'role-1' },
    context as never,
  )
  const archived = await archiveTeamMemberTool.execute!(
    { teamMemberId: 'role-1', expectedRevision: 2 },
    context as never,
  )
  await listTeamTemplatesTool.execute!({}, context as never)
  await saveTeamTemplateTool.execute!({ name: 'Build team' }, context as never)
  const applied = await applyTeamTemplateTool.execute!(
    { templateId: 'template-1', expectedTeamRevision: 4 },
    context as never,
  )
  await deleteTeamTemplateTool.execute!({ templateId: 'template-1' }, context as never)

  assert.deepEqual(calls, [
    'list',
    'create',
    'update',
    'reset',
    'archive',
    'list-templates',
    'save-template',
    'apply-template',
    'delete-template',
  ])
  assert.equal((listed as { teamMembers: TeamMember[] }).teamMembers[0]?.id, role.id)
  assert.equal((listed as { teamRevision: number }).teamRevision, 4)
  assert.equal((created as { teamMember: TeamMember }).teamMember.id, role.id)
  assert.equal((updated as { teamMember: TeamMember }).teamMember.revision, 2)
  assert.deepEqual(reset, { deleted: true })
  assert.ok((archived as { teamMember: TeamMember }).teamMember.archivedAt)
  assert.equal((applied as { teamRevision: number }).teamRevision, 5)
})
