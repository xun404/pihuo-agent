/**
 * Optional app-level NPM registry override for Worker npx launches.
 * Empty / unset → system default (~/.npmrc or ambient NPM_CONFIG_REGISTRY).
 */

/** Max length for a registry URL stored in settings. */
export const NPM_REGISTRY_MAX_LENGTH = 512

/**
 * Normalize user input for settings storage.
 * - blank / whitespace → undefined (use system default)
 * - must be absolute https URL with host (no whitespace)
 * - trailing slash stripped for stable equality
 */
export function normalizeNpmRegistry(input: unknown): string | undefined {
  if (input == null) return undefined
  if (typeof input !== 'string') {
    throw new TypeError('npmRegistry must be a string')
  }
  const trimmed = input.trim()
  if (!trimmed) return undefined
  // Non-empty values must not contain any whitespace (including internal)
  if (/\s/u.test(trimmed)) {
    throw new TypeError('npmRegistry must not contain whitespace')
  }
  if (trimmed.length > NPM_REGISTRY_MAX_LENGTH) {
    throw new RangeError(`npmRegistry must be at most ${NPM_REGISTRY_MAX_LENGTH} characters`)
  }
  if (!trimmed.startsWith('https://')) {
    throw new TypeError('npmRegistry must start with https://')
  }
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new TypeError('npmRegistry must be a valid absolute URL')
  }
  if (url.protocol !== 'https:') {
    throw new TypeError('npmRegistry must use https')
  }
  if (!url.hostname) {
    throw new TypeError('npmRegistry must include a hostname')
  }
  // Normalize: drop trailing slash on path root
  let href = url.href
  if (href.endsWith('/') && url.pathname === '/') {
    href = href.slice(0, -1)
  }
  return href
}

/** Parse settings payload field; blank clears override. */
export function parseNpmRegistryInput(input: unknown): string | undefined {
  return normalizeNpmRegistry(input)
}
