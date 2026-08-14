import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

test('Owner exposes Chat-scoped Team CRUD routes', () => {
  const owner = readFileSync(fileURLToPath(new URL('./http-server.ts', import.meta.url)), 'utf8')

  for (const source of [owner]) {
    assert.match(source, /\/api\/sessions\/:sessionId\/team/u)
    assert.match(source, /\/api\/sessions\/:sessionId\/team\/members\/:teamMemberId/u)
    assert.match(
      source,
      /\/api\/sessions\/:sessionId\/team\/members\/:teamMemberId\/reset-session/u,
    )
    assert.match(source, /listTeamMembers/u)
    assert.match(source, /createTeamMember/u)
    assert.match(source, /updateTeamMember/u)
    assert.match(source, /archiveTeamMember/u)
  }
})
