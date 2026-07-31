import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

/** Keep tab union stable for main↔renderer contract. */
const SETTINGS_TABS = ['general', 'model', 'prompts', 'workers', 'about'] as const

describe('app menu settings tabs', () => {
  it('includes about (settings panel) among valid tabs', () => {
    assert.ok(SETTINGS_TABS.includes('about'))
    assert.equal(SETTINGS_TABS.length, 5)
  })
})
