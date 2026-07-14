/**
 * Helpers for a simple OpenCode-like custom provider form.
 * Users never need to type env var names or provider/model slugs manually.
 */

/** When custom provider id matches models.dev, store under the env Mastra expects. */
const KNOWN_PROVIDER_API_KEY_ENV: Record<string, string> = {
  opencode: 'OPENCODE_API_KEY',
  'opencode-go': 'OPENCODE_API_KEY',
  opencodego: 'OPENCODE_API_KEY',
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  google: 'GOOGLE_GENERATIVE_AI_API_KEY',
  xai: 'XAI_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  groq: 'GROQ_API_KEY',
  mistral: 'MISTRAL_API_KEY',
}

/**
 * Prefer Mastra models.dev provider ids when the name/URL is a known gateway.
 * e.g. "OpenCodeGO" → `opencode-go` (not `opencodego`).
 */
export function inferKnownProviderId(name: string, baseURL?: string): string | undefined {
  const url = (baseURL ?? '').toLowerCase()
  if (url.includes('opencode.ai/zen/go') || url.includes('opencode.ai/go')) return 'opencode-go'
  if (url.includes('opencode.ai')) return 'opencode'
  if (url.includes('openrouter.ai')) return 'openrouter'

  const n = name.toLowerCase().replace(/[^a-z0-9]+/g, '')
  if (n.includes('opencode') && n.includes('go')) return 'opencode-go'
  if (n === 'opencode' || n === 'opencodezen') return 'opencode'
  if (n.includes('openrouter')) return 'openrouter'
  return undefined
}

export function slugProviderId(name: string, baseURL?: string): string {
  const known = inferKnownProviderId(name, baseURL)
  if (known) return known
  const s = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
  return s || 'custom'
}

/** Internal storage key — auto-derived, hidden from normal UI */
export function defaultApiKeyEnv(providerId: string): string {
  const known = KNOWN_PROVIDER_API_KEY_ENV[providerId]
  if (known) return known
  const upper = providerId.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase() || 'CUSTOM'
  return `CUSTOM_${upper}_API_KEY`
}

/**
 * Build Mastra model id `provider/model`.
 * Accepts short name (`deepseek-chat`) or full (`myco/deepseek-chat`).
 */
export function buildModelId(providerId: string, modelInput: string): string {
  const raw = modelInput.trim()
  if (!raw) return `${providerId}/default`
  if (raw.includes('/')) return raw
  return `${providerId}/${raw}`
}

/** Short model name for display/edit from full id */
export function shortModelName(fullId: string, providerId: string): string {
  if (fullId.startsWith(`${providerId}/`)) return fullId.slice(providerId.length + 1)
  const parts = fullId.split('/')
  return parts.length > 1 ? parts.slice(1).join('/') : fullId
}
