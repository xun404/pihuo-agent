import type { ApprovalItem, ApprovalLocation } from './approvals.js'
import type { AcpToolKind } from './permissions.js'
import type { WorkerRole } from './roles.js'
import type { WorkerKind } from './worker-acp.js'

/** UI-facing snapshot of an ACP tool call (tool_call / tool_call_update). */
export type WorkerToolCallStatus = 'pending' | 'in_progress' | 'completed' | 'failed'

export interface WorkerToolCallView {
  toolCallId: string
  title: string
  kind?: AcpToolKind
  status?: WorkerToolCallStatus
  /** Short human-readable detail (paths, truncated content). */
  detail?: string
  locations?: ApprovalLocation[]
}

/**
 * A single visible item in the worker's live execution trail.
 *
 * Unlike the compatibility `thought` / `toolCalls` projections on
 * `WorkerRunState`, this preserves the order in which ACP emitted thought and
 * tool events. A tool update always replaces the existing item in place.
 */
export type WorkerActivityItem =
  | {
      id: string
      type: 'thought'
      sequence: number
      text: string
    }
  | {
      id: string
      type: 'tool'
      sequence: number
      toolCall: WorkerToolCallView
    }

export interface WorkerPlanEntryView {
  content: string
  priority?: string
  status?: string
}

/**
 * Typed event stream for worker execution (Scheduler → tool bridge → Chat UI).
 * Order: started -> (delta|thought_delta|tool_call|tool_call_update|plan|approval_*)*
 *        -> completed | failed | cancelled | timed_out
 * Preflight failure (e.g. Worker not found) may skip started and emit failed directly.
 */
export type WorkerRunEvent =
  | {
      type: 'started'
      jobId: string
      workerId: string
      workerName: string
      /** Immutable Chat Team member display name captured at dispatch time. */
      teamMemberName?: string
      workerKind: WorkerKind
      role?: WorkerRole
      model?: string
      reasoning?: string
      /** Dispatch task text — shown as worker card input while running. */
      task?: string
      reusedSession: boolean
      sessionDisposition?: string
    }
  | {
      type: 'delta'
      jobId: string
      sequence: number
      delta: string
    }
  | {
      type: 'thought_delta'
      jobId: string
      sequence: number
      delta: string
    }
  | {
      type: 'tool_call'
      jobId: string
      sequence: number
      toolCall: WorkerToolCallView
    }
  | {
      type: 'tool_call_update'
      jobId: string
      sequence: number
      toolCall: WorkerToolCallView
    }
  | {
      type: 'plan'
      jobId: string
      sequence: number
      entries: WorkerPlanEntryView[]
    }
  | {
      type: 'completed'
      jobId: string
      workerId?: string
      output: string
      truncated: boolean
      workerName?: string
      teamMemberName?: string
      workerKind?: WorkerKind
      role?: WorkerRole
      model?: string
      reasoning?: string
      errorCode?: string
    }
  | {
      type: 'failed' | 'cancelled' | 'timed_out'
      jobId: string
      workerId?: string
      output?: string
      error?: string
      /** Stable public code preserved through stream → reducer → card */
      errorCode?: string
      truncated: boolean
      workerName?: string
      teamMemberName?: string
      workerKind?: WorkerKind
      role?: WorkerRole
      model?: string
      reasoning?: string
      recoveryError?: string
      canResetAcpContext?: boolean
    }
  | {
      type: 'approval_requested'
      jobId: string
      approval: ApprovalItem
    }
  | {
      type: 'approval_resolved'
      jobId: string
      approval: ApprovalItem
    }

export function isTerminalWorkerEvent(
  event: WorkerRunEvent,
): event is WorkerRunEvent & { type: 'completed' | 'failed' | 'cancelled' | 'timed_out' } {
  return (
    event.type === 'completed' ||
    event.type === 'failed' ||
    event.type === 'cancelled' ||
    event.type === 'timed_out'
  )
}

export const LEADER_STEP_BUDGET_PART_TYPE = 'data-leader-step-budget'

export interface LeaderStepBudgetEvent {
  type: typeof LEADER_STEP_BUDGET_PART_TYPE
  data: {
    reason: 'max_steps'
    maxSteps: number
    usedSteps: number
    runId: string
    occurredAt: string
  }
}

export interface ApprovalCursor {
  approvalId: string
  createdAt: string
  resolved: boolean
}

/** Per-job accumulated state for UI reducer */
export interface WorkerRunState {
  jobId: string
  /** Stable Worker identity retained for Registry/auth deep links. */
  workerId?: string
  workerName: string
  /** Chat Team member display name; falls back to workerName for legacy jobs. */
  teamMemberName?: string
  workerKind: WorkerKind
  role?: WorkerRole
  model?: string
  reasoning?: string
  /**
   * Dispatch task / prompt shown as the worker card "input" section.
   * Available from started event, durable job, or tool payload — not only at completion.
   */
  task?: string
  reusedSession: boolean
  sequence: number
  output: string
  /** Accumulated ACP agent_thought_chunk text. */
  thought?: string
  /** Live ACP tool_call / tool_call_update snapshots in first-seen order. */
  toolCalls?: WorkerToolCallView[]
  /** Ordered thought/tool trail for the current live worker run. */
  activityItems?: WorkerActivityItem[]
  /** The currently streaming/executing item; cleared as soon as it completes. */
  activeActivityItemId?: string
  /** Latest ACP plan entries (replaced on each plan/plan_update). */
  planEntries?: WorkerPlanEntryView[]
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'timed_out' | 'pending_approval'
  truncated: boolean
  error?: string
  /** Stable public error code from terminal event / job */
  errorCode?: string
  /** Set when session recovery fails (e.g. worker process died, session not found) */
  recoveryError?: string
  canResetAcpContext?: boolean
  startedAt: number
  lastDeltaAt: number
  /**
   * Every currently pending permission request for this Job, ordered by
   * createdAt then id. This is the authoritative UI state; a Job may have
   * more than one request in flight at once.
   */
  pendingApprovals: ApprovalItem[]
  /** Per-approval cursors used to ignore stale/duplicated live events. */
  approvalCursors?: Record<string, ApprovalCursor>
  /**
   * Deprecated compatibility projection of pendingApprovals[0]. New code
   * must read pendingApprovals instead.
   */
  pendingApproval?: ApprovalItem
  /** Monotonic approval cursor used to prevent stale snapshot resurrection. */
  approvalCursor?: ApprovalCursor
  /** Added from durable Job state so a refreshed card keeps its placement. */
  snapshotHydrated?: boolean
}
