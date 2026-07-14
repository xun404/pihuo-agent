import type { WorkerRole, WorkerRunEvent, WorkerRunState } from '@router-agents/shared'

export function terminalWorkerEventFromToolPart(part: {
  type?: string
  output?: unknown
}): WorkerRunEvent | null {
  if (!part.type?.startsWith('tool-')) return null
  const output = part.output
  if (!output || typeof output !== 'object') return null
  const value = output as Record<string, unknown>
  if (typeof value.jobId !== 'string' || typeof value.workerName !== 'string') return null

  const common = {
    jobId: value.jobId,
    workerName: value.workerName,
    role: typeof value.role === 'string' ? value.role as WorkerRole : undefined,
    model: typeof value.model === 'string' ? value.model : undefined,
    output: typeof value.output === 'string' ? value.output : '',
    error: typeof value.error === 'string' ? value.error : undefined,
    truncated: Boolean(value.truncated),
  }
  if (value.status === 'succeeded') {
    return { type: 'completed', ...common }
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
      if (prev && prev.status === 'running' && prev.sequence < event.sequence) {
        changed = true
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
      if (prev && prev.status === 'running' && prev.sequence < event.sequence) {
        next.set(event.jobId, {
          ...prev,
          sequence: event.sequence,
          output: prev.output + event.delta,
          lastDeltaAt: Date.now(),
        })
      }
      break
    }
    case 'completed': {
      const prev = state.get(event.jobId)
      if (prev) {
        next.set(event.jobId, {
          ...prev,
          output: event.output,
          status: 'completed',
          truncated: event.truncated,
          lastDeltaAt: Date.now(),
        })
      } else if (event.workerName) {
        const now = Date.now()
        next.set(event.jobId, {
          jobId: event.jobId,
          workerName: event.workerName,
          workerKind: event.workerKind ?? 'custom',
          role: event.role,
          model: event.model,
          reusedSession: false,
          sequence: 0,
          output: event.output,
          status: 'completed',
          truncated: event.truncated,
          startedAt: now,
          lastDeltaAt: now,
        })
      }
      break
    }
    case 'failed':
    case 'cancelled':
    case 'timed_out': {
      const prev = state.get(event.jobId)
      if (prev) {
        next.set(event.jobId, {
          ...prev,
          output: event.output ?? prev.output,
          status: event.type,
          truncated: event.truncated,
          error: event.error,
          lastDeltaAt: Date.now(),
        })
      } else if (event.workerName) {
        const now = Date.now()
        next.set(event.jobId, {
          jobId: event.jobId,
          workerName: event.workerName,
          workerKind: event.workerKind ?? 'custom',
          role: event.role,
          model: event.model,
          reusedSession: false,
          sequence: 0,
          output: event.output ?? '',
          status: event.type,
          truncated: event.truncated,
          error: event.error,
          startedAt: now,
          lastDeltaAt: now,
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
      const event = part.type === 'data-worker-run' && part.data
        ? part.data as WorkerRunEvent
        : terminalWorkerEventFromToolPart(part)
      if (!event) continue
      const existing = current.get(event.jobId)
      if (existing && existing.status !== 'running') continue
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
      if (
        event.type === 'completed' ||
        event.type === 'failed' ||
        event.type === 'cancelled' ||
        event.type === 'timed_out'
      ) {
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
