import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function routeBlock(source: string, start: string, end: string): string {
  const startAt = source.indexOf(start)
  const endAt = source.indexOf(end, startAt + start.length)
  assert.notEqual(startAt, -1, `missing route start: ${start}`)
  assert.notEqual(endAt, -1, `missing route end: ${end}`)
  return source.slice(startAt, endAt)
}

describe('Registry catalog GET public error contract', () => {
  it('Owner and Studio catalog GETs use the bounded Registry projector', () => {
    const owner = readFileSync(fileURLToPath(new URL('./http-server.ts', import.meta.url)), 'utf8')
    const studio = readFileSync(fileURLToPath(new URL('./routes/api.ts', import.meta.url)), 'utf8')
    const ownerGet = routeBlock(
      owner,
      "if (method === 'GET' && path === '/api/workers/registry')",
      '// Registry prepare:',
    )
    const studioGet = routeBlock(
      studio,
      "registerApiRoute('/api/workers/registry',",
      "registerApiRoute('/api/workers/registry/prepare',",
    )

    for (const block of [ownerGet, studioGet]) {
      assert.match(block, /registryCatalogApiPublicError\(error\)/u)
      assert.doesNotMatch(block, /error\.message/u)
      assert.doesNotMatch(block, /String\(error\)/u)
    }
  })
})

describe('Registry long-running operation route contract', () => {
  it('Owner prepare returns 202 and exposes bounded status/cancel routes', () => {
    const owner = readFileSync(fileURLToPath(new URL('./http-server.ts', import.meta.url)), 'utf8')
    const prepare = routeBlock(
      owner,
      "if (method === 'POST' && path === '/api/workers/registry/prepare')",
      '// Registry register:',
    )

    assert.match(prepare, /send\(\s*res,\s*202,\s*apiStartPrepareRegistry\(/u)
    assert.match(prepare, /\/api\/workers\/registry\/operations\/:operationId/u)
    assert.match(prepare, /apiGetRegistryOperation/u)
    assert.match(prepare, /apiCancelRegistryOperation/u)
    assert.doesNotMatch(prepare, /await\s+apiPrepareRegistry/u)
  })

  it('Owner agent authentication also returns a cancellable operation immediately', () => {
    const owner = readFileSync(fileURLToPath(new URL('./http-server.ts', import.meta.url)), 'utf8')
    const authenticate = routeBlock(
      owner,
      "const authenticateMatch = match(path, '/api/workers/:id/authenticate')",
      "const secretsMatch = match(path, '/api/workers/:id/secrets')",
    )

    assert.match(authenticate, /send\(\s*res,\s*202,\s*apiStartAuthenticateRegistry\s*\(/u)
    assert.doesNotMatch(authenticate, /await\s+apiAuthenticateWorker/u)
  })
})
