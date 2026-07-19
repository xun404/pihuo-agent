import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { saveSettings } from '@router-agents/core'

describe('resolveLeaderModelConfig', () => {
  let dir: string
  let prevData: string | undefined
  let prevModel: string | undefined

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'leader-model-'))
    prevData = process.env.ROUTER_DATA_DIR
    prevModel = process.env.LEADER_MODEL
    process.env.ROUTER_DATA_DIR = dir
    process.env.LEADER_MODEL = 'openai/gpt-4o'
    process.env.CUSTOM_A_API_KEY = 'key-a'
    process.env.CUSTOM_B_API_KEY = 'key-b'
    process.env.OPENAI_API_KEY = 'openai-key'
  })

  afterEach(() => {
    if (prevData !== undefined) process.env.ROUTER_DATA_DIR = prevData
    else delete process.env.ROUTER_DATA_DIR
    if (prevModel !== undefined) process.env.LEADER_MODEL = prevModel
    else delete process.env.LEADER_MODEL
    delete process.env.CUSTOM_A_API_KEY
    delete process.env.CUSTOM_B_API_KEY
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* ok */
    }
  })

  it('returns plain model id for builtin without custom baseURL', async () => {
    const { resolveLeaderModelConfig } = await import('./agents/leader-agent.js')
    const cfg = resolveLeaderModelConfig()
    assert.equal(cfg, 'openai/gpt-4o')
  })

  it('returns request-scoped url/apiKey for custom gateway without mutating global env', async () => {
    saveSettings({
      leaderModel: 'gateway-a/model-x',
      customProviders: [
        {
          id: 'gateway-a',
          name: 'A',
          apiKeyEnv: 'CUSTOM_A_API_KEY',
          baseURL: 'https://a.example.com/v1',
          apiStyle: 'openai',
          models: [{ id: 'model-x', label: 'X' }],
        },
        {
          id: 'gateway-b',
          name: 'B',
          apiKeyEnv: 'CUSTOM_B_API_KEY',
          baseURL: 'https://b.example.com/v1',
          apiStyle: 'openai',
          models: [{ id: 'model-y', label: 'Y' }],
        },
      ],
    })
    const beforeOpenAi = process.env.OPENAI_BASE_URL
    const { resolveLeaderModelConfig } = await import('./agents/leader-agent.js')
    const cfgA = resolveLeaderModelConfig({
      get: (k: string) => (k === 'leaderModel' ? 'gateway-a/model-x' : undefined),
    })
    assert.deepEqual(cfgA, {
      id: 'gateway-a/model-x',
      url: 'https://a.example.com/v1',
      apiKey: 'key-a',
    })
    const cfgB = resolveLeaderModelConfig({
      get: (k: string) => (k === 'leaderModel' ? 'gateway-b/model-y' : undefined),
    })
    assert.deepEqual(cfgB, {
      id: 'gateway-b/model-y',
      url: 'https://b.example.com/v1',
      apiKey: 'key-b',
    })
    // Concurrent A/B must not stomp process.env
    assert.equal(process.env.OPENAI_BASE_URL, beforeOpenAi)
  })
})
