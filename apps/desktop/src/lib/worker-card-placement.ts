import type { WorkerRunState } from '@router-agents/shared'
import { isActiveWorkerStatus } from './worker-run-reducer'

export interface WorkerCardPlacement {
  jobId: string
  source: 'message' | 'live'
  messageIndex?: number
  partIndex?: number
  state: WorkerRunState
}

/**
 * Whether to show the generic tool shell (incl. dispatch-worker / ACP).
 * Always keep the tool row visible as process history — worker cards are
 * rendered separately and must not replace/hide the tool line.
 */
export function shouldRenderGenericToolShell(
  _part: { type?: string; toolName?: string; output?: unknown; toolCallId?: string },
  _hasActiveWorkerCard: boolean,
  _opts?: {
    placedJobIds?: Set<string>
    toolCallJobIds?: Map<string, string>
  },
): boolean {
  return true
}

/** Build toolCallId → jobId map from message parts (tool output + data-worker-run near tool). */
export function buildToolCallJobIdMap(
  messages: Array<{
    role?: string
    parts?: Array<{
      type?: string
      toolCallId?: string
      toolInvocationId?: string
      output?: unknown
      data?: unknown
    }>
  }>,
): Map<string, string> {
  const map = new Map<string, string>()
  for (const msg of messages) {
    if (!msg.parts) continue
    for (const part of msg.parts) {
      const toolCallId = part.toolCallId ?? part.toolInvocationId
      const output = part.output
      if (
        toolCallId &&
        output &&
        typeof output === 'object' &&
        typeof (output as Record<string, unknown>).jobId === 'string'
      ) {
        map.set(toolCallId, String((output as Record<string, unknown>).jobId))
      }
    }
  }
  return map
}

export function projectWorkerCardPlacements(
  messages: Array<{
    role?: string
    parts?: Array<{ type?: string; data?: unknown; output?: unknown }>
  }>,
  workerStates: Map<string, WorkerRunState>,
  terminalWorkerStates: Map<string, WorkerRunState>,
): WorkerCardPlacement[] {
  const firstMessageLocation = new Map<string, { messageIndex: number; partIndex: number }>()

  function recordFirst(msgIdx: number, partIdx: number, jobId: string) {
    if (!firstMessageLocation.has(jobId)) {
      firstMessageLocation.set(jobId, { messageIndex: msgIdx, partIndex: partIdx })
    }
  }

  messages.forEach((msg, mi) => {
    if (!msg.parts) return
    msg.parts.forEach((part, pi) => {
      if (part.type === 'data-worker-run' && part.data) {
        const data = part.data as { jobId?: string }
        if (typeof data.jobId === 'string') {
          recordFirst(mi, pi, data.jobId)
        }
      } else if (part.type?.startsWith('tool-') || part.type === 'dynamic-tool') {
        const output = part.output
        if (output && typeof output === 'object') {
          const value = output as Record<string, unknown>
          if (typeof value.jobId === 'string') {
            recordFirst(mi, pi, value.jobId)
          }
        }
      }
    })
  })

  const messagePlacements: WorkerCardPlacement[] = []
  const placedJobIds = new Set<string>()

  for (const [jobId, loc] of firstMessageLocation) {
    const state = workerStates.get(jobId) ?? terminalWorkerStates.get(jobId)
    if (!state) continue
    placedJobIds.add(jobId)
    messagePlacements.push({
      jobId,
      source: 'message',
      messageIndex: loc.messageIndex,
      partIndex: loc.partIndex,
      state,
    })
  }

  const livePlacements: WorkerCardPlacement[] = []

  for (const [jobId, state] of workerStates) {
    if (placedJobIds.has(jobId)) continue
    if (!isActiveWorkerStatus(state.status) && !state.snapshotHydrated) continue
    livePlacements.push({
      jobId,
      source: 'live',
      state,
    })
  }

  livePlacements.sort((a, b) => a.state.startedAt - b.state.startedAt)

  return [...messagePlacements, ...livePlacements]
}
