import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import {
  loadSecrets,
  setSecret,
  deleteSecret,
  saveSettings,
  loadSettings,
  getSecretsStatus,
} from './secure-secrets.js'

/**
 * Note: secure-secrets uses fixed ~/.router-agents paths.
 * Tests operate on real path carefully with unique keys and cleanup.
 */
const TEST_KEY = 'ROUTER_AGENTS_TEST_ONLY_KEY'

describe('secure-secrets', () => {
  after(() => {
    try {
      deleteSecret(TEST_KEY)
    } catch {
      /* ignore */
    }
  })

  it('encrypts and loads secrets round-trip', () => {
    setSecret(TEST_KEY, 'super-secret-value-123')
    const all = loadSecrets()
    assert.equal(all[TEST_KEY], 'super-secret-value-123')
    const status = getSecretsStatus([TEST_KEY, 'OPENAI_API_KEY'])
    assert.ok(status.configuredKeys.includes(TEST_KEY))
    // never expose full list dump with wrong key
    assert.equal(status.configuredKeys.includes('NOT_A_KEY'), false)
  })

  it('deletes secrets', () => {
    setSecret(TEST_KEY, 'x')
    deleteSecret(TEST_KEY)
    const all = loadSecrets()
    assert.equal(all[TEST_KEY], undefined)
  })

  it('persists settings leaderModel', () => {
    const prev = loadSettings()
    const next = saveSettings({ leaderModel: 'anthropic/claude-sonnet-4-6' })
    assert.equal(next.leaderModel, 'anthropic/claude-sonnet-4-6')
    assert.equal(loadSettings().leaderModel, 'anthropic/claude-sonnet-4-6')
    // restore
    saveSettings({ leaderModel: prev.leaderModel || 'openai/gpt-5.5' })
  })

  it('persists thinkingIntensity', () => {
    const prev = loadSettings()
    const next = saveSettings({
      leaderModel: prev.leaderModel,
      thinkingIntensity: 'high',
    })
    assert.equal(next.thinkingIntensity, 'high')
    assert.equal(loadSettings().thinkingIntensity, 'high')
    saveSettings({
      leaderModel: prev.leaderModel,
      thinkingIntensity: prev.thinkingIntensity ?? 'medium',
    })
  })
})
