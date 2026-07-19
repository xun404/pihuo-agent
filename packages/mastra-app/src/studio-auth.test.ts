import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildStudioAuthUrl, createStudioAuth, resolveStudioPort } from './studio-auth.js'

describe('Studio authentication boundary', () => {
  it('accepts only the dedicated Studio token', async () => {
    const token = 's'.repeat(32)
    const auth = createStudioAuth(token)
    const request = new Request('http://127.0.0.1:4112/api/agents')

    assert.deepEqual(await auth.authenticateToken(token, request), {
      id: 'router-agents-studio',
      name: 'Router Agents Studio',
      role: 'admin',
    })
    assert.equal(await auth.authenticateToken('i'.repeat(32), request), null)
  })

  it('rejects absent and weak Studio tokens', () => {
    assert.throws(() => createStudioAuth(''), /Studio token/i)
    assert.throws(() => createStudioAuth('short'), /Studio token/i)
  })

  it('builds the official transient auth_header bootstrap URL on loopback', () => {
    const token = 's'.repeat(32)
    const url = new URL(buildStudioAuthUrl({ port: 4112, token }))
    assert.equal(url.origin, 'http://127.0.0.1:4112')
    assert.equal(url.searchParams.get('auth_header'), `Bearer ${token}`)
  })

  it('uses a separate valid Studio port and rejects the owner API port', () => {
    assert.equal(resolveStudioPort(undefined, 4111), 4112)
    assert.equal(resolveStudioPort('4312', 4111), 4312)
    assert.throws(() => resolveStudioPort('4111', 4111), /must differ/i)
    assert.throws(() => resolveStudioPort('nope', 4111), /valid TCP port/i)
  })
})
