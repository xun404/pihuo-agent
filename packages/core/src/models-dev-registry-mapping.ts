/**
 * Map models.dev api.json raw entries (https://models.dev) onto the
 * RegistryModelInfo / RawProvider shapes used by curation (builtin-catalog)
 * and the sync:model-registry maintenance script.
 *
 * Shared at runtime by resolveBuiltinProviders() so the external models.dev
 * catalog can be curated identically to build-time.
 */
import { THINKING_INTENSITIES, type ThinkingIntensity } from './thinking-intensity.js'
import type { RegistryModelInfo } from './builtin-catalog.js'
import type { ModelsDevModelRaw, ModelsDevProviderRaw } from './models-dev-catalog.js'

export const REASONING_LEVEL_MAP: Record<string, ThinkingIntensity> = {
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
  max: 'max',
  ultra: 'max',
  minimal: 'low',
  off: 'off',
}

/** True when the model accepts or emits non-text modalities (image/audio/video). */
export function isMultimodal(m: ModelsDevModelRaw): boolean {
  const mods = [m.modalities?.input ?? [], m.modalities?.output ?? []].flat()
  return mods.some((mod) => mod !== 'text')
}

/** Derive supported thinking levels from models.dev reasoning fields. 'off' is always included. */
export function modelThinkingIntensitiesFromModelsDev(
  m: ModelsDevModelRaw,
): ThinkingIntensity[] | undefined {
  if (m.reasoning === false) return ['off']
  const values = (m.reasoning_options ?? []).flatMap((o) => o.values ?? [])
  const mapped = [...new Set(values.map((v) => REASONING_LEVEL_MAP[v]).filter(Boolean))]
  const ordered = THINKING_INTENSITIES.filter((l) => mapped.includes(l))
  if (ordered.length > 0) return ['off', ...ordered.filter((l) => l !== 'off')]
  // 支持思考但未标注档位 → 常见档位（含关）
  if (m.reasoning === true) return ['off', 'medium', 'high', 'max']
  return undefined
}

/**
 * Map a models.dev model entry onto RegistryModelInfo. The model key keeps a
 * short id (no provider prefix) matching the sync-model-registry behaviour.
 */
export function modelInfo(id: string, m: ModelsDevModelRaw): RegistryModelInfo {
  const short = id.includes('/') ? id.slice(id.indexOf('/') + 1) : id
  const thinking = modelThinkingIntensitiesFromModelsDev(m)
  return {
    id: short,
    label: m.name && m.name !== short ? m.name : short,
    ...(m.limit?.context ? { contextWindow: m.limit.context } : {}),
    ...(m.tool_call === true ? { toolCall: true } : {}),
    ...(isMultimodal(m) ? { multimodal: true } : {}),
    ...(thinking?.length ? { thinkingIntensities: thinking } : {}),
  }
}

/** Registry provider info as written by sync:model-registry (models.dev data). */
export type RawProvider = {
  name: string
  apiKeyEnvVar: string
  models?: RegistryModelInfo[]
  docUrl?: string
}

/** Map models.dev provider entry → the allowlist-friendly RawProvider shape. */
export function toRawProvider(id: string, p: ModelsDevProviderRaw): RawProvider {
  const envVar = (p.api_key ?? p.env_key ?? '').replace(/^\$/, '')
  const models = Array.isArray(p.models)
    ? p.models.map((mid) => modelInfo(mid, {}))
    : Object.entries(p.models ?? {}).map(([mid, m]) => modelInfo(mid, m ?? {}))
  return {
    name: p.name ?? id,
    apiKeyEnvVar: envVar,
    ...(p.doc_url ? { docUrl: p.doc_url } : {}),
    ...(models.length > 0 ? { models } : {}),
  }
}
