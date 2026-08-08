import type { ApprovalItem, NotificationSettings, Session } from '@swarmdesk-agent/shared'

export type NotificationDecision = {
  id: string
  kind: 'completion' | 'error' | 'approval'
  title: string
  body: string
  sessionId?: string
}

const isNewerThan = (candidate: string | undefined, reference: string): boolean =>
  typeof candidate === 'string' && candidate.length > 0 && candidate > reference

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
        title: session.title || '会话完成',
        body: 'Agent 已完成任务',
      })
      nextWatermarks[session.id] = session.lastFinishedAt!
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
      nextWatermarks[session.id] = session.lastErrorAt!
    }
  }

  return { decisions, nextWatermarks }
}

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
