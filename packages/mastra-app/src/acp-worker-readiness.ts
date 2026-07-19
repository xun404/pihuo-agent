/**
 * Worker readiness gates for Scheduler / API.
 * ready|degraded may dispatch; auth_required / incompatible / failed hard-block.
 */
import type {
  WorkerReadiness,
  WorkerReadinessStatus,
  WorkerRegistration,
} from '@swarmdesk-agent/shared'

const DISPATCHABLE: ReadonlySet<WorkerReadinessStatus> = new Set(['ready', 'degraded'])

/** Hard gates that even force cannot bypass. */
const HARD_BLOCK: ReadonlySet<WorkerReadinessStatus> = new Set([
  'auth_required',
  'authenticating',
  'incompatible',
  'failed',
  'cataloged',
  'preparing',
  'prepared',
  'initializing',
])

export type ReadinessGateResult =
  | { ok: true }
  | {
      ok: false
      code: string
      message: string
      status: WorkerReadinessStatus
      nextAction?: WorkerReadiness['nextAction']
    }

/**
 * Decide whether a Worker may receive a Job.
 * @param force — allows degraded only; never bypasses auth/protocol hard gates.
 */
export function evaluateWorkerReadinessGate(
  worker: Pick<WorkerRegistration, 'enabled' | 'readiness' | 'name' | 'id'>,
  opts: { force?: boolean } = {},
): ReadinessGateResult {
  if (!worker.enabled) {
    return {
      ok: false,
      code: 'WORKER_NOT_READY',
      message: `Worker ${worker.name} is disabled`,
      status: worker.readiness?.status ?? 'failed',
    }
  }

  const readiness = worker.readiness
  // Legacy workers without readiness: allow (pre-Registry path)
  if (!readiness) return { ok: true }

  if (DISPATCHABLE.has(readiness.status)) return { ok: true }

  if (opts.force && readiness.status === 'degraded') return { ok: true }

  if (HARD_BLOCK.has(readiness.status) || !DISPATCHABLE.has(readiness.status)) {
    const code =
      readiness.code ??
      (readiness.status === 'auth_required' ? 'WORKER_AUTH_REQUIRED' : 'WORKER_NOT_READY')
    return {
      ok: false,
      code,
      message: readiness.message ?? `Worker ${worker.name} is not ready (${readiness.status})`,
      status: readiness.status,
      nextAction: readiness.nextAction,
    }
  }

  return { ok: true }
}

export function isWorkerDispatchable(
  worker: Pick<WorkerRegistration, 'enabled' | 'readiness' | 'name' | 'id'>,
  opts: { force?: boolean } = {},
): boolean {
  return evaluateWorkerReadinessGate(worker, opts).ok
}

export function bumpAuthRevision(current: number | undefined): number {
  return (current ?? 0) + 1
}

export function applyReadinessToWorker(
  worker: WorkerRegistration,
  readiness: WorkerReadiness,
  extras?: Partial<Pick<WorkerRegistration, 'capabilitySummary' | 'authRevision'>>,
): WorkerRegistration {
  return {
    ...worker,
    readiness,
    ...(extras?.capabilitySummary ? { capabilitySummary: extras.capabilitySummary } : {}),
    ...(extras?.authRevision !== undefined ? { authRevision: extras.authRevision } : {}),
  }
}
