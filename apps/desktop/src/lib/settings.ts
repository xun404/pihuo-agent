import { api } from './api'

export type ApiStyle = 'openai' | 'anthropic' | 'google' | 'custom'

export type ThinkingIntensity = 'off' | 'low' | 'medium' | 'high' | 'max'

export const THINKING_INTENSITY_OPTIONS: ThinkingIntensity[] = [
  'off',
  'low',
  'medium',
  'high',
  'max',
]

/** Default checkboxes when adding a custom gateway */
export const DEFAULT_CUSTOM_THINKING_SUPPORT: ThinkingIntensity[] = ['off', 'medium']

export interface CustomProvider {
  id: string
  name: string
  apiKeyEnv: string
  docsUrl?: string
  baseURL?: string
  apiStyle?: ApiStyle
  contextWindow?: number
  /** Which thinking levels this gateway supports (Settings checkboxes) */
  thinkingIntensities?: ThinkingIntensity[]
  models: { id: string; label: string; contextWindow?: number }[]
}

export interface SettingsProvider {
  id: string
  name: string
  apiKeyEnv: string
  docsUrl: string
  models: { id: string; label: string; tag?: string; contextWindow?: number }[]
  configured: boolean
  custom?: boolean
  baseURL?: string
  apiStyle?: string
  contextWindow?: number
  /** Resolved supported levels (builtins = full preset) */
  thinkingIntensities?: ThinkingIntensity[]
}

export interface SettingsPayload {
  configuredKeys: string[]
  storage: string
  settings: {
    leaderModel: string
    thinkingIntensity?: ThinkingIntensity
    leaderMaxSteps?: number
    updatedAt?: string
    customProviders?: CustomProvider[]
  }
  providers: SettingsProvider[]
  customProviders?: CustomProvider[]
  leaderMaxSteps?: number
  safeStorageAvailable?: boolean
  platform?: string
  storagePath?: string
}

export type SaveSettingsPayload = {
  leaderModel?: string
  thinkingIntensity?: ThinkingIntensity
  leaderMaxSteps?: number
  secrets?: Record<string, string | null>
  customProviders?: CustomProvider[]
}

export async function fetchSettings(): Promise<SettingsPayload> {
  if (typeof window !== 'undefined' && window.routerAgents?.settings?.get) {
    return window.routerAgents.settings.get() as Promise<SettingsPayload>
  }
  return api.getSettings()
}

export async function saveSettings(
  payload: SaveSettingsPayload,
): Promise<{ ok?: boolean; status?: unknown } & Partial<SettingsPayload>> {
  if (typeof window !== 'undefined' && window.routerAgents?.settings?.save) {
    return (await window.routerAgents.settings.save(payload)) as {
      ok?: boolean
      status?: unknown
    } & Partial<SettingsPayload>
  }
  return api.saveSettings(payload)
}

export async function deleteSecret(key: string): Promise<unknown> {
  if (typeof window !== 'undefined' && window.routerAgents?.settings?.deleteSecret) {
    return window.routerAgents.settings.deleteSecret(key)
  }
  return api.deleteSecret(key)
}
