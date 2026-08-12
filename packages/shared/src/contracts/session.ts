import type { LeaderMode, SessionStatus } from './worker-acp.js'
import type { SessionApprovalPolicy, SessionPermissionMode } from './permissions.js'

export type Locale = 'zh' | 'zh-TW' | 'en'

export function isAppLocale(value: unknown): value is Locale {
  return value === 'zh' || value === 'zh-TW' || value === 'en'
}

export interface Project {
  id: string
  name: string
  rootPath: string
  defaultBranch?: string
  /** Whether this project's resource-scoped working memory is used by Leader. */
  memoryEnabled?: boolean
  workerIds: string[]
  createdAt: string
  updatedAt: string
}

export interface Session {
  id: string
  projectId: string
  title: string
  /**
   * Provenance of `title`. `'auto'` = placeholder or Leader-generated on first
   * task completion (may be overwritten by future auto-naming); `'user'` = user
   * renamed it via the sidebar, locked against auto-overwrite. Missing on
   * legacy snapshots → treated as `'auto'`.
   */
  titleSource?: 'auto' | 'user'
  status: SessionStatus
  mode: LeaderMode
  activeWorkerIds: string[]
  memoryThreadId: string
  approvalPolicy: SessionApprovalPolicy
  /** Authoritative runtime permission state. Legacy approvalPolicy is compatibility-only. */
  permissionMode: SessionPermissionMode
  /** Increments once for every persisted Team mutation. */
  teamRevision: number
  /** New Sessions ask once whether the bootstrapped Team needs adjustment. */
  roleReviewState?: 'pending' | 'prompted'
  roleReviewPromptedAt?: string
  /** Last chat/stream error message for UI (survives reload) */
  lastChatError?: string
  lastChatErrorAt?: string
  /**
   * Sidebar lamp "read" watermark. Notification lamps (error / done) stay lit
   * while their event timestamp is newer than `lastReadAt`; opening a session
   * stamps this via `store.markSessionRead`. Never bumps `updatedAt`.
   * Missing on legacy snapshots → migrated to the session's `updatedAt`.
   */
  lastReadAt?: string
  /**
   * Timestamp of the last error event relevant to the sidebar red lamp:
   * chat send failure (stamped alongside `lastChatErrorAt`) or a worker job
   * failing / timing out. The lamp derives purely from this timestamp +
   * `lastReadAt`, so it can extinguish on read without wiping the sticky
   * `lastChatError` card payload.
   */
  lastErrorAt?: string
  /**
   * Timestamp of the last successful worker job completion (chat replies use
   * `lastReplyAt` instead). The steady green "done" lamp lights when
   * max(`lastReplyAt`, `lastFinishedAt`) is newer than `lastReadAt`.
   */
  lastFinishedAt?: string
  createdAt: string
  updatedAt: string
  /**
   * Timestamp of the last assistant reply (chat onFinish). The sidebar uses
   * `lastReplyAt ?? createdAt` as the relative-time source so opening / renaming /
   * switching mode does not falsely "freshen" it. Missing on legacy snapshots and on
   * sessions that have not received a reply yet → callers fall back to the
   * `createdAt`. Bumped via `store.markSessionReply(sessionId)`.
   */
  lastReplyAt?: string
  /**
   * Cumulative token usage across all turns (real model-reported values from the
   * chat `onFinish` step.usage). Used by the chat context popup to show a real
   * cache-hit rate and context size. All fields missing on legacy snapshots and
   * before the first turn → treated as 0. Stamped via
   * `store.markSessionUsage(sessionId, delta)` (does NOT bump `updatedAt`).
   */
  usageInputTokens?: number
  usageCachedTokens?: number
  usageOutputTokens?: number
  /**
   * Real input-token count of the MOST RECENT turn (overwritten each turn, not
   * accumulated). This is what the context-window ring should show: it reflects
   * the actual prompt size the model just saw, so it correctly drops after a
   * context compression (the next turn's prompt is shorter). Falls back to the
   * live chars/4 estimate when missing (legacy snapshots / before first turn).
   */
  usageLastInputTokens?: number
  usageLastUpdatedAt?: string
}

/**
 * Placeholder title assigned at session creation when the user did not supply
 * one. The UI renders this via i18n (`sidebar.untitledSession`); the raw value
 * is also the gate for auto-naming: only sessions whose title is still the
 * placeholder (or explicitly `titleSource === 'auto'`) are eligible for Leader
 * auto-naming during the first Leader response.
 */
export const DEFAULT_SESSION_TITLE = 'New session'

/** True if the title is missing or still the placeholder (eligible for auto-naming). */
export function isPlaceholderSessionTitle(title: string | undefined | null): boolean {
  return !title || title === DEFAULT_SESSION_TITLE
}

/** Red lamp lingers this long after the session is read ("阅读后延迟3秒熄灭"). */
export const SESSION_LAMP_ERROR_GRACE_MS = 3_000
/** Lamps auto-extinguish this long after the event while the session is active. */
export const SESSION_LAMP_ACTIVE_TTL_MS = 60_000

export interface SessionLampTimes {
  /** Last error event (ms epoch, 0 = none). Falls back to legacy lastChatErrorAt. */
  errAt: number
  /** Last successful completion (ms epoch, 0 = none): chat reply or worker job. */
  doneAt: number
  /** Read watermark (ms epoch, 0 = never). */
  readAt: number
}

function parseLampTime(value: string | undefined): number {
  if (!value) return 0
  const t = Date.parse(value)
  return Number.isFinite(t) ? t : 0
}

export function sessionLampTimes(s: Session): SessionLampTimes {
  return {
    errAt: parseLampTime(s.lastErrorAt ?? s.lastChatErrorAt),
    doneAt: Math.max(parseLampTime(s.lastReplyAt), parseLampTime(s.lastFinishedAt)),
    readAt: parseLampTime(s.lastReadAt),
  }
}

export type SessionLampClass = 'approve' | 'run' | 'error' | 'done' | 'idle'

/**
 * Single source of truth for the sidebar session lamp, highest priority first:
 *   approve — needs authorization (actionable)
 *   run     — executing (`busy` is the optimistic in-flight send, not persisted)
 *   error   — unread error event; lingers SESSION_LAMP_ERROR_GRACE_MS after read
 *   done    — steady green, unread successful completion
 *   idle    — nothing to report
 * Notification lamps (error/done) extinguish on read, or via the active-session
 * TTL handled by the caller stamping `lastReadAt`.
 */
export function sessionLampClass(s: Session, busy: boolean, now: number): SessionLampClass {
  if (s.status === 'needs_approval') return 'approve'
  if (busy || s.status === 'running') return 'run'
  const { errAt, doneAt, readAt } = sessionLampTimes(s)
  if (errAt > 0 && (errAt > readAt || now - readAt < SESSION_LAMP_ERROR_GRACE_MS)) return 'error'
  if (doneAt > readAt) return 'done'
  return 'idle'
}

/** True when an error/done lamp event is newer than the read watermark. */
export function sessionHasUnreadLamp(s: Session): boolean {
  const { errAt, doneAt, readAt } = sessionLampTimes(s)
  return errAt > readAt || doneAt > readAt
}
