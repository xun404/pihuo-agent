import { workerHealthRank, type WorkerRegistration, type WorkerRole } from '@pihuo-agent/shared'

export interface SelectWorkerOptions {
  role?: WorkerRole
  workerIdOrKind?: string
  enabledOnly?: boolean
  /**
   * Prefer healthy workers within the match set (default true).
   * Explicit workerIdOrKind always wins regardless of health.
   */
  preferHealthy?: boolean
}

function sortByHealthThenPrimary(
  list: WorkerRegistration[],
  role?: WorkerRole,
): WorkerRegistration[] {
  return [...list].sort((a, b) => {
    const hr = workerHealthRank(b.health) - workerHealthRank(a.health)
    if (hr !== 0) return hr
    if (role) {
      const ap = a.primaryRole === role ? 1 : 0
      const bp = b.primaryRole === role ? 1 : 0
      if (bp !== ap) return bp - ap
    }
    return 0
  })
}

/**
 * Pure: pick the best worker for a role / id / kind.
 * Prefers exact id, then kind/name match, then primaryRole match, then any role match.
 * Within role matches, prefers healthier workers when preferHealthy is true.
 */
export function selectWorkerByRole(
  workers: WorkerRegistration[],
  opts: SelectWorkerOptions = {},
): WorkerRegistration | null {
  const enabledOnly = opts.enabledOnly !== false
  const preferHealthy = opts.preferHealthy !== false
  const list = enabledOnly ? workers.filter((w) => w.enabled) : workers
  if (list.length === 0) return null

  const key = opts.workerIdOrKind?.toLowerCase().trim()
  if (key) {
    // Explicit selection — respect user/leader force-pick even if unhealthy
    const byId = list.find((w) => w.id === opts.workerIdOrKind)
    if (byId) return byId
    const byKind = list.find((w) => w.kind === key)
    if (byKind) return byKind
    const byName = list.find((w) => w.name.toLowerCase().includes(key))
    if (byName) return byName
  }

  if (opts.role) {
    const role = opts.role
    const capable = list.filter((w) => w.primaryRole === role || w.roles.includes(role))
    if (capable.length === 0) return null
    if (!preferHealthy) {
      return capable.find((w) => w.primaryRole === role) ?? capable[0]!
    }
    const sorted = sortByHealthThenPrimary(capable, role)
    return sorted[0] ?? null
  }

  if (preferHealthy) {
    return sortByHealthThenPrimary(list)[0] ?? null
  }
  return list[0] ?? null
}

/**
 * Candidates for a role ordered by health (for fallback).
 */
export function listWorkersForRole(
  workers: WorkerRegistration[],
  role: WorkerRole,
  enabledOnly = true,
): WorkerRegistration[] {
  const list = enabledOnly ? workers.filter((w) => w.enabled) : workers
  const capable = list.filter((w) => w.primaryRole === role || w.roles.includes(role))
  return sortByHealthThenPrimary(capable, role)
}
