import type { AcpToolKind } from './permissions.js'

/** Pending or resolved permission from ACP / tool approval path. */
export type ApprovalStatus = 'pending' | 'allowed' | 'denied' | 'cancelled'

export type ApprovalDecision = 'allow' | 'deny' | 'cancel'

export type ApprovalOptionKind = 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always'

export interface ApprovalOption {
  optionId: string
  name: string
  kind: ApprovalOptionKind
}

export interface ApprovalLocation {
  filePath?: string
  line?: number
  column?: number
  description?: string
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
  jobId?: string
  toolCallId?: string
  toolKind?: AcpToolKind
  locations?: ApprovalLocation[]
  options: ApprovalOption[]
  /** Option id chosen when allowed */
  selectedOptionId?: string
  /** Exact immutable option selected at resolution time. */
  selectedOption?: ApprovalOption
  decision?: ApprovalDecision
  source: 'acp' | 'tool' | 'manual'
  resolutionSource?: 'manual_chat' | 'manual_panel' | 'policy' | 'system'
  resolutionReason?: string
  createdAt: string
  resolvedAt?: string
}

/** Stable pending-approval order shared by worker cards and the approvals panel. */
export function compareApprovalOrder(a: ApprovalItem, b: ApprovalItem): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1
  if (a.id === b.id) return 0
  return a.id < b.id ? -1 : 1
}

/** Return pending approvals in their deterministic createdAt + id order. */
export function sortPendingApprovals(approvals: ApprovalItem[]): ApprovalItem[] {
  return approvals.filter((approval) => approval.status === 'pending').sort(compareApprovalOrder)
}
