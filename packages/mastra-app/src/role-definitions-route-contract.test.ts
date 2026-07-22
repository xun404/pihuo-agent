import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

test('Owner and Studio expose Chat-scoped role-definition CRUD routes', () => {
  const owner = readFileSync(fileURLToPath(new URL('./http-server.ts', import.meta.url)), 'utf8')
  const studio = readFileSync(fileURLToPath(new URL('./routes/api.ts', import.meta.url)), 'utf8')

  for (const source of [owner, studio]) {
    assert.match(source, /\/api\/sessions\/:sessionId\/role-definitions/u)
    assert.match(source, /\/api\/sessions\/:sessionId\/role-definitions\/:roleDefinitionId/u)
    assert.match(
      source,
      /\/api\/sessions\/:sessionId\/role-definitions\/:roleDefinitionId\/reset-session/u,
    )
    assert.match(source, /listRoleDefinitions/u)
    assert.match(source, /createRoleDefinition/u)
    assert.match(source, /updateRoleDefinition/u)
    assert.match(source, /archiveRoleDefinition/u)
  }
})
