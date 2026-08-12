import type { WorkerRole } from './contracts/roles.js'
import type {
  AcpHealth,
  AcpHealthStatus,
  CommandHealth,
  CommandHealthStatus,
  WorkerHealthReport,
  WorkerHealthStatus,
  WorkerRegistration,
} from './contracts/worker.js'

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

function commandStatusToLegacy(status: CommandHealthStatus): WorkerHealthStatus {
  return status
}

function legacyToCommandStatus(status: WorkerHealthStatus): CommandHealthStatus {
  return status
}

function acpStatusToLegacy(status: AcpHealthStatus): WorkerHealthStatus {
  switch (status) {
    case 'ready':
      return 'healthy'
    case 'degraded':
      return 'unhealthy'
    case 'unavailable':
      return 'missing'
    default:
      return 'unknown'
  }
}

function legacyToAcpStatus(status: WorkerHealthStatus): AcpHealthStatus {
  switch (status) {
    case 'healthy':
      return 'ready'
    case 'unhealthy':
      return 'degraded'
    case 'missing':
      return 'unavailable'
    default:
      return 'unknown'
  }
}

/**
 * Bidirectionally project commandHealth ↔ cliHealth, acpHealth ↔ acpSessionHealth.
 * `health` is the worst of the two legacy statuses.
 */
export function projectLegacyHealth<T extends Partial<WorkerRegistration>>(
  worker: T,
): T & {
  health: WorkerHealthStatus
  cliHealth: WorkerHealthStatus
  acpSessionHealth: WorkerHealthStatus
  commandHealth: CommandHealth
  acpHealth: AcpHealth
} {
  const fallbackStatus: WorkerHealthStatus =
    worker.health ?? worker.healthReport?.status ?? 'unknown'
  const checkedAt =
    worker.commandHealth?.checkedAt ??
    worker.acpHealth?.checkedAt ??
    worker.healthReport?.checkedAt ??
    worker.lastSeenAt

  // Design: legacy `health` is command input only — never projected as ACP ready.
  let commandStatus: CommandHealthStatus
  if (worker.commandHealth?.status) {
    commandStatus = worker.commandHealth.status
  } else if (worker.cliHealth) {
    commandStatus = legacyToCommandStatus(worker.cliHealth)
  } else {
    commandStatus = legacyToCommandStatus(fallbackStatus)
  }

  let acpStatus: AcpHealthStatus
  if (worker.acpHealth?.status) {
    acpStatus = worker.acpHealth.status
  } else if (worker.acpSessionHealth) {
    acpStatus = legacyToAcpStatus(worker.acpSessionHealth)
  } else {
    // Without explicit ACP fields, stay unknown (do not copy command health into ACP)
    acpStatus = 'unknown'
  }

  const cliHealth = commandStatusToLegacy(commandStatus)
  const acpSessionHealth = acpStatusToLegacy(acpStatus)
  // Aggregate display health prefers command; ACP unknown does not mark unhealthy
  const health = acpStatus === 'unknown' ? cliHealth : worstHealth(cliHealth, acpSessionHealth)

  const commandHealth: CommandHealth = {
    status: commandStatus,
    checkedAt: worker.commandHealth?.checkedAt ?? checkedAt,
  }
  const acpHealth: AcpHealth = {
    status: acpStatus,
    checkedAt: worker.acpHealth?.checkedAt ?? checkedAt,
    lastSuccessAt: worker.acpHealth?.lastSuccessAt,
    errorCode: worker.acpHealth?.errorCode,
  }

  return {
    ...worker,
    cliHealth,
    acpSessionHealth,
    commandHealth,
    acpHealth,
    health,
  }
}

/** Ensure health + healthReport are consistent for migrated store rows. */
export function normalizeWorkerHealth<T extends Partial<WorkerRegistration>>(
  worker: T,
): T & {
  health: WorkerHealthStatus
  cliHealth: WorkerHealthStatus
  acpSessionHealth: WorkerHealthStatus
  commandHealth: CommandHealth
  acpHealth: AcpHealth
} {
  const projected = projectLegacyHealth(worker)
  // healthReport is diagnostic only — must not override computed aggregate health
  const report =
    worker.healthReport ??
    (worker.health || worker.lastSeenAt || worker.commandHealth || worker.acpHealth
      ? {
          status: projected.health,
          level: 'presence' as const,
          checkedAt:
            projected.commandHealth.checkedAt ?? worker.lastSeenAt ?? new Date(0).toISOString(),
          message: projected.health === 'unknown' ? 'Not checked yet' : undefined,
        }
      : undefined)
  return {
    ...projected,
    // Keep projected aggregate; report status is informational only
    health: projected.health,
    healthReport: report ? { ...report, status: projected.health } : report,
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

/** CLI command health TTL (5 minutes). */
export const COMMAND_HEALTH_TTL_MS = 5 * 60 * 1000

/** ACP boundary health TTL (15 minutes). */
export const ACP_HEALTH_TTL_MS = 15 * 60 * 1000

function isTimestampFresh(
  checkedAt: string | undefined,
  ttlMs: number,
  nowMs = Date.now(),
): boolean {
  if (!checkedAt) return false
  const t = Date.parse(checkedAt)
  if (!Number.isFinite(t)) return false
  return nowMs - t < ttlMs
}

export function isHealthReportFresh(
  report: WorkerHealthReport | undefined,
  ttlMs = WORKER_HEALTH_TTL_MS,
  nowMs = Date.now(),
): boolean {
  return isTimestampFresh(report?.checkedAt, ttlMs, nowMs)
}

export function isCommandHealthFresh(
  health: CommandHealth | undefined,
  nowMs = Date.now(),
  ttlMs = COMMAND_HEALTH_TTL_MS,
): boolean {
  return isTimestampFresh(health?.checkedAt, ttlMs, nowMs)
}

export function isAcpHealthFresh(
  health: AcpHealth | undefined,
  nowMs = Date.now(),
  ttlMs = ACP_HEALTH_TTL_MS,
): boolean {
  return isTimestampFresh(health?.checkedAt, ttlMs, nowMs)
}

/**
 * Non-force dispatch skip rules (§7.1):
 * - fresh commandHealth missing/unhealthy → skip
 * - fresh acpHealth unavailable → skip
 * - degraded or expired ACP → allow try
 */
export function shouldSkipWorkerDispatch(
  worker: Partial<WorkerRegistration>,
  opts?: { forced?: boolean; now?: number },
): boolean {
  if (opts?.forced) return false
  const nowMs = opts?.now ?? Date.now()
  const projected = projectLegacyHealth(worker)
  if (
    isCommandHealthFresh(projected.commandHealth, nowMs) &&
    (projected.commandHealth.status === 'missing' || projected.commandHealth.status === 'unhealthy')
  ) {
    return true
  }
  if (
    isAcpHealthFresh(projected.acpHealth, nowMs) &&
    projected.acpHealth.status === 'unavailable'
  ) {
    return true
  }
  return false
}

/**
 * Default TTL for considering a model cache entry fresh (30 minutes).
 * After this period, models are considered stale and should be refreshed.
 */
export const WORKER_MODELS_TTL_MS = 30 * 60 * 1000

/** Returns the worst (least healthy) of two health statuses. */
function worstHealth(a: WorkerHealthStatus, b: WorkerHealthStatus): WorkerHealthStatus {
  const rank: Record<WorkerHealthStatus, number> = {
    healthy: 0,
    unknown: 1,
    unhealthy: 2,
    missing: 3,
  }
  return rank[a] >= rank[b] ? a : b
}

/**
 * Check whether a model cache timestamp is still within the TTL.
 */
export function isModelCacheFresh(
  modelsFetchedAt: string | undefined,
  ttlMs = WORKER_MODELS_TTL_MS,
  nowMs = Date.now(),
): boolean {
  return isTimestampFresh(modelsFetchedAt, ttlMs, nowMs)
}
