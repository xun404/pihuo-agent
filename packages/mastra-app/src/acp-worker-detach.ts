/**
 * Detach / uninstall helpers for Registry workers.
 * Deleting a Worker never cascade-deletes installations still referenced by
 * other Workers or still needed for recovery.
 */
import {
  removeWorkerReference,
  listUnreferencedInstallations,
  markInstallationRemoved,
  findInstallationById,
  type AcpAgentInstallationRecord,
} from '@swarmdesk-agent/core'
import type { WorkerRegistration } from '@swarmdesk-agent/shared'

export type DetachWorkerResult = {
  workerId: string
  installationId?: string
  /** Installation still has other worker refs or was never managed. */
  installationRetained: boolean
  /** Only true when explicitly requested AND unreferenced. */
  installationMarkedRemoved: boolean
}

/**
 * Drop Worker → installation reference. Does not delete install files.
 * @param removeUnreferencedInstallation — if true and no remaining refs, mark removed.
 */
export function detachWorkerFromInstallation(input: {
  worker: WorkerRegistration
  removeUnreferencedInstallation?: boolean
  referencedInstallationIds?: ReadonlySet<string>
}): DetachWorkerResult {
  const installationId =
    input.worker.installationId ??
    (input.worker.source?.type === 'registry' ? input.worker.source.installationId : undefined)

  if (!installationId) {
    return {
      workerId: input.worker.id,
      installationRetained: true,
      installationMarkedRemoved: false,
    }
  }

  removeWorkerReference(installationId, input.worker.id)
  const still = findInstallationById(installationId)
  const hasRefs = Boolean(still && still.workerIds.length > 0)
  const hasSessionRefs = Boolean(input.referencedInstallationIds?.has(installationId))

  let installationMarkedRemoved = false
  if (input.removeUnreferencedInstallation && still && !hasRefs && !hasSessionRefs) {
    markInstallationRemoved(installationId)
    installationMarkedRemoved = true
  }

  return {
    workerId: input.worker.id,
    installationId,
    installationRetained: hasRefs || hasSessionRefs || !installationMarkedRemoved,
    installationMarkedRemoved,
  }
}

/** List cleanup candidates only (never auto-delete). */
export function listInstallationCleanupCandidates(): AcpAgentInstallationRecord[] {
  return listUnreferencedInstallations()
}
