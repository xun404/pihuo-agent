import { spawn } from 'node:child_process'
import type {
  AcpHealth,
  CommandHealth,
  HealthProbeLevel,
  WorkerHealthReport,
  WorkerHealthStatus,
  WorkerKind,
  WorkerRegistration,
} from '@swarmdesk-agent/shared'
import { projectLegacyHealth } from '@swarmdesk-agent/shared'

export type ProbeDepth = 'presence' | 'version' | 'acp'

export interface ProbeOptions {
  /** Default `version` (= presence + capture version in one spawn) */
  level?: HealthProbeLevel | ProbeDepth
  timeoutMs?: number
  /** ACP handshake timeout (depth acp only) */
  acpTimeoutMs?: number
  cwd?: string
  env?: Record<string, string>
  /**
   * Test seam: inject spawn result instead of running a process.
   */
  runCommand?: (
    cmd: string,
    args: string[],
    opts: {
      cwd?: string
      env?: NodeJS.ProcessEnv
      timeoutMs: number
    },
  ) => Promise<SpawnProbeResult>
}

export interface SpawnProbeResult {
  exitCode: number | null
  signal?: NodeJS.Signals | null
  errorCode?: string
  stdout?: string
  stderr?: string
  timedOut?: boolean
}

const MAX_NODE_TIMER_MS = 2_147_483_647

export function resolveHealthTimeoutMs(raw: unknown, fallbackMs: number): number {
  const numeric = Number(raw)
  if (!Number.isFinite(numeric) || numeric <= 0) return fallbackMs
  return Math.min(Math.floor(numeric), MAX_NODE_TIMER_MS)
}

const DEFAULT_PROBE_MS = resolveHealthTimeoutMs(process.env.WORKER_HEALTH_PROBE_MS, 4_000)
const DEFAULT_ACP_MS = resolveHealthTimeoutMs(process.env.WORKER_HEALTH_ACP_MS, 12_000)

function normalizeLevel(raw: HealthProbeLevel | ProbeDepth | undefined): HealthProbeLevel {
  if (raw === 'acp' || raw === 'acp_handshake') return 'acp_handshake'
  if (raw === 'presence') return 'presence'
  return 'version'
}

export function healthHintsForKind(
  kind: WorkerKind | string,
  status: WorkerHealthStatus,
): string[] {
  const hints: string[] = []
  if (status === 'missing') {
    if (kind === 'claude' || kind === 'codex') {
      hints.push('Install Node.js so `npx` is on PATH.')
      hints.push('Then re-check health; the ACP package is downloaded on first use.')
    } else if (kind === 'opencode') {
      hints.push('Install OpenCode CLI and ensure `opencode` is on PATH.')
      hints.push('See https://opencode.ai/docs')
    } else {
      hints.push('Ensure the worker command is installed and available on PATH.')
    }
  } else if (status === 'unhealthy') {
    hints.push('Retry the check; if it keeps failing, verify the CLI auth / install.')
    if (kind === 'claude' || kind === 'codex') {
      hints.push('Confirm the CLI is logged in (provider credentials).')
    }
  }
  return hints
}

function trimOut(s: string | undefined, max = 200): string | undefined {
  if (!s) return undefined
  const t = s.replace(/\s+/g, ' ').trim()
  if (!t) return undefined
  return t.length > max ? `${t.slice(0, max)}…` : t
}

/**
 * Low-level spawn used by probes (and tests via injection).
 */
export function spawnProbeCommand(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs: number },
): Promise<SpawnProbeResult> {
  return new Promise((resolve) => {
    const timeoutMs = resolveHealthTimeoutMs(opts.timeoutMs, DEFAULT_PROBE_MS)
    const child = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      // Never shell:true — missing commands must surface as ENOENT, not exit 127
      shell: false,
      cwd: opts.cwd,
      env: opts.env ?? process.env,
    })

    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (c: Buffer) => {
      if (stdout.length < 4000) stdout += c.toString('utf8')
    })
    child.stderr?.on('data', (c: Buffer) => {
      if (stderr.length < 4000) stderr += c.toString('utf8')
    })

    let settled = false
    const finish = (result: SpawnProbeResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }

    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* ignore */
      }
      finish({
        exitCode: null,
        timedOut: true,
        stdout,
        stderr,
      })
    }, timeoutMs)

    child.on('error', (err: NodeJS.ErrnoException) => {
      finish({
        exitCode: null,
        errorCode: err.code ?? 'SPAWN_ERROR',
        stdout,
        stderr: stderr || err.message,
      })
    })

    child.on('exit', (code, signal) => {
      finish({
        exitCode: code,
        signal,
        stdout,
        stderr,
      })
    })
  })
}

function presenceArgs(worker: Pick<WorkerRegistration, 'command'>): {
  cmd: string
  args: string[]
} {
  const isNpx = worker.command === 'npx' || worker.command.endsWith('/npx')
  if (isNpx) return { cmd: 'npx', args: ['--version'] }
  // Prefer --version; many CLIs support it. Fallbacks handled by retry with --help.
  return { cmd: worker.command, args: ['--version'] }
}

/**
 * Probe worker command availability (+ optional short version capture).
 * Does not run the full ACP agent task.
 */
export async function probeWorkerHealth(
  worker: Pick<WorkerRegistration, 'command' | 'args' | 'kind' | 'env' | 'name'>,
  opts: ProbeOptions = {},
): Promise<WorkerHealthReport> {
  const level = normalizeLevel(opts.level)
  const timeoutMs = resolveHealthTimeoutMs(opts.timeoutMs, DEFAULT_PROBE_MS)
  const run = opts.runCommand ?? spawnProbeCommand
  const started = Date.now()
  // Whitelist ambient + worker env only — never full Leader process.env secrets
  const { buildEffectiveWorkerEnv } = await import('./worker-env.js')
  const env = {
    ...buildEffectiveWorkerEnv({
      ambientEnv: process.env,
      workerEnv: { ...worker.env, ...opts.env } as Record<string, string | undefined>,
      model: (worker as { model?: string }).model,
      // Network plumbing for enterprise proxies / TLS
      extraAmbientKeys: [
        'HTTP_PROXY',
        'HTTPS_PROXY',
        'http_proxy',
        'https_proxy',
        'NO_PROXY',
        'no_proxy',
        'SSL_CERT_FILE',
        'SSL_CERT_DIR',
        'NODE_EXTRA_CA_CERTS',
        'REQUESTS_CA_BUNDLE',
        'CURL_CA_BUNDLE',
      ],
    }),
  } as NodeJS.ProcessEnv

  // —— presence / version (single spawn path) ——
  const { cmd, args } = presenceArgs(worker)
  let result = await run(cmd, args, { cwd: opts.cwd, env, timeoutMs })

  // Retry bare binaries with --help when --version fails with non-0/1 or "unknown option"
  const isNpx = worker.command === 'npx' || worker.command.endsWith('/npx')
  if (
    !isNpx &&
    !result.timedOut &&
    !result.errorCode &&
    result.exitCode !== 0 &&
    result.exitCode !== 1
  ) {
    result = await run(worker.command, ['--help'], { cwd: opts.cwd, env, timeoutMs })
  }

  const latencyMs = Date.now() - started
  const checkedAt = new Date().toISOString()

  if (result.errorCode === 'ENOENT' || result.errorCode === 'SPAWN_ERROR') {
    const status: WorkerHealthStatus = 'missing'
    return {
      status,
      level: 'presence',
      checkedAt,
      latencyMs,
      message: `Command not found: ${worker.command}`,
      hints: healthHintsForKind(worker.kind, status),
      detail: {
        errorCode: result.errorCode,
        stderrTail: trimOut(result.stderr, 300),
      },
    }
  }

  if (result.timedOut) {
    const status: WorkerHealthStatus = 'unhealthy'
    return {
      status,
      level: 'presence',
      checkedAt,
      latencyMs,
      message: `Health probe timed out after ${timeoutMs}ms`,
      hints: healthHintsForKind(worker.kind, status),
      detail: { exitCode: null, stderrTail: trimOut(result.stderr, 300) },
    }
  }

  if (result.exitCode !== 0 && result.exitCode !== 1) {
    const status: WorkerHealthStatus = 'unhealthy'
    return {
      status,
      level: 'presence',
      checkedAt,
      latencyMs,
      message: `Command exited with code ${result.exitCode ?? 'null'}`,
      hints: healthHintsForKind(worker.kind, status),
      detail: {
        exitCode: result.exitCode,
        stderrTail: trimOut(result.stderr, 300),
      },
    }
  }

  // presence OK
  if (level === 'presence') {
    return {
      status: 'healthy',
      level: 'presence',
      checkedAt,
      latencyMs,
      message: 'Command is available on PATH',
      hints: [],
      detail: { exitCode: result.exitCode },
    }
  }

  const version = trimOut(result.stdout ?? result.stderr, 120)

  // —— optional ACP process-start probe (NOT a full initialize/session handshake) ——
  // Design: acpHealth ready only comes from real ACP initialize/session/config/prompt.
  // This probe only proves the binary can spawn; map to command-level healthy + note.
  if (level === 'acp_handshake') {
    const acpTimeout = resolveHealthTimeoutMs(opts.acpTimeoutMs, DEFAULT_ACP_MS)
    const acpStarted = Date.now()
    const acpResult = await run(worker.command, [...worker.args], {
      cwd: opts.cwd,
      env,
      timeoutMs: acpTimeout,
    })
    const acpLatency = Date.now() - acpStarted

    if (acpResult.errorCode === 'ENOENT' || acpResult.errorCode === 'SPAWN_ERROR') {
      return {
        status: 'missing',
        level: 'acp_handshake',
        checkedAt: new Date().toISOString(),
        latencyMs: latencyMs + acpLatency,
        message: `Failed to start ACP worker: ${worker.command} ${worker.args.join(' ')}`,
        version,
        hints: healthHintsForKind(worker.kind, 'missing'),
        detail: {
          errorCode: acpResult.errorCode,
          stderrTail: trimOut(acpResult.stderr, 300),
        },
      }
    }

    // Process spawn-only probe: healthy means command can start, not ACP ready.
    if (acpResult.timedOut || acpResult.exitCode === 0 || acpResult.exitCode === 1) {
      return {
        status: 'healthy',
        level: 'acp_handshake',
        checkedAt: new Date().toISOString(),
        latencyMs: latencyMs + acpLatency,
        message:
          'ACP process spawn probe ok (command-level only; acpHealth ready requires real session)',
        version,
        hints: ['acpHealth is updated only after initialize/session/config/prompt'],
        detail: {
          exitCode: acpResult.timedOut ? null : acpResult.exitCode,
          probeKind: 'spawn_only',
        },
      }
    }

    return {
      status: 'unhealthy',
      level: 'acp_handshake',
      checkedAt: new Date().toISOString(),
      latencyMs: latencyMs + acpLatency,
      message: `ACP process exited early with code ${acpResult.exitCode ?? 'null'} (command-level only)`,
      version,
      hints: healthHintsForKind(worker.kind, 'unhealthy'),
      detail: {
        exitCode: acpResult.exitCode,
        stderrTail: trimOut(acpResult.stderr, 300),
        probeKind: 'spawn_only',
      },
    }
  }

  // version level success
  return {
    status: 'healthy',
    level: 'version',
    checkedAt,
    latencyMs,
    message: version ? `Available (${version})` : 'Command is available on PATH',
    version,
    hints: [],
    detail: { exitCode: result.exitCode },
  }
}

const HARD_ACP_ERROR_CODES = new Set([
  'ENOENT',
  'EACCES',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'SPAWN_ERROR',
  'ACP_INIT',
  'ACP_UNAVAILABLE',
  'ACP_SPAWN',
])

const HARD_ACP_ERROR_RE =
  /enoent|eacces|econnrefused|econnreset|etimedout|spawn|failed to start|initialize|init(?:ialize)?\s*(?:fail|error|timeout)|connection refused|not found on path|command not found/i

/**
 * Classify hard ACP unavailability (connection/spawn/init) vs soft/partial failures.
 */
export function isHardAcpJobFailure(errorCode?: string, error?: string): boolean {
  const code = (errorCode ?? '').trim().toUpperCase()
  if (code && HARD_ACP_ERROR_CODES.has(code)) return true
  return HARD_ACP_ERROR_RE.test(`${errorCode ?? ''} ${error ?? ''}`)
}

/**
 * Map a dispatch/job terminal outcome onto acpHealth (§7.1).
 * - success → ready + lastSuccessAt
 * - hard ACP unavailability → unavailable + errorCode
 * - soft/partial → degraded
 */
export function acpHealthFromJobOutcome(
  status: 'succeeded' | 'failed',
  opts?: {
    nowMs?: number
    errorCode?: string
    error?: string
    lastSuccessAt?: string
  },
): AcpHealth {
  const checkedAt = new Date(opts?.nowMs ?? Date.now()).toISOString()
  if (status === 'succeeded') {
    return {
      status: 'ready',
      checkedAt,
      lastSuccessAt: checkedAt,
    }
  }
  if (isHardAcpJobFailure(opts?.errorCode, opts?.error)) {
    return {
      status: 'unavailable',
      checkedAt,
      lastSuccessAt: opts?.lastSuccessAt,
      errorCode: opts?.errorCode ?? 'ACP_UNAVAILABLE',
    }
  }
  return {
    status: 'degraded',
    checkedAt,
    lastSuccessAt: opts?.lastSuccessAt,
    errorCode: opts?.errorCode,
  }
}

/**
 * Apply a health report onto a worker registration (immutable).
 * Sets commandHealth / acpHealth (and legacy cliHealth / acpSessionHealth) by probe level:
 * - presence/version → commandHealth
 * - acp_handshake → acpHealth (ready/degraded/unavailable) + command when known
 * - presence missing → both missing/unavailable
 */
export function applyHealthReport(
  worker: WorkerRegistration,
  report: WorkerHealthReport,
): WorkerRegistration {
  const { status, level } = report
  const base = projectLegacyHealth(worker)
  let commandHealth: CommandHealth = {
    status: base.commandHealth.status,
    checkedAt: base.commandHealth.checkedAt,
  }
  let acpHealth: AcpHealth = {
    status: base.acpHealth.status,
    checkedAt: base.acpHealth.checkedAt,
    lastSuccessAt: base.acpHealth.lastSuccessAt,
    errorCode: base.acpHealth.errorCode,
  }

  if (level === 'presence' || level === 'version') {
    if (status === 'healthy') {
      commandHealth = { status: 'healthy', checkedAt: report.checkedAt }
    } else if (status === 'missing') {
      commandHealth = { status: 'missing', checkedAt: report.checkedAt }
      acpHealth = {
        status: 'unavailable',
        checkedAt: report.checkedAt,
        lastSuccessAt: acpHealth.lastSuccessAt,
        errorCode: report.detail?.errorCode,
      }
    } else if (status === 'unhealthy') {
      commandHealth = { status: 'unhealthy', checkedAt: report.checkedAt }
    }
  } else if (level === 'acp_handshake') {
    // Spawn-only probe updates commandHealth; acpHealth ready only from real session outcomes.
    const spawnOnly = report.detail?.probeKind === 'spawn_only'
    if (status === 'healthy') {
      commandHealth = { status: 'healthy', checkedAt: report.checkedAt }
      if (!spawnOnly) {
        acpHealth = {
          status: 'ready',
          checkedAt: report.checkedAt,
          lastSuccessAt: report.checkedAt,
        }
      }
      // spawn_only: leave acpHealth unchanged (unknown until real ACP boundary)
    } else if (status === 'missing') {
      commandHealth = { status: 'missing', checkedAt: report.checkedAt }
      acpHealth = {
        status: 'unavailable',
        checkedAt: report.checkedAt,
        lastSuccessAt: acpHealth.lastSuccessAt,
        errorCode: report.detail?.errorCode,
      }
    } else if (status === 'unhealthy') {
      if (commandHealth.status !== 'missing') {
        commandHealth = { status: 'healthy', checkedAt: report.checkedAt }
      }
      if (!spawnOnly) {
        acpHealth = {
          status: 'degraded',
          checkedAt: report.checkedAt,
          lastSuccessAt: acpHealth.lastSuccessAt,
          errorCode: report.detail?.errorCode,
        }
      }
    }
  }

  const projected = projectLegacyHealth({
    ...worker,
    commandHealth,
    acpHealth,
  })

  return {
    ...worker,
    ...projected,
    lastSeenAt: report.checkedAt,
    healthReport: report,
  }
}

/**
 * Back-compat wrapper: old API returned only status string.
 */
export async function checkWorkerCommand(
  worker: Pick<WorkerRegistration, 'command' | 'args' | 'kind' | 'env' | 'name'>,
  timeoutMs = DEFAULT_PROBE_MS,
): Promise<WorkerHealthStatus> {
  const report = await probeWorkerHealth(worker, { level: 'version', timeoutMs })
  return report.status
}

export function parseHealthDepth(raw: unknown): ProbeDepth {
  if (raw === 'presence' || raw === 'version' || raw === 'acp') return raw
  if (raw === 'acp_handshake') return 'acp'
  return 'version'
}
