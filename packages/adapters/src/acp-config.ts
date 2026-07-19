import type { WorkerModelOption, WorkerRegistration } from '@router-agents/shared'
import { resolveEligibilityCandidates } from './model-eligibility.js'
import { resolveWorkerCwd } from './presets.js'

export interface AcpSpawnConfig {
  command: string
  args: string[]
  cwd: string
  env: Record<string, string>
  workerId: string
  workerName: string
  kind: WorkerRegistration['kind']
  primaryRole: WorkerRegistration['primaryRole']
  roles: WorkerRegistration['roles']
  /** ACP session model (session/set_config_option) */
  model?: string
  /** Cached ACP candidates for execute-time eligibility (omit = pin as-is) */
  availableModels?: WorkerModelOption[]
}

/**
 * Pure: build ACP spawn configuration from a worker registration.
 * Used by live dispatch and tests — no process spawn.
 * Pass catalog.searchIndex via opts so execute eligibility matches pin/search.
 */
export function buildAcpSpawnConfig(
  worker: WorkerRegistration,
  projectRoot?: string,
  envExtra?: Record<string, string>,
  opts?: { searchIndex?: WorkerModelOption[] | null },
): AcpSpawnConfig {
  const cwd = resolveWorkerCwd(projectRoot)
  const eligibilityCandidates = resolveEligibilityCandidates(worker, {
    searchIndex: opts?.searchIndex,
  })
  return {
    command: worker.command,
    args: [...worker.args],
    cwd,
    // This is the explicit worker boundary. Ambient PATH/HOME and model-scoped
    // credentials are added only by the spawn layer's sanitizer.
    env: { ...worker.env, ...envExtra } as Record<string, string>,
    workerId: worker.id,
    workerName: worker.name,
    kind: worker.kind,
    primaryRole: worker.primaryRole,
    roles: [...worker.roles],
    model: worker.model?.trim() || undefined,
    availableModels: eligibilityCandidates,
  }
}
