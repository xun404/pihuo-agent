/**
 * Frontend validation for settings → General → npm registry.
 * Empty = system default. Non-empty must be https://… without whitespace.
 */

/** Must start with https://, no whitespace, valid URL host. */
export const NPM_REGISTRY_HTTPS_RE = /^https:\/\/[^\s]+$/u

export type NpmRegistryDraftValidation =
  { ok: true; value: string | undefined } | { ok: false; reason: 'https' | 'space' | 'url' }

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
