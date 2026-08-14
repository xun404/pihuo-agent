/**
 * Build the effective environment for worker child processes.
 *
 * Workers must NOT inherit Leader provider secrets (API keys / tokens) by default.
 * Only a small ambient whitelist + worker-configured env + model-required credentials
 * are passed through.
 */

import { getProviderId } from './model-eligibility.js'

/** Ambient keys safe / necessary for CLI agents to function. */
const AMBIENT_ALLOWLIST_EXACT = new Set([
  'PATH',
  'HOME',
  'USERPROFILE',
  'USER',
  'LOGNAME',
  'SHELL',
  'TERM',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'LANGUAGE',
  'LC_ALL',
  'LC_CTYPE',
  'LC_MESSAGES',
  'LC_COLLATE',
  'LC_MONETARY',
  'LC_NUMERIC',
  'LC_TIME',
  'TZ',
  'XDG_DATA_HOME',
  'XDG_CONFIG_HOME',
  'XDG_CACHE_HOME',
  'XDG_STATE_HOME',
  'XDG_RUNTIME_DIR',
  'COLORTERM',
  'TERM_PROGRAM',
  'SSH_AUTH_SOCK',
  'DISPLAY',
  // Node / runtime plumbing (not secrets)
  'NODE_ENV',
  'NODE_OPTIONS',
  'NO_COLOR',
  'FORCE_COLOR',
  // Enterprise network / TLS (non-secret)
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'http_proxy',
  'https_proxy',
  'NO_PROXY',
  'no_proxy',
  'ALL_PROXY',
  'all_proxy',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS',
  'REQUESTS_CA_BUNDLE',
  'CURL_CA_BUNDLE',
  // npm / npx registry (system default when app override unset)
  'NPM_CONFIG_REGISTRY',
])

const AMBIENT_ALLOWLIST_PREFIX = ['LC_']

/** App-level override applied to every Worker spawn (from settings.npmRegistry). */
let configuredNpmRegistry: string | undefined

/**
 * Configure process-wide defaults for Worker env construction.
 * Call on API boot and after settings save (no API restart required).
 */
export function configureWorkerEnvDefaults(opts: { npmRegistry?: string | null }): void {
  const raw = opts.npmRegistry
  if (raw == null || (typeof raw === 'string' && !raw.trim())) {
    configuredNpmRegistry = undefined
    return
  }
  configuredNpmRegistry = String(raw).trim()
}

export function getConfiguredNpmRegistry(): string | undefined {
  return configuredNpmRegistry
}

/** Owner-process capabilities and control flags are never valid Worker input. */
const NEVER_FORWARD_EXACT = new Set([
  'PIHUO_AGENT_INTERNAL_TOKEN',
  'PIHUO_AGENT_DESKTOP_TOKEN',
  'PIHUO_AGENT_STUDIO_TOKEN',
  'PIHUO_AGENT_ACP_FINGERPRINT_KEY',
  'PIHUO_AGENT_WORKER_SECRETS_KEY',
  'PIHUO_AGENT_SECRETS_PARENT_INJECTED',
  'MASTRA_API_TOKEN',
  'ELECTRON_RUN_AS_NODE',
  'ELECTRON_NO_ATTACH_CONSOLE',
])

/** Secrets are denied unless intentionally configured for this Worker/model. */
const SECRET_DENY_SUFFIXES = ['_API_KEY', '_TOKEN', '_SECRET', '_PASSWORD', '_CREDENTIAL']
const SECRET_DENY_EXACT = new Set([
  'API_KEY',
  'TOKEN',
  'SECRET',
  'PASSWORD',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GOOGLE_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'XAI_API_KEY',
  'DEEPSEEK_API_KEY',
  'OPENROUTER_API_KEY',
  'OPENCODE_API_KEY',
  'DASHSCOPE_API_KEY',
  'MOONSHOT_API_KEY',
  'ZHIPU_API_KEY',
  'GROQ_API_KEY',
  'MISTRAL_API_KEY',
  'COHERE_API_KEY',
  'TOGETHER_API_KEY',
  'FIREWORKS_API_KEY',
  'PERPLEXITY_API_KEY',
  'HUGGINGFACE_API_KEY',
  'HF_TOKEN',
])

/** Provider id → env keys needed for that provider's models. */
const PROVIDER_CREDENTIAL_KEYS: Record<string, string[]> = {
  openai: ['OPENAI_API_KEY'],
  anthropic: ['ANTHROPIC_API_KEY'],
  google: ['GOOGLE_GENERATIVE_AI_API_KEY', 'GOOGLE_API_KEY'],
  gemini: ['GOOGLE_GENERATIVE_AI_API_KEY', 'GOOGLE_API_KEY'],
  xai: ['XAI_API_KEY'],
  deepseek: ['DEEPSEEK_API_KEY'],
  openrouter: ['OPENROUTER_API_KEY'],
  opencode: ['OPENCODE_API_KEY'],
  'opencode-go': ['OPENCODE_API_KEY'],
  alibaba: ['DASHSCOPE_API_KEY'],
  'alibaba-cn': ['DASHSCOPE_API_KEY'],
  moonshotai: ['MOONSHOT_API_KEY'],
  zhipuai: ['ZHIPU_API_KEY'],
  groq: ['GROQ_API_KEY'],
  mistral: ['MISTRAL_API_KEY'],
  cohere: ['COHERE_API_KEY'],
  together: ['TOGETHER_API_KEY'],
  fireworks: ['FIREWORKS_API_KEY'],
  perplexity: ['PERPLEXITY_API_KEY'],
  huggingface: ['HUGGINGFACE_API_KEY', 'HF_TOKEN'],
}

function isAmbientKey(key: string): boolean {
  if (AMBIENT_ALLOWLIST_EXACT.has(key)) return true
  return AMBIENT_ALLOWLIST_PREFIX.some((p) => key.startsWith(p))
}

function looksLikeSecretKey(key: string): boolean {
  if (SECRET_DENY_EXACT.has(key)) return true
  const upper = key.toUpperCase()
  if (SECRET_DENY_EXACT.has(upper)) return true
  return SECRET_DENY_SUFFIXES.some((s) => upper.endsWith(s))
}

function mustNeverForward(key: string): boolean {
  return NEVER_FORWARD_EXACT.has(key.toUpperCase())
}

/**
 * Credential env keys required for a model pin (provider-scoped).
 * Empty model → no auto credentials (worker config may still supply them).
 */
export function credentialKeysForModel(model?: string | null): string[] {
  const m = model?.trim()
  if (!m) return []
  const provider = getProviderId(m)
  return PROVIDER_CREDENTIAL_KEYS[provider] ?? []
}

export interface BuildEffectiveWorkerEnvOpts {
  /** process.env (or a test double) */
  ambientEnv?: Readonly<Record<string, string | undefined>>
  /** Worker registration / SessionEntryConfig.env (explicit overrides) */
  workerEnv?: Readonly<Record<string, string | undefined>>
  /** Pinned model — only this provider's keys are pulled from ambient when missing in workerEnv */
  model?: string | null
  /**
   * Extra ambient keys to allow (e.g. worker-specific).
   * Still subject to secret deny unless listed in credentialKeysForModel / workerEnv.
   */
  extraAmbientKeys?: readonly string[]
  /**
   * Worker-scoped env_var auth secrets (from encrypted namespace).
   * Injected only into this spawn env — never written to process.env.
   */
  workerSecrets?: Readonly<Record<string, string | undefined>>
  /**
   * Optional NPM registry override for this spawn (NPM_CONFIG_REGISTRY).
   * When omitted, uses configureWorkerEnvDefaults() value if set;
   * otherwise ambient NPM_CONFIG_REGISTRY or npm system default (~/.npmrc).
   */
  npmRegistry?: string | null
}

/**
 * Construct the env object actually passed to spawn().
 *
 * Policy:
 * 1. Ambient whitelist (PATH/HOME/locale/XDG/TMP/…)
 * 2. workerEnv overlays (may include intentional credentials for that worker)
 * 3. workerSecrets overlay (env_var auth; target process only)
 * 4. Only model-required credentials pulled from ambient if not already set
 * 5. Strip denied secrets that were never authorized for this worker/model
 *
 * Never mutates process.env.
 */
export function buildEffectiveWorkerEnv(
  opts: BuildEffectiveWorkerEnvOpts = {},
): Record<string, string> {
  const ambient = opts.ambientEnv ?? process.env
  const workerEnv = opts.workerEnv ?? {}
  const workerSecrets = opts.workerSecrets ?? {}
  const allowedCreds = new Set(credentialKeysForModel(opts.model))
  // Worker-configured keys that look like secrets are intentional for that worker
  for (const k of Object.keys(workerEnv)) {
    if (
      !mustNeverForward(k) &&
      workerEnv[k] != null &&
      workerEnv[k] !== '' &&
      looksLikeSecretKey(k)
    ) {
      allowedCreds.add(k)
    }
  }
  for (const k of Object.keys(workerSecrets)) {
    if (!mustNeverForward(k) && workerSecrets[k] != null && workerSecrets[k] !== '') {
      allowedCreds.add(k)
    }
  }
  const extraAmbient = new Set(opts.extraAmbientKeys ?? [])

  const out: Record<string, string> = {}

  // 1. Ambient whitelist
  for (const [k, v] of Object.entries(ambient)) {
    if (v == null || v === '') continue
    if (mustNeverForward(k)) continue
    if (isAmbientKey(k) || extraAmbient.has(k)) {
      if (looksLikeSecretKey(k) && !allowedCreds.has(k)) continue
      out[k] = v
    }
  }

  // 2. Worker explicit env (full overlay for non-denied keys; secrets only if intentional)
  for (const [k, v] of Object.entries(workerEnv)) {
    if (v == null) continue
    if (mustNeverForward(k)) continue
    if (looksLikeSecretKey(k) && !allowedCreds.has(k)) continue
    out[k] = v
  }

  // 3. Worker-scoped encrypted secrets (env_var auth) — target process only
  for (const [k, v] of Object.entries(workerSecrets)) {
    if (v == null || v === '') continue
    if (mustNeverForward(k)) continue
    out[k] = v
  }

  // 4. Model-required credentials from ambient if still missing
  for (const key of allowedCreds) {
    if (out[key]) continue
    const fromAmbient = ambient[key]
    if (fromAmbient != null && fromAmbient !== '') {
      out[key] = fromAmbient
    }
  }

  // 5. Final scrub: drop any leftover denied secrets not in allowedCreds
  for (const k of Object.keys(out)) {
    if (mustNeverForward(k) || (looksLikeSecretKey(k) && !allowedCreds.has(k))) {
      delete out[k]
    }
  }

  // 6. NPM registry: explicit opt > process-wide settings override > ambient (already applied)
  const registryOverride =
    opts.npmRegistry !== undefined && opts.npmRegistry !== null
      ? String(opts.npmRegistry).trim()
      : configuredNpmRegistry
  if (registryOverride) {
    out.NPM_CONFIG_REGISTRY = registryOverride
  }

  return out
}
