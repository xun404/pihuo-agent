import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_FEATURED_POLICY,
  resolveBuiltinProviders,
  type ModelProviderDef,
} from './models-catalog.js'
import { applyFeaturedPolicy, type FeaturedCatalogResult } from './featured-policy.js'
import {
  loadRegistrySnapshot,
  writePersistedRegistrySnapshot,
  type RegistrySnapshot,
} from './registry-snapshot.js'
import { resolveRouterDataPaths } from './router-data-paths.js'

function dataDir(): string {
  return resolveRouterDataPaths().dataDir
}

function cacheFile(): string {
  return resolveRouterDataPaths().modelsCachePath
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000

interface RegistryProvider {
  url?: string
  apiKeyEnvVar: string | string[]
  apiKeyHeader?: string
  name: string
  models: string[]
  docUrl: string
  gateway: string
  npm?: string
}

interface RegistryData {
  providers: Record<string, RegistryProvider>
}

interface CacheEntry {
  timestamp: number
  catalog: ModelProviderDef[]
}

function inferApiStyle(providerId: string, npm?: string): ModelProviderDef['apiStyle'] {
  if (!npm) {
    if (providerId === 'anthropic') return 'anthropic'
    if (providerId === 'google') return 'google'
    return 'openai'
  }
  if (npm.includes('anthropic')) return 'anthropic'
  if (npm.includes('google')) return 'google'
  if (npm.includes('xai')) return 'openai'
  return 'openai'
}

function registryProviderToDef(id: string, rp: RegistryProvider): ModelProviderDef {
  const envVar = rp.apiKeyEnvVar
  const apiKeyEnv = Array.isArray(envVar) ? envVar[0]! : envVar
  const apiKeyEnvAliases = Array.isArray(envVar) ? envVar.slice(1) : undefined

  return {
    id,
    name: rp.name,
    apiKeyEnv,
    ...(apiKeyEnvAliases?.length ? { apiKeyEnvAliases } : {}),
    docsUrl: rp.docUrl,
    apiStyle: inferApiStyle(id, rp.npm),
    ...(rp.url ? { baseURL: rp.url } : {}),
    models: rp.models.map((m) => ({
      id: `${id}/${m}`,
      label: m,
    })),
  }
}

function mergeCatalogs(
  hardcoded: ModelProviderDef[],
  registry: ModelProviderDef[],
): ModelProviderDef[] {
  const merged = new Map<string, ModelProviderDef>()

  for (const p of registry) {
    merged.set(p.id, { ...p })
  }

  for (const p of hardcoded) {
    const existing = merged.get(p.id)
    if (existing) {
      const registryModelIds = new Set(existing.models.map((m) => m.id))
      const hardcodedModelIds = new Set(p.models.map((m) => m.id))
      const mergedModels = [...p.models]
      for (const m of existing.models) {
        if (!hardcodedModelIds.has(m.id)) {
          mergedModels.push(m)
        }
      }
      merged.set(p.id, { ...existing, ...p, models: mergedModels })
    } else {
      merged.set(p.id, p)
    }
  }

  return [...merged.values()]
}

function loadCache(): CacheEntry | null {
  try {
    const file = cacheFile()
    if (!existsSync(file)) return null
    const raw = readFileSync(file, 'utf-8')
    return JSON.parse(raw) as CacheEntry
  } catch {
    return null
  }
}

function saveCache(catalog: ModelProviderDef[]): void {
  try {
    const dir = dirname(cacheFile())
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(cacheFile(), JSON.stringify({ timestamp: Date.now(), catalog }), 'utf-8')
  } catch {
    // non-fatal for production disk issues
  }
}

/** Load versioned bundled snapshot shipped with the package (read-only). */
export function loadBundledRegistrySnapshot(): RegistrySnapshot | null {
  try {
    const fromSrc = dirname(fileURLToPath(import.meta.url))
    const candidates = [
      join(fromSrc, 'bundled/mastra-model-registry.json'),
      join(fromSrc, '../src/bundled/mastra-model-registry.json'),
      join(fromSrc, '../../src/bundled/mastra-model-registry.json'),
    ]
    for (const p of candidates) {
      if (!existsSync(p)) continue
      const raw = JSON.parse(readFileSync(p, 'utf8')) as RegistrySnapshot
      if (raw?.version !== 1 || !Array.isArray(raw.providers)) continue
      return { ...raw, source: 'bundled' }
    }
  } catch {
    /* ignore */
  }
  return null
}

function snapshotToCatalog(snapshot: RegistrySnapshot): ModelProviderDef[] {
  return snapshot.providers.map((p) => {
    const envVar = p.apiKeyEnvVar
    const apiKeyEnv = Array.isArray(envVar) ? envVar[0]! : envVar
    const apiKeyEnvAliases = Array.isArray(envVar) ? envVar.slice(1) : undefined
    return {
      id: p.id,
      name: p.name,
      apiKeyEnv,
      ...(apiKeyEnvAliases?.length ? { apiKeyEnvAliases } : {}),
      docsUrl: '',
      ...(p.baseURL ? { baseURL: p.baseURL } : {}),
      models: p.models.map((m) => ({
        id: m.id,
        label: m.label,
        ...(m.contextWindow ? { contextWindow: m.contextWindow } : {}),
        ...(m.toolCall ? { toolCall: m.toolCall } : {}),
        ...(m.multimodal ? { multimodal: m.multimodal } : {}),
        ...(m.thinkingIntensities?.length
          ? { thinkingIntensities: m.thinkingIntensities }
          : {}),
      })),
    } satisfies ModelProviderDef
  })
}

function catalogToSnapshot(
  catalog: ModelProviderDef[],
  source: RegistrySnapshot['source'],
  mastraPackageVersion: string,
): RegistrySnapshot {
  return {
    version: 1,
    source,
    mastraPackageVersion,
    generatedAt: new Date().toISOString(),
    providers: catalog.map((p) => ({
      id: p.id,
      name: p.name,
      apiKeyEnvVar: p.apiKeyEnvAliases?.length ? [p.apiKeyEnv, ...p.apiKeyEnvAliases] : p.apiKeyEnv,
      ...(p.baseURL ? { baseURL: p.baseURL } : {}),
      models: p.models.map((m) => ({
        id: m.id,
        label: m.label,
        ...(m.contextWindow ? { contextWindow: m.contextWindow } : {}),
        ...(m.toolCall ? { toolCall: m.toolCall } : {}),
        ...(m.multimodal ? { multimodal: m.multimodal } : {}),
        ...(m.thinkingIntensities?.length
          ? { thinkingIntensities: m.thinkingIntensities }
          : {}),
      })),
    })),
  }
}

function applyFeaturedTags(catalog: ModelProviderDef[]): ModelProviderDef[] {
  const snapshot = catalogToSnapshot(catalog, 'installed', 'runtime')
  const { featured } = applyFeaturedPolicy(snapshot, DEFAULT_FEATURED_POLICY, null)
  const tagById = new Map(featured.map((m) => [m.id, m.tag]))
  return catalog.map((p) => ({
    ...p,
    models: p.models.map((m) => {
      const tag = tagById.get(m.id)
      return tag ? { ...m, tag } : m
    }),
  }))
}

/**
 * Read provider definitions from the installed @mastra/core provider registry.
 * Returns an empty array if the registry cannot be loaded.
 *
 * NOTE: core package does not depend on @mastra/core. This is a best-effort
 * lookup for monorepo/dev only. Production runtime must use
 * loadRegistrySnapshot (persisted → bundled). Maintenance sync lives in
 * packages/mastra-app (see scripts/sync-model-registry.ts).
 */
export function fetchMastraProviderRegistry(): ModelProviderDef[] {
  // Prefer explicit env path (set by maintenance command / CI)
  const explicit = process.env.MASTRA_PROVIDER_REGISTRY_PATH
  const candidates = [...(explicit ? [explicit] : []), ...registryPaths()]
  for (const candidate of candidates) {
    try {
      if (!existsSync(candidate)) continue
      const raw = readFileSync(candidate, 'utf-8')
      const data: RegistryData = JSON.parse(raw)
      if (!data.providers) continue
      return Object.entries(data.providers).map(([id, rp]) => registryProviderToDef(id, rp))
    } catch {
      continue
    }
  }
  return []
}

/** Build an installed RegistrySnapshot from the local Mastra package registry. */
export function buildInstalledRegistrySnapshot(): RegistrySnapshot | null {
  const registry = fetchMastraProviderRegistry()
  if (registry.length === 0) return null
  return catalogToSnapshot(registry, 'installed', 'installed')
}

function registryPaths(): string[] {
  const paths: string[] = []
  const fromSrc = dirname(fileURLToPath(import.meta.url))
  // Relative from packages/core/src/ → monorepo root
  paths.push(join(fromSrc, '../../../node_modules/@mastra/core/dist/provider-registry.json'))
  // Relative from dist/ (if compiled)
  paths.push(join(fromSrc, '../../node_modules/@mastra/core/dist/provider-registry.json'))
  // Fallback: resolve via import.meta.resolve (ESM)
  paths.push(join(fromSrc, '../../../../node_modules/@mastra/core/dist/provider-registry.json'))
  return paths
}

/**
 * Attempt to sync the leader model catalog from the Mastra provider registry.
 * The built-in list (resolveBuiltinProviders — external models.dev catalog when
 * fresher, else bundled) is the merge base: its curated model lists take
 * priority, and the @mastra/core registry (installed) is merged in as
 * secondary (adds missing providers / models).
 * Caches the result to <root>/cache/models-cache.json and persists a
 * RegistrySnapshot to <root>/data/mastra-model-registry.json.
 *
 * Falls back to cache (any age) if sync fails, then to the built-in list.
 */
/**
 * Admin/maintenance refresh only — may write models-cache + persisted snapshot.
 * Ordinary Settings/GET must use getLeaderModelCatalog(false) (read-only).
 */
export function syncLeaderModelCatalog(opts?: { dataDir?: string }): {
  catalog: ModelProviderDef[]
  source: 'registry' | 'cache' | 'fallback'
  synced: boolean
} {
  const dir = opts?.dataDir ?? dataDir()
  const base = resolveBuiltinProviders().providers
  try {
    const registry = fetchMastraProviderRegistry()
    if (registry.length > 0) {
      const merged = applyFeaturedTags(mergeCatalogs(base, registry))
      saveCache(merged)
      try {
        writePersistedRegistrySnapshot(catalogToSnapshot(merged, 'persisted', 'installed'), dir)
      } catch {
        /* non-fatal */
      }
      return { catalog: merged, source: 'registry', synced: true }
    }
  } catch {
    // fall through
  }

  const snapshot = loadRegistrySnapshot({
    dataDir: dir,
    bundled: loadBundledRegistrySnapshot(),
    installed: buildInstalledRegistrySnapshot(),
  })
  if (snapshot.ok) {
    const merged = applyFeaturedTags(mergeCatalogs(base, snapshotToCatalog(snapshot)))
    return { catalog: merged, source: 'cache', synced: false }
  }

  const cached = loadCache()
  if (cached) {
    return { catalog: applyFeaturedTags(cached.catalog), source: 'cache', synced: false }
  }

  return { catalog: applyFeaturedTags([...base]), source: 'fallback', synced: false }
}

/**
 * Read-only leader catalog for Settings / UI.
 * Priority: memory cache (if fresh) → persisted → bundled → installed static →
 * built-in list (resolveBuiltinProviders).
 * Never writes disk. Use forceRefresh / syncLeaderModelCatalog for admin refresh only.
 */
export function getLeaderModelCatalog(forceRefresh = false): ModelProviderDef[] {
  if (forceRefresh) {
    return syncLeaderModelCatalog().catalog
  }

  const cached = loadCache()
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return applyFeaturedTags(cached.catalog)
  }

  const loaded = loadRegistrySnapshot({
    dataDir: dataDir(),
    bundled: loadBundledRegistrySnapshot(),
    installed: buildInstalledRegistrySnapshot(),
  })
  if (loaded.ok) {
    return applyFeaturedTags(
      mergeCatalogs(resolveBuiltinProviders().providers, snapshotToCatalog(loaded)),
    )
  }

  if (cached) {
    return applyFeaturedTags(cached.catalog)
  }

  return applyFeaturedTags([...resolveBuiltinProviders().providers])
}

/**
 * Default featured list for admin/settings UI: RegistrySnapshot ∩ DEFAULT_FEATURED_POLICY.
 * Loads via getLeaderModelCatalog (read-only), then applies policy.
 */
export function getLeaderFeaturedCatalog(currentModelId?: string | null): FeaturedCatalogResult {
  const catalog = getLeaderModelCatalog(false)
  const loaded = loadRegistrySnapshot({
    dataDir: dataDir(),
    bundled: loadBundledRegistrySnapshot() ?? catalogToSnapshot(catalog, 'bundled', 'runtime'),
    installed: buildInstalledRegistrySnapshot(),
  })
  const snapshot = catalogToSnapshot(catalog, loaded.ok ? loaded.source : 'installed', 'runtime')
  return applyFeaturedPolicy(snapshot, DEFAULT_FEATURED_POLICY, currentModelId ?? null)
}
