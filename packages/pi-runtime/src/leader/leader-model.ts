import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import {
  applySecretsToEnv,
  hasAnyApiKey,
  loadSettings,
  normalizeLeaderModelForMastra,
  normalizeMastraModelId,
  resolveApiKeyEnvsForModel,
  resolveRouterDataPaths,
  type CustomProviderSettings,
} from '@pihuo-agent/core'
import type { LeaderThinkingIntensity } from '@pihuo-agent/shared'

let runtimePromise: Promise<ModelRuntime> | null = null

export function mapThinkingLevel(
  intensity?: LeaderThinkingIntensity,
): 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' {
  if (!intensity || intensity === 'off') return 'off'
  if (intensity === 'low') return 'low'
  if (intensity === 'high') return 'high'
  if (intensity === 'xhigh') return 'xhigh'
  if (intensity === 'max') return 'max'
  return 'medium'
}

export function parseProviderModel(modelId: string): { provider: string; model: string } {
  const normalized = normalizeLeaderModelForMastra(
    normalizeMastraModelId(modelId),
    loadSettings().customProviders,
  )
  const slash = normalized.indexOf('/')
  if (slash <= 0) throw new Error(`Invalid leader model id: ${modelId}`)
  return { provider: normalized.slice(0, slash), model: normalized.slice(slash + 1) }
}

export async function getLeaderModelRuntime(): Promise<ModelRuntime> {
  if (!runtimePromise) {
    const paths = resolveRouterDataPaths()
    mkdirSync(paths.piAgentDir, { recursive: true })
    runtimePromise = ModelRuntime.create({
      authPath: join(paths.piAgentDir, 'auth.json'),
      modelsPath: join(paths.piAgentDir, 'models.json'),
      allowModelNetwork: false,
      refreshOnCreate: false,
    })
  }
  return runtimePromise
}

export async function resolveLeaderPiModel(
  modelId: string,
): Promise<{ runtime: ModelRuntime; model: NonNullable<ReturnType<ModelRuntime['getModel']>>; modelId: string }> {
  applySecretsToEnv(process.env)
  const settings = loadSettings()
  const { provider, model } = parseProviderModel(modelId)
  const runtime = await getLeaderModelRuntime()
  registerCustomProvider(runtime, provider, settings.customProviders ?? [])
  const keyInfo = resolveApiKeyEnvsForModel(`${provider}/${model}`, settings.customProviders)
  if (keyInfo && !hasAnyApiKey(keyInfo.envKeys, process.env)) {
    const error = new Error(`Missing API key for ${provider}/${model}`)
    ;(error as Error & { code?: string }).code = 'MISSING_API_KEY'
    throw error
  }
  if (keyInfo) {
    const apiKey = keyInfo.envKeys.map((key) => process.env[key]?.trim()).find(Boolean)
    if (apiKey) await runtime.setRuntimeApiKey(provider, apiKey)
  }
  const resolved = runtime.getModel(provider, model)
  if (!resolved) {
    throw new Error(`Unknown leader model: ${provider}/${model}`)
  }
  return { runtime, model: resolved, modelId: `${provider}/${model}` }
}

function registerCustomProvider(
  runtime: ModelRuntime,
  providerId: string,
  custom: CustomProviderSettings[],
) {
  const match = custom.find(
    (item) => item.id === providerId || item.id.replace(/_/g, '-') === providerId,
  )
  if (!match?.baseURL?.trim()) return
  if (runtime.getProvider(providerId)) return
  runtime.registerProvider(providerId, {
    name: match.id,
    baseUrl: match.baseURL.trim().replace(/\/$/, ''),
    api: match.apiStyle === 'anthropic' ? 'anthropic-messages' : 'openai-completions',
    models: [],
  })
}
