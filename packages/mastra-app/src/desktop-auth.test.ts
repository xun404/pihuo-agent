import assert from 'node:assert/strict'
import { describe, it, beforeEach, afterEach } from 'node:test'
import type { IncomingMessage } from 'node:http'
import {
  authorizeDesktopRequest,
  desktopAuthMode,
  isAllowedDesktopOrigin,
  tokenMatches,
} from './desktop-auth.js'

function req(partial: {
  method?: string
  origin?: string
  authorization?: string
  desktopToken?: string
}): IncomingMessage {
  const headers: Record<string, string | string[] | undefined> = {}
  if (partial.origin !== undefined) headers.origin = partial.origin
  if (partial.authorization) headers.authorization = partial.authorization
  if (partial.desktopToken) headers['x-swarmdesk-agent-desktop-token'] = partial.desktopToken
  return {
    method: partial.method ?? 'GET',
    headers,
  } as IncomingMessage
}

describe('desktop-auth', () => {
  const prev = process.env.SWARMDESK_AGENT_DESKTOP_AUTH

  afterEach(() => {
    if (prev === undefined) delete process.env.SWARMDESK_AGENT_DESKTOP_AUTH
    else process.env.SWARMDESK_AGENT_DESKTOP_AUTH = prev
  })

  it('allows configured vite origins and file; rejects null string and evil', () => {
    assert.equal(isAllowedDesktopOrigin('http://127.0.0.1:5173'), true)
    assert.equal(isAllowedDesktopOrigin('http://localhost:5173'), true)
    assert.equal(isAllowedDesktopOrigin('file://'), true)
    assert.equal(isAllowedDesktopOrigin(null), true)
    assert.equal(isAllowedDesktopOrigin(''), true)
    assert.equal(isAllowedDesktopOrigin('null'), false)
    assert.equal(isAllowedDesktopOrigin('http://127.0.0.1:9999'), false)
    assert.equal(isAllowedDesktopOrigin('chrome-extension://abc'), false)
    assert.equal(isAllowedDesktopOrigin('https://evil.example'), false)
  })

  it('enforced: rejects evil origin', () => {
    process.env.SWARMDESK_AGENT_DESKTOP_AUTH = '1'
    assert.equal(desktopAuthMode(), 'enforced')
    const r = authorizeDesktopRequest(
      req({ method: 'GET', origin: 'https://evil.example' }),
      'tok',
      { path: '/api/snapshot' },
    )
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.code, 'DESKTOP_ORIGIN_DENIED')
  })

  it('enforced: GET /api requires token; /health does not', () => {
    process.env.SWARMDESK_AGENT_DESKTOP_AUTH = '1'
    const snap = authorizeDesktopRequest(
      req({ method: 'GET', origin: 'http://127.0.0.1:5173' }),
      'secret-token-value',
      { path: '/api/snapshot' },
    )
    assert.equal(snap.ok, false)

    const health = authorizeDesktopRequest(req({ method: 'GET' }), 'secret-token-value', {
      path: '/health',
    })
    assert.equal(health.ok, true)

    const ok = authorizeDesktopRequest(
      req({
        method: 'GET',
        origin: 'http://127.0.0.1:5173',
        authorization: 'Bearer secret-token-value',
      }),
      'secret-token-value',
      { path: '/api/snapshot' },
    )
    assert.equal(ok.ok, true)
  })

  it('disabled: allows without token', () => {
    process.env.SWARMDESK_AGENT_DESKTOP_AUTH = '0'
    const r = authorizeDesktopRequest(req({ method: 'POST' }), null)
    assert.equal(r.ok, true)
  })

  it('tokenMatches is length-safe', () => {
    assert.equal(tokenMatches('abc', 'abc'), true)
    assert.equal(tokenMatches('abc', 'abd'), false)
    assert.equal(tokenMatches('ab', 'abc'), false)
  })
})
