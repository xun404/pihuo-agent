import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const owner = readFileSync(new URL('./http-server.ts', import.meta.url), 'utf8')

describe('Session permission mode route contract', () => {
  it('registers the Owner permission-mode POST route', () => {
    assert.match(owner, /match\(path, '\/api\/sessions\/:id\/permission-mode'\)/u)
  })

  it('validates the two supported values and delegates to the scheduler service', () => {
    assert.match(owner, /permissionMode/u)
    assert.match(owner, /isValidSessionPermissionMode/u)
    assert.match(owner, /getWorkerScheduler\(\)\.setSessionPermissionMode/u)
    assert.match(owner, /snapshot/u)
  })

  it('returns the complete mutation result from the Owner route', () => {
    for (const route of ['approval-policy', 'permission-mode']) {
      const start = owner.indexOf(`/api/sessions/:id/${route}`)
      assert.notEqual(start, -1)
      const block = owner.slice(start, start + 2_400)
      assert.match(block, /\{\s*session,\s*approvals,\s*failures\s*\}/u)
      assert.match(block, /\{\s*session,\s*approvals,\s*failures,\s*snapshot:/u)
    }
  })

  it('keeps modern source validation strict and legacy route provenance explicit', () => {
    assert.match(owner, /manual_chat/u)
    assert.match(owner, /manual_panel/u)
    const start = owner.indexOf('/api/sessions/:id/approval-policy')
    const block = owner.slice(start, start + 2_000)
    assert.match(block, /source:\s*['"]migration['"]/u)
  })

  it('redacts unexpected legacy mutation failures at the HTTP surface', () => {
    const start = owner.indexOf('/api/sessions/:id/approval-policy')
    const block = owner.slice(start, start + 2_400)
    assert.match(block, /Internal server error/u)
  })

  it('maps the legacy approval-policy route through the live permission service', () => {
    const start = owner.indexOf('/api/sessions/:id/approval-policy')
    assert.notEqual(start, -1)
    const block = owner.slice(start, start + 1_600)
    assert.match(block, /permissionModeFromLegacyPolicy/u)
    assert.match(block, /setSessionPermissionMode/u)
  })
})
