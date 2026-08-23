import type { TeamMember, WorkerRunState } from '@pihuo-agent/shared'

export type GroupDiscussionState = {
  enabled: boolean
  workerStates: WorkerRunState[]
  activeWorkerCount: number
}

/**
 * Derive the group-discussion presentation from the existing team and worker
 * snapshots. This deliberately owns no worker or member state.
 */
export function deriveGroupDiscussionState(
  teamMembers: readonly TeamMember[],
  workerStates: Iterable<WorkerRunState>,
): GroupDiscussionState {
  const byJobId = new Map<string, WorkerRunState>()
  for (const state of workerStates) {
    if (!byJobId.has(state.jobId)) byJobId.set(state.jobId, state)
  }
  const visibleWorkers = [...byJobId.values()]
  const activeWorkerCount = visibleWorkers.filter(
    (state) => state.status === 'running' || state.status === 'pending_approval',
  ).length

  return {
    enabled: teamMembers.length > 0 || visibleWorkers.length > 0,
    workerStates: visibleWorkers,
    activeWorkerCount,
  }
}
