/**
 * Leader model catalog for Mastra router (`provider/model`).
 * Curated subset of the Mastra / models.dev registry (keep short, keep current).
 * Everything else → custom OpenAI-compatible gateway in Settings.
 *
 * @see https://mastra.ai/models/providers/
 * @see node_modules/@mastra/core provider registry
 */

import { normalizeMastraProviderId } from './provider-ids.js'
import type { FeaturedPolicy } from './featured-policy.js'

export interface ModelOption {
  id: string
  label: string
  /** Short tag for UI chips */
  tag?: 'flagship' | 'fast' | 'coding' | 'cheap' | 'reasoning'
  /** Approximate context window (tokens) for UI hints */
  contextWindow?: number
}

export interface ModelProviderDef {
  id: string
  name: string
  /** Env var Mastra / AI SDK typically reads */
  apiKeyEnv: string
  /** Optional alternate env names */
  apiKeyEnvAliases?: string[]
  docsUrl: string
  /** Default API style for OpenCode-like custom gateways */
  apiStyle?: 'openai' | 'anthropic' | 'google' | 'custom'
  /** Optional default base URL (OpenAI-compatible gateways) */
  baseURL?: string
  models: ModelOption[]
}

/**
 * Built-in providers only. Prefer quality over coverage —
 * OpenRouter / Ollama / 硅基流动 etc. go through Custom gateway.
 */
export const MASTRA_PROVIDERS: ModelProviderDef[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    apiKeyEnv: 'OPENAI_API_KEY',
    docsUrl: 'https://platform.openai.com/docs/models',
    apiStyle: 'openai',
    models: [
      { id: 'openai/gpt-5.5', label: 'GPT-5.5', tag: 'flagship', contextWindow: 400000 },
      { id: 'openai/gpt-5.5-pro', label: 'GPT-5.5 Pro', tag: 'flagship', contextWindow: 400000 },
      { id: 'openai/gpt-5.4', label: 'GPT-5.4', tag: 'flagship', contextWindow: 1050000 },
      { id: 'openai/gpt-5.4-mini', label: 'GPT-5.4 mini', tag: 'fast', contextWindow: 400000 },
      { id: 'openai/gpt-5.3-codex', label: 'GPT-5.3 Codex', tag: 'coding', contextWindow: 400000 },
      { id: 'openai/o3-mini', label: 'o3-mini', tag: 'reasoning', contextWindow: 200000 },
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    docsUrl: 'https://docs.anthropic.com/en/docs/about-claude/models',
    apiStyle: 'anthropic',
    models: [
      {
        id: 'anthropic/claude-opus-4-8',
        label: 'Claude Opus 4.8',
        tag: 'flagship',
        contextWindow: 200000,
      },
      {
        id: 'anthropic/claude-opus-4-6',
        label: 'Claude Opus 4.6',
        tag: 'flagship',
        contextWindow: 1000000,
      },
      {
        id: 'anthropic/claude-sonnet-4-6',
        label: 'Claude Sonnet 4.6',
        tag: 'coding',
        contextWindow: 1000000,
      },
      {
        id: 'anthropic/claude-haiku-4-5',
        label: 'Claude Haiku 4.5',
        tag: 'fast',
        contextWindow: 200000,
      },
    ],
  },
  {
    id: 'google',
    name: 'Google',
    apiKeyEnv: 'GOOGLE_GENERATIVE_AI_API_KEY',
    apiKeyEnvAliases: ['GOOGLE_API_KEY'],
    docsUrl: 'https://ai.google.dev/gemini-api/docs/models',
    apiStyle: 'google',
    models: [
      {
        id: 'google/gemini-3.1-pro-preview',
        label: 'Gemini 3.1 Pro',
        tag: 'flagship',
        contextWindow: 1048576,
      },
      {
        id: 'google/gemini-3.5-flash',
        label: 'Gemini 3.5 Flash',
        tag: 'fast',
        contextWindow: 1048576,
      },
      {
        id: 'google/gemini-2.5-pro',
        label: 'Gemini 2.5 Pro',
        tag: 'flagship',
        contextWindow: 1048576,
      },
      {
        id: 'google/gemini-2.5-flash',
        label: 'Gemini 2.5 Flash',
        tag: 'cheap',
        contextWindow: 1048576,
      },
    ],
  },
  {
    id: 'xai',
    name: 'xAI',
    apiKeyEnv: 'XAI_API_KEY',
    docsUrl: 'https://docs.x.ai/docs/models',
    apiStyle: 'openai',
    models: [
      { id: 'xai/grok-4.3', label: 'Grok 4.3', tag: 'flagship', contextWindow: 256000 },
      { id: 'xai/grok-4-fast', label: 'Grok 4 Fast', tag: 'fast', contextWindow: 256000 },
      {
        id: 'xai/grok-4.20-reasoning',
        label: 'Grok 4.20 Reasoning',
        tag: 'reasoning',
        contextWindow: 256000,
      },
      { id: 'xai/grok-3-mini', label: 'Grok 3 Mini', tag: 'cheap', contextWindow: 131072 },
    ],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    docsUrl: 'https://api-docs.deepseek.com/',
    apiStyle: 'openai',
    models: [
      {
        id: 'deepseek/deepseek-v4-pro',
        label: 'DeepSeek V4 Pro',
        tag: 'flagship',
        contextWindow: 128000,
      },
      {
        id: 'deepseek/deepseek-v4-flash',
        label: 'DeepSeek V4 Flash',
        tag: 'fast',
        contextWindow: 128000,
      },
      { id: 'deepseek/deepseek-chat', label: 'DeepSeek Chat', tag: 'cheap', contextWindow: 64000 },
      {
        id: 'deepseek/deepseek-reasoner',
        label: 'DeepSeek Reasoner',
        tag: 'reasoning',
        contextWindow: 64000,
      },
    ],
  },
]

/** All secret env keys managed by settings (builtins + common aliases) */
export const SECRET_ENV_KEYS = [
  ...new Set([
    ...MASTRA_PROVIDERS.map((p) => p.apiKeyEnv),
    ...MASTRA_PROVIDERS.flatMap((p) => p.apiKeyEnvAliases ?? []),
  ]),
] as string[]

export const DEFAULT_LEADER_MODEL = 'openai/gpt-5.5'

/** Quick-pick recommendations for empty state / chat bar */
export const RECOMMENDED_MODELS: { id: string; label: string; reason: string }[] = [
  { id: 'openai/gpt-5.5', label: 'GPT-5.5', reason: 'balanced' },
  { id: 'anthropic/claude-sonnet-4-6', label: 'Claude Sonnet 4.6', reason: 'coding' },
  { id: 'google/gemini-3.5-flash', label: 'Gemini 3.5 Flash', reason: 'fast' },
  { id: 'xai/grok-4.3', label: 'Grok 4.3', reason: 'flagship' },
  { id: 'deepseek/deepseek-v4-flash', label: 'DeepSeek V4 Flash', reason: 'cheap' },
]

/** Product featured layer — intersect with RegistrySnapshot for default UI lists */
export const DEFAULT_FEATURED_POLICY: FeaturedPolicy = (() => {
  const recommendedOrder = new Map(RECOMMENDED_MODELS.map((m, i) => [m.id, i]))
  const entries: FeaturedPolicy['entries'] = []
  let fallbackSort = 0
  for (const p of MASTRA_PROVIDERS) {
    for (const m of p.models) {
      const recIdx = recommendedOrder.get(m.id)
      const hint = RECOMMENDED_MODELS.find((r) => r.id === m.id)?.reason
      entries.push({
        modelId: m.id,
        tag: m.tag,
        sort: recIdx !== undefined ? recIdx : 1000 + fallbackSort,
        ...(hint ? { hint } : {}),
      })
      fallbackSort += 1
    }
  }
  entries.sort((a, b) => a.sort - b.sort)
  return { version: 1, entries }
})()

export function findProviderForModel(modelId: string): ModelProviderDef | undefined {
  const prefix = modelId.split('/')[0]
  return (
    MASTRA_PROVIDERS.find((p) => p.models.some((m) => m.id === modelId)) ??
    MASTRA_PROVIDERS.find((p) => p.id === prefix)
  )
}

export function findProviderByEnvKey(envKey: string): ModelProviderDef | undefined {
  return MASTRA_PROVIDERS.find(
    (p) => p.apiKeyEnv === envKey || p.apiKeyEnvAliases?.includes(envKey),
  )
}

/**
 * Resolve env var names that can unlock a model id (builtin + custom gateway).
 */
export function resolveApiKeyEnvsForModel(
  modelId: string,
  custom?: { id: string; apiKeyEnv: string; name?: string; baseURL?: string }[] | null,
): { providerId: string; envKeys: string[] } | null {
  const id = modelId.trim()
  if (!id.includes('/')) return null
  const prefix = id.split('/')[0]!
  const canon = normalizeMastraProviderId(prefix)

  const builtin =
    findProviderForModel(id) ?? findProviderForModel(`${canon}/${id.split('/').slice(1).join('/')}`)
  if (builtin) {
    return {
      providerId: builtin.id,
      envKeys: [builtin.apiKeyEnv, ...(builtin.apiKeyEnvAliases ?? [])],
    }
  }
  const customHit = (custom ?? []).find(
    (c) => c.id === prefix || c.id === canon || normalizeMastraProviderId(c.id) === canon,
  )
  if (customHit) {
    const upper = customHit.id.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()
    const canonUpper = canon.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()
    const keys = [
      customHit.apiKeyEnv,
      `${upper}_API_KEY`,
      `CUSTOM_${upper}_API_KEY`,
      `${canonUpper}_API_KEY`,
      // known Mastra gateway keys
      ...(canon === 'opencode-go' || canon === 'opencode' ? ['OPENCODE_API_KEY'] : []),
    ]
    return { providerId: canon, envKeys: [...new Set(keys)] }
  }
  // Unknown provider — best-effort env guess used by many gateways
  const upper = prefix.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()
  const canonUpper = canon.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()
  return {
    providerId: canon,
    envKeys: [
      `${upper}_API_KEY`,
      `CUSTOM_${upper}_API_KEY`,
      `${canonUpper}_API_KEY`,
      `CUSTOM_${canonUpper}_API_KEY`,
      ...(canon === 'opencode-go' || canon === 'opencode' ? ['OPENCODE_API_KEY'] : []),
    ],
  }
}

/** True if any of the env keys is non-empty in process.env / secrets map */
export function hasAnyApiKey(
  envKeys: string[],
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): boolean {
  return envKeys.some((k) => {
    const v = env[k]
    return typeof v === 'string' && v.trim().length > 0
  })
}

/**
 * Get the merged provider catalog from the sync mechanism.
 * Falls back to the static MASTRA_PROVIDERS if the sync module is unavailable.
 */
export async function getProviderCatalog(forceRefresh?: boolean): Promise<ModelProviderDef[]> {
  try {
    const { getLeaderModelCatalog } = await import('./models-catalog-sync.js')
    return getLeaderModelCatalog(forceRefresh)
  } catch {
    return MASTRA_PROVIDERS
  }
}

/** Normalize api style for custom / OpenCode-like gateways */
export type ApiStyle = 'openai' | 'anthropic' | 'google' | 'custom'

export function normalizeApiStyle(raw: string | undefined | null): ApiStyle {
  const v = (raw ?? 'openai').toLowerCase().trim()
  if (v === 'anthropic' || v === 'claude') return 'anthropic'
  if (v === 'google' || v === 'gemini') return 'google'
  if (v === 'custom') return 'custom'
  return 'openai'
}
