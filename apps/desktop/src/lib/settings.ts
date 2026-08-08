import { api, clearDesktopToken, ensureDesktopToken, type DangerZoneAction } from './api'
import type { AppSnapshot } from '@swarmdesk-agent/shared'
import type { PromptSettings, WorkerTimeoutSettings } from '@swarmdesk-agent/shared'
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  type NotificationSettings,
} from '@swarmdesk-agent/shared'

export type ApiStyle = 'openai' | 'anthropic' | 'google'

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

/**
 * Linked default thinking level for a model (no per-model default config):
 * - 默认取「中」(medium)；不支持则取「中上」=「高」(high);
 * - 只有两档 关+X（关+开 / 关+最高）时不选「关」，取另一档;
 * - 兜底取最强支持档，仅当只有「关」一档时才返回「关」。
 */
export function defaultThinkingFor(supported: ThinkingIntensity[]): ThinkingIntensity {
  const list =
    supported.length > 0 ? supported : ([...THINKING_INTENSITY_OPTIONS] as ThinkingIntensity[])
  if (list.includes('medium')) return 'medium'
  if (list.includes('high')) return 'high'
  // 两档 关+X：不要选关，取另一档
  if (list.length === 2 && list.includes('off')) {
    return list.find((lv) => lv !== 'off') ?? 'off'
  }
  let best: ThinkingIntensity = 'off'
  let bestRank = -1
  for (const lv of list) {
    const rank = THINKING_INTENSITY_OPTIONS.indexOf(lv)
    if (rank > bestRank) {
      bestRank = rank
      best = lv
    }
  }
  return best
}

export type CustomModelEntry = {
  id: string
  label: string
  contextWindow?: number
  /** Per-model supported thinking levels (design §7.3) */
  thinkingIntensities?: ThinkingIntensity[]
  toolCall?: boolean
  multimodal?: boolean
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
  /** models.dev import vs hand-built custom gateway */
  source?: 'custom' | 'models.dev'
  modelsDevSyncedAt?: string
  npm?: string
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
    toolCall?: boolean
    multimodal?: boolean
  }[]
  configured: boolean
  custom?: boolean
  baseURL?: string
  apiStyle?: string
  contextWindow?: number
  /** Whether the provider is enabled in model pickers (default true) */
  enabled?: boolean
  /** Resolved supported levels (builtins = full preset; custom falls back) */
  thinkingIntensities?: ThinkingIntensity[]
  source?: 'custom' | 'models.dev'
  modelsDevSyncedAt?: string
  npm?: string
}

export type ModelsDevProviderSummary = {
  id: string
  name: string
  modelCount: number
  npm?: string
  api?: string
  docsUrl?: string
  apiStyle: ApiStyle
  needsBaseURL: boolean
}

export type ModelsDevMeta = {
  fetchedAt: string
  sourceUrl: string
  providerCount: number
  bytes: number
  etag?: string
}

export interface SettingsPayload {
  configuredKeys: string[]
  storage: string
  settings: {
    leaderModel: string
    thinkingIntensity?: ThinkingIntensity
    leaderMaxSteps?: number
    prompts: PromptSettings
    workerTimeouts: WorkerTimeoutSettings
    /** Optional NPM registry for Worker npx; empty = system default */
    npmRegistry?: string
    /** Built-in catalog provider ids turned off by the user */
    disabledProviderIds?: string[]
    /** Native OS notification preferences (defaults applied when missing) */
    notifications?: NotificationSettings
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
  prompts?: PromptSettings
  workerTimeouts?: WorkerTimeoutSettings
  npmRegistry?: string | null
  secrets?: Record<string, string | null>
  customProviders?: CustomProvider[]
  disabledProviderIds?: string[]
  /** Partial notification preferences; merged with persisted values by the owner. */
  notifications?: NotificationSettings
}

export async function performDangerZoneAction(action: DangerZoneAction): Promise<{
  ok?: boolean
  action?: DangerZoneAction
  error?: string
  snapshot?: AppSnapshot
  stats?: {
    projects: number
    workers: number
    workerSessions: number
    crews: number
    chatSessions: number
  }
  result?: unknown
}> {
  if (typeof window !== 'undefined' && window.routerAgents?.settings?.dangerAction) {
    return (await window.routerAgents.settings.dangerAction(action)) as {
      ok?: boolean
      action?: DangerZoneAction
      error?: string
      snapshot?: AppSnapshot
      stats?: {
        projects: number
        workers: number
        workerSessions: number
        crews: number
        chatSessions: number
      }
      result?: unknown
    }
  }
  if (action === 'reset-settings') {
    throw new Error('Reset settings is only available through the Desktop owner process')
  }
  return api.dangerZoneAction(action)
}

export async function fetchSettings(): Promise<SettingsPayload> {
  const payload: SettingsPayload =
    typeof window !== 'undefined' && window.routerAgents?.settings?.get
      ? ((await window.routerAgents.settings.get()) as SettingsPayload)
      : await api.getSettings()
  return {
    ...payload,
    settings: {
      ...payload.settings,
      notifications: payload.settings.notifications ?? DEFAULT_NOTIFICATION_SETTINGS,
    },
  }
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
