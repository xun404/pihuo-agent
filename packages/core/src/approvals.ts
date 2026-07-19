import type {
  ApprovalDecision,
  ApprovalItem,
  ApprovalOption,
  ApprovalLocation,
  ApprovalStatus,
  AcpToolKind,
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
  options: ApprovalOption[]
  source?: ApprovalItem['source']
  id?: string
  createdAt?: string
  jobId?: string
  toolCallId?: string
  toolKind?: AcpToolKind
  locations?: ApprovalLocation[]
}

/**
 * Pure: build a pending approval item (does not mutate store).
 */
export function createApprovalItem(input: EnqueueApprovalInput): ApprovalItem {
  const options = validateApprovalOptions(input.options)

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
    jobId: input.jobId,
    toolCallId: input.toolCallId,
    toolKind: input.toolKind,
    locations: input.locations,
  }
}

function validateApprovalOptions(options: ApprovalOption[] | undefined): ApprovalOption[] {
  if (!Array.isArray(options) || options.length === 0) {
    throw new Error('Approval options must contain at least one option')
  }
  const seen = new Set<string>()
  return options.map((option) => {
    const optionId = option?.optionId?.trim()
    const name = option?.name?.trim()
    const kind = option?.kind
    if (
      !optionId ||
      !name ||
      !['allow_once', 'allow_always', 'reject_once', 'reject_always'].includes(kind) ||
      seen.has(optionId)
    ) {
      throw new Error('Approval options are invalid')
    }
    seen.add(optionId)
    return { optionId, name, kind }
  })
}

export interface ResolveApprovalInput {
  item: ApprovalItem
  decision: ApprovalDecision
  optionId?: string
  resolvedAt?: string
  resolutionSource?: ApprovalItem['resolutionSource']
  resolutionReason?: string
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
  let selectedOption: ApprovalOption | undefined

  if (decision === 'allow') {
    status = 'allowed'
    if (!input.optionId) throw new Error('optionId required for allow/deny')
    selectedOption = item.options.find((option) => option.optionId === input.optionId)
    if (!selectedOption)
      throw new Error(`optionId "${input.optionId}" does not belong to approval ${item.id}`)
    if (selectedOption.kind !== 'allow_once' && selectedOption.kind !== 'allow_always') {
      throw new Error('allow decision requires allow_* option kind')
    }
  } else if (decision === 'deny') {
    status = 'denied'
    if (!input.optionId) throw new Error('optionId required for allow/deny')
    selectedOption = item.options.find((option) => option.optionId === input.optionId)
    if (!selectedOption)
      throw new Error(`optionId "${input.optionId}" does not belong to approval ${item.id}`)
    if (selectedOption.kind !== 'reject_once' && selectedOption.kind !== 'reject_always') {
      throw new Error('deny decision requires reject_* option kind')
    }
  } else {
    if (input.optionId) throw new Error('cancel must not specify optionId')
    status = 'cancelled'
  }

  return {
    ...item,
    status,
    decision,
    selectedOptionId: selectedOption?.optionId,
    selectedOption: selectedOption ? { ...selectedOption } : undefined,
    resolutionSource: input.resolutionSource,
    resolutionReason: input.resolutionReason,
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
  metadata?: Pick<ResolveApprovalInput, 'resolutionSource' | 'resolutionReason'>,
): { queue: ApprovalItem[]; item: ApprovalItem } {
  const idx = queue.findIndex((a) => a.id === id)
  if (idx < 0) throw new Error(`Approval not found: ${id}`)
  const resolved = applyApprovalDecision({
    item: queue[idx]!,
    decision,
    optionId,
    ...metadata,
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
  options: ApprovalOption[]
  workerId?: string
  workerName?: string
  sessionId?: string | null
  pathOrTarget?: string
  action?: string
  jobId?: string
  toolCallId?: string
  toolKind?: AcpToolKind
  locations?: ApprovalLocation[]
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
    jobId: input.jobId,
    toolCallId: input.toolCallId,
    toolKind: input.toolKind,
    locations: input.locations,
  }
}
