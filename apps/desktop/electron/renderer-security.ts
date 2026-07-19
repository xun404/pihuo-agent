import { fileURLToPath } from 'node:url'
import { isAbsolute, relative, resolve } from 'node:path'

export function resolveDesktopApiPort(raw: string | undefined, fallback = 4111): number {
  const value = raw?.trim()
  if (!value || !/^\d+$/.test(value)) return fallback
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65_535 ? parsed : fallback
}

export function resolveTrustedDevServerUrl(raw: string | undefined): string | undefined {
  if (!raw?.trim()) return undefined
  try {
    const url = new URL(raw)
    const loopback = new Set(['localhost', '127.0.0.1', '[::1]'])
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      !loopback.has(url.hostname) ||
      url.username ||
      url.password
    )
      return undefined
    return url.href
  } catch {
    return undefined
  }
}

function isPathInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** Only the packaged renderer or the configured Vite origin may receive preload IPC. */
export function isTrustedRendererUrl(input: {
  url: string
  devServerUrl?: string
  distDir: string
}): boolean {
  let candidate: URL
  try {
    candidate = new URL(input.url)
  } catch {
    return false
  }

  if (input.devServerUrl) {
    try {
      const expected = new URL(input.devServerUrl)
      return (
        (candidate.protocol === 'http:' || candidate.protocol === 'https:') &&
        candidate.origin === expected.origin
      )
    } catch {
      return false
    }
  }

  if (candidate.protocol !== 'file:') return false
  try {
    return isPathInside(input.distDir, fileURLToPath(candidate))
  } catch {
    return false
  }
}

export function isSafeExternalUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}
