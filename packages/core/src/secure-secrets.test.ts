import { describe, it, after, before, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  loadSecrets,
  setSecret,
  deleteSecret,
  saveSettings,
  loadSettings,
  getSecretsStatus,
  collectExecutionRelevantEnv,
  computeAcpExecutionFingerprint,
  setTestMasterKey,
  isConfigurableSecretEnvKey,
} from './secure-secrets.js'
import type { CustomProviderSettings } from './secure-secrets.js'

const TEST_KEY = 'RA_TEST_ONLY_API_KEY'

describe('secure-secrets', () => {
  let dataDir: string
  let prevDataDir: string | undefined
  let prevSecret: string | undefined

  before(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'router-secure-secrets-'))
    prevDataDir = process.env.SWARMDESK_AGENT_DATA_DIR
    prevSecret = process.env.SWARMDESK_AGENT_CREDENTIAL_SECRET
    process.env.SWARMDESK_AGENT_DATA_DIR = dataDir
    process.env.SWARMDESK_AGENT_CREDENTIAL_SECRET = 'secure-secrets-test-key'
  })

  after(() => {
    try {
      deleteSecret(TEST_KEY)
    } catch {
      /* ignore */
    }
    if (prevDataDir === undefined) delete process.env.SWARMDESK_AGENT_DATA_DIR
    else process.env.SWARMDESK_AGENT_DATA_DIR = prevDataDir
    if (prevSecret === undefined) delete process.env.SWARMDESK_AGENT_CREDENTIAL_SECRET
    else process.env.SWARMDESK_AGENT_CREDENTIAL_SECRET = prevSecret
    try {
      rmSync(dataDir, { recursive: true, force: true })
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
    assert.equal(status.configuredKeys.includes('NOT_A_KEY'), false)
    // Master key is derived from machine identity, never persisted to disk.
    assert.equal(existsSync(join(dataDir, '.master-key')), false)
  })

  it('deletes secrets', () => {
    setSecret(TEST_KEY, 'x')
    deleteSecret(TEST_KEY)
    const all = loadSecrets()
    assert.equal(all[TEST_KEY], undefined)
  })

  it('rejects runtime and process-control names as provider secret keys', () => {
    for (const key of [
      'SWARMDESK_AGENT_INTERNAL_TOKEN',
      'SWARMDESK_AGENT_STUDIO_TOKEN',
      'MASTRA_API_TOKEN',
      'NODE_OPTIONS',
      'ELECTRON_RUN_AS_NODE',
      'VITE_DEV_SERVER_URL',
      'PATH',
      'LD_PRELOAD',
      'lowercase_key',
    ]) {
      assert.equal(isConfigurableSecretEnvKey(key), false, key)
      assert.throws(() => setSecret(key, 'must-not-persist'), /invalid or reserved/i)
    }
    assert.equal(isConfigurableSecretEnvKey('CUSTOM_GATEWAY_API_KEY'), true)
    assert.equal(isConfigurableSecretEnvKey('OPENAI_API_KEY'), true)
  })

  it('rejects custom providers that alias a reserved environment key', () => {
    const prev = loadSettings()
    assert.throws(
      () =>
        saveSettings({
          ...prev,
          customProviders: [
            {
              id: 'unsafe-provider',
              name: 'Unsafe',
              apiKeyEnv: 'SWARMDESK_AGENT_STUDIO_TOKEN',
              models: [{ id: 'unsafe-provider/model', label: 'Model' }],
            },
          ],
        }),
      /invalid or reserved/i,
    )
  })

  it('persists settings leaderModel', () => {
    const prev = loadSettings()
    const next = saveSettings({ leaderModel: 'anthropic/claude-sonnet-4-6' })
    assert.equal(next.leaderModel, 'anthropic/claude-sonnet-4-6')
    assert.equal(loadSettings().leaderModel, 'anthropic/claude-sonnet-4-6')
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

  it('persists the custom provider enabled flag used by Desktop settings', () => {
    const prev = loadSettings()
    const provider: CustomProviderSettings = {
      id: 'disabled-provider',
      name: 'Disabled Provider',
      apiKeyEnv: TEST_KEY,
      enabled: false,
      models: [{ id: 'disabled-provider/model', label: 'Model' }],
    }
    try {
      const next = saveSettings({
        ...prev,
        customProviders: [provider],
      })
      assert.equal(next.customProviders?.[0]?.enabled, false)
      assert.equal(loadSettings().customProviders?.[0]?.enabled, false)
    } finally {
      saveSettings(prev)
    }
  })
})

// ── collectExecutionRelevantEnv ──

describe('collectExecutionRelevantEnv', () => {
  it('includes all explicit worker env keys', () => {
    const result = collectExecutionRelevantEnv({ MY_CUSTOM_VAR: 'val1', ANOTHER: 'val2' }, {})
    assert.equal(result.MY_CUSTOM_VAR, 'val1')
    assert.equal(result.ANOTHER, 'val2')
  })

  it('includes ambient exact keys: PATH, HOME, USERPROFILE', () => {
    const result = collectExecutionRelevantEnv(
      {},
      { PATH: '/usr/bin', HOME: '/home/user', USERPROFILE: 'C:\\Users\\u', OTHER: 'ignored' },
    )
    assert.equal(result.PATH, '/usr/bin')
    assert.equal(result.HOME, '/home/user')
    assert.equal(result.USERPROFILE, 'C:\\Users\\u')
    assert.equal('OTHER' in result, false)
  })

  it('includes ambient proxy env vars', () => {
    const result = collectExecutionRelevantEnv(
      {},
      {
        HTTP_PROXY: 'http://a:8080',
        HTTPS_PROXY: 'https://b:8443',
        ALL_PROXY: 'socks://c:1080',
        NO_PROXY: 'localhost',
        SSL_CERT_FILE: '/etc/ssl/cert.pem',
        NODE_EXTRA_CA_CERTS: '/etc/ssl/ca.pem',
        NODE_OPTIONS: '--max-old-space-size=4096',
      },
    )
    assert.equal(result.HTTP_PROXY, 'http://a:8080')
    assert.equal(result.HTTPS_PROXY, 'https://b:8443')
    assert.equal(result.ALL_PROXY, 'socks://c:1080')
    assert.equal(result.NO_PROXY, 'localhost')
    assert.equal(result.SSL_CERT_FILE, '/etc/ssl/cert.pem')
    assert.equal(result.NODE_EXTRA_CA_CERTS, '/etc/ssl/ca.pem')
    assert.equal(result.NODE_OPTIONS, '--max-old-space-size=4096')
  })

  it('includes ambient prefix-matched keys', () => {
    const result = collectExecutionRelevantEnv(
      {},
      {
        XDG_CONFIG_HOME: '/home/user/.config',
        NPM_CONFIG_REGISTRY: 'https://registry.npmjs.org',
        OPENAI_API_KEY: 'sk-test',
        ANTHROPIC_API_KEY: 'ant-test',
        GOOGLE_API_KEY: 'g-test',
        GEMINI_API_KEY: 'gem-test',
        AWS_ACCESS_KEY_ID: 'aws-test',
        AZURE_OPENAI_API_KEY: 'az-test',
        OPENCODE_MODEL: 'test-model',
        CLAUDE_CODE_MODEL: 'cc-model',
        CODEX_MODEL: 'cx-model',
      },
    )
    assert.equal(result.XDG_CONFIG_HOME, '/home/user/.config')
    assert.equal(result.NPM_CONFIG_REGISTRY, 'https://registry.npmjs.org')
    assert.equal(result.OPENAI_API_KEY, 'sk-test')
    assert.equal(result.ANTHROPIC_API_KEY, 'ant-test')
    assert.equal(result.GOOGLE_API_KEY, 'g-test')
    assert.equal(result.GEMINI_API_KEY, 'gem-test')
    assert.equal(result.AWS_ACCESS_KEY_ID, 'aws-test')
    assert.equal(result.AZURE_OPENAI_API_KEY, 'az-test')
    assert.equal(result.OPENCODE_MODEL, 'test-model')
    assert.equal(result.CLAUDE_CODE_MODEL, 'cc-model')
    assert.equal(result.CODEX_MODEL, 'cx-model')
  })

  it('includes ambient suffix-matched keys', () => {
    const result = collectExecutionRelevantEnv(
      {},
      {
        CUSTOM_API_KEY: 'secret1',
        GITHUB_TOKEN: 'ghp_test',
        API_BASE_URL: 'https://api.example.com',
        DEFAULT_MODEL: 'gpt-4',
        USER_PROFILE: 'profile-1',
      },
    )
    assert.equal(result.CUSTOM_API_KEY, 'secret1')
    assert.equal(result.GITHUB_TOKEN, 'ghp_test')
    assert.equal(result.API_BASE_URL, 'https://api.example.com')
    assert.equal(result.DEFAULT_MODEL, 'gpt-4')
    assert.equal(result.USER_PROFILE, 'profile-1')
  })

  it('excludes SHLVL, TERM_SESSION_ID, PWD, _', () => {
    const result = collectExecutionRelevantEnv(
      {},
      { SHLVL: '3', TERM_SESSION_ID: 'abc123', PWD: '/tmp', _: '/usr/bin/node' },
    )
    assert.equal('SHLVL' in result, false)
    assert.equal('TERM_SESSION_ID' in result, false)
    assert.equal('PWD' in result, false)
    assert.equal('_' in result, false)
  })

  it('worker env overrides ambient for same key', () => {
    const result = collectExecutionRelevantEnv(
      { HOME: '/worker/home', PATH: '/worker/bin' },
      { HOME: '/ambient/home', PATH: '/ambient/bin' },
    )
    assert.equal(result.HOME, '/worker/home')
    assert.equal(result.PATH, '/worker/bin')
  })

  it('env key sort order does not affect output', () => {
    const r1 = collectExecutionRelevantEnv({ B: '2', A: '1' }, { D: '4', C: '3' })
    const r2 = collectExecutionRelevantEnv({ A: '1', B: '2' }, { C: '3', D: '4' })
    assert.deepEqual(Object.keys(r1).sort(), Object.keys(r2).sort())
    assert.deepEqual(r1, r2)
  })

  it('case-insensitive match for proxy env vars', () => {
    const result = collectExecutionRelevantEnv(
      {},
      { http_proxy: 'http://lo:8080', HTTPS_PROXY: 'https://hi:8443', no_proxy: 'lo' },
    )
    assert.equal(result.http_proxy, 'http://lo:8080')
    assert.equal(result.HTTPS_PROXY, 'https://hi:8443')
    assert.equal(result.no_proxy, 'lo')
  })

  it('prefix match is case-insensitive on keys', () => {
    const result = collectExecutionRelevantEnv(
      {},
      { openai_api_key: 'sk-lower', OPENAI_MODEL: 'gpt-5' },
    )
    assert.equal(result.openai_api_key, 'sk-lower')
    assert.equal(result.OPENAI_MODEL, 'gpt-5')
  })

  it('suffix match is case-insensitive on keys', () => {
    const result = collectExecutionRelevantEnv({}, { my_api_key: 'key1', MY_TOKEN: 'tok1' })
    assert.equal(result.my_api_key, 'key1')
    assert.equal(result.MY_TOKEN, 'tok1')
  })

  it('always includes case-normalized exact ambient keys regardless of casing', () => {
    const result = collectExecutionRelevantEnv({}, { path: '/low', Home: '/low-home' })
    assert.equal(result.path, '/low')
    assert.equal(result.Home, '/low-home')
  })
})

// ── computeAcpExecutionFingerprint ──

describe('computeAcpExecutionFingerprint', () => {
  const TEST_KEY_BUF = randomBytes(32)

  beforeEach(() => {
    setTestMasterKey(TEST_KEY_BUF)
  })

  afterEach(() => {
    setTestMasterKey(null)
  })

  it('same inputs across instances produce same digest', () => {
    const workerEnv = { MY_VAR: 'val' }
    const ambientEnv = { PATH: '/usr/bin', HOME: '/home/u' }
    const f1 = computeAcpExecutionFingerprint('cmd', ['a', 'b'], 'm1', workerEnv, ambientEnv)
    const f2 = computeAcpExecutionFingerprint('cmd', ['a', 'b'], 'm1', workerEnv, ambientEnv)
    assert.equal(f1, f2)
    assert.match(f1, /^[0-9a-f]{64}$/)
  })

  it('different command produces different digest', () => {
    const f1 = computeAcpExecutionFingerprint('cmd-a', [], 'm1', {}, {})
    const f2 = computeAcpExecutionFingerprint('cmd-b', [], 'm1', {}, {})
    assert.notEqual(f1, f2)
  })

  it('different args produce different digest', () => {
    const f1 = computeAcpExecutionFingerprint('cmd', ['a'], 'm1', {}, {})
    const f2 = computeAcpExecutionFingerprint('cmd', ['b'], 'm1', {}, {})
    assert.notEqual(f1, f2)
  })

  it('different model produces different digest', () => {
    const f1 = computeAcpExecutionFingerprint('cmd', [], 'm1', {}, {})
    const f2 = computeAcpExecutionFingerprint('cmd', [], 'm2', {}, {})
    assert.notEqual(f1, f2)
  })

  it('different worker env produces different digest', () => {
    const f1 = computeAcpExecutionFingerprint('cmd', [], 'm1', { K: 'v1' }, {})
    const f2 = computeAcpExecutionFingerprint('cmd', [], 'm1', { K: 'v2' }, {})
    assert.notEqual(f1, f2)
  })

  it('different ambient env (relevant var) produces different digest', () => {
    const f1 = computeAcpExecutionFingerprint('cmd', [], 'm1', {}, { PATH: '/a' })
    const f2 = computeAcpExecutionFingerprint('cmd', [], 'm1', {}, { PATH: '/b' })
    assert.notEqual(f1, f2)
  })

  it('irrelevant ambient env change does not affect digest', () => {
    const f1 = computeAcpExecutionFingerprint('cmd', [], 'm1', {}, { IGNORED: 'a' })
    const f2 = computeAcpExecutionFingerprint('cmd', [], 'm1', {}, { IGNORED: 'b' })
    assert.equal(f1, f2)
  })

  it('fingerprint does not contain env values', () => {
    const fp = computeAcpExecutionFingerprint(
      'cmd',
      [],
      'm1',
      {},
      { OPENAI_API_KEY: 'sk-super-secret' },
    )
    assert.equal(fp.includes('sk-super-secret'), false)
    assert.equal(fp.includes('super-secret'), false)
  })

  it('fingerprint is hex string', () => {
    const fp = computeAcpExecutionFingerprint('cmd', ['a'], 'm1', { K: 'v' }, { PATH: '/bin' })
    assert.match(fp, /^[0-9a-f]{64}$/)
  })

  it('different master keys produce different digests for same inputs', () => {
    const workerEnv = { MY_VAR: 'val' }
    const ambientEnv = { PATH: '/usr/bin' }
    const f1 = computeAcpExecutionFingerprint('cmd', ['a'], 'm1', workerEnv, ambientEnv)

    setTestMasterKey(randomBytes(32))
    const f2 = computeAcpExecutionFingerprint('cmd', ['a'], 'm1', workerEnv, ambientEnv)

    assert.notEqual(f1, f2)
  })

  it('returns digest only, never exports master key', () => {
    const fp = computeAcpExecutionFingerprint('cmd', [], 'm1', {}, {})
    assert.equal(typeof fp, 'string')
    assert.match(fp, /^[0-9a-f]+$/)
  })

  it('command containing | does not collide with args containing | (canonical collision fix)', () => {
    const f1 = computeAcpExecutionFingerprint('a|b', ['c'], 'm1', {}, {})
    const f2 = computeAcpExecutionFingerprint('a', ['b|c'], 'm1', {}, {})
    assert.notEqual(f1, f2)
  })

  it('env values containing delimiters cannot collide with additional env entries', () => {
    const f1 = computeAcpExecutionFingerprint('cmd', [], 'm1', { A: 'b|C=d' }, {})
    const f2 = computeAcpExecutionFingerprint('cmd', [], 'm1', { A: 'b', C: 'd' }, {})
    assert.notEqual(f1, f2)
  })
})
