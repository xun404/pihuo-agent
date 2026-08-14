/**
 * Desktop public API auth (owner http-server).
 *
 * Tokens:
 * - desktopApiToken: Electron/renderer only (via preload IPC); never the internal runtime token
 * - internalRuntimeToken: RemoteRuntimeDispatchPort only (runtime.json internal field)
 *
 * Disable with PIHUO_AGENT_DESKTOP_AUTH=0 for unit tests.
 */
import type { IncomingMessage } from 'node:http'
import { timingSafeEqual } from 'node:crypto'

export type DesktopAuthMode = 'enforced' | 'disabled'

export function desktopAuthMode(): DesktopAuthMode {
  const v = process.env.PIHUO_AGENT_DESKTOP_AUTH
  if (v === '0' || v === 'false' || v === 'off') return 'disabled'
  return 'enforced'
}

/**
 * Explicit allowlist. Override with PIHUO_AGENT_DESKTOP_ORIGINS (comma-separated).
 * Default: vite dev + empty/missing Origin (Electron file:// often omits Origin).
 * Does NOT accept arbitrary chrome-extension or Origin: null strings.
 */
export function allowedDesktopOrigins(): string[] {
  const fromEnv = process.env.PIHUO_AGENT_DESKTOP_ORIGINS?.split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (fromEnv?.length) return fromEnv
  return [
    'http://127.0.0.1:5173',
    'http://localhost:5173',
    'http://127.0.0.1:4173',
    'http://localhost:4173',
  ]
}

export function isAllowedDesktopOrigin(origin: string | undefined | null): boolean {
  // Missing Origin: Electron native, curl, same-machine tools (not browser cross-origin)
  if (origin == null || origin === '') return true
  // Explicit "null" string is a browser privacy mode — do not treat as trusted for token boot
  if (origin === 'null') return false
  if (origin.startsWith('file:')) return true
  const allow = allowedDesktopOrigins()
  if (allow.includes(origin)) return true
  // Exact match only — no wildcard localhost ports
  return false
}

export function extractBearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization
  if (typeof header === 'string') {
    const m = /^Bearer\s+(.+)$/i.exec(header.trim())
    if (m?.[1]?.trim()) return m[1].trim()
  }
  const alt = req.headers['x-pihuo-agent-desktop-token']
  if (typeof alt === 'string' && alt.trim()) return alt.trim()
  if (Array.isArray(alt) && alt[0]?.trim()) return alt[0].trim()
  return null
}

export function tokenMatches(provided: string, expected: string): boolean {
  try {
    const a = Buffer.from(provided)
    const b = Buffer.from(expected)
    if (a.length !== b.length) return false
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

export type DesktopAuthResult =
  { ok: true } | { ok: false; status: 401 | 403; code: string; error: string }

/**
 * Authorize Desktop /api and /chat.
 * Enforced mode: all methods except OPTIONS need desktop token when present.
 * GET health can stay open without token for process liveness probes.
 */
export function authorizeDesktopRequest(
  req: IncomingMessage,
  desktopToken: string | null,
  opts?: { path?: string },
): DesktopAuthResult {
  if (desktopAuthMode() === 'disabled') return { ok: true }

  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined
  if (origin !== undefined && !isAllowedDesktopOrigin(origin)) {
    return {
      ok: false,
      status: 403,
      code: 'DESKTOP_ORIGIN_DENIED',
      error: 'Origin not allowed for Desktop API',
    }
  }

  const method = (req.method ?? 'GET').toUpperCase()
  if (method === 'OPTIONS') return { ok: true }

  // Liveness only
  if (method === 'GET' && (opts?.path === '/health' || opts?.path === '/api/health')) {
    return { ok: true }
  }

  if (!desktopToken) {
    return {
      ok: false,
      status: 401,
      code: 'DESKTOP_AUTH_UNAVAILABLE',
      error: 'Desktop API token not configured',
    }
  }
  const provided = extractBearerToken(req)
  if (!provided || !tokenMatches(provided, desktopToken)) {
    return {
      ok: false,
      status: 401,
      code: 'DESKTOP_AUTH_FAILED',
      error: 'Desktop API authentication required',
    }
  }
  return { ok: true }
}

/**
 * CORS: when request Origin is allowed, echo it exactly (required for credentialed browser).
 * When no Origin, omit ACAO or use null-safe default without lying about echo.
 */
export function desktopCorsHeaders(req: IncomingMessage): Record<string, string> {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS,PUT,PATCH',
    'Access-Control-Allow-Headers':
      'Content-Type, Authorization, X-PiHuo-Agent-Desktop-Token, Last-Event-ID',
    Vary: 'Origin',
  }
  if (origin && isAllowedDesktopOrigin(origin)) {
    headers['Access-Control-Allow-Origin'] = origin
    headers['Access-Control-Allow-Credentials'] = 'true'
  } else if (!origin && desktopAuthMode() === 'disabled') {
    headers['Access-Control-Allow-Origin'] = '*'
  } else if (!origin) {
    // Electron / no Origin header — no ACAO needed for non-browser clients
  }
  return headers
}
