import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { settingsMutationRequiresApiRestart } from './settings-restart.js'

describe('settingsMutationRequiresApiRestart', () => {
  it('does not restart the API for a prompt-only save', () => {
    assert.equal(settingsMutationRequiresApiRestart({ prompts: {} }), false)
  })

  it('preserves restarts for runtime, provider, and secret mutations', () => {
    assert.equal(settingsMutationRequiresApiRestart({ leaderModel: 'openai/gpt-5.6' }), true)
    assert.equal(settingsMutationRequiresApiRestart({ customProviders: [] }), true)
    assert.equal(settingsMutationRequiresApiRestart({ secrets: {} }), true)
  })
})
