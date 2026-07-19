import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { applyProviderBaseUrlForModel, resolveProviderBaseUrlForModel } from './secure-secrets.js'

describe('resolveProviderBaseUrlForModel', () => {
  const custom = [
    {
      id: 'gw-a',
      name: 'A',
      apiKeyEnv: 'A_KEY',
      baseURL: 'https://a.example/v1',
      apiStyle: 'openai' as const,
      models: [{ id: 'm', label: 'm' }],
    },
    {
      id: 'gw-b',
      name: 'B',
      apiKeyEnv: 'B_KEY',
      baseURL: 'https://b.example/v1',
      apiStyle: 'openai' as const,
      models: [{ id: 'm', label: 'm' }],
    },
  ]

  it('resolves without writing process.env', () => {
    const before = process.env.OPENAI_BASE_URL
    const r = resolveProviderBaseUrlForModel('gw-a/m', custom)
    assert.equal(r?.baseURL, 'https://a.example/v1')
    assert.equal(process.env.OPENAI_BASE_URL, before)
  })

  it('apply only writes into explicit target, not process.env by default', () => {
    const before = process.env.OPENAI_BASE_URL
    applyProviderBaseUrlForModel('gw-a/m', custom) // no target → no write
    assert.equal(process.env.OPENAI_BASE_URL, before)
    const bag: NodeJS.ProcessEnv = {}
    applyProviderBaseUrlForModel('gw-b/m', custom, bag)
    assert.equal(bag.OPENAI_BASE_URL, 'https://b.example/v1')
    assert.equal(process.env.OPENAI_BASE_URL, before)
  })

  it('concurrent A then B on separate targets do not cross-wire', () => {
    const a: NodeJS.ProcessEnv = {}
    const b: NodeJS.ProcessEnv = {}
    applyProviderBaseUrlForModel('gw-a/m', custom, a)
    applyProviderBaseUrlForModel('gw-b/m', custom, b)
    assert.equal(a.OPENAI_BASE_URL, 'https://a.example/v1')
    assert.equal(b.OPENAI_BASE_URL, 'https://b.example/v1')
  })
})
