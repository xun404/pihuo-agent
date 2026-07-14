/** Domain types shared by desktop UI, core store, and Mastra app. */

export type SessionStatus = 'idle' | 'running' | 'needs_approval' | 'error'

export type LeaderMode = 'ask' | 'plan' | 'build' | 'review'

export type WorkerKind = 'claude' | 'codex' | 'opencode' | 'custom'

/**
 * Functional roles a worker can play when the Leader delegates.
 * Distinct from `kind` (which CLI product) and `capabilities` (raw abilities).
 */
export type WorkerRole = 'plan' | 'coder' | 'review' | 'test' | 'research' | 'general'

export type WorkerCapability = 'code-edit' | 'review' | 'research' | 'test' | 'general' | 'plan'

/** Aggregated worker health status (UI + routing). */
export type WorkerHealthStatus = 'unknown' | 'healthy' | 'unhealthy' | 'missing'

/** How deep a health probe ran. */
export type HealthProbeLevel = 'presence' | 'version' | 'acp_handshake'

/**
 * Structured result of a worker health probe.
 * @see packages/adapters health probe
 */
export interface WorkerHealthReport {
  status: WorkerHealthStatus
  /** Deepest level actually executed */
  level: HealthProbeLevel
  checkedAt: string
  latencyMs?: number
  /** One-line human reason */
  message?: string
  /** Short version string if captured */
  version?: string
  /** Actionable install / fix tips */
  hints?: string[]
  detail?: {
    exitCode?: number | null
    errorCode?: string
    stderrTail?: string
  }
}

export type Locale = 'zh' | 'en'

export const WORKER_ROLES: WorkerRole[] = [
  'plan',
  'coder',
  'review',
  'test',
  'research',
  'general',
]

export interface Project {
  id: string
  name: string
  rootPath: string
  defaultBranch?: string
  workerIds: string[]
  createdAt: string
  updatedAt: string
}

export interface Session {
  id: string
  projectId: string
  title: string
  status: SessionStatus
  mode: LeaderMode
  activeWorkerIds: string[]
  memoryThreadId: string
  createdAt: string
  updatedAt: string
}

/** Selectable model advertised by an ACP agent (or user-entered). */
export interface WorkerModelOption {
  modelId: string
  name: string
  description?: string
}

export interface WorkerRegistration {
  id: string
  name: string
  kind: WorkerKind
  /** Executable or package runner, e.g. npx / opencode */
  command: string
  args: string[]
  env?: Record<string, string>
  /**
   * Primary role used for default routing (plan / coder / review / test / …).
   */
  primaryRole: WorkerRole
  /**
   * All roles this worker may accept. Must include primaryRole.
   */
  roles: WorkerRole[]
  capabilities: WorkerCapability[]
  enabled: boolean
  /** Global vs project-scoped */
  scope: 'global' | 'project'
  projectId?: string
  description: string
  /** Shortcut = healthReport?.status ?? 'unknown' (kept for compatibility) */
  health: WorkerHealthStatus
  lastSeenAt?: string
  /** Latest probe report (message, hints, latency) */
  healthReport?: WorkerHealthReport
  /**
   * ACP model id for session/set_config_option (optional).
   * Stable config option validated against session-announced options.
   */
  model?: string
  /** Cached list from last ACP configOptions parse */
  availableModels?: WorkerModelOption[]
  /** When availableModels was last fetched */
  modelsFetchedAt?: string
  /** Fresh after successful refresh; stale after failed refresh with old cache retained */
  modelsState?: 'fresh' | 'stale'
  /** Most recent model refresh error (truncated, no secrets) */
  modelsError?: string
}

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
  | 'queued'
  | 'running'
  | 'pending_approval'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'timed_out'

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
  task: string
  cwd: string
  status: JobStatus
  createdAt: string
  startedAt?: string
  finishedAt?: string
  message?: string
  /** Truncated ACP / CLI output */
  output?: string
  error?: string
  approvalIds?: string[]
  source: JobSource
  meta?: Record<string, unknown>
}

export const JOB_OPEN_STATUSES: JobStatus[] = [
  'queued',
  'running',
  'pending_approval',
]

export function isJobOpen(status: JobStatus): boolean {
  return status === 'queued' || status === 'running' || status === 'pending_approval'
}

/** Max jobs retained in snapshot */
export const JOB_HISTORY_LIMIT = 100

/** Truncate job output stored on disk */
export const JOB_OUTPUT_MAX_CHARS = 32_000

/**
 * Typed event stream for worker execution (Scheduler → tool bridge → Chat UI).
 * Order: started -> delta* -> completed | failed | cancelled | timed_out
 * Preflight failure (e.g. Worker not found) may skip started and emit failed directly.
 */
export type WorkerRunEvent =
  | {
      type: 'started'
      jobId: string
      workerId: string
      workerName: string
      workerKind: WorkerKind
      role?: WorkerRole
      model?: string
      reusedSession: boolean
    }
  | {
      type: 'delta'
      jobId: string
      sequence: number
      delta: string
    }
  | {
      type: 'completed'
      jobId: string
      output: string
      truncated: boolean
      workerName?: string
      workerKind?: WorkerKind
      role?: WorkerRole
      model?: string
    }
  | {
      type: 'failed' | 'cancelled' | 'timed_out'
      jobId: string
      output?: string
      error?: string
      truncated: boolean
      workerName?: string
      workerKind?: WorkerKind
      role?: WorkerRole
      model?: string
    }

export const LEADER_STEP_BUDGET_PART_TYPE = "data-leader-step-budget";

export interface LeaderStepBudgetEvent {
  type: typeof LEADER_STEP_BUDGET_PART_TYPE;
  data: {
    reason: "max_steps";
    maxSteps: number;
    usedSteps: number;
    runId: string;
    occurredAt: string;
  };
}

/** Per-job accumulated state for UI reducer */
export interface WorkerRunState {
  jobId: string
  workerName: string
  workerKind: WorkerKind
  role?: WorkerRole
  model?: string
  reusedSession: boolean
  sequence: number
  output: string
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'timed_out'
  truncated: boolean
  error?: string
  startedAt: number
  lastDeltaAt: number
}

/** Pending or resolved permission from ACP / tool approval path. */
export type ApprovalStatus = 'pending' | 'allowed' | 'denied' | 'cancelled'

export type ApprovalDecision = 'allow' | 'deny' | 'cancel'

export interface ApprovalOption {
  optionId: string
  name: string
}

export interface ApprovalItem {
  id: string
  status: ApprovalStatus
  title: string
  detail?: string
  /** e.g. write, execute_command */
  action?: string
  pathOrTarget?: string
  workerId?: string
  workerName?: string
  sessionId?: string | null
  options: ApprovalOption[]
  /** Option id chosen when allowed */
  selectedOptionId?: string
  decision?: ApprovalDecision
  source: 'acp' | 'tool' | 'manual'
  createdAt: string
  resolvedAt?: string
}

export interface AppSnapshot {
  projects: Project[]
  sessions: Session[]
  workers: WorkerRegistration[]
  approvals: ApprovalItem[]
  /** Recent worker jobs (dispatch history + in-flight) */
  jobs?: WorkerJob[]
  activeProjectId: string | null
  activeSessionId: string | null
  /** UI locale preference persisted with app state */
  locale?: Locale
}

export const DEFAULT_WORKERS: Omit<
  WorkerRegistration,
  'id' | 'health' | 'lastSeenAt' | 'enabled' | 'scope'
>[] = [
  {
    name: 'Claude Code',
    kind: 'claude',
    command: 'npx',
    args: ['-y', '@agentclientprotocol/claude-agent-acp@latest'],
    primaryRole: 'coder',
    roles: ['coder', 'plan', 'research', 'general'],
    capabilities: ['code-edit', 'plan', 'research', 'general'],
    description:
      'Primary coder: multi-file implementation and refactors via ACP. Can also plan and research.',
  },
  {
    name: 'Codex CLI',
    kind: 'codex',
    command: 'npx',
    args: ['-y', '@zed-industries/codex-acp@latest'],
    primaryRole: 'review',
    roles: ['review', 'coder', 'test', 'general'],
    capabilities: ['review', 'code-edit', 'test', 'general'],
    description:
      'Primary reviewer: code review and quality checks via ACP. Also capable of coding and tests.',
  },
  {
    name: 'OpenCode',
    kind: 'opencode',
    command: 'opencode',
    args: ['acp'],
    primaryRole: 'general',
    roles: ['general', 'coder', 'plan', 'test'],
    capabilities: ['general', 'code-edit', 'plan', 'test'],
    description:
      'General-purpose coding agent via native ACP. Flexible for plan / code / test tasks.',
  },
]

/** Normalize legacy workers that lack role fields. */
export function normalizeWorkerRoles<
  T extends Partial<WorkerRegistration> & Pick<WorkerRegistration, 'name' | 'kind'>,
>(worker: T): T & Pick<WorkerRegistration, 'primaryRole' | 'roles'> {
  const roles =
    worker.roles && worker.roles.length > 0
      ? worker.roles
      : worker.capabilities?.includes('review')
        ? (['review', 'coder', 'general'] as WorkerRole[])
        : (['coder', 'general'] as WorkerRole[])
  const primaryRole =
    worker.primaryRole && roles.includes(worker.primaryRole) ? worker.primaryRole : roles[0]!
  return { ...worker, primaryRole, roles }
}

/** Ensure health + healthReport are consistent for migrated store rows. */
export function normalizeWorkerHealth<T extends Partial<WorkerRegistration>>(
  worker: T,
): T & Pick<WorkerRegistration, 'health'> {
  const status: WorkerHealthStatus = worker.health ?? worker.healthReport?.status ?? 'unknown'
  const report =
    worker.healthReport ??
    (worker.health || worker.lastSeenAt
      ? {
          status,
          level: 'presence' as const,
          checkedAt: worker.lastSeenAt ?? new Date(0).toISOString(),
          message: status === 'unknown' ? 'Not checked yet' : undefined,
        }
      : undefined)
  return {
    ...worker,
    health: report?.status ?? status,
    healthReport: report,
  }
}

/** Rank for routing: higher = preferred. */
export function workerHealthRank(status: WorkerHealthStatus | undefined): number {
  switch (status) {
    case 'healthy':
      return 4
    case 'unknown':
      return 3
    case 'unhealthy':
      return 2
    case 'missing':
      return 1
    default:
      return 0
  }
}

/** Default TTL for considering a health report fresh (5 minutes). */
export const WORKER_HEALTH_TTL_MS = 5 * 60 * 1000

export function isHealthReportFresh(
  report: WorkerHealthReport | undefined,
  ttlMs = WORKER_HEALTH_TTL_MS,
): boolean {
  if (!report?.checkedAt) return false
  const t = Date.parse(report.checkedAt)
  if (!Number.isFinite(t)) return false
  return Date.now() - t < ttlMs
}
