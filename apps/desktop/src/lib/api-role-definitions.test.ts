import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { api, clearDesktopToken, encodePathSegment } from './api.js'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  clearDesktopToken()
})

test('role-definition client keeps opaque Chat and role ids in encoded path segments', async () => {
  const requests: Array<{ pathname: string; search: string; method: string; body?: unknown }> = []
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input))
    requests.push({
      pathname: url.pathname,
      search: url.search,
      method: String(init?.method ?? 'GET'),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    })
    return Response.json({ roleDefinitions: [], roleDefinition: {} })
  }

  const chatSessionId = 'chat/one?x=1'
  const roleDefinitionId = 'role/two#fragment'
  await api.listRoleDefinitions(chatSessionId, true)
  await api.createRoleDefinition(chatSessionId, {
    workerId: 'worker-a',
    name: 'Implementer',
    roleType: 'coder',
    instructions: 'Implement changes.',
  })
  await api.updateRoleDefinition(chatSessionId, roleDefinitionId, {
    model: 'provider/model',
    expectedRevision: 1,
  })
  await api.archiveRoleDefinition(chatSessionId, roleDefinitionId, 2)

  const base = `/api/sessions/${encodePathSegment(chatSessionId)}/role-definitions`
  const item = `${base}/${encodePathSegment(roleDefinitionId)}`
  assert.deepEqual(requests, [
    { pathname: base, search: '?includeArchived=1', method: 'GET', body: undefined },
    {
      pathname: base,
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
