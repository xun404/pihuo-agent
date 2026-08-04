import {
  isTerminalWorkerEvent,
  compareApprovalOrder,
  sortPendingApprovals,
  type ApprovalCursor,
  type ApprovalItem,
  type WorkerJob,
  type WorkerRegistration,
  type WorkerKind,
  type WorkerRole,
  type WorkerRunEvent,
  type WorkerRunState,
} from '@swarmdesk-agent/shared'

export function isActiveWorkerStatus(status: WorkerRunState['status']): boolean {
  return status === 'running' || status === 'pending_approval'
}

function taskFromUnknown(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const task = (value as { task?: unknown }).task
  return typeof task === 'string' && task.trim() ? task : undefined
}

function cursorForApproval(approval: ApprovalItem): ApprovalCursor {
  return {
    approvalId: approval.id,
    createdAt: approval.createdAt,
    resolved: approval.status !== 'pending',
  }
}

function pendingApprovalsForState(state: WorkerRunState): ApprovalItem[] {
  if (Array.isArray(state.pendingApprovals)) return state.pendingApprovals
  return state.pendingApproval ? [state.pendingApproval] : []
}

function approvalCursorsForState(
  state: WorkerRunState,
  pendingApprovals: ApprovalItem[],
): Record<string, ApprovalCursor> {
  const cursors = state.approvalCursors ? { ...state.approvalCursors } : {}
  for (const approval of pendingApprovals) {
    if (!cursors[approval.id]) cursors[approval.id] = cursorForApproval(approval)
  }
  return cursors
}

function sameApproval(a: ApprovalItem | undefined, b: ApprovalItem | undefined): boolean {
  if (!a || !b) return a === b
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Positive means incoming is newer; same-id resolution is monotonic. */
export function compareApprovalCursor(
  incoming: ApprovalCursor,
  current: ApprovalCursor | undefined,
): number {
  if (!current) return 1
  if (incoming.approvalId === current.approvalId) {
    if (incoming.resolved === current.resolved) return 0
    return incoming.resolved ? 1 : -1
  }
  const byCreatedAt = incoming.createdAt.localeCompare(current.createdAt)
  if (byCreatedAt !== 0) return byCreatedAt
  return incoming.approvalId.localeCompare(current.approvalId)
}

function mergeApprovalIntoWorkerState(
  state: WorkerRunState,
  approval: ApprovalItem,
  eventKind?: 'requested' | 'resolved',
): WorkerRunState {
  if (!isActiveWorkerStatus(state.status)) return state
  const pendingApprovals = pendingApprovalsForState(state)
  const cursor = cursorForApproval(approval)
  const current = pendingApprovals.find((item) => item.id === approval.id)
  const currentCursor =
    state.approvalCursors?.[approval.id] ?? (current ? cursorForApproval(current) : undefined)
  const cursorComparison = compareApprovalCursor(cursor, currentCursor)
  const isPending = eventKind === 'requested' || (eventKind !== 'resolved' && approval.status === 'pending')
  // Same-id pending requests are true upserts: keep the reference for an
  // identical duplicate, but accept changed metadata (title/detail/options).
  if (
    cursorComparison < 0 ||
    (cursorComparison === 0 && !(isPending && current && !sameApproval(current, approval)))
  )
    return state

  if (isPending) {
    const nextPending = sortPendingApprovals(
      current
        ? pendingApprovals.map((item) => (item.id === approval.id ? approval : item))
        : [...pendingApprovals, approval],
    )
    const approvalCursors = approvalCursorsForState(state, pendingApprovals)
    approvalCursors[approval.id] = cursor
    return {
      ...state,
      status: 'pending_approval',
      pendingApprovals: nextPending,
      pendingApproval: nextPending[0],
      approvalCursors,
      approvalCursor: cursor,
      lastDeltaAt: Date.now(),
    }
  }

  // A resolution only removes its own id. In particular, resolving one of
  // several requests must not make the Job look runnable while another is
  // still pending. Record a tombstone even when other requests are pending:
  // transient events can be delivered out of order, and a later stale
  // approval_requested for this id must not resurrect the resolved request.
  if (!current) {
    if (currentCursor) return state
    const approvalCursors = approvalCursorsForState(state, pendingApprovals)
    approvalCursors[approval.id] = cursor
    return {
      ...state,
      approvalCursors,
      approvalCursor: cursor,
      lastDeltaAt: Date.now(),
    }
  }
  const nextPending = pendingApprovals.filter((item) => item.id !== approval.id)
  const approvalCursors = approvalCursorsForState(state, pendingApprovals)
  approvalCursors[approval.id] = cursor
  return {
    ...state,
    status: nextPending.length > 0 ? 'pending_approval' : 'running',
    pendingApprovals: nextPending,
    pendingApproval: nextPending[0],
    approvalCursors,
    approvalCursor: cursor,
    lastDeltaAt: Date.now(),
  }
}

export function terminalWorkerEventFromToolPart(part: {
  type?: string
  output?: unknown
}): WorkerRunEvent | null {
  if (!part.type?.startsWith('tool-')) return null
  const output = part.output
  if (!output || typeof output !== 'object') return null
  const value = output as Record<string, unknown>
  if (typeof value.jobId !== 'string' || typeof value.workerName !== 'string') return null

  const workerName = value.workerName
  const rawKind =
    typeof value.workerKind === 'string'
      ? value.workerKind
      : typeof value.kind === 'string'
        ? value.kind
        : undefined
  // Infer brand when ACP/tool payload omits kind (avoids “custom +” logo after complete)
  const nameLower = workerName.toLowerCase()
  const inferredKind: WorkerKind | undefined =
    rawKind === 'claude' || rawKind === 'codex' || rawKind === 'opencode' || rawKind === 'custom'
      ? rawKind
      : nameLower.includes('claude')
        ? 'claude'
        : nameLower.includes('codex') || nameLower.includes('openai')
          ? 'codex'
          : nameLower.includes('opencode')
            ? 'opencode'
            : undefined
  const common = {
    jobId: value.jobId,
    workerId: typeof value.workerId === 'string' ? value.workerId : undefined,
    workerName,
    teamMemberName: typeof value.teamMemberName === 'string' ? value.teamMemberName : undefined,
    workerKind: inferredKind,
    role: typeof value.role === 'string' ? (value.role as WorkerRole) : undefined,
    model: typeof value.model === 'string' ? value.model : undefined,
    reasoning: typeof value.reasoning === 'string' ? value.reasoning : undefined,
    task: typeof value.task === 'string' ? value.task : undefined,
    output: typeof value.output === 'string' ? value.output : '',
    error: typeof value.error === 'string' ? value.error : undefined,
    errorCode: typeof value.errorCode === 'string' ? value.errorCode : undefined,
    // Recovery fields must be re-hydrated from the persisted tool output too,
    // not just the live SSE event — otherwise a page refresh / session switch
    // drops them and the "Reset ACP context" button disappears from a failed
    // card that still needs it (e.g. session_not_found after a stale catalog).
    recoveryError: typeof value.recoveryError === 'string' ? value.recoveryError : undefined,
    canResetAcpContext: Boolean(value.canResetAcpContext) || undefined,
    truncated: Boolean(value.truncated),
    // optional wall-clock from jobToToolResult (ISO strings)
    startedAt: typeof value.startedAt === 'string' ? value.startedAt : undefined,
    finishedAt: typeof value.finishedAt === 'string' ? value.finishedAt : undefined,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : undefined,
  }
  if (value.status === 'succeeded') {
    return { type: 'completed', ...common } as WorkerRunEvent
  }
  if (value.status === 'failed' || value.status === 'cancelled' || value.status === 'timed_out') {
    return { type: value.status, ...common }
  }
  return null
}

export function workerRunReducer(
  state: Map<string, WorkerRunState>,
  event: WorkerRunEvent,
): Map<string, WorkerRunState> {
  let changed = false

  switch (event.type) {
    case 'started': {
      if (!state.has(event.jobId)) changed = true
      break
    }
    case 'delta': {
      const prev = state.get(event.jobId)
      if (prev && isActiveWorkerStatus(prev.status) && prev.sequence < event.sequence) {
        changed = true
      }
      break
    }
    case 'approval_requested': {
      const prev = state.get(event.jobId)
      if (prev && isActiveWorkerStatus(prev.status)) {
        const approval = (event as WorkerRunEvent & { type: 'approval_requested' }).approval
        changed = mergeApprovalIntoWorkerState(prev, approval, 'requested') !== prev
      }
      break
    }
    case 'approval_resolved': {
      const prev = state.get(event.jobId)
      if (prev && isActiveWorkerStatus(prev.status)) {
        const resolvedApproval = (event as WorkerRunEvent & { type: 'approval_resolved' }).approval
        changed = mergeApprovalIntoWorkerState(prev, resolvedApproval, 'resolved') !== prev
      }
      break
    }
    case 'completed': {
      const prev = state.get(event.jobId)
      if (prev) {
        if (
          prev.output !== event.output ||
          prev.status !== 'completed' ||
          prev.truncated !== event.truncated ||
          prev.teamMemberName !== event.teamMemberName
        ) {
          changed = true
        }
      } else if (event.workerName) {
        changed = true
      }
      break
    }
    case 'failed':
    case 'cancelled':
    case 'timed_out': {
      const prev = state.get(event.jobId)
      if (prev) {
        const output = event.output ?? prev.output
        if (
          prev.output !== output ||
          prev.status !== event.type ||
          prev.truncated !== event.truncated ||
          prev.error !== event.error ||
          prev.teamMemberName !== event.teamMemberName
        ) {
          changed = true
        }
      } else if (event.workerName) {
        changed = true
      }
      break
    }
  }

  if (!changed) return state

  const next = new Map(state)

  switch (event.type) {
    case 'started': {
      const now = Date.now()
      next.set(event.jobId, {
        jobId: event.jobId,
        workerId: event.workerId,
        workerName: event.workerName,
        teamMemberName: event.teamMemberName,
        workerKind: event.workerKind,
        role: event.role,
        model: event.model,
        reasoning: (event as { reasoning?: string }).reasoning,
        task: typeof event.task === 'string' ? event.task : undefined,
        reusedSession: event.reusedSession,
        sequence: 0,
        output: '',
        status: 'running',
        truncated: false,
        startedAt: now,
        lastDeltaAt: now,
        pendingApprovals: [],
      })
      break
    }
    case 'delta': {
      const prev = state.get(event.jobId)
      if (prev && isActiveWorkerStatus(prev.status) && prev.sequence < event.sequence) {
        next.set(event.jobId, {
          ...prev,
          sequence: event.sequence,
          output: prev.output + event.delta,
          lastDeltaAt: Date.now(),
        })
      }
      break
    }
    case 'approval_requested': {
      const prev = state.get(event.jobId)
      if (prev && isActiveWorkerStatus(prev.status)) {
        const newApproval = (event as WorkerRunEvent & { type: 'approval_requested' }).approval
        next.set(event.jobId, mergeApprovalIntoWorkerState(prev, newApproval, 'requested'))
      }
      break
    }
    case 'approval_resolved': {
      const prev = state.get(event.jobId)
      if (prev && isActiveWorkerStatus(prev.status)) {
        const resolvedApproval = (event as WorkerRunEvent & { type: 'approval_resolved' }).approval
        next.set(event.jobId, mergeApprovalIntoWorkerState(prev, resolvedApproval, 'resolved'))
      }
      break
    }
    case 'completed': {
      const prev = state.get(event.jobId)
      const times = hasEventJobTimes(event) ? jobTimingMs(eventJobTimes(event)) : null
      if (prev) {
        const nameLower = (event.workerName ?? prev.workerName).toLowerCase()
        const kind: WorkerKind =
          prev.workerKind && prev.workerKind !== 'custom'
            ? prev.workerKind
            : (event.workerKind ??
              (nameLower.includes('claude')
                ? 'claude'
                : nameLower.includes('codex')
                  ? 'codex'
                  : nameLower.includes('opencode')
                    ? 'opencode'
                    : (prev.workerKind ?? 'custom')))
        const end = times?.lastDeltaAt ?? Date.now()
        const eventTask = taskFromUnknown(event)
        next.set(event.jobId, {
          ...prev,
          workerName: event.workerName ?? prev.workerName,
          teamMemberName: event.teamMemberName ?? prev.teamMemberName,
          workerKind: kind,
          task: eventTask ?? prev.task,
          output: event.output,
          status: 'completed',
          truncated: event.truncated,
          reasoning: (event as { reasoning?: string }).reasoning ?? prev.reasoning,
          startedAt: times?.startedAt ?? prev.startedAt,
          lastDeltaAt: Math.max(end, times?.startedAt ?? prev.startedAt),
          pendingApprovals: [],
          pendingApproval: undefined,
        })
      } else if (event.workerName) {
        const t = times ?? jobTimingMs({})
        const nameLower = event.workerName.toLowerCase()
        const kind: WorkerKind =
          event.workerKind ??
          (nameLower.includes('claude')
            ? 'claude'
            : nameLower.includes('codex')
              ? 'codex'
              : nameLower.includes('opencode')
                ? 'opencode'
                : 'custom')
        next.set(event.jobId, {
          jobId: event.jobId,
          workerId: event.workerId,
          workerName: event.workerName,
          teamMemberName: event.teamMemberName,
          workerKind: kind,
          role: event.role,
          model: event.model,
          task: taskFromUnknown(event),
          reusedSession: false,
          sequence: 0,
          output: event.output,
          status: 'completed',
          truncated: event.truncated,
          startedAt: t.startedAt,
          lastDeltaAt: t.lastDeltaAt,
          pendingApprovals: [],
        })
      }
      break
    }
    case 'failed':
    case 'cancelled':
    case 'timed_out': {
      const prev = state.get(event.jobId)
      const times = hasEventJobTimes(event) ? jobTimingMs(eventJobTimes(event)) : null
      if (prev) {
        const end = times?.lastDeltaAt ?? Date.now()
        next.set(event.jobId, {
          ...prev,
          teamMemberName: event.teamMemberName ?? prev.teamMemberName,
          output: event.output ?? prev.output,
          status: event.type,
          truncated: event.truncated,
          error: event.error,
          errorCode: event.errorCode,
          reasoning: (event as any).reasoning ?? prev.reasoning,
          recoveryError: event.recoveryError,
          canResetAcpContext: event.canResetAcpContext,
          startedAt: times?.startedAt ?? prev.startedAt,
          lastDeltaAt: Math.max(end, times?.startedAt ?? prev.startedAt),
          pendingApprovals: [],
          pendingApproval: undefined,
        })
      } else if (event.workerName) {
        const t = times ?? jobTimingMs({})
        const nameLower = event.workerName.toLowerCase()
        const kind: WorkerKind =
          event.workerKind ??
          (nameLower.includes('claude')
            ? 'claude'
            : nameLower.includes('codex')
              ? 'codex'
              : nameLower.includes('opencode')
                ? 'opencode'
                : 'custom')
        next.set(event.jobId, {
          jobId: event.jobId,
          workerId: event.workerId,
          workerName: event.workerName,
          teamMemberName: event.teamMemberName,
          workerKind: kind,
          role: event.role,
          model: event.model,
          reusedSession: false,
          sequence: 0,
          output: event.output ?? '',
          status: event.type,
          truncated: event.truncated,
          error: event.error,
          errorCode: event.errorCode,
          recoveryError: event.recoveryError,
          canResetAcpContext: event.canResetAcpContext,
          startedAt: t.startedAt,
          lastDeltaAt: t.lastDeltaAt,
          pendingApprovals: [],
        })
      }
      break
    }
  }

  return next
}

export function seedWorkerStates(
  state: Map<string, WorkerRunState>,
  messages: Array<{ parts?: unknown[] }>,
): Map<string, WorkerRunState> {
  let current = state
  for (const msg of messages) {
    if (!msg.parts) continue
    for (const part of msg.parts as Array<{ type: string; data?: unknown; output?: unknown }>) {
      const event =
        part.type === 'data-worker-run' && part.data
          ? (part.data as WorkerRunEvent)
          : terminalWorkerEventFromToolPart(part)
      if (!event) continue
      const existing = current.get(event.jobId)
      if (existing && !isActiveWorkerStatus(existing.status)) continue
      current = workerRunReducer(current, event)
    }
  }
  return current
}

export function cleanupTerminalWorkers(
  state: Map<string, WorkerRunState>,
  messages: Array<{ parts?: unknown[] }>,
): { active: Map<string, WorkerRunState>; terminal: Map<string, WorkerRunState> } {
  const terminal: Map<string, WorkerRunState> = new Map()
  let active = state

  for (const msg of messages) {
    if (!msg.parts) continue
    for (const part of msg.parts as Array<{ type: string; data?: unknown }>) {
      if (part.type !== 'data-worker-run' || !part.data) continue
      const event = part.data as WorkerRunEvent
      if (isTerminalWorkerEvent(event)) {
        const existing = active.get(event.jobId)
        if (existing) {
          terminal.set(event.jobId, existing)
          const next = new Map(active)
          next.delete(event.jobId)
          active = next
        }
      }
    }
  }

  if (terminal.size === 0) return { active: state, terminal }
  return { active, terminal }
}

export function seedApprovalsFromSnapshot(
  state: Map<string, WorkerRunState>,
  approvals: ApprovalItem[],
): Map<string, WorkerRunState> {
  // A snapshot is a complete durable view for each Job represented in it.
  // Group first so an older resolved row/cursor cannot hide another pending
  // row for the same Job, regardless of transport order.
  const rowsByJob = new Map<string, ApprovalItem[]>()
  for (const approval of approvals) {
    if (!approval.jobId) continue
    const rows = rowsByJob.get(approval.jobId)
    if (rows) rows.push(approval)
    else rowsByJob.set(approval.jobId, [approval])
  }

  let next = state
  for (const [jobId, rows] of rowsByJob) {
    const existing = next.get(jobId)
    if (!existing || !isActiveWorkerStatus(existing.status)) continue

    // Durable stores should contain one row per id, but tolerate an old or
    // concurrently merged snapshot carrying both pending and resolved copies.
    // For the same id, a resolved row wins; pending rows for *other* ids still
    // remain authoritative and visible.
    const latestById = new Map<string, ApprovalItem>()
    for (const row of [...rows].sort(compareApprovalOrder)) {
      const current = latestById.get(row.id)
      if (!current || compareApprovalCursor(cursorForApproval(row), cursorForApproval(current)) > 0) {
        latestById.set(row.id, row)
      }
    }
    const canonicalRows = [...latestById.values()]
    const pending = sortPendingApprovals(canonicalRows)
    const currentPending = pendingApprovalsForState(existing)
    const rowsInOrder = canonicalRows.sort(compareApprovalOrder)
    const approvalCursors = approvalCursorsForState(existing, currentPending)
    for (const row of rowsInOrder) {
      const cursor = cursorForApproval(row)
      const previous = approvalCursors[row.id]
      // Keep an already-resolved tombstone stable across snapshots whose
      // deserialized createdAt differs by a few milliseconds. Pending rows may
      // still replace a resolved cursor because the pending set is authoritative.
      if (!previous || previous.resolved !== cursor.resolved) approvalCursors[row.id] = cursor
    }
    // If a row appears in both forms, the snapshot's pending representation is
    // authoritative and must win over a stale resolved cursor.
    for (const row of pending) {
      const previous = approvalCursors[row.id]
      if (!previous || previous.resolved) approvalCursors[row.id] = cursorForApproval(row)
    }

    const samePending =
      currentPending.length === pending.length &&
      currentPending.every((item, index) => sameApproval(item, pending[index]))
    const nextStatus = pending.length > 0 ? 'pending_approval' : 'running'
    const needsChange =
      !samePending ||
      existing.status !== nextStatus ||
      !Array.isArray(existing.pendingApprovals) ||
      existing.pendingApproval !== pending[0] ||
      JSON.stringify(existing.approvalCursors ?? {}) !== JSON.stringify(approvalCursors)

    if (!needsChange) continue
    if (next === state) next = new Map(state)
    next.set(jobId, {
      ...existing,
      status: nextStatus,
      pendingApprovals: pending,
      pendingApproval: pending[0],
      approvalCursors,
      approvalCursor: rowsInOrder.length
        ? cursorForApproval(rowsInOrder[rowsInOrder.length - 1]!)
        : existing.approvalCursor,
      lastDeltaAt: Date.now(),
    })
  }

  return next
}

function timestamp(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function timestampOrNow(value: string | undefined): number {
  return timestamp(value) ?? Date.now()
}

/** Prefer job wall-clock; ensure end >= start so UI duration is never negative. */
export function jobTimingMs(job: { startedAt?: string; finishedAt?: string; createdAt?: string }): {
  startedAt: number
  lastDeltaAt: number
} {
  const startedAt = timestamp(job.startedAt) ?? timestamp(job.createdAt)
  const finishedAt = timestamp(job.finishedAt)
  if (startedAt != null && finishedAt != null) {
    return { startedAt, lastDeltaAt: Math.max(finishedAt, startedAt) }
  }
  if (startedAt != null) {
    return {
      startedAt,
      lastDeltaAt: finishedAt != null ? Math.max(finishedAt, startedAt) : startedAt,
    }
  }
  if (finishedAt != null) {
    return { startedAt: finishedAt, lastDeltaAt: finishedAt }
  }
  const now = Date.now()
  return { startedAt: now, lastDeltaAt: now }
}

function eventJobTimes(event: WorkerRunEvent): {
  startedAt?: string
  finishedAt?: string
  createdAt?: string
} {
  const e = event as WorkerRunEvent & {
    startedAt?: string
    finishedAt?: string
    createdAt?: string
  }
  return {
    startedAt: typeof e.startedAt === 'string' ? e.startedAt : undefined,
    finishedAt: typeof e.finishedAt === 'string' ? e.finishedAt : undefined,
    createdAt: typeof e.createdAt === 'string' ? e.createdAt : undefined,
  }
}

function hasEventJobTimes(event: WorkerRunEvent): boolean {
  const t = eventJobTimes(event)
  return Boolean(t.startedAt || t.finishedAt || t.createdAt)
}

export function seedAcpResetMarkers(
  state: Map<string, WorkerRunState>,
  jobs: WorkerJob[],
  sessionId: string,
): Map<string, WorkerRunState> {
  let next = state
  for (const job of jobs) {
    if (job.sessionId !== sessionId || typeof job.meta?.acpContextResetAt !== 'string') continue
    const existing = next.get(job.id)
    if (!existing?.canResetAcpContext) continue
    if (next === state) next = new Map(state)
    next.set(job.id, { ...existing, canResetAcpContext: false })
  }
  return next
}

/** Atomically hydrate active jobs, worker identity, approval cursors and reset markers. */
export function seedWorkerStatesFromSnapshot(
  state: Map<string, WorkerRunState>,
  input: {
    sessionId: string
    jobs: WorkerJob[]
    workers: WorkerRegistration[]
    approvals: ApprovalItem[]
  },
): Map<string, WorkerRunState> {
  const workers = new Map(input.workers.map((worker) => [worker.id, worker]))
  let next = seedAcpResetMarkers(state, input.jobs, input.sessionId)

  for (const job of input.jobs) {
    if (job.sessionId !== input.sessionId) continue
    const existing = next.get(job.id)
    const isJobTerminal =
      job.status === 'succeeded' ||
      job.status === 'failed' ||
      job.status === 'cancelled' ||
      job.status === 'timed_out'

    // Terminal jobs: only refresh cards already present (from live events / message seed).
    // Always re-sync startedAt + lastDeltaAt from durable job so duration is not 0ms.
    if (existing && isJobTerminal) {
      const status: WorkerRunState['status'] =
        job.status === 'succeeded'
          ? 'completed'
          : job.status === 'failed' || job.status === 'cancelled' || job.status === 'timed_out'
            ? job.status
            : existing.status
      const { startedAt, lastDeltaAt } = jobTimingMs(job)
      const worker = workers.get(job.workerId)
      const output = job.output ?? existing.output
      const error = job.error ?? existing.error
      const errorCode = job.errorCode ?? existing.errorCode
      const timingStale =
        existing.startedAt !== startedAt ||
        existing.lastDeltaAt !== lastDeltaAt ||
        existing.lastDeltaAt < existing.startedAt
      if (
        existing.status !== status ||
        existing.output !== output ||
        existing.error !== error ||
        existing.errorCode !== errorCode ||
        existing.workerId !== job.workerId ||
        existing.teamMemberName !== job.teamMemberName ||
        !existing.snapshotHydrated ||
        timingStale
      ) {
        if (next === state) next = new Map(state)
        next.set(job.id, {
          ...existing,
          workerId: job.workerId,
          workerName: job.workerName || existing.workerName,
          teamMemberName: job.teamMemberName ?? existing.teamMemberName,
          workerKind: worker?.kind ?? existing.workerKind,
          role: job.role ?? existing.role,
          model: job.effectiveModel?.trim() || worker?.model?.trim() || existing.model,
          reasoning:
            job.effectiveReasoning?.trim() || worker?.reasoning?.trim() || existing.reasoning,
          status,
          output,
          error,
          errorCode,
          pendingApprovals: [],
          pendingApproval: undefined,
          snapshotHydrated: true,
          startedAt,
          lastDeltaAt,
        })
      }
      continue
    }

    if (job.status !== 'running' && job.status !== 'pending_approval') continue

    // Refresh missing task/identity on an already-live card from durable job.
    if (next.has(job.id)) {
      const existing = next.get(job.id)!
      const task = job.task?.trim() || existing.task
      if (task && task !== existing.task) {
        if (next === state) next = new Map(state)
        next.set(job.id, { ...existing, task, snapshotHydrated: true })
      }
      continue
    }

    const worker = workers.get(job.workerId)
    const startedAt = timestampOrNow(job.startedAt ?? job.createdAt)
    if (next === state) next = new Map(state)
    next.set(job.id, {
      jobId: job.id,
      workerId: job.workerId,
      workerName: job.workerName,
      teamMemberName: job.teamMemberName,
      workerKind: worker?.kind ?? 'custom',
      role: job.role,
      model: job.effectiveModel?.trim() || worker?.model?.trim() || undefined,
      reasoning: job.effectiveReasoning?.trim() || worker?.reasoning?.trim() || undefined,
      task: job.task?.trim() || undefined,
      reusedSession: false,
      sequence: 0,
      output: job.output ?? '',
      status: job.status === 'pending_approval' ? 'pending_approval' : 'running',
      truncated: false,
      startedAt,
      lastDeltaAt: startedAt,
      pendingApprovals: [],
      snapshotHydrated: true,
    })
  }

  return seedApprovalsFromSnapshot(next, input.approvals)
}
