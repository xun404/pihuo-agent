import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildEffectiveWorkerEnv, credentialKeysForModel } from './worker-env.js'

describe('buildEffectiveWorkerEnv', () => {
  const ambient = {
    PATH: '/usr/bin',
    HOME: '/home/u',
    SHELL: '/bin/zsh',
    LANG: 'en_US.UTF-8',
    TMPDIR: '/tmp',
    XDG_DATA_HOME: '/home/u/.local/share',
    OPENAI_API_KEY: 'sk-openai-secret',
    ANTHROPIC_API_KEY: 'sk-anthropic-secret',
    XAI_API_KEY: 'xai-secret',
    SWARMDESK_AGENT_INTERNAL_TOKEN: 'internal-tok',
    SWARMDESK_AGENT_DESKTOP_TOKEN: 'desktop-tok',
    SWARMDESK_AGENT_STUDIO_TOKEN: 'studio-tok',
    SWARMDESK_AGENT_ACP_FINGERPRINT_KEY: 'fingerprint-key',
    SWARMDESK_AGENT_WORKER_SECRETS_KEY: 'worker-secret-capability',
    SWARMDESK_AGENT_SECRETS_PARENT_INJECTED: '1',
    ELECTRON_RUN_AS_NODE: '1',
    CUSTOM_JUNK: 'should-not-pass',
    NODE_ENV: 'test',
  }

  it('includes ambient whitelist only', () => {
    const env = buildEffectiveWorkerEnv({ ambientEnv: ambient })
    assert.equal(env.PATH, '/usr/bin')
    assert.equal(env.HOME, '/home/u')
    assert.equal(env.LANG, 'en_US.UTF-8')
    assert.equal(env.NODE_ENV, 'test')
    assert.equal(env.CUSTOM_JUNK, undefined)
    assert.equal(env.OPENAI_API_KEY, undefined)
    assert.equal(env.ANTHROPIC_API_KEY, undefined)
    assert.equal(env.SWARMDESK_AGENT_INTERNAL_TOKEN, undefined)
    assert.equal(env.SWARMDESK_AGENT_DESKTOP_TOKEN, undefined)
    assert.equal(env.SWARMDESK_AGENT_STUDIO_TOKEN, undefined)
    assert.equal(env.SWARMDESK_AGENT_ACP_FINGERPRINT_KEY, undefined)
    assert.equal(env.SWARMDESK_AGENT_WORKER_SECRETS_KEY, undefined)
    assert.equal(env.SWARMDESK_AGENT_SECRETS_PARENT_INJECTED, undefined)
    assert.equal(env.ELECTRON_RUN_AS_NODE, undefined)
  })

  it('never forwards owner-only runtime values through ambient or worker overrides', () => {
    const forbidden = [
      'SWARMDESK_AGENT_INTERNAL_TOKEN',
      'SWARMDESK_AGENT_DESKTOP_TOKEN',
      'SWARMDESK_AGENT_STUDIO_TOKEN',
      'SWARMDESK_AGENT_ACP_FINGERPRINT_KEY',
      'SWARMDESK_AGENT_WORKER_SECRETS_KEY',
      'SWARMDESK_AGENT_SECRETS_PARENT_INJECTED',
      'MASTRA_API_TOKEN',
      'ELECTRON_RUN_AS_NODE',
      'ELECTRON_NO_ATTACH_CONSOLE',
    ]
    const env = buildEffectiveWorkerEnv({
      ambientEnv: {
        ...ambient,
        MASTRA_API_TOKEN: 'mastra-token',
        ELECTRON_NO_ATTACH_CONSOLE: '1',
      },
      workerEnv: Object.fromEntries(forbidden.map((key) => [key, 'forced-value'])),
      extraAmbientKeys: forbidden,
    })
    for (const key of forbidden) assert.equal(env[key], undefined, key)
  })

  it('cannot smuggle the worker-secret capability through any input layer', () => {
    const key = 'SWARMDESK_AGENT_WORKER_SECRETS_KEY'
    const env = buildEffectiveWorkerEnv({
      ambientEnv: { [key]: 'ambient', PATH: '/bin' },
      workerEnv: { [key]: 'worker-env' },
      workerSecrets: { [key]: 'worker-secret-value' },
      extraAmbientKeys: [key],
    })
    assert.equal(env[key], undefined)
  })

  it('only injects credentials for the selected model provider', () => {
    const env = buildEffectiveWorkerEnv({
      ambientEnv: ambient,
      model: 'anthropic/claude-sonnet-4',
    })
    assert.equal(env.ANTHROPIC_API_KEY, 'sk-anthropic-secret')
    assert.equal(env.OPENAI_API_KEY, undefined)
    assert.equal(env.XAI_API_KEY, undefined)
  })

  it('allows worker-configured secrets for that worker', () => {
    const env = buildEffectiveWorkerEnv({
      ambientEnv: ambient,
      workerEnv: { OPENAI_API_KEY: 'worker-openai', MY_CUSTOM: 'ok' },
    })
    assert.equal(env.OPENAI_API_KEY, 'worker-openai')
    assert.equal(env.MY_CUSTOM, 'ok')
    assert.equal(env.ANTHROPIC_API_KEY, undefined)
  })

  it('does not leave unrelated provider keys after model switch', () => {
    const forAnthropic = buildEffectiveWorkerEnv({
      ambientEnv: ambient,
      model: 'anthropic/claude-3',
    })
    const forOpenai = buildEffectiveWorkerEnv({
      ambientEnv: ambient,
      model: 'openai/gpt-4o',
    })
    assert.equal(forAnthropic.OPENAI_API_KEY, undefined)
    assert.equal(forOpenai.ANTHROPIC_API_KEY, undefined)
    assert.equal(forOpenai.OPENAI_API_KEY, 'sk-openai-secret')
  })

  it('worker env overlays ambient PATH', () => {
    const env = buildEffectiveWorkerEnv({
      ambientEnv: ambient,
      workerEnv: { PATH: '/custom/bin:/usr/bin' },
    })
    assert.equal(env.PATH, '/custom/bin:/usr/bin')
  })
})

describe('credentialKeysForModel', () => {
  it('maps providers', () => {
    assert.deepEqual(credentialKeysForModel('openai/gpt-4o'), ['OPENAI_API_KEY'])
    assert.deepEqual(credentialKeysForModel('anthropic/claude'), ['ANTHROPIC_API_KEY'])
    assert.deepEqual(credentialKeysForModel(''), [])
    assert.deepEqual(credentialKeysForModel(null), [])
  })
})
