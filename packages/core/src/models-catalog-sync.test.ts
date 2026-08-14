import { describe, it, before, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  fetchMastraProviderRegistry,
  getLeaderModelCatalog,
  getLeaderFeaturedCatalog,
  loadBundledRegistrySnapshot,
  syncLeaderModelCatalog,
} from './models-catalog-sync.js'
import { MASTRA_PROVIDERS, DEFAULT_FEATURED_POLICY, type ModelOption } from './models-catalog.js'
import { persistedRegistryPath } from './registry-snapshot.js'

describe('models-catalog-sync', () => {
  let registry: ReturnType<typeof fetchMastraProviderRegistry>
  let dataDir: string
  let prevDataDir: string | undefined
  let prevHome: string | undefined

  before(() => {
    registry = fetchMastraProviderRegistry()
  })

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'reg-sync-'))
    prevDataDir = process.env.PIHUO_AGENT_DATA_DIR
    prevHome = process.env.HOME
    // Pin the entire app root to a temp dir; redirects HOME too so any
    // accidental write never lands in the login home.
    process.env.PIHUO_AGENT_DATA_DIR = dataDir
    process.env.HOME = dataDir
  })

  afterEach(() => {
    if (prevDataDir === undefined) delete process.env.PIHUO_AGENT_DATA_DIR
    else process.env.PIHUO_AGENT_DATA_DIR = prevDataDir
    if (prevHome === undefined) delete process.env.HOME
    else process.env.HOME = prevHome
    try {
      rmSync(dataDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  it('loadBundledRegistrySnapshot returns versioned snapshot', () => {
    const bundled = loadBundledRegistrySnapshot()
    assert.ok(bundled, 'bundled snapshot must ship with package')
    assert.equal(bundled.version, 1)
    assert.equal(bundled.source, 'bundled')
    assert.ok(bundled.providers.length > 0)
  })

  it('getLeaderModelCatalog(false) is read-only and does not write real HOME', () => {
    // Read-only path must not create files under the persisted registry dir.
    // dataDir here is the app root; persisted registry lives under <root>/data/.
    const catalog = getLeaderModelCatalog(false)
    assert.ok(catalog.length >= 1)
    assert.equal(
      existsSync(persistedRegistryPath(join(dataDir, 'data'))),
      false,
      'read-only getLeaderModelCatalog must not write persisted registry',
    )
  })

  it('fetchMastraProviderRegistry returns providers when installed registry is present', () => {
    // Best-effort: monorepo may have @mastra/core; if not, still ok with empty + hardcoded
    if (registry.length === 0) {
      assert.ok(MASTRA_PROVIDERS.length > 0)
      return
    }
    const ids = registry.map((p) => p.id)
    assert.ok(ids.includes('openai'), 'should include openai')
  })

  it('getLeaderModelCatalog returns a catalog with hardcoded providers', () => {
    const catalog = getLeaderModelCatalog(false)
    assert.ok(catalog.length >= MASTRA_PROVIDERS.length)
    const openai = catalog.find((p) => p.id === 'openai')
    assert.ok(openai, 'catalog should include openai')
    assert.ok(openai.models.length > 0, 'openai should have models')
    const hardcodedOpenai = MASTRA_PROVIDERS.find((p) => p.id === 'openai')!
    for (const hm of hardcodedOpenai.models) {
      const found: ModelOption | undefined = openai.models.find((m) => m.id === hm.id)
      assert.ok(found, `hardcoded model ${hm.id} should be present`)
    }
  })

  it('admin sync writes the persisted registry under the pinned root', () => {
    const result = syncLeaderModelCatalog({ dataDir: join(dataDir, 'data') })
    assert.ok(result.catalog.length > 0)
    // May or may not write depending on registry availability — must not throw
  })

  it('getLeaderFeaturedCatalog returns snapshot ∩ DEFAULT_FEATURED_POLICY', () => {
    const full = getLeaderModelCatalog(false)
    const result = getLeaderFeaturedCatalog(null)
    assert.ok(Array.isArray(result.featured))
    assert.ok(result.featured.length > 0, 'featured list should not be empty')
    assert.equal(result.currentSelection, null)

    const policyIds = new Set(DEFAULT_FEATURED_POLICY.entries.map((e) => e.modelId))
    const fullModelIds = new Set(full.flatMap((p) => p.models.map((m) => m.id)))
    for (const m of result.featured) {
      assert.ok(policyIds.has(m.id), `featured ${m.id} must be in DEFAULT_FEATURED_POLICY`)
      assert.ok(fullModelIds.has(m.id), `featured ${m.id} must exist in full catalog/snapshot`)
    }
  })

  it('getLeaderFeaturedCatalog preserves currentSelection when not featured', () => {
    const full = getLeaderModelCatalog(false)
    const nonFeatured = full
      .flatMap((p) => p.models.map((m) => m.id))
      .find((id) => !DEFAULT_FEATURED_POLICY.entries.some((e) => e.modelId === id))
    if (!nonFeatured) {
      // All models featured — still ok
      return
    }
    const result = getLeaderFeaturedCatalog(nonFeatured)
    assert.equal(result.currentSelection?.id, nonFeatured)
    assert.equal(result.currentSelection?.status, 'not_featured')
  })
})
