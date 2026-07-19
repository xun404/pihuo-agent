/**
 * Map chat/stream failures to short user-facing copy.
 * Full payloads / stacks go to the developer console only.
 */

export type ChatErrorKind = 'missing_key' | 'billing' | 'network' | 'offline' | 'model' | 'generic'

export type FriendlyChatError = {
  kind: ChatErrorKind
  /** Short message for the UI (no stack / no JSON dump) */
  message: string
  /** Optional action hint */
  action?: 'open_settings'
  /** Optional external billing/docs URL extracted from the provider error */
  href?: string
}

function tryParseJsonBlob(raw: string): Record<string, unknown> | null {
  const t = raw.trim()
  if (!t.startsWith('{') && !t.startsWith('[')) return null
  try {
    const v = JSON.parse(t) as unknown
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>
  } catch {
    /* ignore */
  }
  // Sometimes the body is double-encoded or wrapped
  try {
    const m = t.match(/\{[\s\S]*\}/)
    if (m) {
      const v = JSON.parse(m[0]) as unknown
      if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>
    }
  } catch {
    /* ignore */
  }
  return null
}

function extractRawMessage(error: unknown): string {
  if (!error) return ''
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message || error.name || ''
  if (typeof error === 'object' && error !== null) {
    const o = error as { message?: unknown; error?: unknown }
    if (typeof o.message === 'string') return o.message
    if (typeof o.error === 'string') return o.error
    try {
      return JSON.stringify(error)
    } catch {
      return String(error)
    }
  }
  return String(error)
}

/**
 * Normalize any chat error into a friendly UI payload.
 * Always logs the original error to `console.error` for devtools.
 */
function extractHttpUrl(text: string): string | undefined {
  const m = text.match(/https?:\/\/[^\s)"']+/i)
  if (!m) return undefined
  // Trim common trailing punctuation from provider sentences
  return m[0]!.replace(/[.,;:]+$/g, '')
}

export function formatChatError(
  error: unknown,
  copy: {
    missingKey: string
    billing: string
    network: string
    offline: string
    model: string
    generic: string
  },
  opts?: { log?: boolean },
): FriendlyChatError {
  // Developer terminal — full fidelity (skip when re-formatting sticky text)
  if (opts?.log !== false) {
    console.error('[chat]', error)
  }

  const raw = extractRawMessage(error)
  const parsed = tryParseJsonBlob(raw)
  const code =
    (typeof parsed?.code === 'string' && parsed.code) ||
    (typeof (error as { code?: string })?.code === 'string' ? (error as { code: string }).code : '')
  const inner =
    (typeof parsed?.error === 'string' && parsed.error) ||
    (typeof parsed?.message === 'string' && parsed.message) ||
    raw

  const hay = `${code}\n${inner}\n${raw}`

  if (
    /MISSING_API_KEY|Could not find API key|Missing API key|process\.env\.\w*API_KEY|no api key|api key.*required/i.test(
      hay,
    )
  ) {
    return { kind: 'missing_key', message: copy.missingKey, action: 'open_settings' }
  }

  // Provider subscription / wallet exhausted (e.g. OpenCode Zen/Go)
  if (
    /insufficient balance|insufficient.?credit|payment required|billing|subscription.*(expired|inactive|lapsed)|quota exceeded|exceeded your.*quota|plan.*limit|余额不足|订阅.*(到期|过期)|账户余额/i.test(
      hay,
    )
  ) {
    return {
      kind: 'billing',
      message: copy.billing,
      action: 'open_settings',
      href: extractHttpUrl(inner) ?? extractHttpUrl(raw),
    }
  }

  if (
    /Failed to fetch|NetworkError|ECONNREFUSED|ENOTFOUND|network|fetch failed|Load failed/i.test(
      hay,
    )
  ) {
    return { kind: 'network', message: copy.network }
  }

  if (/offline|server down|Mastra is offline|4111/i.test(hay)) {
    return { kind: 'offline', message: copy.offline }
  }

  if (
    /model.*(not found|unknown|invalid)|Unknown model|does not exist|Could not find config for provider/i.test(
      hay,
    )
  ) {
    return { kind: 'model', message: copy.model, action: 'open_settings' }
  }

  // Never surface stacks or huge JSON
  if (
    !inner ||
    inner.includes('\n    at ') ||
    inner.includes('"stack"') ||
    inner.trim().startsWith('{') ||
    inner.length > 220
  ) {
    return { kind: 'generic', message: copy.generic }
  }

  return { kind: 'generic', message: inner }
}
