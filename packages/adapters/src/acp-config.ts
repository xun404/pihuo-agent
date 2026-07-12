import type { WorkerRegistration } from '@router-agents/shared'
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
  /** ACP session model (session/set_model) */
  model?: string
}

/**
 * Pure: build ACP spawn configuration from a worker registration.
 * Used by live dispatch and tests — no process spawn.
 */
export function buildAcpSpawnConfig(
  worker: WorkerRegistration,
  projectRoot?: string,
  envExtra?: Record<string, string>,
): AcpSpawnConfig {
  const cwd = resolveWorkerCwd(projectRoot)
  return {
    command: worker.command,
    args: [...worker.args],
    cwd,
    env: { ...process.env, ...worker.env, ...envExtra } as Record<string, string>,
    workerId: worker.id,
    workerName: worker.name,
    kind: worker.kind,
    primaryRole: worker.primaryRole,
    roles: [...worker.roles],
    model: worker.model?.trim() || undefined,
  }
}
