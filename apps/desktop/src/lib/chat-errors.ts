/**
 * Map chat/stream failures to user-facing copy.
 * Prefer showing the provider's original message when it is readable;
 * friendly summaries are used for well-known kinds and keep `detail` for the raw text.
 */

export type ChatErrorKind = 'missing_key' | 'billing' | 'network' | 'offline' | 'model' | 'generic'

export type FriendlyChatError = {
  kind: ChatErrorKind
  /** Primary line in the UI */
  message: string
  /** Original provider text when different from `message` (always prefer surfacing this) */
  detail?: string
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

function extractHttpUrl(text: string): string | undefined {
  const m = text.match(/https?:\/\/[^\s)"']+/i)
  if (!m) return undefined
  // Trim common trailing punctuation from provider sentences
  return m[0]!.replace(/[.,;:]+$/g, '')
}

/** Readable provider text for UI; drop stacks / huge JSON blobs. */
export function cleanProviderDetail(text: string): string | undefined {
  const t = text.replace(/\r\n/g, '\n').trim()
  if (!t) return undefined
  if (t.includes('\n    at ') || t.includes('\n at ')) return undefined
  if (t.includes('"stack"') && t.length > 400) return undefined
  if ((t.startsWith('{') || t.startsWith('[')) && t.length > 400) {
    // Prefer a nested string field if present
    const parsed = tryParseJsonBlob(t)
    const nested =
      (typeof parsed?.error === 'string' && parsed.error) ||
      (typeof parsed?.message === 'string' && parsed.message) ||
      ''
    if (nested.trim()) return cleanProviderDetail(nested)
    return undefined
  }
  if (t.length > 800) return `${t.slice(0, 800)}…`
  return t
}

function withDetail(base: FriendlyChatError, original: string | undefined): FriendlyChatError {
  const detail = original ? cleanProviderDetail(original) : undefined
  if (!detail) return base
  if (detail === base.message.trim()) return base
  return { ...base, detail }
}

/**
 * Normalize any chat error into a friendly UI payload.
 * Always logs the original error to `console.error` for devtools.
 */
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
  const trimmed = raw.trim()

  // Sticky lastChatError may store "summary\n\n---\noriginal" or plain text.
  const stickySplit = trimmed.match(/^([\s\S]+?)\n\n---\n([\s\S]+)$/)
  if (stickySplit) {
    const summary = stickySplit[1]!.trim()
    const detail = cleanProviderDetail(stickySplit[2]!)
    if (summary === copy.model.trim()) {
      return withDetail({ kind: 'model', message: copy.model, action: 'open_settings' }, detail)
    }
    if (summary === copy.missingKey.trim()) {
      return withDetail(
        { kind: 'missing_key', message: copy.missingKey, action: 'open_settings' },
        detail,
      )
    }
    if (summary === copy.billing.trim()) {
      return withDetail({ kind: 'billing', message: copy.billing, action: 'open_settings' }, detail)
    }
    // Prefer original as primary when sticky was stored that way
    if (detail) {
      return formatChatError(detail, copy, { log: false })
    }
  }

  // Sticky re-hydrate for summary-only (legacy) payloads
  if (trimmed && trimmed === copy.model.trim()) {
    return { kind: 'model', message: copy.model, action: 'open_settings' }
  }
  if (trimmed && trimmed === copy.missingKey.trim()) {
    return { kind: 'missing_key', message: copy.missingKey, action: 'open_settings' }
  }
  if (trimmed && trimmed === copy.billing.trim()) {
    return { kind: 'billing', message: copy.billing, action: 'open_settings' }
  }
  if (trimmed && trimmed === copy.network.trim()) {
    return { kind: 'network', message: copy.network }
  }
  if (trimmed && trimmed === copy.offline.trim()) {
    return { kind: 'offline', message: copy.offline }
  }

  const parsed = tryParseJsonBlob(raw)
  const code =
    (typeof parsed?.code === 'string' && parsed.code) ||
    (typeof (error as { code?: string })?.code === 'string' ? (error as { code: string }).code : '')
  const inner =
    (typeof parsed?.error === 'string' && parsed.error) ||
    (typeof parsed?.message === 'string' && parsed.message) ||
    raw

  const hay = `${code}\n${inner}\n${raw}`
  const original = cleanProviderDetail(inner) ?? cleanProviderDetail(raw)

  if (
    /MISSING_API_KEY|Could not find API key|Missing API key|process\.env\.\w*API_KEY|no api key|api key.*required/i.test(
      hay,
    )
  ) {
    return withDetail(
      { kind: 'missing_key', message: copy.missingKey, action: 'open_settings' },
      original,
    )
  }

  // Provider subscription / wallet exhausted (e.g. OpenCode Zen/Go)
  if (
    /insufficient balance|insufficient.?credit|payment required|billing|subscription.*(expired|inactive|lapsed)|quota exceeded|exceeded your.*quota|plan.*limit|余额不足|订阅.*(到期|过期)|账户余额/i.test(
      hay,
    )
  ) {
    return withDetail(
      {
        kind: 'billing',
        message: copy.billing,
        action: 'open_settings',
        href: extractHttpUrl(inner) ?? extractHttpUrl(raw),
      },
      original,
    )
  }

  if (
    /Failed to fetch|NetworkError|ECONNREFUSED|ENOTFOUND|network|fetch failed|Load failed/i.test(
      hay,
    )
  ) {
    return withDetail({ kind: 'network', message: copy.network }, original)
  }

  if (/offline|server down|Mastra is offline|API is offline|4111/i.test(hay)) {
    return withDetail({ kind: 'offline', message: copy.offline }, original)
  }

  // Model / provider availability — primary line is the original provider text when readable.
  if (
    /model.*(not found|unknown|invalid)|Unknown model|does not exist|Could not find config for provider|explicit opt.?in|only available hosted in China|requires.*opt.?in|provider.*(not configured|unavailable|disabled)|region.*not.*available/i.test(
      hay,
    )
  ) {
    const primary = original || copy.model
    return {
      kind: 'model',
      // Prefer the real provider sentence; keep friendly text only as fallback.
      message: primary,
      // If we fell back to friendly copy, still attach original when available
      ...(primary === copy.model && original && original !== copy.model
        ? { detail: original }
        : {}),
      action: 'open_settings',
      href: extractHttpUrl(inner) ?? extractHttpUrl(raw),
    }
  }

  // Readable original provider sentence
  if (original && !original.includes('\n    at ') && !original.trim().startsWith('{')) {
    return { kind: 'generic', message: original }
  }

  // Stacks / opaque blobs → generic summary + no raw dump
  return { kind: 'generic', message: copy.generic }
}

/** Persist sticky text that can rehydrate summary + original detail. */
export function serializeChatErrorForSticky(err: FriendlyChatError): string {
  if (err.detail && err.detail.trim() && err.detail.trim() !== err.message.trim()) {
    return `${err.message.trim()}\n\n---\n${err.detail.trim()}`
  }
  return err.message.trim()
}
