/**
 * Curate Settings → Models built-in list from Mastra provider-registry models
 * using packages/core/src/bundled/builtin-providers.policy.json.
 */
export type ModelTag = 'flagship' | 'fast' | 'coding' | 'cheap' | 'reasoning'

export type CuratedModel = {
  id: string
  label: string
  tag?: ModelTag
  contextWindow?: number
}

export type CuratedProvider = {
  id: string
  name: string
  apiKeyEnv: string
  apiKeyEnvAliases?: string[]
  docsUrl: string
  apiStyle?: 'openai' | 'anthropic' | 'google' | 'custom'
  baseURL?: string
  models: CuratedModel[]
}

export type BuiltinProvidersCatalog = {
  version: 1
  generatedAt: string
  mastraPackageVersion: string
  source: 'synced-from-mastra'
  defaultLeaderModel: string
  recommended: Array<{ id: string; label: string; reason: string }>
  providers: CuratedProvider[]
}

export type ProviderPolicy = {
  id: string
  name: string
  apiKeyEnv: string
  apiKeyEnvAliases?: string[]
  docsUrl: string
  apiStyle?: 'openai' | 'anthropic' | 'google' | 'custom'
  baseURL?: string
  maxModels: number
  includePrefixes: string[]
  excludeSubstrings: string[]
  tagRules: Array<{ match: string; tag: ModelTag }>
  contextWindowDefault: number
  contextWindowByMatch?: Array<{ match: string; contextWindow: number }>
}

export type BuiltinProvidersPolicy = {
  version: number
  providers: ProviderPolicy[]
  defaultLeaderPreferPrefixes: string[]
  recommended: Array<{
    providerId: string
    preferContains: string[]
    excludeContains?: string[]
    reason: string
  }>
}

/** Extract numeric segments for reverse version-ish sort (5.6 > 5.5 > 5.4). */
export function versionKey(modelId: string): number[] {
  const bare = modelId.includes('/') ? modelId.split('/').slice(1).join('/') : modelId
  return [...bare.matchAll(/\d+/g)].map((m) => Number(m[0]))
}

export function compareVersionDesc(a: string, b: string): number {
  const ka = versionKey(a)
  const kb = versionKey(b)
  const n = Math.max(ka.length, kb.length)
  for (let i = 0; i < n; i++) {
    const da = ka[i] ?? -1
    const db = kb[i] ?? -1
    if (db !== da) return db - da
  }
  // Prefer shorter / cleaner ids (no date suffixes) when versions tie
  return a.length - b.length
}

function humanLabel(modelId: string): string {
  const bare = modelId.includes('/') ? modelId.split('/').slice(1).join('/') : modelId
  // gpt-5.6 → GPT-5.6 ; claude-sonnet-5 → Claude Sonnet 5 ; o4-mini → o4-mini
  if (/^gpt-/i.test(bare)) {
    return bare
      .replace(/^gpt-/i, 'GPT-')
      .replace(/-pro$/i, ' Pro')
      .replace(/-mini$/i, ' mini')
  }
  if (/^o\d/i.test(bare)) return bare
  return bare
    .split(/[-_]/)
    .map((part) => {
      if (/^\d/.test(part)) return part
      return part.charAt(0).toUpperCase() + part.slice(1)
    })
    .join(' ')
}

function assignTag(bare: string, rules: ProviderPolicy['tagRules']): ModelTag | undefined {
  for (const rule of rules) {
    if (!rule.match) return rule.tag
    if (bare.includes(rule.match)) return rule.tag
  }
  return undefined
}

function assignContextWindow(bare: string, policy: ProviderPolicy): number {
  for (const rule of policy.contextWindowByMatch ?? []) {
    if (bare.includes(rule.match)) return rule.contextWindow
  }
  return policy.contextWindowDefault
}

export function filterAndSortModels(registryModelIds: string[], policy: ProviderPolicy): string[] {
  const filtered = registryModelIds.filter((raw) => {
    const bare = raw.includes('/') ? raw.split('/').slice(1).join('/') : raw
    const startsOk = policy.includePrefixes.some((p) => bare.startsWith(p))
    if (!startsOk) return false
    if (policy.excludeSubstrings.some((s) => bare.includes(s))) return false
    return true
  })
  return [...filtered].sort(compareVersionDesc)
}

export function curateProvider(
  policy: ProviderPolicy,
  registryModelIds: string[],
): CuratedProvider {
  const picked = filterAndSortModels(registryModelIds, policy).slice(0, policy.maxModels)
  return {
    id: policy.id,
    name: policy.name,
    apiKeyEnv: policy.apiKeyEnv,
    ...(policy.apiKeyEnvAliases?.length ? { apiKeyEnvAliases: policy.apiKeyEnvAliases } : {}),
    docsUrl: policy.docsUrl,
    apiStyle: policy.apiStyle,
    ...(policy.baseURL ? { baseURL: policy.baseURL } : {}),
    models: picked.map((raw) => {
      const fullId = raw.includes('/') ? raw : `${policy.id}/${raw}`
      const bare = fullId.split('/').slice(1).join('/')
      const tag = assignTag(bare, policy.tagRules)
      return {
        id: fullId,
        label: humanLabel(fullId),
        ...(tag ? { tag } : {}),
        contextWindow: assignContextWindow(bare, policy),
      }
    }),
  }
}

export function pickRecommended(
  providers: CuratedProvider[],
  rules: BuiltinProvidersPolicy['recommended'],
): Array<{ id: string; label: string; reason: string }> {
  const out: Array<{ id: string; label: string; reason: string }> = []
  for (const rule of rules) {
    const p = providers.find((x) => x.id === rule.providerId)
    if (!p) continue
    const hit =
      p.models.find((m) => {
        const bare = m.id.split('/').slice(1).join('/')
        if (rule.excludeContains?.some((s) => bare.includes(s) || m.id.includes(s))) return false
        return rule.preferContains.some((s) => bare.includes(s) || m.id.includes(s))
      }) ?? p.models[0]
    if (hit) out.push({ id: hit.id, label: hit.label, reason: rule.reason })
  }
  return out
}

export function pickDefaultLeader(providers: CuratedProvider[], preferPrefixes: string[]): string {
  const all = providers.flatMap((p) => p.models.map((m) => m.id))
  for (const prefix of preferPrefixes) {
    const matches = all.filter((id) => id.startsWith(prefix)).sort(compareVersionDesc)
    if (matches[0]) return matches[0]
  }
  return all[0] ?? 'openai/gpt-4o'
}

export function buildBuiltinCatalog(
  policy: BuiltinProvidersPolicy,
  registryByProvider: Record<string, string[]>,
  mastraPackageVersion: string,
  generatedAt = new Date().toISOString(),
): BuiltinProvidersCatalog {
  const providers = policy.providers.map((p) => curateProvider(p, registryByProvider[p.id] ?? []))
  const recommended = pickRecommended(providers, policy.recommended)
  const defaultLeaderModel = pickDefaultLeader(providers, policy.defaultLeaderPreferPrefixes)
  return {
    version: 1,
    generatedAt,
    mastraPackageVersion,
    source: 'synced-from-mastra',
    defaultLeaderModel,
    recommended,
    providers,
  }
}
