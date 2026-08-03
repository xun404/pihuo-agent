/**
 * Frontend validation for settings → General → npm registry.
 * Empty = system default. Non-empty must be https://… without whitespace.
 */

/** Must start with https://, no whitespace, valid URL host. */
export const NPM_REGISTRY_HTTPS_RE = /^https:\/\/[^\s]+$/u

/**
 * Curated registry presets for mainland China and common overseas endpoints.
 * `url: ''` means “use the process / system default” (no app override).
 */
export type NpmRegistryPresetId =
  | 'system'
  | 'npmjs'
  | 'npmmirror'
  | 'huawei'
  | 'tencent'
  | 'yarn'

export type NpmRegistryPreset = {
  id: NpmRegistryPresetId
  /** Empty = clear override (system default). */
  url: string
  /** Hint for UI grouping / optional badges. */
  region: 'global' | 'cn'
}

export const NPM_REGISTRY_PRESETS: readonly NpmRegistryPreset[] = Object.freeze([
  { id: 'system', url: '', region: 'global' },
  { id: 'npmjs', url: 'https://registry.npmjs.org', region: 'global' },
  { id: 'yarn', url: 'https://registry.yarnpkg.com', region: 'global' },
  { id: 'npmmirror', url: 'https://registry.npmmirror.com', region: 'cn' },
  { id: 'huawei', url: 'https://repo.huaweicloud.com/repository/npm', region: 'cn' },
  { id: 'tencent', url: 'https://mirrors.cloud.tencent.com/npm', region: 'cn' },
])

/** Normalize for comparison: trim + drop trailing root slash. */
export function normalizeNpmRegistryUrl(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return ''
  try {
    const url = new URL(trimmed)
    if (url.pathname === '/' || url.pathname === '') {
      return `${url.protocol}//${url.host}`
    }
    return trimmed.replace(/\/+$/u, '')
  } catch {
    return trimmed.replace(/\/+$/u, '')
  }
}

/** Match draft text to a known preset id, or null when custom. */
export function matchNpmRegistryPreset(input: string): NpmRegistryPresetId | null {
  const normalized = normalizeNpmRegistryUrl(input)
  for (const preset of NPM_REGISTRY_PRESETS) {
    if (normalizeNpmRegistryUrl(preset.url) === normalized) return preset.id
  }
  return null
}

export type NpmRegistryDraftValidation =
  | { ok: true; value: string | undefined }
  | { ok: false; reason: 'https' | 'space' | 'url' }

export function validateNpmRegistryDraft(input: string): NpmRegistryDraftValidation {
  const trimmed = input.trim()
  if (!trimmed) return { ok: true, value: undefined }
  if (/\s/u.test(input) || /\s/u.test(trimmed)) return { ok: false, reason: 'space' }
  if (!NPM_REGISTRY_HTTPS_RE.test(trimmed)) return { ok: false, reason: 'https' }
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'https:' || !url.hostname) return { ok: false, reason: 'url' }
  } catch {
    return { ok: false, reason: 'url' }
  }
  // strip trailing slash on root path for stable storage
  return {
    ok: true,
    value:
      trimmed.endsWith('/') && new URL(trimmed).pathname === '/' ? trimmed.slice(0, -1) : trimmed,
  }
}
