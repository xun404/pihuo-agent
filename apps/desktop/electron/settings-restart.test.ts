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

  it('preserves restarts for provider and secret mutations (child env wiring)', () => {
    assert.equal(settingsMutationRequiresApiRestart({ customProviders: [] }), true)
    assert.equal(settingsMutationRequiresApiRestart({ secrets: {} }), true)
  })

  // The runtime resolves leaderModel / thinkingIntensity / leaderMaxSteps from
  // loadSettings() on every chat request (applySecretsToEnv re-syncs env), so
  // recycling the whole API child just delays the confirmation toast.
  it('treats runtime-live preferences as hot: no restart, instant toast', () => {
    assert.equal(settingsMutationRequiresApiRestart({ leaderModel: 'openai/gpt-5.6' }), false)
    assert.equal(settingsMutationRequiresApiRestart({ leaderMaxSteps: 500 }), false)
    assert.equal(settingsMutationRequiresApiRestart({ thinkingIntensity: 'off' }), false)
  })

  it('still restarts when hot keys are mixed with env-wiring mutations', () => {
    assert.equal(
      settingsMutationRequiresApiRestart({
        leaderModel: 'openai/gpt-5.6',
        secrets: { OPENAI_API_KEY: 'sk-test' },
      }),
      true,
    )
    assert.equal(
      settingsMutationRequiresApiRestart({
        leaderModel: 'openai/gpt-5.6',
        customProviders: [],
      }),
      true,
    )
  })

  it('does not restart the API for provider enable/disable only', () => {
    assert.equal(
      settingsMutationRequiresApiRestart({ disabledProviderIds: ['opencode-go'] }),
      false,
    )
  })
})
