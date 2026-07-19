import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { applyFeaturedPolicy, type FeaturedPolicy } from './featured-policy.js'
import type { RegistrySnapshot } from './registry-snapshot.js'

const snapshot: RegistrySnapshot = {
  version: 1,
  source: 'bundled',
  mastraPackageVersion: 't',
  generatedAt: '2026-07-15T00:00:00.000Z',
  providers: [
    {
      id: 'openai',
      name: 'OpenAI',
      apiKeyEnvVar: 'OPENAI_API_KEY',
      models: [
        { id: 'openai/gpt-featured', label: 'Featured' },
        { id: 'openai/gpt-other', label: 'Other' },
      ],
    },
  ],
}

const policy: FeaturedPolicy = {
  version: 1,
  entries: [{ modelId: 'openai/gpt-featured', tag: 'flagship', sort: 10 }],
}

describe('applyFeaturedPolicy', () => {
  it('returns registry ∩ featured only for default list', () => {
    const r = applyFeaturedPolicy(snapshot, policy, null)
    assert.deepEqual(
      r.featured.map((m) => m.id),
      ['openai/gpt-featured'],
    )
    assert.equal(r.currentSelection, null)
  })

  it('keeps current selection even when not featured', () => {
    const r = applyFeaturedPolicy(snapshot, policy, 'openai/gpt-other')
    assert.equal(r.currentSelection?.id, 'openai/gpt-other')
    assert.equal(r.currentSelection?.status, 'not_featured')
  })

  it('marks unknown current selection without remapping', () => {
    const r = applyFeaturedPolicy(snapshot, policy, 'openai/does-not-exist')
    assert.equal(r.currentSelection?.id, 'openai/does-not-exist')
    assert.equal(r.currentSelection?.status, 'registry_unknown')
  })
})
