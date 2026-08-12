import type { SessionApprovalPolicy } from './permissions.js'
import type { WorkerRole } from './roles.js'

export interface ChatMessagePart {
  type: 'text' | 'plan' | 'delegation' | 'diff' | 'approval' | 'tool'
  text?: string
  data?: Record<string, unknown>
}

export interface ChatMessage {
  id: string
  sessionId: string
  role: 'user' | 'assistant' | 'system'
  parts: ChatMessagePart[]
  createdAt: string
}

/** @deprecated Prefer WorkerJob — kept for type compatibility */
export interface DelegationEvent {
  id: string
  sessionId: string
  workerId: string
  workerName: string
  status: 'running' | 'done' | 'error' | 'pending_approval'
  task: string
  /** Role the leader requested for this delegation */
  role?: WorkerRole
  startedAt: string
  finishedAt?: string
  summary?: string
}

/** Lifecycle of a scheduled worker (ACP) job */
export type JobStatus =
  'queued' | 'running' | 'pending_approval' | 'succeeded' | 'failed' | 'cancelled' | 'timed_out'

export type JobSource = 'leader' | 'api' | 'ui'

/**
 * Durable worker dispatch unit — selected worker + task + lifecycle.
 * @see WorkerScheduler
 */
export interface WorkerJob {
  id: string
  sessionId: string
  projectId: string
  threadId?: string
  workerId: string
  workerName: string
  role?: WorkerRole
  /** Immutable Team-member snapshot captured at dispatch time. */
  teamMemberId?: string
  teamMemberName?: string
  roleType?: WorkerRole
  teamMemberRevision?: number
  effectiveModel?: string
  /** ACP reasoning value frozen at dispatch time (TeamMember override → Worker default → Agent default). */
  effectiveReasoning?: string
  instructionsSnapshot?: string
  effectivePrompt?: string
  task: string
  cwd: string
  status: JobStatus
  approvalPolicy: SessionApprovalPolicy
  createdAt: string
  startedAt?: string
  finishedAt?: string
  message?: string
  /** Truncated ACP / CLI output */
  output?: string
  error?: string
  /** Stable public error code (e.g. WORKER_AUTH_REQUIRED) — no secrets */
  errorCode?: string
  approvalIds?: string[]
  source: JobSource
  meta?: Record<string, unknown>
  /**
   * Opaque ACP reuse key digest at job start (no agentSessionId).
   * Used by reset-context so config/auth drift cannot recompute the wrong key.
   */
  reuseKeyDigest?: string
  /**
   * Set when session recovery fails (worker process died, session not found,
   * recovery unsupported). Persisted on the job so the "Reset ACP context"
   * button survives a page refresh / session switch, not just the live SSE event.
   */
  recoveryError?: string
  canResetAcpContext?: boolean
}

export const JOB_OPEN_STATUSES: JobStatus[] = ['queued', 'running', 'pending_approval']

export function isJobOpen(status: JobStatus): boolean {
  return status === 'queued' || status === 'running' || status === 'pending_approval'
}

/** Max jobs retained in snapshot */
export const JOB_HISTORY_LIMIT = 100

/** Truncate job output stored on disk */
export const JOB_OUTPUT_MAX_CHARS = 32_000
