import type { ApprovalItem, WorkerJob } from '@pihuo-agent/shared'

/**
 * Return only approvals belonging to one Chat Session.
 *
 * Current durable rows carry `sessionId`. The Job fallback keeps older rows
 * (created before that field was populated) scoped correctly without allowing
 * an unrelated Session's approval to leak into the shield or panel.
 */
export function approvalsForSession(
  approvals: readonly ApprovalItem[],
  jobs: readonly Pick<WorkerJob, 'id' | 'sessionId'>[],
  sessionId: string,
): ApprovalItem[] {
  const sessionJobIds = new Set(
    jobs.filter((job) => job.sessionId === sessionId).map((job) => job.id),
  )
  return approvals.filter(
    (approval) =>
      approval.sessionId === sessionId ||
      (approval.sessionId == null && approval.jobId != null && sessionJobIds.has(approval.jobId)),
  )
}
