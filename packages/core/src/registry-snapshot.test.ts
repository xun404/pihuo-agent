import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  loadRegistrySnapshot,
  writePersistedRegistrySnapshot,
  type RegistrySnapshot,
} from './registry-snapshot.js'

function sampleSnapshot(overrides?: Partial<RegistrySnapshot>): RegistrySnapshot {
  return {
    version: 1,
    source: 'bundled',
    mastraPackageVersion: '1.0.0-test',
    generatedAt: '2026-07-15T00:00:00.000Z',
    providers: [
      {
        id: 'openai',
        name: 'OpenAI',
        apiKeyEnvVar: 'OPENAI_API_KEY',
        models: [{ id: 'openai/gpt-test', label: 'GPT Test' }],
      },
    ],
    ...overrides,
  }
}

describe('loadRegistrySnapshot', () => {
  it('prefers persisted last-known-good over bundled', () => {
    const dir = mkdtempSync(join(tmpdir(), 'reg-snap-'))
    const persisted = sampleSnapshot({
      source: 'persisted',
      mastraPackageVersion: 'persisted-v',
      providers: [
        {
          id: 'openai',
          name: 'OpenAI',
          apiKeyEnvVar: 'OPENAI_API_KEY',
          models: [{ id: 'openai/from-persist', label: 'Persist' }],
        },
      ],
    })
    writePersistedRegistrySnapshot(persisted, dir)
    const loaded = loadRegistrySnapshot({
      dataDir: dir,
      bundled: sampleSnapshot({ source: 'bundled', mastraPackageVersion: 'bundled-v' }),
      installed: null,
    })
    assert.equal(loaded.ok, true)
    if (!loaded.ok) return
    assert.equal(loaded.source, 'persisted')
    assert.equal(loaded.providers[0]!.models[0]!.id, 'openai/from-persist')
  })

  it('falls back to bundled when persisted missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'reg-snap-'))
    const bundled = sampleSnapshot({ source: 'bundled' })
    const loaded = loadRegistrySnapshot({ dataDir: dir, bundled, installed: null })
    assert.equal(loaded.ok, true)
    if (!loaded.ok) return
    assert.equal(loaded.source, 'bundled')
  })

  it('falls back to installed static registry when bundled missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'reg-snap-'))
    const installed = sampleSnapshot({ source: 'installed', mastraPackageVersion: 'installed-v' })
    const loaded = loadRegistrySnapshot({ dataDir: dir, bundled: null, installed })
    assert.equal(loaded.ok, true)
    if (!loaded.ok) return
    assert.equal(loaded.source, 'installed')
  })

  it('returns error result when all sources unavailable', () => {
    const dir = mkdtempSync(join(tmpdir(), 'reg-snap-'))
    const loaded = loadRegistrySnapshot({ dataDir: dir, bundled: null, installed: null })
    assert.equal(loaded.ok, false)
    if (loaded.ok) return
    assert.equal(loaded.errorCode, 'MODEL_REGISTRY_UNAVAILABLE')
  })
})
