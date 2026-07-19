export type EnvValueSource = 'worker_env' | 'settings_secret' | 'process_env' | 'derived_alias'

export interface ProviderEnvDiagnostic {
  envName: string
  source: EnvValueSource
}

export type ProviderEnvOverrideEntry = {
  apiKeyEnvAliases?: string[]
  globalBaseUrlAlias?: string
}

/**
 * Small project override table layered on Mastra registry apiKeyEnvVar.
 * Values are gateway env name(s) for a provider id (legacy string | string[] form).
 */
export const PROVIDER_ENV_OVERRIDES: Record<string, string | string[]> = {
  opencode: 'OPENCODE_API_KEY',
  'opencode-go': 'OPENCODE_API_KEY',
  opencodego: 'OPENCODE_API_KEY',
  google: ['GOOGLE_GENERATIVE_AI_API_KEY', 'GOOGLE_API_KEY'],
  gemini: ['GOOGLE_GENERATIVE_AI_API_KEY', 'GOOGLE_API_KEY'],
  alibaba: 'DASHSCOPE_API_KEY',
  'alibaba-cn': 'DASHSCOPE_API_KEY',
  moonshotai: 'MOONSHOT_API_KEY',
  zhipuai: 'ZHIPU_API_KEY',
  huggingface: ['HUGGINGFACE_API_KEY', 'HF_TOKEN'],
  azure: ['AZURE_OPENAI_API_KEY', 'AZURE_API_KEY'],
  bedrock: ['AWS_ACCESS_KEY_ID', 'BEDROCK_API_KEY'],
  cloudflare: ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_API_KEY', 'CF_API_TOKEN'],
  perplexity: 'PERPLEXITY_API_KEY',
  groq: 'GROQ_API_KEY',
  together: 'TOGETHER_API_KEY',
  fireworks: 'FIREWORKS_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  cohere: 'COHERE_API_KEY',
  replicate: 'REPLICATE_API_TOKEN',
  stability: 'STABILITY_API_KEY',
  elevenlabs: 'ELEVENLABS_API_KEY',
  jina: 'JINA_API_KEY',
  voyage: 'VOYAGE_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  xai: 'XAI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
}

export interface ProviderEnvResolveInput {
  providerId: string
  registryApiKeyEnvVar: string | string[]
  workerEnv: Record<string, string | undefined>
  settingsSecrets: Record<string, string | undefined>
  processEnv: Record<string, string | undefined>
  overrides?: Record<string, ProviderEnvOverrideEntry>
  customBaseURL?: string
  allowGlobalBaseUrlAliases?: boolean
}

export interface ProviderEnvResolveResult {
  env: Record<string, string | undefined>
  diagnostics: ProviderEnvDiagnostic[]
}

function firstNonEmpty(
  ...sources: Array<{ value: string | undefined; source: EnvValueSource; name: string }>
): { value: string; source: EnvValueSource; name: string } | null {
  for (const s of sources) {
    if (s.value?.trim()) return { value: s.value, source: s.source, name: s.name }
  }
  return null
}

export function resolveProviderEnv(input: ProviderEnvResolveInput): ProviderEnvResolveResult {
  const env: Record<string, string | undefined> = { ...input.processEnv }
  const diagnostics: ProviderEnvDiagnostic[] = []
  const names = [
    ...(Array.isArray(input.registryApiKeyEnvVar)
      ? input.registryApiKeyEnvVar
      : [input.registryApiKeyEnvVar]),
    ...(input.overrides?.[input.providerId]?.apiKeyEnvAliases ?? []),
  ].filter(Boolean)

  const uniqueNames = [...new Set(names)]

  // Source priority first (worker → settings → process), then alias name order.
  // One winning credential fills every alias — never leave mixed secrets.
  const candidates: Array<{ value: string | undefined; source: EnvValueSource; name: string }> = []
  for (const n of uniqueNames) {
    candidates.push({ value: input.workerEnv[n], source: 'worker_env', name: n })
  }
  for (const n of uniqueNames) {
    candidates.push({ value: input.settingsSecrets[n], source: 'settings_secret', name: n })
  }
  for (const n of uniqueNames) {
    candidates.push({ value: input.processEnv[n], source: 'process_env', name: n })
  }
  const sharedHit = firstNonEmpty(...candidates)

  if (sharedHit) {
    for (const n of uniqueNames) {
      env[n] = sharedHit.value
      diagnostics.push({
        envName: n,
        source: n === sharedHit.name ? sharedHit.source : 'derived_alias',
      })
    }
  }

  if (input.customBaseURL?.trim()) {
    const upper = input.providerId.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase() || 'CUSTOM'
    const base = input.customBaseURL.trim().replace(/\/$/, '')
    const scoped = `${upper}_BASE_URL`
    if (!env[scoped]?.trim()) {
      env[scoped] = base
      diagnostics.push({ envName: scoped, source: 'derived_alias' })
    }
    if (input.allowGlobalBaseUrlAliases) {
      const g = input.overrides?.[input.providerId]?.globalBaseUrlAlias
      if (g && !env[g]?.trim()) {
        env[g] = base
        diagnostics.push({ envName: g, source: 'derived_alias' })
      }
    }
  }

  return { env, diagnostics }
}
