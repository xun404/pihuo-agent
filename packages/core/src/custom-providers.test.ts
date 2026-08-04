import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyCustomProviderEnv,
  applyMastraProviderKeyAliases,
  mergeProvidersWithCustom,
} from './secure-secrets.js'
import { MASTRA_PROVIDERS, normalizeApiStyle } from './models-catalog.js'

describe('mergeProvidersWithCustom', () => {
  it('appends custom provider and finds it by id', () => {
    const custom = [
      {
        id: 'myco',
        name: 'My Co',
        apiKeyEnv: 'MYCO_API_KEY',
        baseURL: 'https://api.myco.test/v1',
        apiStyle: 'openai' as const,
        contextWindow: 128000,
        models: [{ id: 'myco/fast-1', label: 'Fast 1', contextWindow: 64000 }],
      },
    ]
    const merged = mergeProvidersWithCustom(MASTRA_PROVIDERS, custom)
    const found = merged.find((p) => p.id === 'myco')
    assert.ok(found)
    assert.equal(found!.name, 'My Co')
    assert.equal(found!.apiKeyEnv, 'MYCO_API_KEY')
    assert.equal(found!.models[0]!.id, 'myco/fast-1')
    assert.equal(found!.baseURL, 'https://api.myco.test/v1')
    assert.equal(found!.apiStyle, 'openai')
    assert.equal(found!.models[0]!.contextWindow, 64000)
    // builtins still present
    assert.ok(merged.some((p) => p.id === 'openai'))
  })

  it('does not override builtin id', () => {
    const custom = [
      {
        id: 'openai',
        name: 'Fake',
        apiKeyEnv: 'X',
        models: [{ id: 'openai/x', label: 'X' }],
      },
    ]
    const merged = mergeProvidersWithCustom(MASTRA_PROVIDERS, custom)
    const openai = merged.filter((p) => p.id === 'openai')
    assert.equal(openai.length, 1)
    assert.notEqual(openai[0]!.name, 'Fake')
  })

  it('keeps a curated builtin set (not a marketplace catalog)', () => {
    const ids = MASTRA_PROVIDERS.map((p) => p.id)
    assert.deepEqual(ids, ['openai', 'anthropic', 'google', 'xai', 'deepseek', 'opencode-go'])
  })
})

describe('applyCustomProviderEnv', () => {
  it('writes base URL env vars from custom providers', () => {
    const env: NodeJS.ProcessEnv = {}
    applyCustomProviderEnv(
      [
        {
          id: 'myco',
          name: 'My Co',
          apiKeyEnv: 'MYCO_API_KEY',
          baseURL: 'https://gw.example.com/v1/',
          apiStyle: 'openai',
          models: [{ id: 'myco/m', label: 'M' }],
        },
      ],
      env,
    )
    assert.equal(env.MYCO_BASE_URL, 'https://gw.example.com/v1')
    assert.equal(env.MYCO_API_BASE_URL, 'https://gw.example.com/v1')
  })
})

describe('applyMastraProviderKeyAliases', () => {
  it('aliases CUSTOM_OPENCODE_GO_API_KEY → OPENCODE_API_KEY for opencode-go', () => {
    const env: NodeJS.ProcessEnv = {}
    const secrets = { CUSTOM_OPENCODE_GO_API_KEY: 'sk-opencode-test-key' }
    applyMastraProviderKeyAliases(
      [
        {
          id: 'opencode-go',
          name: 'OpenCode-GO',
          apiKeyEnv: 'CUSTOM_OPENCODE_GO_API_KEY',
          baseURL: 'https://opencode.ai/zen/go/v1',
          apiStyle: 'openai',
          models: [{ id: 'opencode-go/deepseek-v4-flash', label: 'deepseek-v4-flash' }],
        },
      ],
      secrets,
      env,
    )
    assert.equal(env.OPENCODE_API_KEY, 'sk-opencode-test-key')
    assert.equal(env.OPENCODE_GO_API_KEY, 'sk-opencode-test-key')
    assert.equal(env.CUSTOM_OPENCODE_GO_API_KEY, 'sk-opencode-test-key')
  })

  it('settings secret wins over stale process OPENCODE_API_KEY (worker>settings>process)', () => {
    const env: NodeJS.ProcessEnv = { OPENCODE_API_KEY: 'stale-process' }
    applyMastraProviderKeyAliases(
      [
        {
          id: 'opencode-go',
          name: 'OpenCode-GO',
          apiKeyEnv: 'CUSTOM_OPENCODE_GO_API_KEY',
          models: [{ id: 'opencode-go/x', label: 'x' }],
        },
      ],
      { CUSTOM_OPENCODE_GO_API_KEY: 'from-custom' },
      env,
    )
    // Resolver priority: settings secret must replace process env for registry aliases
    assert.equal(env.OPENCODE_API_KEY, 'from-custom')
  })

  it('forces OPENCODE_GO_API_KEY when shell has a different stale key', () => {
    const env: NodeJS.ProcessEnv = {
      OPENCODE_API_KEY: 'new-saved-key',
      OPENCODE_GO_API_KEY: 'stale-shell-key-from-cli',
    }
    applyMastraProviderKeyAliases(
      [
        {
          id: 'opencode-go',
          name: 'OpenCodeGO',
          apiKeyEnv: 'OPENCODE_API_KEY',
          baseURL: 'https://opencode.ai/zen/go/v1',
          models: [{ id: 'opencode-go/deepseek-v4-pro', label: 'pro' }],
        },
      ],
      { OPENCODE_API_KEY: 'new-saved-key' },
      env,
    )
    assert.equal(env.OPENCODE_API_KEY, 'new-saved-key')
    assert.equal(env.OPENCODE_GO_API_KEY, 'new-saved-key')
  })

  it('does not let stale CUSTOM_OPENCODEGO overwrite configured OPENCODE_API_KEY', () => {
    const env: NodeJS.ProcessEnv = {}
    applyMastraProviderKeyAliases(
      [
        {
          id: 'opencode-go',
          name: 'OpenCodeGO',
          apiKeyEnv: 'OPENCODE_API_KEY',
          baseURL: 'https://opencode.ai/zen/go/v1',
          models: [{ id: 'opencode-go/deepseek-v4-pro', label: 'pro' }],
        },
      ],
      {
        OPENCODE_API_KEY: 'valid-primary-key',
        CUSTOM_OPENCODEGO_API_KEY: 'stale-billing-dead-key',
      },
      env,
    )
    assert.equal(env.OPENCODE_API_KEY, 'valid-primary-key')
    assert.equal(env.OPENCODE_GO_API_KEY, 'valid-primary-key')
    assert.equal(env.CUSTOM_OPENCODEGO_API_KEY, 'valid-primary-key')
  })

  it('aliases from CUSTOM_* secret key even without customProviders entry', () => {
    const env: NodeJS.ProcessEnv = {}
    applyMastraProviderKeyAliases([], { CUSTOM_OPENCODE_GO_API_KEY: 'sk-from-secret-only' }, env)
    assert.equal(env.OPENCODE_API_KEY, 'sk-from-secret-only')
  })
})

describe('normalizeApiStyle', () => {
  it('maps aliases to openai|anthropic|google|custom', () => {
    assert.equal(normalizeApiStyle('openai'), 'openai')
    assert.equal(normalizeApiStyle('claude'), 'anthropic')
    assert.equal(normalizeApiStyle('gemini'), 'google')
    assert.equal(normalizeApiStyle('custom'), 'custom')
    assert.equal(normalizeApiStyle(undefined), 'openai')
  })
})
