import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const owner = readFileSync(new URL('./http-server.ts', import.meta.url), 'utf8')
const studio = readFileSync(new URL('./routes/api.ts', import.meta.url), 'utf8')

function sessionCreateBlock(source: string): string {
  const ownerStart = source.indexOf("if (method === 'POST' && path === '/api/sessions')")
  const studioStart = source.indexOf("registerApiRoute('/api/sessions', {\n    method: 'POST'")
  const start = ownerStart >= 0 ? ownerStart : studioStart
  assert.notEqual(start, -1)
  return source.slice(start, start + 2_500)
}

test('Owner and Studio resolve a selected Team template before Session creation', () => {
  for (const source of [owner, studio]) {
    const block = sessionCreateBlock(source)
    assert.match(block, /teamTemplateId/u)
    assert.match(block, /resolveForProject/u)
    assert.match(block, /initialTeamMembers/u)
    assert.ok(block.indexOf('resolveForProject') < block.indexOf('createSession'))
  }
})

test('Session creation maps template failures to stable public codes', () => {
  for (const source of [owner, studio]) {
    const block = sessionCreateBlock(source)
    assert.match(block, /TeamTemplateServiceError/u)
    assert.match(block, /TEAM_TEMPLATE_NOT_FOUND/u)
    assert.match(block, /TEAM_TEMPLATE_MAPPING_REQUIRED/u)
  }
})
