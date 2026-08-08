import { useEffect } from 'react'
import type { AppSnapshot } from '@swarmdesk-agent/shared'
import {
  evaluateApprovalNotifications,
  evaluateSessionNotifications,
  type NotificationDecision,
} from '../lib/notification-watcher'

/**
 * Renders native OS notifications for the desktop shell.
 *
 * Wired into AppShell with the 8s `AppSnapshot` poll: every snapshot the hook
 * re-runs the pure watermark evaluation (lib/notification-watcher) and turns
 * the resulting decisions into `routerAgents.notify.show` IPC calls. Delivery
 * is best-effort — the main process dedupes and the renderer never blocks on
 * the IPC promise.
 *
 * Notification watermarks persist in localStorage so a restart does not
 * re-fire banners for events already shown: `getWatermarks` / `setWatermarks`
 * keep the last-notified ISO timestamp per session, and
 * `getNotifiedApprovalIds` / `setNotifiedApprovalIds` keep the approval ids
 * already announced. Both are best-effort (try/catch) because storage can be
 * unavailable in embedded/preview contexts.
 */
const WATERMARKS_KEY = 'swarmdesk:notification-watermarks'
const APPROVALS_KEY = 'swarmdesk:notification-approvals'

/** Last-notified ISO timestamp per session id; {} when nothing stored yet. */
export function getWatermarks(): Record<string, string> {
  try {
    const raw = localStorage.getItem(WATERMARKS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, string>)
      : {}
  } catch {
    return {}
  }
}

export function setWatermarks(watermarks: Record<string, string>): void {
  try {
    localStorage.setItem(WATERMARKS_KEY, JSON.stringify(watermarks))
  } catch {
    // storage unavailable — best-effort
  }
}

/** Approval ids already announced; filters malformed entries. */
export function getNotifiedApprovalIds(): string[] {
  try {
    const raw = localStorage.getItem(APPROVALS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? (parsed as string[]).filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function setNotifiedApprovalIds(ids: string[]): void {
  try {
    localStorage.setItem(APPROVALS_KEY, JSON.stringify(ids))
  } catch {
    // storage unavailable — best-effort
  }
}

type SystemNotificationOptions = {
  snapshot: AppSnapshot
  /** Notification settings; undefined → notifications disabled. */
  notifications: {
    enabled: boolean
    mode: 'always' | 'hidden-only'
    onCompletion: boolean
    onError: boolean
    onApproval: boolean
  } | null
}

export function useSystemNotifications({ snapshot, notifications }: SystemNotificationOptions): void {
  useEffect(() => {
    if (!notifications?.enabled) return

    const watermarks = getWatermarks()
    const focused = typeof document !== 'undefined' ? document.hasFocus() : true

    const { decisions: sessionDecisions, nextWatermarks } = evaluateSessionNotifications({
      sessions: snapshot.sessions,
      settings: notifications,
      focused,
      lastNotifiedAt: watermarks,
    })

    const notifiedApprovalIds = new Set(getNotifiedApprovalIds())
    const { decisions: approvalDecisions, nextNotifiedIds } = evaluateApprovalNotifications({
      approvals: snapshot.approvals,
      settings: notifications,
      focused,
      notifiedApprovalIds,
    })

    // Web-preview builds have no desktop bridge; skip silently so the
    // localStorage watermarks are NOT advanced (they stay valid for desktop).
    const bridge = typeof window !== 'undefined'
      ? (window as unknown as { routerAgents?: { notify?: { show: (p: NotificationDecision) => Promise<unknown> } } }).routerAgents?.notify
      : undefined
    if (!bridge?.show) return

    const decisions = [...sessionDecisions, ...approvalDecisions]
    for (const decision of decisions) {
      void bridge.show(decision).catch(() => undefined)
    }

    // Advance watermarks only for decisions actually handed to the bridge.
    if (Object.keys(nextWatermarks).length > 0) {
      setWatermarks({ ...watermarks, ...nextWatermarks })
    }
    if (nextNotifiedIds.length > 0) {
      setNotifiedApprovalIds([...notifiedApprovalIds, ...nextNotifiedIds])
    }
  }, [snapshot, notifications])
}
