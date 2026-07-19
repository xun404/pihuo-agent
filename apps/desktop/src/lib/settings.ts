import { api, clearDesktopToken, ensureDesktopToken } from './api'
import type { AppSnapshot } from '@swarmdesk-agent/shared'

export type ApiStyle = 'openai' | 'anthropic' | 'google' | 'custom'

export type ThinkingIntensity = 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export const THINKING_INTENSITY_OPTIONS: ThinkingIntensity[] = [
  'off',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]

/** Default checkboxes when adding a custom gateway / model */
export const DEFAULT_CUSTOM_THINKING_SUPPORT: ThinkingIntensity[] = ['off', 'medium']

export type CustomModelEntry = {
  id: string
  label: string
  contextWindow?: number
  /** Per-model supported thinking levels (design §7.3) */
  thinkingIntensities?: ThinkingIntensity[]
}

export interface CustomProvider {
  id: string
  name: string
  apiKeyEnv: string
  docsUrl?: string
  baseURL?: string
  apiStyle?: ApiStyle
  contextWindow?: number
  /**
   * Whether this custom gateway is enabled for chat model pickers.
   * Default true when omitted (backward compatible).
   */
  enabled?: boolean
  /**
   * @deprecated Prefer models[].thinkingIntensities (per-model).
   * Kept for backward-compatible read of older settings.
   */
  thinkingIntensities?: ThinkingIntensity[]
  models: CustomModelEntry[]
}

export interface SettingsProvider {
  id: string
  name: string
  apiKeyEnv: string
  docsUrl: string
  models: {
    id: string
    label: string
    tag?: string
    contextWindow?: number
    thinkingIntensities?: ThinkingIntensity[]
  }[]
  configured: boolean
  custom?: boolean
  baseURL?: string
  apiStyle?: string
  contextWindow?: number
  /** Custom providers only; default true */
  enabled?: boolean
  /** Resolved supported levels (builtins = full preset; custom falls back) */
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
  platform?: string
  storagePaths?: { root: string; data: string; cache: string }
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

export async function saveSettings(payload: SaveSettingsPayload): Promise<
  {
    ok?: boolean
    status?: unknown
    error?: string
    clearedSessionErrors?: number
    snapshot?: AppSnapshot
  } & Partial<SettingsPayload>
> {
  if (typeof window !== 'undefined' && window.routerAgents?.settings?.save) {
    return (await window.routerAgents.settings.save(payload)) as {
      ok?: boolean
      status?: unknown
      error?: string
      clearedSessionErrors?: number
      snapshot?: AppSnapshot
    } & Partial<SettingsPayload>
  }
  return api.saveSettings(payload)
}

/** Persist a per-chat preference without restarting the Electron-owned API. */
export async function saveThinkingIntensity(thinkingIntensity: ThinkingIntensity): Promise<void> {
  if (typeof window !== 'undefined' && window.routerAgents?.settings?.setThinkingIntensity) {
    await window.routerAgents.settings.setThinkingIntensity(thinkingIntensity)
    return
  }
  await api.saveSettings({ thinkingIntensity })
}

export async function deleteSecret(key: string): Promise<{
  ok?: boolean
  error?: string
  clearedSessionErrors?: number
  snapshot?: AppSnapshot
}> {
  if (typeof window !== 'undefined' && window.routerAgents?.settings?.deleteSecret) {
    return window.routerAgents.settings.deleteSecret(key) as Promise<{
      ok?: boolean
      error?: string
      clearedSessionErrors?: number
      snapshot?: AppSnapshot
    }>
  }
  return api.deleteSecret(key)
}

/**
 * Drop sticky chat errors after credentials change.
 * Electron restarts the API (new desktop token) before this runs — must force
 * re-auth or clear-chat-errors 401s and the old billing card sticks around.
 */
export async function clearStickyChatErrorsAfterCredentials(): Promise<{
  cleared: number
  snapshot?: AppSnapshot
}> {
  try {
    clearDesktopToken()
    await ensureDesktopToken(true)
    const res = await api.clearSessionChatErrors()
    return {
      cleared: res.clearedSessionErrors ?? 0,
      snapshot: res.snapshot,
    }
  } catch {
    // Retry once after a short wait (API still coming up after settings restart)
    try {
      await new Promise((r) => setTimeout(r, 400))
      clearDesktopToken()
      await ensureDesktopToken(true)
      const res = await api.clearSessionChatErrors()
      return {
        cleared: res.clearedSessionErrors ?? 0,
        snapshot: res.snapshot,
      }
    } catch {
      return { cleared: 0 }
    }
  }
}
