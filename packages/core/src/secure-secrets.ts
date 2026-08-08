/**
 * Cross-platform secret storage for API keys.
 *
 * Strategy:
 * - Encrypt payload with AES-256-GCM
 * - Master key derived from a machine/account identifier (see master-key.ts);
 *   never persisted to disk, never wrapped with OS keychain.
 * - Ciphertext in <config>/secrets.enc
 */

import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  chmodSync,
  unlinkSync,
  openSync,
  closeSync,
  fsyncSync,
  renameSync,
} from 'node:fs'
import { join } from 'node:path'
import { resolveRouterDataPaths } from './router-data-paths.js'
import { deriveMasterKey } from './master-key.js'
import {
  DEFAULT_THINKING_INTENSITY,
  normalizeThinkingIntensity,
  type ThinkingIntensity,
} from './thinking-intensity.js'
import {
  normalizeCustomProvidersForMastra,
  normalizeLeaderModelForMastra,
  normalizeMastraProviderId,
} from './provider-ids.js'
import { resolveLeaderMaxSteps, parseLeaderMaxStepsInput } from './leader-max-steps.js'
import { normalizeNpmRegistry } from './npm-registry.js'
import {
  parseWorkerTimeoutSettings,
  resolveWorkerTimeoutSettings,
  type WorkerTimeoutSettings,
} from './worker-timeouts.js'
import { resolveProviderEnv, PROVIDER_ENV_OVERRIDES } from './provider-env-resolver.js'
import { DEFAULT_LEADER_MODEL } from './models-catalog.js'
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  isNotificationMode,
  normalizePromptSettings,
  type NotificationSettings,
  type PromptSettings,
} from '@swarmdesk-agent/shared'

export type SecretsMap = Record<string, string>

export type CustomApiStyle = 'openai' | 'anthropic' | 'google'

export interface CustomProviderModel {
  id: string
  label: string
  /** Context window size in tokens (OpenCode-style) */
  contextWindow?: number
  /** Per-model supported thinking levels */
  thinkingIntensities?: ThinkingIntensity[]
  /** Capability tags from models.dev (optional) */
  toolCall?: boolean
  multimodal?: boolean
}

export interface CustomProviderSettings {
  id: string
  name: string
  apiKeyEnv: string
  docsUrl?: string
  /**
   * OpenAI-compatible base URL, e.g. https://api.example.com/v1
   * Applied as `{ID}_BASE_URL` and (for openai style) may set OPENAI_BASE_URL when id is openai.
   */
  baseURL?: string
  /** Protocol style: openai | anthropic | google (legacy `custom` normalizes to openai) */
  apiStyle?: CustomApiStyle
  /** Whether this custom provider is available in Desktop model pickers. */
  enabled?: boolean
  /** Default context window for models without per-model override */
  contextWindow?: number
  /**
   * Thinking intensities this gateway actually supports (checkboxes in Settings).
   * Built-ins ignore this and use BUILTIN_THINKING_PRESETS.
   */
  thinkingIntensities?: ThinkingIntensity[]
  models: CustomProviderModel[]
  /**
   * Origin of this entry. `models.dev` = imported full catalog; omit/`custom` = hand-built.
   */
  source?: 'custom' | 'models.dev'
  /** ISO time of last models.dev model-list sync (import or refresh). */
  modelsDevSyncedAt?: string
  /** models.dev provider.toml npm field (diagnostic / apiStyle hint only; not installed). */
  npm?: string
}

export interface AppSettings {
  leaderModel: string
  /**
   * Leader reasoning / thinking intensity (maps to providerOptions).
   * @see thinking-intensity.ts
   */
  thinkingIntensity?: ThinkingIntensity
  /** User-defined providers (non-secret); keys stored in secrets map */
  customProviders?: CustomProviderSettings[]
  /**
   * Built-in / policy catalog provider ids the user has turned off.
   * Custom providers use `customProviders[].enabled` instead.
   */
  disabledProviderIds?: string[]
  /** Maximum model steps per response (10–1000, default 500) */
  leaderMaxSteps?: number
  /** Editable Leader behavior prompt and role defaults. */
  prompts: PromptSettings
  /** Worker task, approval, and queue deadlines. */
  workerTimeouts: WorkerTimeoutSettings
  /**
   * Optional npm registry for Worker `npx` launches (NPM_CONFIG_REGISTRY).
   * Empty / omitted → system default (~/.npmrc or ambient env).
   */
  npmRegistry?: string
  /** Native OS notification preferences. Missing on legacy settings.json files. */
  notifications?: NotificationSettings
  /** Non-secret prefs */
  updatedAt?: string
}

/** Normalize disabled built-in provider id list. */
export function normalizeDisabledProviderIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const id = item.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

export function normalizeNotificationSettings(raw: unknown): NotificationSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_NOTIFICATION_SETTINGS }
  const record = raw as Record<string, unknown>
  return {
    enabled: record.enabled === true,
    mode: isNotificationMode(record.mode) ? record.mode : DEFAULT_NOTIFICATION_SETTINGS.mode,
    onCompletion:
      record.onCompletion === undefined
        ? DEFAULT_NOTIFICATION_SETTINGS.onCompletion
        : record.onCompletion === true,
    onError:
      record.onError === undefined ? DEFAULT_NOTIFICATION_SETTINGS.onError : record.onError === true,
    onApproval:
      record.onApproval === undefined
        ? DEFAULT_NOTIFICATION_SETTINGS.onApproval
        : record.onApproval === true,
  }
}

export interface SecretsStatus {
  /** Env keys available from encrypted storage or trusted parent injection (never values). */
  configuredKeys: string[]
  storage: 'encrypted-file' | 'memory' | 'none'
  settings: AppSettings
}

const RESERVED_SECRET_ENV_PREFIXES = [
  'SWARMDESK_AGENT_',
  'MASTRA_',
  'NODE_',
  'ELECTRON_',
  'VITE_',
  'NPM_',
  'XDG_',
  'LD_',
  'DYLD_',
]

const RESERVED_SECRET_ENV_KEYS = new Set([
  'PATH',
  'HOME',
  'USERPROFILE',
  'SHELL',
  'PWD',
  'OLDPWD',
  'TMPDIR',
  'TEMP',
  'TMP',
  'BASH_ENV',
  'ENV',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'SSL_CERT_FILE',
])

/**
 * Provider credentials may use ordinary uppercase environment names, but must
 * never alias process/runtime capability controls.
 */
export function isConfigurableSecretEnvKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^[A-Z][A-Z0-9_]{0,127}$/.test(value)) return false
  if (RESERVED_SECRET_ENV_KEYS.has(value)) return false
  return !RESERVED_SECRET_ENV_PREFIXES.some((prefix) => value.startsWith(prefix))
}

function assertConfigurableSecretEnvKey(value: unknown): asserts value is string {
  if (!isConfigurableSecretEnvKey(value)) {
    throw new Error('Secret environment key is invalid or reserved')
  }
}

function validCustomProviders(providers: CustomProviderSettings[]): CustomProviderSettings[] {
  return providers.filter((provider) => isConfigurableSecretEnvKey(provider.apiKeyEnv))
}

function secretsRoot(): string {
  return resolveRouterDataPaths().secretsDir
}
function secretsPath(): string {
  return join(secretsRoot(), 'secrets.enc')
}
function settingsPath(): string {
  return join(secretsRoot(), 'settings.json')
}

function ensureDir(): void {
  if (!existsSync(secretsRoot())) {
    mkdirSync(secretsRoot(), { recursive: true, mode: 0o700 })
  }
  try {
    chmodSync(secretsRoot(), 0o700)
  } catch {
    /* windows may ignore */
  }
}

function atomicWritePrivateFile(target: string, data: string | Buffer): void {
  const tmp = `${target}.tmp.${process.pid}.${randomBytes(4).toString('hex')}`
  let fd: number | undefined
  try {
    fd = openSync(tmp, 'wx', 0o600)
    writeFileSync(fd, data)
    fsyncSync(fd)
    closeSync(fd)
    fd = undefined
    try {
      chmodSync(tmp, 0o600)
    } catch {
      /* windows */
    }
    renameSync(tmp, target)
    try {
      chmodSync(target, 0o600)
    } catch {
      /* windows */
    }
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd)
      } catch {
        /* best effort */
      }
    }
    if (existsSync(tmp)) {
      try {
        unlinkSync(tmp)
      } catch {
        /* best effort */
      }
    }
  }
}

function getMasterKey(): Buffer {
  return deriveMasterKey()
}

function encryptJson(obj: SecretsMap, key: Buffer): Buffer {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const plaintext = Buffer.from(JSON.stringify(obj), 'utf8')
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  // format: iv(12) + tag(16) + ciphertext
  return Buffer.concat([iv, tag, enc])
}

function decryptJson(blob: Buffer, key: Buffer): SecretsMap {
  const iv = blob.subarray(0, 12)
  const tag = blob.subarray(12, 28)
  const data = blob.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  const dec = Buffer.concat([decipher.update(data), decipher.final()])
  const parsed: unknown = JSON.parse(dec.toString('utf8'))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Encrypted secrets payload is not an object')
  }
  for (const [key, value] of Object.entries(parsed)) {
    if (!key || typeof value !== 'string') {
      throw new Error('Encrypted secrets payload contains an invalid entry')
    }
  }
  return parsed as SecretsMap
}

function loadSecretsStrict(): SecretsMap {
  if (!existsSync(secretsPath())) return {}
  const key = getMasterKey()
  const blob = readFileSync(secretsPath())
  return decryptJson(blob, key)
}

export function loadSecrets(): SecretsMap {
  try {
    // The trusted API child receives decrypted provider credentials through its
    // environment (SWARMDESK_AGENT_SECRETS_PARENT_INJECTED). It must not re-read the
    // encrypted file — its derived master key may differ from the owner's.
    if (process.env.SWARMDESK_AGENT_SECRETS_PARENT_INJECTED === '1') return {}
    return loadSecretsStrict()
  } catch (e) {
    console.error('[secure-secrets] load failed', e)
    return {}
  }
}

export function saveSecrets(secrets: SecretsMap): void {
  ensureDir()
  const key = getMasterKey()
  // strip empty
  const clean: SecretsMap = {}
  for (const [k, v] of Object.entries(secrets)) {
    if (isConfigurableSecretEnvKey(k) && typeof v === 'string' && v.trim()) {
      clean[k] = v.trim()
    }
  }
  const blob = encryptJson(clean, key)
  atomicWritePrivateFile(secretsPath(), blob)
}

/** Related env names that must stay in lockstep for OpenCode / custom gateways. */
function relatedSecretEnvKeys(envKey: string): string[] {
  const keys = new Set<string>([envKey])
  if (
    envKey === 'OPENCODE_API_KEY' ||
    envKey === 'OPENCODE_GO_API_KEY' ||
    /^CUSTOM_OPENCODE.*_API_KEY$/.test(envKey)
  ) {
    keys.add('OPENCODE_API_KEY')
    keys.add('OPENCODE_GO_API_KEY')
    keys.add('CUSTOM_OPENCODE_GO_API_KEY')
    keys.add('CUSTOM_OPENCODEGO_API_KEY')
  }
  return [...keys].filter((k) => isConfigurableSecretEnvKey(k))
}

export function setSecret(envKey: string, value: string): SecretsMap {
  assertConfigurableSecretEnvKey(envKey)
  // A tolerant read is appropriate for status/UI, but mutation must fail closed:
  // never replace an unreadable or OS-wrapped payload with a partial new map.
  if (process.env.SWARMDESK_AGENT_SECRETS_PARENT_INJECTED === '1') {
    throw new Error('Secret mutation is unavailable in the injected API child')
  }
  const all = loadSecretsStrict()
  const related = relatedSecretEnvKeys(envKey)
  if (!value.trim()) {
    for (const k of related) delete all[k]
  } else {
    const v = value.trim()
    // Keep aliases identical so a stale CUSTOM_* key cannot shadow the new one
    for (const k of related) all[k] = v
  }
  saveSecrets(all)
  return all
}

export function deleteSecret(envKey: string): SecretsMap {
  assertConfigurableSecretEnvKey(envKey)
  if (process.env.SWARMDESK_AGENT_SECRETS_PARENT_INJECTED === '1') {
    throw new Error('Secret mutation is unavailable in the injected API child')
  }
  const all = loadSecretsStrict()
  delete all[envKey]
  saveSecrets(all)
  return all
}

export function clearAllSecrets(): void {
  ensureDir()
  if (existsSync(secretsPath())) unlinkSync(secretsPath())
}

function defaultAppSettings(opts?: { useEnvironment?: boolean }): AppSettings {
  return {
    leaderModel:
      opts?.useEnvironment === false
        ? DEFAULT_LEADER_MODEL
        : (process.env.LEADER_MODEL ?? DEFAULT_LEADER_MODEL),
    thinkingIntensity: DEFAULT_THINKING_INTENSITY,
    customProviders: [],
    disabledProviderIds: [],
    leaderMaxSteps: 500,
    prompts: normalizePromptSettings(undefined),
    workerTimeouts: resolveWorkerTimeoutSettings(undefined),
    npmRegistry: undefined,
  }
}

export function loadSettings(): AppSettings {
  try {
    return loadSettingsStrict()
  } catch {
    return defaultAppSettings()
  }
}

function loadSettingsStrict(): AppSettings {
  if (!existsSync(settingsPath())) return defaultAppSettings()
  const parsed: unknown = JSON.parse(readFileSync(settingsPath(), 'utf8'))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Settings payload is not an object')
  }
  const raw = parsed as Partial<AppSettings>
  const customRaw = Array.isArray(raw.customProviders) ? raw.customProviders : []
  const customProviders = validCustomProviders(normalizeCustomProvidersForMastra(customRaw))
  const leaderRaw =
    typeof raw.leaderModel === 'string' && raw.leaderModel.trim()
      ? raw.leaderModel
      : process.env.LEADER_MODEL || DEFAULT_LEADER_MODEL
  return {
    leaderModel: normalizeLeaderModelForMastra(leaderRaw, customProviders),
    thinkingIntensity: normalizeThinkingIntensity(
      raw.thinkingIntensity ?? process.env.THINKING_INTENSITY,
    ),
    customProviders,
    disabledProviderIds: normalizeDisabledProviderIds(raw.disabledProviderIds),
    leaderMaxSteps: resolveLeaderMaxSteps(raw.leaderMaxSteps),
    prompts: normalizePromptSettings(raw.prompts),
    workerTimeouts: resolveWorkerTimeoutSettings(raw.workerTimeouts),
    npmRegistry: (() => {
      try {
        return normalizeNpmRegistry(raw.npmRegistry)
      } catch {
        return undefined
      }
    })(),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : undefined,
  }
}

export function saveSettings(settings: Partial<AppSettings>): AppSettings {
  ensureDir()
  // Preserve an unreadable file for diagnosis/recovery instead of silently
  // replacing it with defaults plus the single field being edited.
  const prev = loadSettingsStrict()
  const requestedCustomProviders =
    settings.customProviders !== undefined ? settings.customProviders : (prev.customProviders ?? [])
  for (const provider of requestedCustomProviders) {
    assertConfigurableSecretEnvKey(provider?.apiKeyEnv)
  }
  const customProviders = normalizeCustomProvidersForMastra(requestedCustomProviders)
  const leaderRaw = settings.leaderModel ?? prev.leaderModel
  const next: AppSettings = {
    leaderModel: normalizeLeaderModelForMastra(leaderRaw, customProviders),
    thinkingIntensity:
      settings.thinkingIntensity !== undefined
        ? normalizeThinkingIntensity(settings.thinkingIntensity)
        : normalizeThinkingIntensity(prev.thinkingIntensity),
    customProviders,
    disabledProviderIds:
      settings.disabledProviderIds !== undefined
        ? normalizeDisabledProviderIds(settings.disabledProviderIds)
        : normalizeDisabledProviderIds(prev.disabledProviderIds),
    leaderMaxSteps:
      settings.leaderMaxSteps !== undefined
        ? parseLeaderMaxStepsInput(settings.leaderMaxSteps)
        : (prev.leaderMaxSteps ?? resolveLeaderMaxSteps(undefined)),
    prompts: normalizePromptSettings(settings.prompts ?? prev.prompts),
    workerTimeouts:
      settings.workerTimeouts !== undefined
        ? parseWorkerTimeoutSettings(settings.workerTimeouts)
        : prev.workerTimeouts,
    npmRegistry:
      settings.npmRegistry !== undefined
        ? normalizeNpmRegistry(settings.npmRegistry)
        : prev.npmRegistry,
    updatedAt: new Date().toISOString(),
  }
  // Explicit clear: empty string / null becomes undefined (omit override)
  if (settings.npmRegistry !== undefined && next.npmRegistry === undefined) {
    delete next.npmRegistry
  }
  atomicWritePrivateFile(settingsPath(), JSON.stringify(next, null, 2))
  return next
}

/** Reset persisted settings without inheriting a previously selected model from process.env. */
export function resetSettingsToDefaults(): AppSettings {
  ensureDir()
  const defaults = defaultAppSettings({ useEnvironment: false })
  atomicWritePrivateFile(settingsPath(), JSON.stringify(defaults, null, 2))
  return defaults
}

/** Merge built-in + custom providers for settings UI / API */
export function mergeProvidersWithCustom<
  T extends {
    id: string
    name: string
    apiKeyEnv: string
    docsUrl: string
    models: {
      id: string
      label: string
      contextWindow?: number
      thinkingIntensities?: ThinkingIntensity[]
      toolCall?: boolean
      multimodal?: boolean
    }[]
    baseURL?: string
    apiStyle?: string
    contextWindow?: number
    thinkingIntensities?: ThinkingIntensity[]
    source?: 'custom' | 'models.dev'
    modelsDevSyncedAt?: string
    npm?: string
  },
>(builtIn: T[], custom: CustomProviderSettings[] | undefined): T[] {
  const extras = validCustomProviders(custom ?? []).map(
    (c) =>
      ({
        id: c.id,
        name: c.name,
        apiKeyEnv: c.apiKeyEnv,
        docsUrl: c.docsUrl ?? '',
        baseURL: c.baseURL,
        apiStyle: c.apiStyle ?? 'openai',
        contextWindow: c.contextWindow,
        thinkingIntensities: c.thinkingIntensities,
        source: c.source,
        modelsDevSyncedAt: c.modelsDevSyncedAt,
        npm: c.npm,
        models: (c.models?.length ? c.models : [{ id: `${c.id}/default`, label: 'Default' }]).map(
          (m) => ({
            id: m.id,
            label: m.label,
            contextWindow: m.contextWindow ?? c.contextWindow,
            thinkingIntensities: m.thinkingIntensities ?? c.thinkingIntensities,
            ...(m.toolCall ? { toolCall: true } : {}),
            ...(m.multimodal ? { multimodal: true } : {}),
          }),
        ),
      }) as unknown as T,
  )
  const builtinIds = new Set(builtIn.map((p) => p.id))
  return [...builtIn, ...extras.filter((e) => !builtinIds.has(e.id))]
}

/**
 * @deprecated Prefer PROVIDER_ENV_OVERRIDES from provider-env-resolver.
 * Kept as a re-export so existing imports remain functional.
 */
export const MASTRA_GATEWAY_API_KEY_ENV = PROVIDER_ENV_OVERRIDES

/** Derive `OPENCODE_GO` style prefix from provider id `opencode-go`. */
export function providerIdToEnvPrefix(providerId: string): string {
  return providerId.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase() || 'CUSTOM'
}

/**
 * Apply custom provider base URLs into process.env for OpenAI-compatible gateways.
 * Only sets **provider-scoped** env (`{ID}_BASE_URL`). Does NOT set global OPENAI_BASE_URL
 * from array order — that must be request-scoped via applyProviderBaseUrlForModel.
 */
export function applyCustomProviderEnv(
  custom: CustomProviderSettings[] | undefined,
  target: NodeJS.ProcessEnv = process.env,
): void {
  for (const c of validCustomProviders(custom ?? [])) {
    if (!c.baseURL?.trim()) continue
    const base = c.baseURL.trim().replace(/\/$/, '')
    const upper = providerIdToEnvPrefix(c.id)
    target[`${upper}_BASE_URL`] = base
    target[`${upper}_API_BASE_URL`] = base
    // Only the literal builtin provider ids may set global base URL aliases
    if (c.id === 'openai' && (c.apiStyle ?? 'openai') === 'openai') {
      target.OPENAI_BASE_URL = base
    }
    if (c.id === 'anthropic' && (c.apiStyle ?? 'openai') === 'anthropic') {
      target.ANTHROPIC_BASE_URL = base
    }
  }
}

/**
 * Resolve request-scoped base URL for a model without touching process.env.
 * Prefer returning this via Mastra OpenAICompatibleConfig `{ id, url, apiKey }`.
 *
 * @deprecated Prefer resolveProviderBaseUrlForModel + request-scoped model config.
 * If `target` is provided, writes into that object only (never defaults to process.env).
 */
export function applyProviderBaseUrlForModel(
  modelId: string | null | undefined,
  custom: CustomProviderSettings[] | undefined,
  target?: NodeJS.ProcessEnv,
): void {
  const resolved = resolveProviderBaseUrlForModel(modelId, custom)
  if (!resolved || !target) return
  if (resolved.envKey === 'OPENAI_BASE_URL') target.OPENAI_BASE_URL = resolved.baseURL
  else if (resolved.envKey === 'ANTHROPIC_BASE_URL') target.ANTHROPIC_BASE_URL = resolved.baseURL
}

export function resolveProviderBaseUrlForModel(
  modelId: string | null | undefined,
  custom: CustomProviderSettings[] | undefined,
): {
  baseURL: string
  envKey: 'OPENAI_BASE_URL' | 'ANTHROPIC_BASE_URL'
  providerId: string
} | null {
  const mid = modelId?.trim()
  if (!mid) return null
  const providerId = mid.includes('/') ? mid.slice(0, mid.indexOf('/')) : mid
  const match = (custom ?? []).find(
    (c) => c.id === providerId || normalizeMastraProviderId(c.id) === providerId,
  )
  if (!match?.baseURL?.trim()) return null
  const base = match.baseURL.trim().replace(/\/$/, '')
  const style = String(match.apiStyle ?? 'openai').toLowerCase()
  if (style === 'anthropic') {
    return { baseURL: base, envKey: 'ANTHROPIC_BASE_URL', providerId }
  }
  // openai + legacy `custom` (and unknown) all use OpenAI-compatible base URL wiring
  if (style === 'google') {
    return null
  }
  return { baseURL: base, envKey: 'OPENAI_BASE_URL', providerId }
}

/**
 * Apply resolved winner from ProviderEnvResolver (settings/worker beat process).
 * Unlike fill-if-empty, a non-empty process value does not block a higher-priority winner.
 */
function applyResolvedEnv(
  target: NodeJS.ProcessEnv,
  envName: string,
  value: string | undefined,
  opts?: { force?: boolean },
): void {
  if (!value?.trim()) return
  if (opts?.force || !target[envName]?.trim()) {
    target[envName] = value
  }
}

function fillEnvIfEmpty(target: NodeJS.ProcessEnv, envName: string, value: string): void {
  applyResolvedEnv(target, envName, value)
}

/**
 * Alias custom / stored API keys onto Mastra models.dev env names.
 * Example: custom id `opencode-go` + `CUSTOM_OPENCODE_GO_API_KEY` → `OPENCODE_API_KEY`.
 * Uses resolveProviderEnv for registry-aligned alias fill; keeps custom-id conventions.
 */
/**
 * Push one authoritative API key onto all env aliases for a custom / Mastra provider.
 * Always force — ambient shell keys and stale secrets must not diverge.
 */
function forceProviderKeyAliases(
  target: NodeJS.ProcessEnv,
  providerIds: string[],
  apiKeyEnv: string | undefined,
  key: string,
  secrets: SecretsMap,
): void {
  if (apiKeyEnv) applyResolvedEnv(target, apiKeyEnv, key, { force: true })
  for (const id of new Set(providerIds.filter(Boolean))) {
    const canonId = normalizeMastraProviderId(id)
    const upper = providerIdToEnvPrefix(id)
    const canonUpper = providerIdToEnvPrefix(canonId)
    applyResolvedEnv(target, `${upper}_API_KEY`, key, { force: true })
    applyResolvedEnv(target, `${canonUpper}_API_KEY`, key, { force: true })
    applyResolvedEnv(target, `CUSTOM_${upper}_API_KEY`, key, { force: true })
    applyResolvedEnv(target, `CUSTOM_${canonUpper}_API_KEY`, key, { force: true })
    if (canonId === 'opencode' || canonId === 'opencode-go' || canonId === 'opencodego') {
      applyResolvedEnv(target, 'OPENCODE_API_KEY', key, { force: true })
      applyResolvedEnv(target, 'OPENCODE_GO_API_KEY', key, { force: true })
      // Historical typos / legacy secret names
      applyResolvedEnv(target, 'CUSTOM_OPENCODEGO_API_KEY', key, { force: true })
      applyResolvedEnv(target, 'CUSTOM_OPENCODE_GO_API_KEY', key, { force: true })
    }
    for (const pid of new Set([id, canonId])) {
      const mapped = MASTRA_GATEWAY_API_KEY_ENV[pid]
      if (!mapped) continue
      const registryApiKeyEnvVar = Array.isArray(mapped) ? mapped : [mapped]
      const resolved = resolveProviderEnv({
        providerId: pid,
        registryApiKeyEnvVar,
        workerEnv: {},
        settingsSecrets: {
          ...(apiKeyEnv ? { [apiKeyEnv]: key } : {}),
          ...secrets,
        },
        processEnv: target as Record<string, string | undefined>,
        overrides: apiKeyEnv ? { [pid]: { apiKeyEnvAliases: [apiKeyEnv] } } : undefined,
      })
      for (const envName of registryApiKeyEnvVar) {
        if (resolved.env[envName]?.trim()) {
          applyResolvedEnv(target, envName, resolved.env[envName], { force: true })
        }
      }
      // Always stamp registry names with the authoritative key
      for (const envName of registryApiKeyEnvVar) {
        applyResolvedEnv(target, envName, key, { force: true })
      }
    }
  }
}

export function applyMastraProviderKeyAliases(
  custom: CustomProviderSettings[] | undefined,
  secrets: SecretsMap,
  target: NodeJS.ProcessEnv = process.env,
): void {
  const resolveKey = (envName: string | undefined): string | undefined => {
    if (!envName) return undefined
    const fromSecrets = secrets[envName]?.trim()
    if (fromSecrets) return fromSecrets
    const fromTarget = target[envName]?.trim()
    return fromTarget || undefined
  }

  // 1) Legacy CUSTOM_* secrets — fill gaps only when the configured provider
  //    secret is missing. Never let a stale CUSTOM_* overwrite the provider key.
  for (const [secretKey, raw] of Object.entries(secrets)) {
    const value = raw?.trim()
    if (!value) continue
    const m = /^CUSTOM_(.+)_API_KEY$/.exec(secretKey)
    if (!m?.[1]) continue
    const collapsed = m[1].toLowerCase()
    const hyphenated = collapsed.replace(/_/g, '-')
    const ids = [
      hyphenated,
      collapsed,
      normalizeMastraProviderId(hyphenated),
      normalizeMastraProviderId(collapsed),
    ]
    // If a customProviders entry owns this provider and has its own secret, skip
    const owned = (custom ?? []).some((c) => {
      const cid = normalizeMastraProviderId(c.id)
      return ids.some((id) => id === c.id || id === cid) && Boolean(secrets[c.apiKeyEnv]?.trim())
    })
    if (owned) continue
    forceProviderKeyAliases(target, ids, secretKey, value, secrets)
  }

  // 2) Configured custom providers LAST — apiKeyEnv is authoritative
  for (const c of validCustomProviders(custom ?? [])) {
    const key = resolveKey(c.apiKeyEnv)
    if (!key) continue
    const ids = [c.id, normalizeMastraProviderId(c.id)]
    for (const m of c.models ?? []) {
      const prefix = m.id.split('/')[0]
      if (prefix) ids.push(prefix, normalizeMastraProviderId(prefix))
    }
    forceProviderKeyAliases(target, ids, c.apiKeyEnv, key, secrets)
  }
}

/**
 * Apply stored secrets + settings into process.env (for API / agent runtime).
 */
export function applySecretsToEnv(target: NodeJS.ProcessEnv = process.env): SecretsMap {
  const secrets = loadSecrets()
  for (const [k, v] of Object.entries(secrets)) {
    // Always overwrite process/shell ambient with the saved secret value
    if (isConfigurableSecretEnvKey(k) && v) target[k] = v
  }
  // Google dual-name aliases via ProviderEnvResolver
  {
    const google = resolveProviderEnv({
      providerId: 'google',
      registryApiKeyEnvVar: ['GOOGLE_GENERATIVE_AI_API_KEY', 'GOOGLE_API_KEY'],
      workerEnv: {},
      settingsSecrets: secrets,
      processEnv: target as Record<string, string | undefined>,
    })
    for (const name of ['GOOGLE_GENERATIVE_AI_API_KEY', 'GOOGLE_API_KEY'] as const) {
      if (google.env[name]?.trim() && !target[name]?.trim()) {
        target[name] = google.env[name]
      }
    }
  }
  try {
    const custom = loadSettings().customProviders
    applyCustomProviderEnv(custom, target)
    applyMastraProviderKeyAliases(custom, secrets, target)
  } catch {
    /* ignore */
  }
  const settings = loadSettings()
  if (settings.leaderModel) {
    target.LEADER_MODEL = settings.leaderModel
  }
  if (settings.thinkingIntensity) {
    target.THINKING_INTENSITY = settings.thinkingIntensity
  }
  return secrets
}

export function getSecretsStatus(secretKeys: string[]): SecretsStatus {
  const secrets = loadSecrets()
  // Electron injects decrypted credentials into its trusted API child. That child
  // cannot unwrap safeStorage itself, but may safely report key presence (never value).
  const configuredKeys = secretKeys.filter((k) =>
    Boolean(secrets[k]?.trim() || process.env[k]?.trim()),
  )
  return {
    configuredKeys,
    storage: existsSync(secretsPath())
      ? 'encrypted-file'
      : configuredKeys.length
        ? 'memory'
        : 'none',
    settings: loadSettings(),
  }
}

export function secretsDir(): string {
  return secretsRoot()
}

// ── ACP execution fingerprint ──

let _testMasterKey: Buffer | null = null
const ACP_FINGERPRINT_DOMAIN = 'acp-session-fingerprint-v1'
const ACP_FINGERPRINT_KEY_ENV = 'SWARMDESK_AGENT_ACP_FINGERPRINT_KEY'
const WORKER_SECRETS_DOMAIN = 'worker-secrets-encryption-v1'
const WORKER_SECRETS_KEY_ENV = 'SWARMDESK_AGENT_WORKER_SECRETS_KEY'

export function setTestMasterKey(key: Buffer | null): void {
  _testMasterKey = key
}

function getDerivedKey(domain: string): Buffer {
  if (!_testMasterKey && domain === ACP_FINGERPRINT_DOMAIN) {
    const encoded = process.env[ACP_FINGERPRINT_KEY_ENV]?.trim()
    if (encoded) {
      try {
        const injected = Buffer.from(encoded, 'base64')
        if (injected.length === 32) return injected
      } catch {
        /* use the local master-key path */
      }
    }
  }
  const masterKey = _testMasterKey ?? getMasterKey()
  return createHmac('sha256', masterKey).update(domain).digest()
}

function decodeInjectedKey(envName: string): Buffer {
  const encoded = process.env[envName]?.trim()
  if (!encoded) {
    throw new Error('Worker secret capability is unavailable in this process')
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0) {
    throw new Error('Worker secret capability must be valid base64 for exactly 32 bytes')
  }
  const key = Buffer.from(encoded, 'base64')
  if (key.length !== 32 || key.toString('base64') !== encoded) {
    throw new Error('Worker secret capability must decode to exactly 32 bytes')
  }
  return key
}

/**
 * Internal storage keys for the worker-scoped namespace.
 * The trusted API child gets only the current domain key.
 */
export function getWorkerSecretsEncryptionKeys(): {
  current: Buffer
} {
  if (process.env.SWARMDESK_AGENT_SECRETS_PARENT_INJECTED === '1') {
    return { current: decodeInjectedKey(WORKER_SECRETS_KEY_ENV) }
  }
  const masterKey = _testMasterKey ?? getMasterKey()
  return {
    current: createHmac('sha256', masterKey).update(WORKER_SECRETS_DOMAIN).digest(),
  }
}

/** Domain-separated key passed only to the trusted Node API child, never a worker. */
export function getAcpFingerprintKeyForChild(): string {
  return getDerivedKey(ACP_FINGERPRINT_DOMAIN).toString('base64')
}

/** Domain-separated capability passed only to the trusted Node API child. */
export function getWorkerSecretsKeyForChild(): string {
  if (process.env.SWARMDESK_AGENT_SECRETS_PARENT_INJECTED === '1') {
    throw new Error('Worker secret child capability can only be minted by the owner process')
  }
  return getWorkerSecretsEncryptionKeys().current.toString('base64')
}

const AMBIENT_EXACT = new Set([
  'PATH',
  'HOME',
  'USERPROFILE',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'SSL_CERT_FILE',
  'NODE_EXTRA_CA_CERTS',
  'NODE_OPTIONS',
])

const AMBIENT_PREFIXES = [
  'XDG_',
  'NPM_CONFIG_',
  'OPENAI_',
  'ANTHROPIC_',
  'GOOGLE_',
  'GEMINI_',
  'AWS_',
  'AZURE_',
  'OPENCODE_',
  'CLAUDE_',
  'CODEX_',
]

const AMBIENT_SUFFIXES = ['_API_KEY', '_TOKEN', '_BASE_URL', '_MODEL', '_PROFILE']

export function collectExecutionRelevantEnv(
  workerEnv: Record<string, string>,
  ambientEnv: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {}

  for (const [key, value] of Object.entries(ambientEnv)) {
    if (key.toUpperCase() === ACP_FINGERPRINT_KEY_ENV) continue
    if (matchesAmbient(key)) {
      result[key] = value
    }
  }

  for (const [key, value] of Object.entries(workerEnv)) {
    result[key] = value
  }

  return result
}

function matchesAmbient(key: string): boolean {
  const upper = key.toUpperCase()

  if (AMBIENT_EXACT.has(upper)) return true

  for (const prefix of AMBIENT_PREFIXES) {
    if (upper.startsWith(prefix)) return true
  }

  for (const suffix of AMBIENT_SUFFIXES) {
    if (upper.endsWith(suffix)) return true
  }

  return false
}

function normalizeEnvKeyValues(env: Record<string, string>): Array<[string, string]> {
  return Object.entries(env).sort(([left], [right]) => left.localeCompare(right))
}

export function computeAcpExecutionFingerprint(
  command: string,
  args: string[],
  model: string | undefined,
  reasoning: string | undefined,
  workerEnv: Record<string, string>,
  ambientEnv: Record<string, string>,
): string {
  const relevantAmbientEnv = collectExecutionRelevantEnv({}, ambientEnv)
  const canonical = JSON.stringify({
    command,
    args,
    model: model ?? null,
    reasoning: reasoning ?? null,
    explicitEnv: normalizeEnvKeyValues(workerEnv),
    ambientEnv: normalizeEnvKeyValues(relevantAmbientEnv),
  })
  const key = getDerivedKey(ACP_FINGERPRINT_DOMAIN)
  return createHmac('sha256', key).update(canonical).digest('hex')
}
