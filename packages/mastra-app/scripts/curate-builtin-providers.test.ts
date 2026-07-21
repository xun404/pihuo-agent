import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildBuiltinCatalog,
  compareVersionDesc,
  filterAndSortModels,
  type BuiltinProvidersPolicy,
} from './curate-builtin-providers.ts'

describe('curate-builtin-providers', () => {
  it('sorts model versions newest first', () => {
    const ids = ['gpt-5.4', 'gpt-5.6', 'gpt-5.5', 'gpt-5.5-pro']
    assert.deepEqual([...ids].sort(compareVersionDesc).slice(0, 2), ['gpt-5.6', 'gpt-5.5'])
  })

  it('filters openai chat models and drops image/embed', () => {
    const policy = {
      id: 'openai',
      name: 'OpenAI',
      apiKeyEnv: 'OPENAI_API_KEY',
      docsUrl: 'https://example.com',
      maxModels: 5,
      includePrefixes: ['gpt-5.', 'o4-mini'],
      excludeSubstrings: ['image', 'embedding', 'nano'],
      tagRules: [{ match: '', tag: 'flagship' as const }],
      contextWindowDefault: 400000,
    }
    const out = filterAndSortModels(
      ['gpt-5.6', 'gpt-image-1', 'gpt-5.4-nano', 'o4-mini', 'text-embedding-3-large', 'gpt-5.5'],
      policy,
    )
    assert.deepEqual(out, ['gpt-5.6', 'gpt-5.5', 'o4-mini'])
  })

  it('builds catalog with default leader and recommended', () => {
    const policy: BuiltinProvidersPolicy = {
      version: 1,
      providers: [
        {
          id: 'openai',
          name: 'OpenAI',
          apiKeyEnv: 'OPENAI_API_KEY',
          docsUrl: 'https://example.com',
          maxModels: 3,
          includePrefixes: ['gpt-5.'],
          excludeSubstrings: [],
          tagRules: [{ match: '', tag: 'flagship' }],
          contextWindowDefault: 400000,
        },
      ],
      defaultLeaderPreferPrefixes: ['openai/gpt-5.'],
      recommended: [
        {
          providerId: 'openai',
          preferContains: ['gpt-5.'],
          excludeContains: ['pro'],
          reason: 'balanced',
        },
      ],
    }
    const catalog = buildBuiltinCatalog(
      policy,
      { openai: ['gpt-5.5-pro', 'gpt-5.6', 'gpt-5.4'] },
      '1.0.0',
      '2026-01-01T00:00:00.000Z',
    )
    assert.equal(catalog.defaultLeaderModel, 'openai/gpt-5.6')
    assert.equal(catalog.recommended[0]?.id, 'openai/gpt-5.6')
    assert.equal(catalog.providers[0]?.models[0]?.id, 'openai/gpt-5.6')
  })
})
