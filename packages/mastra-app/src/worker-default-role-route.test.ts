import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

test('Owner and Studio expose Worker default role type mutation routes', () => {
  const owner = readFileSync(fileURLToPath(new URL('./http-server.ts', import.meta.url)), 'utf8')
  const studio = readFileSync(fileURLToPath(new URL('./routes/api.ts', import.meta.url)), 'utf8')

  for (const source of [owner, studio]) {
    assert.match(source, /\/api\/workers\/:id\/default-role-type/u)
    assert.match(source, /setWorkerDefaultRoleType/u)
    assert.doesNotMatch(source, /body\.instructions/u)
    assert.match(source, /snapshot/u)
  }
})
