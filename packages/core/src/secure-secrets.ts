/**
 * Cross-platform secret storage for API keys.
 *
 * Strategy:
 * - Encrypt payload with AES-256-GCM
 * - Master key in ~/.router-agents/.master-key (mode 0o600)
 * - Ciphertext in ~/.router-agents/secrets.enc
 *
 * Electron may additionally wrap the master key with safeStorage (Keychain / DPAPI)
 * via setMasterKeyProvider / getMasterKeyProvider hooks.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  chmodSync,
  unlinkSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
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

export type SecretsMap = Record<string, string>

export type CustomApiStyle = 'openai' | 'anthropic' | 'google' | 'custom'

export interface CustomProviderModel {
  id: string
  label: string
  /** Context window size in tokens (OpenCode-style) */
  contextWindow?: number
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
  /** Protocol style — OpenCode-like: openai | anthropic | google | custom */
  apiStyle?: CustomApiStyle
  /** Default context window for models without per-model override */
  contextWindow?: number
  /**
   * Thinking intensities this gateway actually supports (checkboxes in Settings).
   * Built-ins ignore this and use BUILTIN_THINKING_PRESETS.
   */
  thinkingIntensities?: ThinkingIntensity[]
  models: CustomProviderModel[]
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
  /** Maximum model steps per response (10–1000, default 500) */
  leaderMaxSteps?: number
  /** Non-secret prefs */
  updatedAt?: string
}

export interface SecretsStatus {
  /** Env keys that have a non-empty stored value (never return the value here) */
  configuredKeys: string[]
  storage: 'encrypted-file' | 'memory' | 'none'
  settings: AppSettings
}

const DIR = join(homedir(), '.router-agents')
const MASTER_KEY_PATH = join(DIR, '.master-key')
const SECRETS_PATH = join(DIR, 'secrets.enc')
const SETTINGS_PATH = join(DIR, 'settings.json')

type MasterKeyProvider = {
  /** Prefer OS-backed storage when available (Electron safeStorage) */
  wrapMasterKey?: (raw: Buffer) => Buffer | null
  unwrapMasterKey?: (wrapped: Buffer) => Buffer | null
  isAvailable?: () => boolean
}

let masterKeyProvider: MasterKeyProvider | null = null

export function setMasterKeyProvider(provider: MasterKeyProvider | null): void {
  masterKeyProvider = provider
}

function ensureDir(): void {
  if (!existsSync(DIR)) {
    mkdirSync(DIR, { recursive: true, mode: 0o700 })
  }
  try {
    chmodSync(DIR, 0o700)
  } catch {
    /* windows may ignore */
  }
}

function loadOrCreateMasterKey(): Buffer {
  ensureDir()
  if (existsSync(MASTER_KEY_PATH)) {
    const raw = readFileSync(MASTER_KEY_PATH)
    // versioned: 0x01 + OS-wrapped master key (Electron safeStorage)
    if (raw[0] === 0x01 && raw.length > 1 && masterKeyProvider?.unwrapMasterKey) {
      try {
        const unwrapped = masterKeyProvider.unwrapMasterKey(raw.subarray(1))
        if (unwrapped && unwrapped.length >= 32) return unwrapped.subarray(0, 32)
      } catch {
        /* fall through */
      }
    }
    // plain 32-byte key (file mode 600) — used by API-only and first-run without wrap
    if (raw.length >= 32) return raw.subarray(0, 32)
    return scryptSync(raw, 'router-agents', 32)
  }

  const key = randomBytes(32)
  let toWrite: Buffer = key
  if (masterKeyProvider?.wrapMasterKey && masterKeyProvider.isAvailable?.()) {
    try {
      const wrapped = masterKeyProvider.wrapMasterKey(key)
      if (wrapped) {
        toWrite = Buffer.concat([Buffer.from([0x01]), wrapped])
      }
    } catch {
      /* store plain */
    }
  }
  writeFileSync(MASTER_KEY_PATH, toWrite, { mode: 0o600 })
  try {
    chmodSync(MASTER_KEY_PATH, 0o600)
  } catch {
    /* windows */
  }
  return key
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
  return JSON.parse(dec.toString('utf8')) as SecretsMap
}

export function loadSecrets(): SecretsMap {
  try {
    if (!existsSync(SECRETS_PATH)) return {}
    const key = loadOrCreateMasterKey()
    const blob = readFileSync(SECRETS_PATH)
    return decryptJson(blob, key)
  } catch (e) {
    console.error('[secure-secrets] load failed', e)
    return {}
  }
}

export function saveSecrets(secrets: SecretsMap): void {
  ensureDir()
  const key = loadOrCreateMasterKey()
  // strip empty
  const clean: SecretsMap = {}
  for (const [k, v] of Object.entries(secrets)) {
    if (typeof v === 'string' && v.trim()) clean[k] = v.trim()
  }
  const blob = encryptJson(clean, key)
  writeFileSync(SECRETS_PATH, blob, { mode: 0o600 })
  try {
    chmodSync(SECRETS_PATH, 0o600)
  } catch {
    /* windows */
  }
}

export function setSecret(envKey: string, value: string): SecretsMap {
  const all = loadSecrets()
  if (!value.trim()) {
    delete all[envKey]
  } else {
    all[envKey] = value.trim()
  }
  saveSecrets(all)
  return all
}

export function deleteSecret(envKey: string): SecretsMap {
  const all = loadSecrets()
  delete all[envKey]
  saveSecrets(all)
  return all
}

export function clearAllSecrets(): void {
  ensureDir()
  if (existsSync(SECRETS_PATH)) unlinkSync(SECRETS_PATH)
}

function defaultAppSettings(): AppSettings {
  return {
    leaderModel: process.env.LEADER_MODEL ?? 'openai/gpt-5.5',
    thinkingIntensity: DEFAULT_THINKING_INTENSITY,
    customProviders: [],
    leaderMaxSteps: 500,
  }
}

export function loadSettings(): AppSettings {
  try {
    if (!existsSync(SETTINGS_PATH)) {
      return defaultAppSettings()
    }
    const raw = JSON.parse(readFileSync(SETTINGS_PATH, 'utf8')) as AppSettings
    const customRaw = Array.isArray(raw.customProviders) ? raw.customProviders : []
    const customProviders = normalizeCustomProvidersForMastra(customRaw)
    const leaderRaw = raw.leaderModel || process.env.LEADER_MODEL || 'openai/gpt-5.5'
    return {
      leaderModel: normalizeLeaderModelForMastra(leaderRaw, customProviders),
      thinkingIntensity: normalizeThinkingIntensity(
        raw.thinkingIntensity ?? process.env.THINKING_INTENSITY,
      ),
      customProviders,
      leaderMaxSteps: resolveLeaderMaxSteps(raw.leaderMaxSteps),
      updatedAt: raw.updatedAt,
    }
  } catch {
    return defaultAppSettings()
  }
}

export function saveSettings(settings: AppSettings): AppSettings {
  ensureDir()
  const prev = loadSettings()
  const customProviders = normalizeCustomProvidersForMastra(
    settings.customProviders !== undefined
      ? settings.customProviders
      : prev.customProviders ?? [],
  )
  const leaderRaw = settings.leaderModel ?? prev.leaderModel
  const next: AppSettings = {
    leaderModel: normalizeLeaderModelForMastra(leaderRaw, customProviders),
    thinkingIntensity:
      settings.thinkingIntensity !== undefined
        ? normalizeThinkingIntensity(settings.thinkingIntensity)
        : normalizeThinkingIntensity(prev.thinkingIntensity),
    customProviders,
    leaderMaxSteps:
      settings.leaderMaxSteps !== undefined
        ? parseLeaderMaxStepsInput(settings.leaderMaxSteps)
        : prev.leaderMaxSteps ?? resolveLeaderMaxSteps(undefined),
    updatedAt: new Date().toISOString(),
  }
  writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2), { mode: 0o600 })
  try {
    chmodSync(SETTINGS_PATH, 0o600)
  } catch {
    /* windows */
  }
  return next
}

/** Merge built-in + custom providers for settings UI / API */
export function mergeProvidersWithCustom<
  T extends {
    id: string
    name: string
    apiKeyEnv: string
    docsUrl: string
    models: { id: string; label: string; contextWindow?: number }[]
    baseURL?: string
    apiStyle?: string
    contextWindow?: number
    thinkingIntensities?: ThinkingIntensity[]
  },
>(builtIn: T[], custom: CustomProviderSettings[] | undefined): T[] {
  const extras = (custom ?? []).map(
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
        models: (c.models?.length ? c.models : [{ id: `${c.id}/default`, label: 'Default' }]).map(
          (m) => ({
            id: m.id,
            label: m.label,
            contextWindow: m.contextWindow ?? c.contextWindow,
          }),
        ),
      }) as T,
  )
  const builtinIds = new Set(builtIn.map((p) => p.id))
  return [...builtIn, ...extras.filter((e) => !builtinIds.has(e.id))]
}

/**
 * Mastra models.dev provider id → API key env var(s).
 * When a custom provider reuses a models.dev id (e.g. `opencode-go`), the stored
 * secret is often `CUSTOM_OPENCODE_GO_API_KEY`, but the gateway reads a different
 * name (e.g. `OPENCODE_API_KEY`). Aliases bridge that gap at runtime.
 *
 * @see https://models.dev / @mastra/core provider-registry
 */
export const MASTRA_GATEWAY_API_KEY_ENV: Record<string, string | string[]> = {
  opencode: 'OPENCODE_API_KEY',
  'opencode-go': 'OPENCODE_API_KEY',
  // slug("OpenCodeGO") without hyphen — still map to same key
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
}

/** Derive `OPENCODE_GO` style prefix from provider id `opencode-go`. */
export function providerIdToEnvPrefix(providerId: string): string {
  return providerId.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase() || 'CUSTOM'
}

/**
 * Apply custom provider base URLs into process.env for OpenAI-compatible gateways.
 * Env keys: `{PROVIDER_ID}_BASE_URL` and optional OPENAI_BASE_URL for openai-style.
 */
export function applyCustomProviderEnv(
  custom: CustomProviderSettings[] | undefined,
  target: NodeJS.ProcessEnv = process.env,
): void {
  for (const c of custom ?? []) {
    if (!c.baseURL?.trim()) continue
    const base = c.baseURL.trim().replace(/\/$/, '')
    const upper = providerIdToEnvPrefix(c.id)
    target[`${upper}_BASE_URL`] = base
    target[`${upper}_API_BASE_URL`] = base
    // OpenAI-compatible gateways often honor OPENAI_BASE_URL when using openai/* models
    if ((c.apiStyle ?? 'openai') === 'openai' && !target.OPENAI_BASE_URL) {
      // only set if this is the active custom gateway named openai or openrouter-like
      if (c.id === 'openai' || c.id.includes('openai') || c.id === 'custom') {
        target.OPENAI_BASE_URL = base
      }
    }
    if ((c.apiStyle ?? 'openai') === 'anthropic' && !target.ANTHROPIC_BASE_URL) {
      if (c.id === 'anthropic' || c.id.includes('anthropic')) {
        target.ANTHROPIC_BASE_URL = base
      }
    }
  }
}

function fillEnvIfEmpty(target: NodeJS.ProcessEnv, envName: string, value: string): void {
  if (!target[envName]?.trim()) {
    target[envName] = value
  }
}

/**
 * Alias custom / stored API keys onto Mastra models.dev env names.
 * Example: custom id `opencode-go` + `CUSTOM_OPENCODE_GO_API_KEY` → `OPENCODE_API_KEY`.
 */
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

  for (const c of custom ?? []) {
    const key = resolveKey(c.apiKeyEnv)
    if (!key) continue

    const canonId = normalizeMastraProviderId(c.id)
    const upper = providerIdToEnvPrefix(c.id)
    const canonUpper = providerIdToEnvPrefix(canonId)
    // Common convention: OPENCODE_GO_API_KEY
    fillEnvIfEmpty(target, `${upper}_API_KEY`, key)
    fillEnvIfEmpty(target, `${canonUpper}_API_KEY`, key)
    // Always ensure the storage key itself is present (usually already set)
    fillEnvIfEmpty(target, c.apiKeyEnv, key)

    for (const id of new Set([c.id, canonId])) {
      const mapped = MASTRA_GATEWAY_API_KEY_ENV[id]
      if (!mapped) continue
      for (const envName of Array.isArray(mapped) ? mapped : [mapped]) {
        fillEnvIfEmpty(target, envName, key)
      }
    }

    // Model ids may use a different provider prefix than settings id (rare)
    for (const m of c.models ?? []) {
      const prefix = m.id.split('/')[0]
      if (!prefix) continue
      const canonPrefix = normalizeMastraProviderId(prefix)
      for (const p of new Set([prefix, canonPrefix])) {
        const mappedPrefix = MASTRA_GATEWAY_API_KEY_ENV[p]
        if (!mappedPrefix) continue
        for (const envName of Array.isArray(mappedPrefix) ? mappedPrefix : [mappedPrefix]) {
          fillEnvIfEmpty(target, envName, key)
        }
        fillEnvIfEmpty(target, `${providerIdToEnvPrefix(p)}_API_KEY`, key)
      }
    }
  }

  // Also map known gateway env names when secrets were saved under CUSTOM_{ID}_API_KEY
  // without going through customProviders (or after id rename).
  for (const [secretKey, raw] of Object.entries(secrets)) {
    const value = raw?.trim()
    if (!value) continue
    const m = /^CUSTOM_(.+)_API_KEY$/.exec(secretKey)
    if (!m?.[1]) continue
    const collapsed = m[1].toLowerCase()
    const hyphenated = collapsed.replace(/_/g, '-')
    // try hyphen form, underscore form, and Mastra-canonical id
    for (const id of new Set([
      hyphenated,
      collapsed,
      normalizeMastraProviderId(hyphenated),
      normalizeMastraProviderId(collapsed),
    ])) {
      const mapped = MASTRA_GATEWAY_API_KEY_ENV[id]
      if (!mapped) continue
      for (const envName of Array.isArray(mapped) ? mapped : [mapped]) {
        fillEnvIfEmpty(target, envName, value)
      }
    }
  }
}

/**
 * Apply stored secrets + settings into process.env (for API / agent runtime).
 */
export function applySecretsToEnv(target: NodeJS.ProcessEnv = process.env): SecretsMap {
  const secrets = loadSecrets()
  for (const [k, v] of Object.entries(secrets)) {
    if (v) target[k] = v
  }
  // Common aliases so either Google env name works with Mastra / AI SDK
  if (secrets.GOOGLE_API_KEY && !target.GOOGLE_GENERATIVE_AI_API_KEY) {
    target.GOOGLE_GENERATIVE_AI_API_KEY = secrets.GOOGLE_API_KEY
  }
  if (secrets.GOOGLE_GENERATIVE_AI_API_KEY && !target.GOOGLE_API_KEY) {
    target.GOOGLE_API_KEY = secrets.GOOGLE_GENERATIVE_AI_API_KEY
  }
  // Custom provider base URLs + Mastra models.dev key aliases (OpenCode-style)
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
  const configuredKeys = secretKeys.filter((k) => Boolean(secrets[k]?.trim()))
  return {
    configuredKeys,
    storage: existsSync(SECRETS_PATH) ? 'encrypted-file' : configuredKeys.length ? 'memory' : 'none',
    settings: loadSettings(),
  }
}

export function secretsDir(): string {
  return DIR
}
