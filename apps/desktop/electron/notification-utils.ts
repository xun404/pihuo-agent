/**
 * Pure notification helpers for the Electron main process.
 *
 * Kept free of any `electron` import so it can run under plain node:test —
 * the same dependency-isolation pattern as `renderer-security.ts` /
 * `api-process.ts`. `notification-service.ts` re-exports these for IPC callers.
 */

/** Payload the renderer sends over `notifications:show` IPC. */
export type NativeNotificationPayload = {
  id: string
  title: string
  body: string
  /** When set, clicking the banner opens this session via `app:open-session`. */
  sessionId?: string
}

/** claimNotification dedupe state: notification id -> last claimed timestamp. */
const CLAIMS = new Map<string, number>()
const DEDUPE_TTL_MS = 5000

/** Validate + normalize an untrusted IPC payload; null when id/title are missing. */
export function normalizeNotificationPayload(raw: unknown): NativeNotificationPayload | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const id = typeof record.id === 'string' ? record.id.trim() : ''
  const title = typeof record.title === 'string' ? record.title.trim() : ''
  if (!id || !title) return null
  const sessionId = typeof record.sessionId === 'string' ? record.sessionId.trim() : ''
  return {
    id,
    title,
    body: typeof record.body === 'string' ? record.body.trim() : '',
    ...(sessionId ? { sessionId } : {}),
  }
}

/**
 * One-shot claim for a notification id within a 5s window. The snapshot poll
 * re-evaluates every 8s and the settings "test" button can be re-clicked, so
 * this absorbs duplicate shows without deduping at the source. Empty ids are
 * never blocked (callers that skip dedupe pass '').
 */
export function claimNotification(id: string): boolean {
  if (!id) return true
  const now = Date.now()
  // Sweep expired claims so the map does not grow unbounded.
  for (const [key, claimedAt] of CLAIMS) {
    if (now - claimedAt > DEDUPE_TTL_MS) CLAIMS.delete(key)
  }
  const claimedAt = CLAIMS.get(id) ?? 0
  if (now - claimedAt < DEDUPE_TTL_MS) return false
  CLAIMS.set(id, now)
  return true
}

/** Test-only reset so claim tests are order-independent. */
export function __clearClaimsForTest(): void {
  CLAIMS.clear()
}
