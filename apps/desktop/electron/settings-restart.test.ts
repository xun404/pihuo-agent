import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { settingsMutationRequiresApiRestart } from './settings-restart.js'

describe('settingsMutationRequiresApiRestart', () => {
  it('does not restart the API for a prompt-only save', () => {
    assert.equal(settingsMutationRequiresApiRestart({ prompts: {} }), false)
  })

  it('does not restart the API for a Worker timeout-only save', () => {
    assert.equal(
      settingsMutationRequiresApiRestart({
        workerTimeouts: {
          jobTimeoutMs: 600_000,
          queueTimeoutMs: 600_000,
        },
      }),
      false,
    )
  })

  it('preserves restarts for runtime, provider, and secret mutations', () => {
    assert.equal(settingsMutationRequiresApiRestart({ leaderModel: 'openai/gpt-5.6' }), true)
    assert.equal(settingsMutationRequiresApiRestart({ customProviders: [] }), true)
    assert.equal(settingsMutationRequiresApiRestart({ secrets: {} }), true)
  })

  it('does not restart the API for provider enable/disable only', () => {
    assert.equal(
      settingsMutationRequiresApiRestart({ disabledProviderIds: ['opencode-go'] }),
      false,
    )
  })
})
