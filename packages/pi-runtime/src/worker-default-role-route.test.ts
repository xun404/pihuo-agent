import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

test('Owner exposes Worker default role type mutation routes', () => {
  const owner = readFileSync(fileURLToPath(new URL('./http-server.ts', import.meta.url)), 'utf8')

  for (const source of [owner]) {
    assert.match(source, /\/api\/workers\/:id\/default-role-type/u)
    assert.match(source, /setWorkerDefaultRoleType/u)
    assert.doesNotMatch(source, /body\.instructions/u)
    assert.match(source, /snapshot/u)
  }
})
