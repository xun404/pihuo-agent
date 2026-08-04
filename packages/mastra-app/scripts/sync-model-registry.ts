/**
 * Maintenance: generate versioned RegistrySnapshot + curated built-in providers
 * from https://models.dev/api.json (authoritative source, always up to date).
 * Run on package (and optionally release CI).
 *
 * Usage: npm run sync:model-registry -w @swarmdesk-agent/mastra-app
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
  type RegistrySnapshot,
} from '@swarmdesk-agent/core'
import {
  buildBuiltinCatalog,
  type BuiltinProvidersPolicy,
  type RegistryModelInfo,
} from './curate-builtin-providers.ts'
import { THINKING_INTENSITIES, type ThinkingIntensity } from '@swarmdesk-agent/core'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '../../..')
const coreBundledDir = join(root, 'packages/core/src/bundled')

/** Authoritative source. Override with a URL or local file path for offline runs. */
const MODELS_DEV_API_URL = process.env.MODELS_DEV_API_URL ?? 'https://models.dev/api.json'

type RawProvider = {
  name: string
  apiKeyEnvVar: string
  models?: RegistryModelInfo[]
  docUrl?: string
}

/** models.dev/api.json provider shape (https://models.dev). */
type ModelsDevProvider = {
  name?: string
  api_key?: string
  env_key?: string
  doc_url?: string
  models?: Record<string, ModelsDevModel> | string[]
}

/** models.dev/api.json model entry shape. */
type ModelsDevModel = {
  id?: string
  name?: string
  reasoning?: boolean
  reasoning_options?: Array<{ type?: string; values?: string[] }>
  limit?: { context?: number; output?: number }
  tool_call?: boolean
  modalities?: { input?: string[]; output?: string[] }
}

/** True when the model accepts or emits non-text modalities (image/audio/video). */
function isMultimodal(m: ModelsDevModel): boolean {
  const mods = [m.modalities?.input ?? [], m.modalities?.output ?? []].flat()
  return mods.some((mod) => mod !== 'text')
}

/** Map models.dev reasoning effort values onto our thinking ladder. */
const REASONING_LEVEL_MAP: Record<string, ThinkingIntensity> = {
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
  max: 'max',
  ultra: 'max',
  minimal: 'low',
  off: 'off',
}

/** Derive supported thinking levels from models.dev reasoning fields. 'off' is always included. */
function modelThinkingIntensities(m: ModelsDevModel): ThinkingIntensity[] | undefined {
  if (m.reasoning === false) return ['off']
  const values = (m.reasoning_options ?? []).flatMap((o) => o.values ?? [])
  const mapped = [...new Set(values.map((v) => REASONING_LEVEL_MAP[v]).filter(Boolean))]
  const ordered = THINKING_INTENSITIES.filter((l) => mapped.includes(l))
  if (ordered.length > 0) return ['off', ...ordered.filter((l) => l !== 'off')]
  // 支持思考但未标注档位 → 常见档位（含关）
  if (m.reasoning === true) return ['off', 'medium', 'high', 'max']
  return undefined
}

function modelInfo(id: string, m: ModelsDevModel): RegistryModelInfo {
  const short = id.includes('/') ? id.slice(id.indexOf('/') + 1) : id
  return {
    id: short,
    label: m.name && m.name !== short ? m.name : short,
    ...(m.limit?.context ? { contextWindow: m.limit.context } : {}),
    ...(m.tool_call === true ? { toolCall: true } : {}),
    ...(isMultimodal(m) ? { multimodal: true } : {}),
    ...(modelThinkingIntensities(m)?.length
      ? { thinkingIntensities: modelThinkingIntensities(m)! }
      : {}),
  }
}

async function fetchModelsDevRegistry(): Promise<Record<string, ModelsDevProvider>> {
  if (/^https?:\/\//i.test(MODELS_DEV_API_URL)) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 60_000)
    try {
      const res = await fetch(MODELS_DEV_API_URL, {
        headers: { accept: 'application/json', 'user-agent': 'swarmdesk-sync-model-registry' },
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

/** Map models.dev provider entry → the allowlist-friendly RawProvider shape. */
function toRawProvider(id: string, p: ModelsDevProvider): RawProvider {
  const envVar = (p.api_key ?? p.env_key ?? '').replace(/^\$/, '')
  const models = Array.isArray(p.models)
    ? p.models.map((mid) => modelInfo(mid, {}))
    : Object.entries(p.models ?? {}).map(([mid, m]) => modelInfo(mid, m))
  return {
    name: p.name ?? id,
    apiKeyEnvVar: envVar,
    ...(p.doc_url ? { docUrl: p.doc_url } : {}),
    ...(models.length > 0 ? { models } : {}),
  }
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
