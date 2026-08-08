import { useEffect, useRef } from 'react'
import type { AppSnapshot } from '@swarmdesk-agent/shared'
import {
  evaluateApprovalNotifications,
  evaluateSessionNotifications,
  type NotificationDecision,
} from '../lib/notification-watcher'

const WATERMARKS_KEY = 'swarmdesk:notification-watermarks'
const APPROVALS_KEY = 'swarmdesk:notification-approvals'

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
  const lastSnapshotRef = useRef(snapshot)
  useEffect(() => {
    if (!notifications?.enabled) return
    const settings = notifications

    const watermarks = getWatermarks()
    const focused = typeof document !== 'undefined' ? document.hasFocus() : true

    const { decisions: sessionDecisions, nextWatermarks } = evaluateSessionNotifications({
      sessions: snapshot.sessions,
      settings,
      focused,
      lastNotifiedAt: watermarks,
    })

    const notifiedApprovalIds = new Set(getNotifiedApprovalIds())
    const { decisions: approvalDecisions, nextNotifiedIds } = evaluateApprovalNotifications({
      approvals: snapshot.approvals,
      settings,
      focused,
      notifiedApprovalIds,
    })

    const bridge = typeof window !== 'undefined'
      ? (window as unknown as { routerAgents?: { notify?: { show: (p: NotificationDecision) => Promise<unknown> } } }).routerAgents?.notify
      : undefined
    if (!bridge?.show) return

    const decisions = [...sessionDecisions, ...approvalDecisions]
    for (const decision of decisions) {
      void bridge.show(decision).catch(() => undefined)
    }

    if (Object.keys(nextWatermarks).length > 0) {
      setWatermarks({ ...watermarks, ...nextWatermarks })
    }
    if (nextNotifiedIds.length > 0) {
      setNotifiedApprovalIds([...notifiedApprovalIds, ...nextNotifiedIds])
    }
  }, [snapshot, notifications])
  lastSnapshotRef.current = snapshot
}
