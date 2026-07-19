/**
 * Resolve trusted absolute paths for npx/uvx runners. Never uses shell:true.
 */
import { accessSync, constants, realpathSync, statSync } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path'
import { execFileSync } from 'node:child_process'

export type AcpRunnerKind = 'npx' | 'uvx'

export interface ResolvedRunner {
  kind: AcpRunnerKind
  command: string
  version?: string
}

export class AcpRunnerError extends Error {
  readonly code = 'ACP_RUNNER_MISSING'
  constructor(
    readonly runner: AcpRunnerKind,
    message: string,
    readonly hint?: string,
  ) {
    super(message)
    this.name = 'AcpRunnerError'
  }
}

function pathEntries(envPath = process.env.PATH ?? ''): string[] {
  return envPath.split(delimiter).filter(Boolean)
}

function candidateNames(kind: AcpRunnerKind, platform = process.platform): string[] {
  if (platform === 'win32') {
    return kind === 'npx' ? ['npx.cmd', 'npx.exe', 'npx'] : ['uvx.exe', 'uvx.cmd', 'uvx']
  }
  return [kind]
}

function executableRealPath(path: string, platform: NodeJS.Platform): string | null {
  try {
    const resolved = realpathSync(path)
    if (!statSync(resolved).isFile()) return null
    accessSync(resolved, platform === 'win32' ? constants.F_OK : constants.X_OK)
    return resolved
  } catch {
    return null
  }
}

/**
 * Resolve runner to an absolute path from PATH. Does not modify PATH.
 */
export function resolveRunnerAbsolutePath(
  kind: AcpRunnerKind,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const names = candidateNames(kind, platform)
  for (const dir of pathEntries(env.PATH)) {
    for (const name of names) {
      const full = join(dir, name)
      if (!isAbsolute(full)) continue
      const resolved = executableRealPath(full, platform)
      if (resolved) return resolved
    }
  }
  return null
}

export function resolveRunnerVersion(
  absoluteCommand: string,
  kind: AcpRunnerKind,
): string | undefined {
  try {
    const args = kind === 'npx' ? ['--version'] : ['--version']
    const out = execFileSync(absoluteCommand, args, {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return out.trim().split('\n')[0]?.trim()
  } catch {
    return undefined
  }
}

export function resolveAcpRunner(
  kind: AcpRunnerKind,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedRunner {
  const command = resolveRunnerAbsolutePath(kind, env)
  if (!command) {
    const hint =
      kind === 'npx'
        ? 'Install Node.js 22+ so `npx` is on PATH: https://nodejs.org/'
        : 'Install uv (provides `uvx`): https://docs.astral.sh/uv/'
    throw new AcpRunnerError(kind, `ACP runner missing: ${kind} not found on PATH`, hint)
  }
  const version = resolveRunnerVersion(command, kind)
  if (!version) {
    throw new AcpRunnerError(
      kind,
      `ACP runner version could not be verified: ${kind}`,
      'Check that the runner can execute and report --version',
    )
  }
  return {
    kind,
    command,
    version,
  }
}

/** Build argv for package agents: runner prefix + package + agent args. */
export function buildPackageAgentArgv(input: {
  kind: 'npx' | 'uvx'
  packageSpec: string
  agentArgs?: string[]
  runner?: ResolvedRunner
  env?: NodeJS.ProcessEnv
}): { command: string; args: string[]; runner: ResolvedRunner } {
  const runner = input.runner ?? resolveAcpRunner(input.kind, input.env)
  if (input.kind === 'npx') {
    return {
      command: runner.command,
      args: ['--yes', input.packageSpec, ...(input.agentArgs ?? [])],
      runner,
    }
  }
  return {
    command: runner.command,
    args: [input.packageSpec, ...(input.agentArgs ?? [])],
    runner,
  }
}
