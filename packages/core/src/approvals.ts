import type {
  ApprovalDecision,
  ApprovalItem,
  ApprovalOption,
  ApprovalStatus,
} from '@router-agents/shared'
import { createId } from './id.js'

export interface EnqueueApprovalInput {
  title: string
  detail?: string
  action?: string
  pathOrTarget?: string
  workerId?: string
  workerName?: string
  sessionId?: string | null
  options?: ApprovalOption[]
  source?: ApprovalItem['source']
  id?: string
  createdAt?: string
}

/**
 * Pure: build a pending approval item (does not mutate store).
 */
export function createApprovalItem(input: EnqueueApprovalInput): ApprovalItem {
  const options =
    input.options && input.options.length > 0
      ? input.options
      : [
          { optionId: 'allow', name: 'Allow' },
          { optionId: 'deny', name: 'Deny' },
        ]

  return {
    id: input.id ?? createId('appr'),
    status: 'pending',
    title: input.title,
    detail: input.detail,
    action: input.action,
    pathOrTarget: input.pathOrTarget,
    workerId: input.workerId,
    workerName: input.workerName,
    sessionId: input.sessionId ?? null,
    options,
    source: input.source ?? 'acp',
    createdAt: input.createdAt ?? new Date().toISOString(),
  }
}

export interface ResolveApprovalInput {
  item: ApprovalItem
  decision: ApprovalDecision
  optionId?: string
  resolvedAt?: string
}

/**
 * Pure: apply allow/deny/cancel to a pending approval.
 * Throws if item is not pending.
 */
export function applyApprovalDecision(input: ResolveApprovalInput): ApprovalItem {
  const { item, decision } = input
  if (item.status !== 'pending') {
    throw new Error(`Approval ${item.id} is already ${item.status}`)
  }

  let status: ApprovalStatus
  let selectedOptionId = input.optionId

  if (decision === 'allow') {
    status = 'allowed'
    if (!selectedOptionId) {
      const allowOpt =
        item.options.find((o) => /allow|yes|approve/i.test(o.name)) ?? item.options[0]
      selectedOptionId = allowOpt?.optionId
    }
  } else if (decision === 'deny') {
    status = 'denied'
    if (!selectedOptionId) {
      const denyOpt =
        item.options.find((o) => /deny|no|reject/i.test(o.name)) ??
        item.options.find((o) => o.optionId === 'deny')
      selectedOptionId = denyOpt?.optionId
    }
  } else {
    status = 'cancelled'
  }

  return {
    ...item,
    status,
    decision,
    selectedOptionId,
    resolvedAt: input.resolvedAt ?? new Date().toISOString(),
  }
}

/**
 * Pure: append pending item to queue (immutable).
 */
export function enqueueApproval(
  queue: ApprovalItem[],
  input: EnqueueApprovalInput,
): { queue: ApprovalItem[]; item: ApprovalItem } {
  const item = createApprovalItem(input)
  return { queue: [item, ...queue], item }
}

/**
 * Pure: resolve by id in queue (immutable).
 */
export function resolveApprovalInQueue(
  queue: ApprovalItem[],
  id: string,
  decision: ApprovalDecision,
  optionId?: string,
): { queue: ApprovalItem[]; item: ApprovalItem } {
  const idx = queue.findIndex((a) => a.id === id)
  if (idx < 0) throw new Error(`Approval not found: ${id}`)
  const resolved = applyApprovalDecision({
    item: queue[idx]!,
    decision,
    optionId,
  })
  const next = queue.slice()
  next[idx] = resolved
  return { queue: next, item: resolved }
}

export function listPendingApprovals(queue: ApprovalItem[]): ApprovalItem[] {
  return queue.filter((a) => a.status === 'pending')
}

/**
 * Map ACP-style permission request payload into enqueue input.
 */
export function mapAcpPermissionToEnqueue(input: {
  title: string
  options?: ApprovalOption[]
  workerId?: string
  workerName?: string
  sessionId?: string | null
  pathOrTarget?: string
  action?: string
}): EnqueueApprovalInput {
  return {
    title: input.title,
    options: input.options,
    workerId: input.workerId,
    workerName: input.workerName,
    sessionId: input.sessionId,
    pathOrTarget: input.pathOrTarget,
    action: input.action ?? 'permission',
    source: 'acp',
    detail: input.pathOrTarget
      ? `${input.action ?? 'permission'}: ${input.pathOrTarget}`
      : undefined,
  }
}
