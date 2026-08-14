import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'

const http = readFileSync(new URL('./http-server.ts', import.meta.url), 'utf8')
const client = readFileSync(
  new URL('../../../apps/desktop/src/lib/api.ts', import.meta.url),
  'utf8',
)

describe('Team route contracts', () => {
  it('exposes Team member routes without role-definition paths', () => {
    for (const source of [http, client]) {
      assert.match(source, /\/api\/sessions\/[^'`]*\/team/u)
      assert.match(source, /\/team\/members/u)
      assert.doesNotMatch(source, /\/role-definitions/u)
    }
  })

  it('exposes global Team template CRUD and application routes', () => {
    for (const source of [http, client]) {
      assert.match(source, /\/api\/team-templates/u)
      assert.match(source, /apply-template/u)
    }
  })

  it('removes Session role-copy input', () => {
    for (const source of [http, client]) {
      assert.doesNotMatch(source, /copyRolesFromSessionId/u)
    }
  })
})
