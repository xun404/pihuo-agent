import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { accessModeById, resolveAccessMode } from './access-mode'

describe('access-mode', () => {
  it('maps plan mode to plan access', () => {
    assert.equal(resolveAccessMode('plan', 'manual'), 'plan')
  })

  it('maps build + manual to confirm', () => {
    assert.equal(resolveAccessMode('build', 'manual'), 'confirm')
  })

  it('maps build + allow_always to full_access', () => {
    assert.equal(resolveAccessMode('build', 'allow_always'), 'full_access')
  })

  it('returns defs with mode and policy', () => {
    const full = accessModeById('full_access')
    assert.equal(full.mode, 'build')
    assert.equal(full.policy, 'allow_always')
    assert.equal(full.accent, true)
  })
})
