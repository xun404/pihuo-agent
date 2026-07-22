import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

test('Owner and Studio expose Worker default-role mutation routes', () => {
  const owner = readFileSync(fileURLToPath(new URL('./http-server.ts', import.meta.url)), 'utf8')
  const studio = readFileSync(fileURLToPath(new URL('./routes/api.ts', import.meta.url)), 'utf8')

  for (const source of [owner, studio]) {
    assert.match(source, /\/api\/workers\/:id\/default-role/u)
    assert.match(source, /setWorkerDefaultRole/u)
    assert.match(source, /snapshot/u)
  }
})
