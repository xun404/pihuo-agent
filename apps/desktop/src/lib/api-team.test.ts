import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { api, clearDesktopToken, encodePathSegment } from './api.js'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  clearDesktopToken()
})

test('Team client keeps opaque Chat and member ids in encoded path segments', async () => {
  const requests: Array<{ pathname: string; search: string; method: string; body?: unknown }> = []
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input))
    requests.push({
      pathname: url.pathname,
      search: url.search,
      method: String(init?.method ?? 'GET'),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    })
    return Response.json({ teamMembers: [], teamMember: {} })
  }

  const chatSessionId = 'chat/one?x=1'
  const teamMemberId = 'role/two#fragment'
  await api.listTeamMembers(chatSessionId, true)
  await api.createTeamMember(chatSessionId, {
    workerId: 'worker-a',
    name: 'Implementer',
    roleType: 'coder',
    instructions: 'Implement changes.',
  })
  await api.updateTeamMember(chatSessionId, teamMemberId, {
    model: 'provider/model',
    expectedRevision: 1,
  })
  await api.archiveTeamMember(chatSessionId, teamMemberId, 2)

  const base = `/api/sessions/${encodePathSegment(chatSessionId)}/team`
  const members = `${base}/members`
  const item = `${members}/${encodePathSegment(teamMemberId)}`
  assert.deepEqual(requests, [
    { pathname: base, search: '?includeArchived=1', method: 'GET', body: undefined },
    {
      pathname: members,
      search: '',
      method: 'POST',
      body: {
        workerId: 'worker-a',
        name: 'Implementer',
        roleType: 'coder',
        instructions: 'Implement changes.',
      },
    },
    {
      pathname: item,
      search: '',
      method: 'PATCH',
      body: { model: 'provider/model', expectedRevision: 1 },
    },
    {
      pathname: item,
      search: '',
      method: 'DELETE',
      body: { expectedRevision: 2 },
    },
  ])
})

test('Worker default role type client uses PUT with an encoded Worker id', async () => {
  let request: { pathname: string; method: string; body?: unknown } | undefined
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input))
    request = {
      pathname: url.pathname,
      method: String(init?.method ?? 'GET'),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    }
    return Response.json({ worker: {}, snapshot: {} })
  }

  await api.setWorkerDefaultRoleType('worker/one?x=1', 'coder')

  assert.deepEqual(request, {
    pathname: `/api/workers/${encodePathSegment('worker/one?x=1')}/default-role-type`,
    method: 'PUT',
    body: { roleType: 'coder' },
  })
})

test('Session creation forwards a selected Team template id', async () => {
  let request: { pathname: string; method: string; body?: unknown } | undefined
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input))
    request = {
      pathname: url.pathname,
      method: String(init?.method ?? 'GET'),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    }
    return Response.json({ session: {}, snapshot: {} })
  }

  await api.createSession({
    projectId: 'project-1',
    mode: 'build',
    teamTemplateId: 'template-1',
  })

  assert.deepEqual(request, {
    pathname: '/api/sessions',
    method: 'POST',
    body: {
      projectId: 'project-1',
      mode: 'build',
      teamTemplateId: 'template-1',
    },
  })
})
