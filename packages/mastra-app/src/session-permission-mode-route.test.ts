import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const owner = readFileSync(new URL('./http-server.ts', import.meta.url), 'utf8')
const studio = readFileSync(new URL('./routes/api.ts', import.meta.url), 'utf8')

describe('Session permission mode route contract', () => {
  it('registers the Owner and Studio permission-mode POST routes', () => {
    assert.match(owner, /match\(path, '\/api\/sessions\/:id\/permission-mode'\)/u)
    assert.match(studio, /registerApiRoute\('\/api\/sessions\/:id\/permission-mode'/u)
  })

  it('validates the two supported values and delegates to the scheduler service', () => {
    for (const source of [owner, studio]) {
      assert.match(source, /permissionMode/u)
      assert.match(source, /isValidSessionPermissionMode/u)
      assert.match(source, /getWorkerScheduler\(\)\.setSessionPermissionMode/u)
      assert.match(source, /snapshot/u)
    }
  })

  it('returns the complete mutation result from Owner and Studio routes', () => {
    for (const source of [owner, studio]) {
      for (const route of ['approval-policy', 'permission-mode']) {
        const start = source.indexOf(`/api/sessions/:id/${route}`)
        assert.notEqual(start, -1)
        const block = source.slice(start, start + 2_400)
        assert.match(block, /\{\s*session,\s*approvals,\s*failures\s*\}/u)
        assert.match(block, /\{\s*session,\s*approvals,\s*failures,\s*snapshot:/u)
      }
    }
  })

  it('keeps modern source validation strict and legacy route provenance explicit', () => {
    for (const source of [owner, studio]) {
      assert.match(source, /manual_chat/u)
      assert.match(source, /manual_panel/u)
      const start = source.indexOf('/api/sessions/:id/approval-policy')
      const block = source.slice(start, start + 2_000)
      assert.match(block, /source:\s*['"]migration['"]/u)
    }
  })

  it('redacts unexpected legacy mutation failures at both HTTP surfaces', () => {
    for (const source of [owner, studio]) {
      const start = source.indexOf('/api/sessions/:id/approval-policy')
      const block = source.slice(start, start + 2_400)
      assert.match(block, /Internal server error/u)
    }
  })

  it('maps the legacy approval-policy route through the live permission service', () => {
    for (const source of [owner, studio]) {
      const start = source.indexOf('/api/sessions/:id/approval-policy')
      assert.notEqual(start, -1)
      const block = source.slice(start, start + 1_600)
      assert.match(block, /permissionModeFromLegacyPolicy/u)
      assert.match(block, /setSessionPermissionMode/u)
    }
  })
})
