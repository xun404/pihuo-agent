import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  inferMastraProviderId,
  normalizeCustomProvidersForMastra,
  normalizeLeaderModelForMastra,
  normalizeMastraModelId,
  normalizeMastraProviderId,
} from './provider-ids.js'

describe('provider-ids', () => {
  it('maps collapsed OpenCodeGO slug to opencode-go', () => {
    assert.equal(normalizeMastraProviderId('opencodego'), 'opencode-go')
    assert.equal(normalizeMastraProviderId('opencode-go'), 'opencode-go')
    assert.equal(
      normalizeMastraModelId('opencodego/deepseek-v4-flash'),
      'opencode-go/deepseek-v4-flash',
    )
  })

  it('infers opencode-go from name and baseURL', () => {
    assert.equal(inferMastraProviderId({ name: 'OpenCodeGO' }), 'opencode-go')
    assert.equal(
      inferMastraProviderId({ name: 'Company', baseURL: 'https://opencode.ai/zen/go/v1' }),
      'opencode-go',
    )
  })

  it('normalizes custom providers + leader model in settings', () => {
    const custom = normalizeCustomProvidersForMastra([
      {
        id: 'opencodego',
        name: 'OpenCodeGO',
        apiKeyEnv: 'CUSTOM_OPENCODEGO_API_KEY',
        baseURL: 'https://opencode.ai/zen/go/v1',
        models: [{ id: 'opencodego/deepseek-v4-flash', label: 'deepseek-v4-flash' }],
      },
    ])
    assert.equal(custom[0]!.id, 'opencode-go')
    assert.equal(custom[0]!.models![0]!.id, 'opencode-go/deepseek-v4-flash')
    assert.equal(
      normalizeLeaderModelForMastra('opencodego/deepseek-v4-flash', custom),
      'opencode-go/deepseek-v4-flash',
    )
  })
})
