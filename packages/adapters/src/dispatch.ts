import type { WorkerHealthReport, WorkerRegistration, WorkerRole } from '@pihuo-agent/shared'
import { buildAcpSpawnConfig, type AcpSpawnConfig } from './acp-config.js'
import { selectWorkerByRole } from './select-worker.js'

export type DispatchMode = 'acp' | 'planned_unavailable' | 'error' | 'mock'

export interface DispatchRequest {
  workers: WorkerRegistration[]
  role?: WorkerRole
  workerIdOrKind?: string
  task: string
  cwd?: string
  /** Prefer healthy workers when selecting by role (default true) */
  preferHealthy?: boolean
  /** Injected for tests: whether ACP can run for this config */
  canRunAcp?: (config: AcpSpawnConfig) => boolean | Promise<boolean>
  /**
   * Injected runner for live ACP. When canRunAcp is true and this is set,
   * result mode becomes `acp` on success.
   */
  runAcp?: (
    config: AcpSpawnConfig,
    task: string,
  ) => Promise<{ ok: boolean; output?: string; error?: string }>
}

export interface DispatchResult {
  ok: boolean
  mode: DispatchMode
  workerName: string
  workerId?: string
  primaryRole?: string
  roles?: string[]
  requestedRole?: WorkerRole
  command: string
  args: string[]
  cwd: string
  task: string
  message: string
  output?: string
  /** True when path would use ACP adapter via SDK 1.2.1 */
  acpPath: boolean
  /** Worker health at dispatch time */
  health?: string
  healthReport?: WorkerHealthReport
  /** Set when user forced a non-healthy worker */
  healthWarning?: string
}

function healthSuffix(worker: WorkerRegistration): string {
  const r = worker.healthReport
  if (!r) return `health=${worker.health}`
  const parts = [`health=${r.status}`]
  if (r.message) parts.push(r.message)
  if (r.hints?.length) parts.push(`hints: ${r.hints.join('; ')}`)
  return parts.join(' — ')
}

/**
 * Pure orchestration for worker dispatch with ACP gate.
 * - Selects worker by role/id
 * - Builds ACP spawn config (always references ACP path structure)
 * - If canRunAcp false → ok:false, mode planned_unavailable (not silent success)
 * - If canRunAcp true and runAcp provided → live ACP
 */
export async function dispatchToWorker(req: DispatchRequest): Promise<DispatchResult> {
  const forced = Boolean(req.workerIdOrKind?.trim())
  const worker = selectWorkerByRole(req.workers, {
    role: req.role,
    workerIdOrKind: req.workerIdOrKind,
    preferHealthy: req.preferHealthy !== false,
  })

  if (!worker) {
    return {
      ok: false,
      mode: 'error',
      workerName: req.workerIdOrKind ?? req.role ?? 'unknown',
      requestedRole: req.role,
      command: '',
      args: [],
      cwd: req.cwd ?? process.cwd(),
      task: req.task,
      message: `No enabled worker matched role/id. Requested role=${req.role ?? '—'} idOrKind=${req.workerIdOrKind ?? '—'}.`,
      acpPath: true,
    }
  }

  const healthWarning =
    forced && (worker.health === 'missing' || worker.health === 'unhealthy')
      ? `Forced worker is ${worker.health}: ${worker.healthReport?.message ?? healthSuffix(worker)}`
      : undefined

  const config = buildAcpSpawnConfig(worker, req.cwd)
  const canRun = req.canRunAcp ? await req.canRunAcp(config) : false

  const healthFields = {
    health: worker.health,
    healthReport: worker.healthReport,
    healthWarning,
  }

  if (!canRun) {
    return {
      ok: false,
      mode: 'planned_unavailable',
      workerName: worker.name,
      workerId: worker.id,
      primaryRole: worker.primaryRole,
      roles: worker.roles,
      requestedRole: req.role,
      command: config.command,
      args: config.args,
      cwd: config.cwd,
      task: req.task,
      message: `ACP unavailable for ${worker.name} (${healthSuffix(worker)}). Would run: ${config.command} ${config.args.join(' ')} (cwd=${config.cwd}). ${worker.healthReport?.hints?.join(' ') ?? 'Install/authenticate the CLI worker, then re-check health.'}`,
      acpPath: true,
      ...healthFields,
    }
  }

  if (!req.runAcp) {
    return {
      ok: false,
      mode: 'planned_unavailable',
      workerName: worker.name,
      workerId: worker.id,
      primaryRole: worker.primaryRole,
      roles: worker.roles,
      requestedRole: req.role,
      command: config.command,
      args: config.args,
      cwd: config.cwd,
      task: req.task,
      message: `ACP runner not wired for ${worker.name} despite canRunAcp=true.`,
      acpPath: true,
      ...healthFields,
    }
  }

  try {
    const result = await req.runAcp(config, req.task)
    if (!result.ok) {
      return {
        ok: false,
        mode: 'error',
        workerName: worker.name,
        workerId: worker.id,
        primaryRole: worker.primaryRole,
        roles: worker.roles,
        requestedRole: req.role,
        command: config.command,
        args: config.args,
        cwd: config.cwd,
        task: req.task,
        message: result.error ?? `ACP execution failed for ${worker.name}`,
        output: result.output,
        acpPath: true,
        ...healthFields,
      }
    }
    return {
      ok: true,
      mode: 'acp',
      workerName: worker.name,
      workerId: worker.id,
      primaryRole: worker.primaryRole,
      roles: worker.roles,
      requestedRole: req.role,
      command: config.command,
      args: config.args,
      cwd: config.cwd,
      task: req.task,
      message: `ACP dispatch completed via @agentclientprotocol/sdk for ${worker.name}${healthWarning ? ` (warning: ${healthWarning})` : ''}`,
      output: result.output,
      acpPath: true,
      ...healthFields,
    }
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e)
    return {
      ok: false,
      mode: 'error',
      workerName: worker.name,
      workerId: worker.id,
      primaryRole: worker.primaryRole,
      roles: worker.roles,
      requestedRole: req.role,
      command: config.command,
      args: config.args,
      cwd: config.cwd,
      task: req.task,
      message: `ACP error: ${err}`,
      acpPath: true,
      ...healthFields,
    }
  }
}
