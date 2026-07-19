import {
  isTerminalWorkerEvent,
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

function cursorForApproval(approval: ApprovalItem): ApprovalCursor {
  return {
    approvalId: approval.id,
    createdAt: approval.createdAt,
    resolved: approval.status !== 'pending',
  }
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
): WorkerRunState {
  if (!isActiveWorkerStatus(state.status)) return state
  const cursor = cursorForApproval(approval)
  if (compareApprovalCursor(cursor, state.approvalCursor) <= 0) return state

  if (approval.status === 'pending') {
    return {
      ...state,
      status: 'pending_approval',
      pendingApproval: approval,
      approvalCursor: cursor,
      lastDeltaAt: Date.now(),
    }
  }

  const { pendingApproval: _pendingApproval, ...rest } = state
  return {
    ...rest,
    status: 'running',
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
    workerKind: inferredKind,
    role: typeof value.role === 'string' ? (value.role as WorkerRole) : undefined,
    model: typeof value.model === 'string' ? value.model : undefined,
    output: typeof value.output === 'string' ? value.output : '',
    error: typeof value.error === 'string' ? value.error : undefined,
    errorCode: typeof value.errorCode === 'string' ? value.errorCode : undefined,
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
        changed = mergeApprovalIntoWorkerState(prev, approval) !== prev
      }
      break
    }
    case 'approval_resolved': {
      const prev = state.get(event.jobId)
      if (prev && isActiveWorkerStatus(prev.status)) {
        const resolvedApproval = (event as WorkerRunEvent & { type: 'approval_resolved' }).approval
        changed = mergeApprovalIntoWorkerState(prev, resolvedApproval) !== prev
      }
      break
    }
    case 'completed': {
      const prev = state.get(event.jobId)
      if (prev) {
        if (
          prev.output !== event.output ||
          prev.status !== 'completed' ||
          prev.truncated !== event.truncated
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
          prev.error !== event.error
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
        workerKind: event.workerKind,
        role: event.role,
        model: event.model,
        reusedSession: event.reusedSession,
        sequence: 0,
        output: '',
        status: 'running',
        truncated: false,
        startedAt: now,
        lastDeltaAt: now,
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
        next.set(event.jobId, mergeApprovalIntoWorkerState(prev, newApproval))
      }
      break
    }
    case 'approval_resolved': {
      const prev = state.get(event.jobId)
      if (prev && isActiveWorkerStatus(prev.status)) {
        const resolvedApproval = (event as WorkerRunEvent & { type: 'approval_resolved' }).approval
        next.set(event.jobId, mergeApprovalIntoWorkerState(prev, resolvedApproval))
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
        next.set(event.jobId, {
          ...prev,
          workerName: event.workerName ?? prev.workerName,
          workerKind: kind,
          output: event.output,
          status: 'completed',
          truncated: event.truncated,
          startedAt: times?.startedAt ?? prev.startedAt,
          lastDeltaAt: Math.max(end, times?.startedAt ?? prev.startedAt),
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
          workerKind: kind,
          role: event.role,
          model: event.model,
          reusedSession: false,
          sequence: 0,
          output: event.output,
          status: 'completed',
          truncated: event.truncated,
          startedAt: t.startedAt,
          lastDeltaAt: t.lastDeltaAt,
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
          output: event.output ?? prev.output,
          status: event.type,
          truncated: event.truncated,
          error: event.error,
          errorCode: event.errorCode,
          recoveryError: event.recoveryError,
          canResetAcpContext: event.canResetAcpContext,
          startedAt: times?.startedAt ?? prev.startedAt,
          lastDeltaAt: Math.max(end, times?.startedAt ?? prev.startedAt),
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
  let next = state
  for (const approval of approvals) {
    if (!approval.jobId) continue
    const existing = next.get(approval.jobId)
    if (!existing) continue
    const merged = mergeApprovalIntoWorkerState(existing, approval)
    if (merged !== existing) {
      if (next === state) next = new Map(state)
      next.set(approval.jobId, merged)
    }
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
        !existing.snapshotHydrated ||
        timingStale
      ) {
        if (next === state) next = new Map(state)
        next.set(job.id, {
          ...existing,
          workerId: job.workerId,
          workerName: job.workerName || existing.workerName,
          workerKind: worker?.kind ?? existing.workerKind,
          role: job.role ?? existing.role,
          model: worker?.model?.trim() || existing.model,
          status,
          output,
          error,
          errorCode,
          pendingApproval: undefined,
          snapshotHydrated: true,
          startedAt,
          lastDeltaAt,
        })
      }
      continue
    }

    if (job.status !== 'running' && job.status !== 'pending_approval') continue
    if (next.has(job.id)) continue

    const worker = workers.get(job.workerId)
    const startedAt = timestampOrNow(job.startedAt ?? job.createdAt)
    if (next === state) next = new Map(state)
    next.set(job.id, {
      jobId: job.id,
      workerId: job.workerId,
      workerName: job.workerName,
      workerKind: worker?.kind ?? 'custom',
      role: job.role,
      model: worker?.model?.trim() || undefined,
      reusedSession: false,
      sequence: 0,
      output: job.output ?? '',
      status: 'running',
      truncated: false,
      startedAt,
      lastDeltaAt: startedAt,
      snapshotHydrated: true,
    })
  }

  return seedApprovalsFromSnapshot(next, input.approvals)
}
