/**
 * Map user-facing / slugified custom gateway ids onto Mastra models.dev provider ids.
 *
 * Example failure without this:
 *   "OpenCodeGO" → slug `opencodego` → model `opencodego/deepseek-v4-flash`
 *   Mastra only knows `opencode-go` → "Could not find config for provider opencodego"
 */

/** Slug / alias → canonical Mastra models.dev provider id */
export const MASTRA_PROVIDER_ID_ALIASES: Record<string, string> = {
  // OpenCode Zen / Go
  opencode: 'opencode',
  'opencode-go': 'opencode-go',
  opencodego: 'opencode-go',
  'opencode_go': 'opencode-go',
  'opencode-zen': 'opencode',
  opencodezen: 'opencode',
  // Google aliases
  gemini: 'google',
  // Common typos / collapsed hyphens
  openrouter: 'openrouter',
  'amazon-bedrock': 'amazon-bedrock',
  amazonbedrock: 'amazon-bedrock',
  bedrock: 'amazon-bedrock',
}

/**
 * Canonicalize a provider id for Mastra model router (`provider/model`).
 */
export function normalizeMastraProviderId(raw: string): string {
  const id = raw.trim().toLowerCase()
  if (!id) return raw
  if (MASTRA_PROVIDER_ID_ALIASES[id]) return MASTRA_PROVIDER_ID_ALIASES[id]!
  // Collapsed form: opencodego already covered; try inserting hyphen before "go"
  if (id.endsWith('go') && id.length > 2 && !id.includes('-')) {
    const base = id.slice(0, -2)
    if (base === 'opencode') return 'opencode-go'
  }
  return id
}

/**
 * Rewrite `provider/model` to Mastra-known provider prefix when aliased.
 * Leaves non-gateway / unknown customs unchanged.
 */
export function normalizeMastraModelId(modelId: string): string {
  const raw = modelId.trim()
  if (!raw.includes('/')) return raw
  const slash = raw.indexOf('/')
  const prefix = raw.slice(0, slash)
  const rest = raw.slice(slash + 1)
  const canon = normalizeMastraProviderId(prefix)
  if (canon === prefix) return raw
  return `${canon}/${rest}`
}

/**
 * Infer a Mastra registry id from display name and/or base URL
 * (used when creating custom gateways in Settings).
 */
export function inferMastraProviderId(opts: {
  name?: string
  baseURL?: string
  id?: string
}): string | undefined {
  if (opts.id) {
    const n = normalizeMastraProviderId(opts.id)
    if (MASTRA_PROVIDER_ID_ALIASES[opts.id.toLowerCase()] || n !== opts.id.toLowerCase()) {
      return n
    }
  }

  const url = (opts.baseURL ?? '').toLowerCase()
  if (url.includes('opencode.ai/zen/go') || url.includes('opencode.ai/go')) {
    return 'opencode-go'
  }
  if (url.includes('opencode.ai')) return 'opencode'
  if (url.includes('openrouter.ai')) return 'openrouter'

  const name = (opts.name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')
  if (!name) return undefined
  if (name.includes('opencode') && name.includes('go')) return 'opencode-go'
  if (name === 'opencode' || name === 'opencodezen') return 'opencode'
  if (name.includes('openrouter')) return 'openrouter'
  return undefined
}

export type CustomProviderLike = {
  id: string
  name: string
  apiKeyEnv: string
  baseURL?: string
  models?: { id: string; label: string; contextWindow?: number }[]
}

/**
 * Normalize custom provider list so ids/models match Mastra registry when possible.
 * Also rewrites leaderModel if it used a collapsed alias prefix.
 */
export function normalizeCustomProvidersForMastra<T extends CustomProviderLike>(
  custom: T[] | undefined | null,
): T[] {
  if (!custom?.length) return custom ? [...custom] : []
  return custom.map((c) => {
    const inferred =
      inferMastraProviderId({ name: c.name, baseURL: c.baseURL, id: c.id }) ??
      normalizeMastraProviderId(c.id)
    const id = inferred || c.id
    const models = (c.models ?? []).map((m) => {
      const mid = m.id.includes('/') ? normalizeMastraModelId(m.id) : `${id}/${m.id}`
      // If model still used old provider prefix, force current id
      const short = mid.includes('/') ? mid.slice(mid.indexOf('/') + 1) : mid
      return { ...m, id: `${id}/${short}` }
    })
    return { ...c, id, models }
  })
}

export function normalizeLeaderModelForMastra(
  leaderModel: string,
  custom?: CustomProviderLike[] | null,
): string {
  const normalized = normalizeMastraModelId(leaderModel)
  if (!custom?.length) return normalized
  // If leader still points at old custom id, rewrite via custom list
  const prefix = leaderModel.split('/')[0]
  const rest = leaderModel.includes('/') ? leaderModel.slice(leaderModel.indexOf('/') + 1) : ''
  const hit = custom.find(
    (c) => c.id === prefix || normalizeMastraProviderId(c.id) === normalizeMastraProviderId(prefix ?? ''),
  )
  if (hit) {
    const canon =
      inferMastraProviderId({ name: hit.name, baseURL: hit.baseURL, id: hit.id }) ??
      normalizeMastraProviderId(hit.id)
    if (canon && rest) return `${canon}/${rest}`
  }
  // also rewrite when only alias on model id
  return normalized
}
