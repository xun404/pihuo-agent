import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveProviderEnv,
  PROVIDER_ENV_OVERRIDES,
  type ProviderEnvResolveInput,
} from './provider-env-resolver.js'
import { MASTRA_GATEWAY_API_KEY_ENV } from './secure-secrets.js'

const base: ProviderEnvResolveInput = {
  providerId: 'openai',
  registryApiKeyEnvVar: 'OPENAI_API_KEY',
  workerEnv: {},
  settingsSecrets: {},
  processEnv: {},
  overrides: {},
}

describe('resolveProviderEnv', () => {
  it('prefers worker.env over settings secrets', () => {
    const r = resolveProviderEnv({
      ...base,
      workerEnv: { OPENAI_API_KEY: 'from-worker' },
      settingsSecrets: { OPENAI_API_KEY: 'from-settings' },
      processEnv: { OPENAI_API_KEY: 'from-process' },
    })
    assert.equal(r.env.OPENAI_API_KEY, 'from-worker')
    assert.equal(r.diagnostics[0]!.source, 'worker_env')
    assert.ok(!('value' in r.diagnostics[0]!))
  })

  it('does not copy one provider key to another without evidence', () => {
    const r = resolveProviderEnv({
      ...base,
      providerId: 'anthropic',
      registryApiKeyEnvVar: 'ANTHROPIC_API_KEY',
      processEnv: { OPENAI_API_KEY: 'sk-openai' },
    })
    assert.equal(r.env.ANTHROPIC_API_KEY, undefined)
  })

  it('applies registry apiKeyEnvVar array as aliases without overwriting higher priority', () => {
    const r = resolveProviderEnv({
      ...base,
      providerId: 'google',
      registryApiKeyEnvVar: ['GOOGLE_GENERATIVE_AI_API_KEY', 'GOOGLE_API_KEY'],
      processEnv: { GOOGLE_API_KEY: 'gkey' },
    })
    assert.equal(r.env.GOOGLE_API_KEY, 'gkey')
    assert.equal(r.env.GOOGLE_GENERATIVE_AI_API_KEY, 'gkey')
  })

  it('uses one winning credential for all aliases when sources split across names', () => {
    const r = resolveProviderEnv({
      ...base,
      providerId: 'google',
      registryApiKeyEnvVar: ['GOOGLE_GENERATIVE_AI_API_KEY', 'GOOGLE_API_KEY'],
      workerEnv: { GOOGLE_API_KEY: 'from-worker' },
      settingsSecrets: { GOOGLE_GENERATIVE_AI_API_KEY: 'from-settings' },
      processEnv: {},
    })
    assert.equal(r.env.GOOGLE_API_KEY, 'from-worker')
    assert.equal(r.env.GOOGLE_GENERATIVE_AI_API_KEY, 'from-worker')
    const byName = Object.fromEntries(r.diagnostics.map((d) => [d.envName, d.source]))
    assert.equal(byName.GOOGLE_API_KEY, 'worker_env')
    assert.equal(byName.GOOGLE_GENERATIVE_AI_API_KEY, 'derived_alias')
  })

  it('worker wins across aliases even when higher-priority name only exists in settings', () => {
    const r = resolveProviderEnv({
      ...base,
      providerId: 'google',
      registryApiKeyEnvVar: ['GOOGLE_GENERATIVE_AI_API_KEY', 'GOOGLE_API_KEY'],
      workerEnv: { GOOGLE_API_KEY: 'worker-only' },
      settingsSecrets: { GOOGLE_GENERATIVE_AI_API_KEY: 'settings-first-name' },
      processEnv: { GOOGLE_GENERATIVE_AI_API_KEY: 'process-first-name' },
    })
    assert.equal(r.env.GOOGLE_GENERATIVE_AI_API_KEY, 'worker-only')
    assert.equal(r.env.GOOGLE_API_KEY, 'worker-only')
  })

  it('does not set global OPENAI_BASE_URL for arbitrary custom providers', () => {
    const r = resolveProviderEnv({
      ...base,
      providerId: 'my-gateway',
      registryApiKeyEnvVar: 'MY_GATEWAY_API_KEY',
      customBaseURL: 'https://example.com/v1',
      processEnv: {},
      allowGlobalBaseUrlAliases: false,
    })
    assert.equal(r.env.MY_GATEWAY_BASE_URL, 'https://example.com/v1')
    assert.equal(r.env.OPENAI_BASE_URL, undefined)
  })

  it('exports PROVIDER_ENV_OVERRIDES and keeps MASTRA_GATEWAY_API_KEY_ENV compatible', () => {
    assert.ok(PROVIDER_ENV_OVERRIDES.google)
    assert.ok(PROVIDER_ENV_OVERRIDES['opencode-go'])
    assert.equal(MASTRA_GATEWAY_API_KEY_ENV, PROVIDER_ENV_OVERRIDES)
    const google = PROVIDER_ENV_OVERRIDES.google
    // PROVIDER_ENV_OVERRIDES values are string | string[] (env name aliases)
    const aliases = Array.isArray(google) ? google : typeof google === 'string' ? [google] : []
    assert.ok(
      aliases.includes('GOOGLE_GENERATIVE_AI_API_KEY') || aliases.includes('GOOGLE_API_KEY'),
    )
  })
})
