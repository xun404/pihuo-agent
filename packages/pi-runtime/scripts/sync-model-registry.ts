/**
 * Maintenance: generate versioned RegistrySnapshot + curated built-in providers
 * from https://models.dev/api.json (authoritative source, always up to date).
 * Run on package (and optionally release CI).
 *
 * Usage: npm run sync:model-registry -w @pihuo-agent/pi-runtime
 *
 * Outputs:
 * - packages/core/src/bundled/mastra-model-registry.json  (allowlisted providers only)
 * - packages/core/src/bundled/builtin-providers.json      (Settings curated list)
 * - persisted user data registry (same allowlist, local LKG)
 *
 * Curation policy: packages/core/src/bundled/builtin-providers.policy.json
 *
 * IMPORTANT: Never dump the full models.dev mega-registry into git. Only
 * providers listed in the policy are written to bundled LKG.
 *
 * Offline / dev override: point MODELS_DEV_API_URL at a local JSON file
 * (same shape as models.dev/api.json) to run without network.
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  writePersistedRegistrySnapshot,
  persistedRegistryPath,
  buildBuiltinCatalog,
  toRawProvider,
  type RegistrySnapshot,
  type BuiltinProvidersPolicy,
  type RegistryModelInfo,
  type RawProvider,
  type ModelsDevProviderRaw,
} from '@pihuo-agent/core'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '../../..')
const coreBundledDir = join(root, 'packages/core/src/bundled')

/** Authoritative source. Override with a URL or local file path for offline runs. */
const MODELS_DEV_API_URL = process.env.MODELS_DEV_API_URL ?? 'https://models.dev/api.json'

/** models.dev/api.json provider shape (https://models.dev). */
type ModelsDevProvider = ModelsDevProviderRaw

async function fetchModelsDevRegistry(): Promise<Record<string, ModelsDevProvider>> {
  if (/^https?:\/\//i.test(MODELS_DEV_API_URL)) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 60_000)
    try {
      const res = await fetch(MODELS_DEV_API_URL, {
        headers: { accept: 'application/json', 'user-agent': 'pihuo-agent-sync-model-registry' },
        signal: controller.signal,
      })
      if (!res.ok) {
        throw new Error(`models.dev fetch failed: HTTP ${res.status} ${res.statusText}`)
      }
      return (await res.json()) as Record<string, ModelsDevProvider>
    } finally {
      clearTimeout(timer)
    }
  }
  return JSON.parse(readFileSync(MODELS_DEV_API_URL, 'utf8')) as Record<string, ModelsDevProvider>
}

function buildAllowlistedSnapshot(
  rawProviders: Record<string, RawProvider>,
  allowIds: string[],
  version: string,
  generatedAt: string,
  source: RegistrySnapshot['source'],
): RegistrySnapshot {
  const providers: RegistrySnapshot['providers'] = []
  for (const id of allowIds) {
    const p = rawProviders[id]
    if (!p) {
      console.warn(
        `[sync:model-registry] policy provider "${id}" missing from models.dev registry — skipped`,
      )
      continue
    }
    providers.push({
      id,
      name: p.name ?? id,
      apiKeyEnvVar: p.apiKeyEnvVar,
      models: (p.models ?? []).map((m) => ({
        id: m.id.includes('/') ? m.id : `${id}/${m.id}`,
        label: m.label,
        ...(m.contextWindow ? { contextWindow: m.contextWindow } : {}),
        ...(m.toolCall ? { toolCall: m.toolCall } : {}),
        ...(m.multimodal ? { multimodal: m.multimodal } : {}),
        ...(m.thinkingIntensities?.length
          ? { thinkingIntensities: m.thinkingIntensities }
          : {}),
      })),
    })
  }
  return {
    version: 1,
    source,
    mastraPackageVersion: version,
    generatedAt,
    providers,
  }
}

async function main() {
  console.log(`[sync:model-registry] fetching ${MODELS_DEV_API_URL}`)
  const raw = await fetchModelsDevRegistry()

  const policyPath = join(coreBundledDir, 'builtin-providers.policy.json')
  if (!existsSync(policyPath)) {
    console.error('missing policy', policyPath)
    process.exit(1)
  }
  const policy = JSON.parse(readFileSync(policyPath, 'utf8')) as BuiltinProvidersPolicy
  const allowIds = policy.providers.map((p) => p.id)
  if (allowIds.length === 0) {
    console.error('policy has no providers')
    process.exit(1)
  }

  const byId: Record<string, RawProvider> = {}
  for (const [id, p] of Object.entries(raw)) {
    byId[id] = toRawProvider(id, p)
  }

  // Field retained for schema compatibility; now identifies the data source.
  const version = 'models.dev'
  const generatedAt = new Date().toISOString()
  const fullProviderCount = Object.keys(raw).length
  const fullModelCount = Object.values(raw).reduce(
    (n, p) => n + (Array.isArray(p.models) ? p.models.length : Object.keys(p.models ?? {}).length),
    0,
  )

  // Bundled LKG: only policy allowlist (keeps git / install package small)
  const snapshot = buildAllowlistedSnapshot(
    byId,
    allowIds,
    version,
    generatedAt,
    'bundled',
  )
  const modelCount = snapshot.providers.reduce((n, p) => n + p.models.length, 0)

  mkdirSync(coreBundledDir, { recursive: true })
  const bundledRegistryPath = join(coreBundledDir, 'mastra-model-registry.json')
  writeFileSync(bundledRegistryPath, JSON.stringify(snapshot, null, 2), 'utf8')
  console.log(
    'wrote bundled registry',
    bundledRegistryPath,
    `mastra=${version}`,
    `providers=${snapshot.providers.length}/${fullProviderCount}`,
    `models=${modelCount}/${fullModelCount}`,
    `(allowlist: ${allowIds.join(', ')})`,
  )

  // Curated Settings built-ins from policy + allowlisted registry models
  const registryByProvider: Record<string, RegistryModelInfo[]> = {}
  for (const id of allowIds) {
    registryByProvider[id] = byId[id]?.models ?? []
  }
  const catalog = buildBuiltinCatalog(policy, registryByProvider, version, generatedAt)
  const builtinPath = join(coreBundledDir, 'builtin-providers.json')
  writeFileSync(builtinPath, JSON.stringify(catalog, null, 2), 'utf8')
  console.log(
    'wrote curated built-ins',
    builtinPath,
    'providers',
    catalog.providers.length,
    'defaultLeader',
    catalog.defaultLeaderModel,
  )
  for (const p of catalog.providers) {
    console.log(
      `  ${p.id}: ${p.models.map((m) => m.id.split('/').slice(1).join('/')).join(', ') || '(none)'}`,
    )
  }

  // Local LKG uses the same allowlist — never dump mega-registry into user data either
  writePersistedRegistrySnapshot({ ...snapshot, source: 'persisted' })
  console.log('wrote persisted registry', persistedRegistryPath())
}

main().catch((err) => {
  console.error('[sync:model-registry] failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
