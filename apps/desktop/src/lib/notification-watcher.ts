import type { ApprovalItem, NotificationSettings, Session } from '@swarmdesk-agent/shared'

/**
 * Pure decision logic for native OS notifications.
 *
 * The renderer runs this on every 8s `AppSnapshot` poll and turns the returned
 * decisions into `routerAgents.notify.show` IPC calls. It shares the same
 * data the sidebar lamps use (`lastFinishedAt` / `lastErrorAt` / `lastReadAt`),
 * but tracks its OWN watermark so the two stay independent: a lamp can still
 * burn after the banner fired, and vice versa. All timestamps are ISO strings
 * compared lexicographically.
 */

export type NotificationDecision = {
  /** Passed through to the main-process 5s dedupe (`claimNotification`). */
  id: string
  kind: 'completion' | 'error' | 'approval'
  title: string
  body: string
  sessionId?: string
}

/** True when `candidate` is a non-empty ISO string strictly after `reference`. */
const isNewerThan = (candidate: string | undefined, reference: string): boolean =>
  typeof candidate === 'string' && candidate.length > 0 && candidate > reference

/**
 * Detect session completion/error events newer than the notification
 * watermark. A session fires a decision when BOTH hold:
 *  - event timestamp is newer than `lastNotifiedAt` (not yet notified) and
 *    newer than `lastReadAt` (still unread — reading the session suppresses
 *    the banner);
 *  - the focused gate passes: `hidden-only` mode skips while the window has
 *    focus, and skipped events do NOT advance the watermark so they re-fire
 *    once the window loses focus.
 * `nextWatermarks` only lists sessions whose watermark moved; a session with
 * both completion and error events takes the LATER timestamp (max), so the
 * next poll never re-fires the earlier event.
 */
export function evaluateSessionNotifications(params: {
  sessions: Session[]
  settings: NotificationSettings
  focused: boolean
  lastNotifiedAt: Record<string, string>
}): { decisions: NotificationDecision[]; nextWatermarks: Record<string, string> } {
  const { sessions, settings, focused, lastNotifiedAt } = params
  const decisions: NotificationDecision[] = []
  const nextWatermarks: Record<string, string> = {}

  for (const session of sessions) {
    const watermarkedAt = lastNotifiedAt[session.id] ?? ''
    const readAt = session.lastReadAt ?? ''

    if (settings.onCompletion && isNewerThan(session.lastFinishedAt, watermarkedAt)) {
      if (!isNewerThan(session.lastFinishedAt, readAt)) continue
      if (settings.mode === 'hidden-only' && focused) continue
      decisions.push({
        id: `completion-${session.id}`,
        kind: 'completion',
        sessionId: session.id,
        // NOTE: hardcoded zh copy today; i18n wiring is a tracked follow-up.
        title: session.title || '会话完成',
        body: 'Agent 已完成任务',
      })
      const prevWatermark = nextWatermarks[session.id] ?? watermarkedAt
      nextWatermarks[session.id] =
        session.lastFinishedAt! > prevWatermark ? session.lastFinishedAt! : prevWatermark
    }

    if (settings.onError && isNewerThan(session.lastErrorAt, watermarkedAt)) {
      if (!isNewerThan(session.lastErrorAt, readAt)) continue
      if (settings.mode === 'hidden-only' && focused) continue
      decisions.push({
        id: `error-${session.id}`,
        kind: 'error',
        sessionId: session.id,
        title: session.title || '会话失败',
        body: 'Agent 运行失败，点击查看详情',
      })
      const prevWatermark = nextWatermarks[session.id] ?? watermarkedAt
      nextWatermarks[session.id] =
        session.lastErrorAt! > prevWatermark ? session.lastErrorAt! : prevWatermark
    }
  }

  return { decisions, nextWatermarks }
}

/**
 * Detect pending approvals not yet notified. Each approval fires once per
 * lifecycle: ids are persisted by the hook in `swarmdesk:notification-approvals`
 * and skipped on later polls. Like sessions, a focused window in `hidden-only`
 * mode suppresses the banner WITHOUT marking the approval as notified, so it
 * still fires after the user leaves the app.
 */
export function evaluateApprovalNotifications(params: {
  approvals: ApprovalItem[]
  settings: NotificationSettings
  focused: boolean
  notifiedApprovalIds: ReadonlySet<string>
}): { decisions: NotificationDecision[]; nextNotifiedIds: string[] } {
  const { approvals, settings, focused, notifiedApprovalIds } = params
  const decisions: NotificationDecision[] = []
  const nextNotifiedIds: string[] = []

  for (const approval of approvals) {
    if (approval.status !== 'pending') continue
    if (notifiedApprovalIds.has(approval.id)) continue
    if (!settings.onApproval) continue
    if (settings.mode === 'hidden-only' && focused) continue
    const body = [approval.workerName, approval.detail ?? approval.action ?? '']
      .filter(Boolean)
      .join(' · ')
    decisions.push({
      id: `approval-${approval.id}`,
      kind: 'approval',
      sessionId: approval.sessionId ?? undefined,
      title: approval.title || '需要审批',
      body: body || 'Agent 请求授权',
    })
    nextNotifiedIds.push(approval.id)
  }

  return { decisions, nextNotifiedIds }
}
