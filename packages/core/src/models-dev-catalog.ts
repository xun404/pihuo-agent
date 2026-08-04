/**
 * models.dev api.json — user-side LKG under config root + import into customProviders.
 *
 * Design: docs/superpowers/specs/2026-08-04-models-dev-provider-import-design.md
 * - Full registry never ships in the install package
 * - Lives at <root>/models-dev/api.json (+ meta.json)
 * - Logos: <root>/cache/provider-logos/{id}.svg (fetch once; fail → caller uses fallback SVG)
 * - npm field is semantic only (apiStyle / needBaseURL); no dynamic install
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { resolveRouterDataPaths } from './router-data-paths.js'
import {
  THINKING_INTENSITIES,
  type ThinkingIntensity,
} from './thinking-intensity.js'
import type { CustomApiStyle, CustomProviderModel, CustomProviderSettings } from './secure-secrets.js'

export const MODELS_DEV_API_URL_DEFAULT = 'https://models.dev/api.json'
/**
 * Provider logo primary source.
 * Prefer GitHub raw (reliable); models.dev/logos often fails in some networks.
 * Single URL only — no multi-mirror fallback chain; miss → caller uses fallback SVG.
 */
export const MODELS_DEV_LOGO_URL = (providerId: string) => {
  const id = encodeURIComponent(providerId)
  const override = process.env.MODELS_DEV_LOGO_BASE?.trim()
  if (override) {
    return `${override.replace(/\/$/, '')}/${id}.svg`
  }
  return `https://raw.githubusercontent.com/anomalyco/models.dev/dev/providers/${id}/logo.svg`
}

export type ModelsDevMeta = {
  fetchedAt: string
  sourceUrl: string
  providerCount: number
  bytes: number
  etag?: string
}

/** Provider-level fields we care about from api.json */
export type ModelsDevProviderRaw = {
  name?: string
  api?: string
  npm?: string
  api_key?: string
  env_key?: string
  env?: string[]
  doc?: string
  doc_url?: string
  models?: Record<string, ModelsDevModelRaw> | string[]
}

export type ModelsDevModelRaw = {
  id?: string
  name?: string
  reasoning?: boolean
  reasoning_options?: Array<{ type?: string; values?: string[] }>
  limit?: { context?: number; output?: number }
  tool_call?: boolean
  modalities?: { input?: string[]; output?: string[] }
}

export type ModelsDevProviderSummary = {
  id: string
  name: string
  modelCount: number
  npm?: string
  api?: string
  docsUrl?: string
  /** Derived transport hint */
  apiStyle: CustomApiStyle
  needsBaseURL: boolean
}

export type ModelsDevCatalogPaths = {
  dir: string
  apiJsonPath: string
  metaPath: string
  logoCacheDir: string
}

export function modelsDevCatalogPaths(
  rootDir = resolveRouterDataPaths().rootDir,
  cacheDir = resolveRouterDataPaths().cacheDir,
): ModelsDevCatalogPaths {
  const dir = join(rootDir, 'models-dev')
  return {
    dir,
    apiJsonPath: join(dir, 'api.json'),
    metaPath: join(dir, 'meta.json'),
    logoCacheDir: join(cacheDir, 'provider-logos'),
  }
}

// —— mapping helpers (shared shape with sync-model-registry) ——

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

function isMultimodal(m: ModelsDevModelRaw): boolean {
  const mods = [m.modalities?.input ?? [], m.modalities?.output ?? []].flat()
  return mods.some((mod) => mod !== 'text')
}

export function modelThinkingIntensitiesFromModelsDev(
  m: ModelsDevModelRaw,
): ThinkingIntensity[] | undefined {
  if (m.reasoning === false) return ['off']
  const values = (m.reasoning_options ?? []).flatMap((o) => o.values ?? [])
  const mapped = [...new Set(values.map((v) => REASONING_LEVEL_MAP[v]).filter(Boolean))] as ThinkingIntensity[]
  const ordered = THINKING_INTENSITIES.filter((l) => mapped.includes(l))
  if (ordered.length > 0) return ['off', ...ordered.filter((l) => l !== 'off')]
  if (m.reasoning === true) return ['off', 'medium', 'high', 'max']
  return undefined
}

export function mapModelsDevModel(
  providerId: string,
  modelKey: string,
  m: ModelsDevModelRaw,
): CustomProviderModel {
  const short = modelKey.includes('/') ? modelKey.slice(modelKey.indexOf('/') + 1) : modelKey
  const thinking = modelThinkingIntensitiesFromModelsDev(m)
  return {
    id: `${providerId}/${short}`,
    label: m.name && m.name !== short ? m.name : short,
    ...(m.limit?.context ? { contextWindow: m.limit.context } : {}),
    ...(m.tool_call === true ? { toolCall: true } : {}),
    ...(isMultimodal(m) ? { multimodal: true } : {}),
    ...(thinking?.length ? { thinkingIntensities: thinking } : {}),
  }
}

/**
 * Derive apiStyle + whether baseURL is required from models.dev npm / api fields.
 * No dynamic package install — semantic only (P0).
 */
export function deriveTransportFromModelsDev(opts: {
  npm?: string
  api?: string
}): { apiStyle: CustomApiStyle; needsBaseURL: boolean } {
  const npm = (opts.npm ?? '').toLowerCase()
  const hasApi = Boolean(opts.api?.trim())

  if (npm.includes('openai-compatible') || npm.includes('compatible')) {
    return { apiStyle: 'openai', needsBaseURL: true }
  }
  if (npm.includes('anthropic')) {
    return { apiStyle: 'anthropic', needsBaseURL: hasApi }
  }
  if (npm.includes('google') || npm.includes('gemini')) {
    return { apiStyle: 'google', needsBaseURL: hasApi }
  }
  if (hasApi) {
    // Specialty / unknown SDK with public endpoint → openai-compatible path
    return { apiStyle: 'openai', needsBaseURL: true }
  }
  // First-party style package, no api URL — Mastra gateway by id if known
  return { apiStyle: 'openai', needsBaseURL: false }
}

function resolveApiKeyEnv(p: ModelsDevProviderRaw, providerId: string): string {
  const fromField = (p.api_key ?? p.env_key ?? '').replace(/^\$/, '').trim()
  if (fromField) return fromField
  const env0 = Array.isArray(p.env) ? p.env[0] : undefined
  if (typeof env0 === 'string' && env0.trim()) return env0.replace(/^\$/, '').trim()
  const upper = providerId.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase() || 'CUSTOM'
  return `${upper}_API_KEY`
}

function mapModels(providerId: string, p: ModelsDevProviderRaw): CustomProviderModel[] {
  if (Array.isArray(p.models)) {
    return p.models.map((mid) => mapModelsDevModel(providerId, mid, {}))
  }
  return Object.entries(p.models ?? {}).map(([mid, m]) => mapModelsDevModel(providerId, mid, m ?? {}))
}

export function providerSummary(
  id: string,
  p: ModelsDevProviderRaw,
): ModelsDevProviderSummary {
  const models = mapModels(id, p)
  const api = typeof p.api === 'string' ? p.api.trim() : undefined
  const npm = typeof p.npm === 'string' ? p.npm.trim() : undefined
  const transport = deriveTransportFromModelsDev({ npm, api })
  const docsUrl = (p.doc_url ?? p.doc)?.trim() || undefined
  return {
    id,
    name: (p.name ?? id).trim() || id,
    modelCount: models.length,
    ...(npm ? { npm } : {}),
    ...(api ? { api } : {}),
    ...(docsUrl ? { docsUrl } : {}),
    apiStyle: transport.apiStyle,
    needsBaseURL: transport.needsBaseURL,
  }
}

// —— LKG read / write ——

export function loadModelsDevMeta(paths = modelsDevCatalogPaths()): ModelsDevMeta | null {
  try {
    if (!existsSync(paths.metaPath)) return null
    return JSON.parse(readFileSync(paths.metaPath, 'utf8')) as ModelsDevMeta
  } catch {
    return null
  }
}

export function loadModelsDevRegistry(
  paths = modelsDevCatalogPaths(),
): Record<string, ModelsDevProviderRaw> | null {
  try {
    if (!existsSync(paths.apiJsonPath)) return null
    const raw = JSON.parse(readFileSync(paths.apiJsonPath, 'utf8')) as unknown
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    return raw as Record<string, ModelsDevProviderRaw>
  } catch {
    return null
  }
}

function atomicWriteJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(data), { encoding: 'utf8', mode: 0o600 })
  renameSync(tmp, path)
}

function atomicWriteText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, text, { encoding: 'utf8', mode: 0o600 })
  renameSync(tmp, path)
}

export type RefreshModelsDevResult = {
  meta: ModelsDevMeta
  providerCount: number
  fromCache: boolean
}

/**
 * Fetch api.json and write LKG under config. Uses MODELS_DEV_API_URL env override when set.
 */
export async function refreshModelsDevCatalog(opts?: {
  url?: string
  paths?: ModelsDevCatalogPaths
  fetchImpl?: typeof fetch
  timeoutMs?: number
}): Promise<RefreshModelsDevResult> {
  const paths = opts?.paths ?? modelsDevCatalogPaths()
  const url =
    opts?.url?.trim() ||
    process.env.MODELS_DEV_API_URL?.trim() ||
    MODELS_DEV_API_URL_DEFAULT
  const fetchImpl = opts?.fetchImpl ?? globalThis.fetch
  if (!fetchImpl) throw new Error('fetch is not available')

  // Local file override (same as sync:model-registry)
  if (!/^https?:\/\//i.test(url)) {
    const text = readFileSync(url, 'utf8')
    const data = JSON.parse(text) as Record<string, ModelsDevProviderRaw>
    atomicWriteText(paths.apiJsonPath, text)
    const meta: ModelsDevMeta = {
      fetchedAt: new Date().toISOString(),
      sourceUrl: url,
      providerCount: Object.keys(data).length,
      bytes: Buffer.byteLength(text, 'utf8'),
    }
    atomicWriteJson(paths.metaPath, meta)
    return { meta, providerCount: meta.providerCount, fromCache: false }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts?.timeoutMs ?? 60_000)
  try {
    const res = await fetchImpl(url, {
      headers: {
        accept: 'application/json',
        'user-agent': 'swarmdesk-models-dev-catalog',
      },
      signal: controller.signal,
    })
    if (!res.ok) {
      throw new Error(`models.dev fetch failed: HTTP ${res.status} ${res.statusText}`)
    }
    const text = await res.text()
    const data = JSON.parse(text) as Record<string, ModelsDevProviderRaw>
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('models.dev api.json: expected object map of providers')
    }
    atomicWriteText(paths.apiJsonPath, text)
    const etag = res.headers?.get?.('etag') ?? undefined
    const meta: ModelsDevMeta = {
      fetchedAt: new Date().toISOString(),
      sourceUrl: url,
      providerCount: Object.keys(data).length,
      bytes: Buffer.byteLength(text, 'utf8'),
      ...(etag ? { etag } : {}),
    }
    atomicWriteJson(paths.metaPath, meta)
    return { meta, providerCount: meta.providerCount, fromCache: false }
  } finally {
    clearTimeout(timer)
  }
}

export function listModelsDevProviders(opts?: {
  q?: string
  excludeIds?: Iterable<string>
  registry?: Record<string, ModelsDevProviderRaw> | null
  paths?: ModelsDevCatalogPaths
}): { providers: ModelsDevProviderSummary[]; meta: ModelsDevMeta | null } {
  const paths = opts?.paths ?? modelsDevCatalogPaths()
  const registry = opts?.registry ?? loadModelsDevRegistry(paths)
  const meta = loadModelsDevMeta(paths)
  if (!registry) return { providers: [], meta }

  const exclude = new Set(
    [...(opts?.excludeIds ?? [])].map((id) => id.trim().toLowerCase()).filter(Boolean),
  )
  const q = (opts?.q ?? '').trim().toLowerCase()

  const providers: ModelsDevProviderSummary[] = []
  for (const [id, raw] of Object.entries(registry)) {
    if (exclude.has(id.toLowerCase())) continue
    const summary = providerSummary(id, raw ?? {})
    if (q) {
      const hay = `${summary.id} ${summary.name} ${summary.npm ?? ''}`.toLowerCase()
      if (!hay.includes(q)) continue
    }
    providers.push(summary)
  }
  providers.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
  return { providers, meta }
}

export type ImportModelsDevErrorCode =
  | 'NOT_FOUND'
  | 'BUILTIN_CONFLICT'
  | 'ALREADY_ADDED'
  | 'NO_MODELS'
  | 'NO_CATALOG'

/**
 * Build a CustomProviderSettings entry from LKG for the given provider id.
 * Does not persist — caller appends to settings.customProviders.
 */
export function buildCustomProviderFromModelsDev(opts: {
  providerId: string
  registry?: Record<string, ModelsDevProviderRaw> | null
  paths?: ModelsDevCatalogPaths
  builtinIds?: Iterable<string>
  existingCustomIds?: Iterable<string>
}):
  | { ok: true; provider: CustomProviderSettings }
  | { ok: false; code: ImportModelsDevErrorCode; message: string } {
  const paths = opts.paths ?? modelsDevCatalogPaths()
  const registry = opts.registry ?? loadModelsDevRegistry(paths)
  if (!registry) {
    return { ok: false, code: 'NO_CATALOG', message: 'models.dev catalog not available; refresh first' }
  }
  const id = opts.providerId.trim()
  if (!id || !registry[id]) {
    return { ok: false, code: 'NOT_FOUND', message: `Provider "${id}" not in models.dev catalog` }
  }
  const builtin = new Set([... (opts.builtinIds ?? [])].map((x) => x.toLowerCase()))
  if (builtin.has(id.toLowerCase())) {
    return {
      ok: false,
      code: 'BUILTIN_CONFLICT',
      message: `Provider "${id}" is a built-in; configure it under Built-in providers`,
    }
  }
  const existing = new Set([... (opts.existingCustomIds ?? [])].map((x) => x.toLowerCase()))
  if (existing.has(id.toLowerCase())) {
    return { ok: false, code: 'ALREADY_ADDED', message: `Provider "${id}" is already added` }
  }

  const raw = registry[id]!
  const models = mapModels(id, raw)
  if (models.length === 0) {
    return { ok: false, code: 'NO_MODELS', message: `Provider "${id}" has no models in catalog` }
  }
  const api = typeof raw.api === 'string' ? raw.api.trim() : undefined
  const npm = typeof raw.npm === 'string' ? raw.npm.trim() : undefined
  const transport = deriveTransportFromModelsDev({ npm, api })
  const docsUrl = (raw.doc_url ?? raw.doc)?.trim() || undefined
  const apiKeyEnv = resolveApiKeyEnv(raw, id)

  const provider: CustomProviderSettings = {
    id,
    name: (raw.name ?? id).trim() || id,
    apiKeyEnv,
    ...(docsUrl ? { docsUrl } : {}),
    ...(api ? { baseURL: api.replace(/\/$/, '') } : {}),
    apiStyle: transport.apiStyle,
    enabled: true,
    models,
    source: 'models.dev',
    modelsDevSyncedAt: new Date().toISOString(),
    ...(npm ? { npm } : {}),
  }
  return { ok: true, provider }
}

// —— logos ——

export function providerLogoCachePath(
  providerId: string,
  paths = modelsDevCatalogPaths(),
): string {
  const safe = providerId.replace(/[^a-zA-Z0-9._-]/g, '_')
  return join(paths.logoCacheDir, `${safe}.svg`)
}

export function readCachedProviderLogo(
  providerId: string,
  paths = modelsDevCatalogPaths(),
): string | null {
  try {
    const p = providerLogoCachePath(providerId, paths)
    if (!existsSync(p)) return null
    const text = readFileSync(p, 'utf8')
    if (!text.includes('<svg') && !text.includes('<SVG')) return null
    return text
  } catch {
    return null
  }
}

/**
 * Fetch logo once into cache. On any failure returns null (caller uses fallback SVG).
 * No multi-mirror fallback chain.
 */
export async function ensureProviderLogoCached(opts: {
  providerId: string
  paths?: ModelsDevCatalogPaths
  fetchImpl?: typeof fetch
  timeoutMs?: number
}): Promise<{ svg: string | null; fromCache: boolean }> {
  const paths = opts.paths ?? modelsDevCatalogPaths()
  const cached = readCachedProviderLogo(opts.providerId, paths)
  if (cached) return { svg: cached, fromCache: true }

  const fetchImpl = opts.fetchImpl ?? globalThis.fetch
  if (!fetchImpl) return { svg: null, fromCache: false }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000)
  try {
    const res = await fetchImpl(MODELS_DEV_LOGO_URL(opts.providerId), {
      headers: { accept: 'image/svg+xml,*/*', 'user-agent': 'swarmdesk-models-dev-logo' },
      signal: controller.signal,
    })
    if (!res.ok) return { svg: null, fromCache: false }
    const text = await res.text()
    if (!text.includes('<svg') && !text.includes('<SVG')) return { svg: null, fromCache: false }
    atomicWriteText(providerLogoCachePath(opts.providerId, paths), text)
    return { svg: text, fromCache: false }
  } catch {
    return { svg: null, fromCache: false }
  } finally {
    clearTimeout(timer)
  }
}
