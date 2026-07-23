import { createHash } from 'node:crypto'
import { accessSync, constants, realpathSync, statSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import type { LocalStore } from '@swarmdesk-agent/core'
import { createId, getSharedStore } from '@swarmdesk-agent/core'
import {
  buildEffectiveWorkerEnv,
  probeSpawnedAgent,
  whichSync,
  type CapabilityProbeResult,
  type SpawnedAcpSetupInput,
} from '@swarmdesk-agent/adapters'
import type {
  CustomAcpRegistrationInput,
  WorkerLaunchSpec,
  WorkerRegistration,
} from '@swarmdesk-agent/shared'

export class CustomAcpRegistrationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'CustomAcpRegistrationError'
  }
}

export interface CustomAcpRegistrationDeps {
  store?: LocalStore
  cwd?: string
  probe?: (input: SpawnedAcpSetupInput) => Promise<CapabilityProbeResult>
  resolveExecutable?: (command: string) => string | null
}

function cleanArgs(args: string[] | undefined): string[] {
  return (args ?? []).map((arg) => String(arg)).filter((arg) => arg.length > 0)
}

function resolveLocalExecutable(command: string): string {
  try {
    const resolved = realpathSync(command)
    if (!statSync(resolved).isFile()) {
      throw new Error('not a regular file')
    }
    accessSync(resolved, constants.X_OK)
    return resolved
  } catch {
    throw new CustomAcpRegistrationError(
      'ACP_RUNNER_MISSING',
      'Local executable must resolve to an executable regular file',
    )
  }
}

function materialize(
  input: CustomAcpRegistrationInput,
  resolveExecutable: (command: string) => string | null,
): {
  command: string
  args: string[]
  launchSpec: WorkerLaunchSpec
} {
  const agentArgs = cleanArgs(input.args)
  const env = { ...(input.env ?? {}) }
  if (input.launchKind === 'npx' || input.launchKind === 'uvx') {
    const packageSpec = input.packageSpec?.trim()
    if (!packageSpec || /\s/u.test(packageSpec)) {
      throw new CustomAcpRegistrationError(
        'ACP_INSTALL_FAILED',
        `Valid packageSpec required for ${input.launchKind}`,
      )
    }
    const runnerArgs = input.launchKind === 'npx' ? ['-y'] : []
    const runner = resolveExecutable(input.launchKind)
    if (!runner || !isAbsolute(runner)) {
      throw new CustomAcpRegistrationError(
        'ACP_RUNNER_MISSING',
        `${input.launchKind} runner is not installed or executable`,
      )
    }
    return {
      command: runner,
      args: [...runnerArgs, packageSpec, ...agentArgs],
      launchSpec: {
        distribution: input.launchKind,
        runnerCommand: runner,
        runnerArgs,
        packageSpec,
        agentArgs,
        env,
      },
    }
  }

  const command = input.command?.trim()
  if (!command) {
    throw new CustomAcpRegistrationError('ACP_RUNNER_MISSING', 'Executable command required')
  }
  if (input.launchKind === 'local' && !isAbsolute(command)) {
    throw new CustomAcpRegistrationError(
      'ACP_RUNNER_MISSING',
      'Local executable must use an absolute path',
    )
  }
  if (input.launchKind === 'system' && isAbsolute(command)) {
    throw new CustomAcpRegistrationError(
      'ACP_RUNNER_MISSING',
      'System executable must be resolved from PATH; use local for an absolute path',
    )
  }
  const executable =
    input.launchKind === 'local' ? resolveLocalExecutable(command) : resolveExecutable(command)
  if (!executable || !isAbsolute(executable)) {
    throw new CustomAcpRegistrationError(
      'ACP_RUNNER_MISSING',
      `System executable not found on PATH: ${command}`,
    )
  }
  return {
    command: executable,
    args: agentArgs,
    launchSpec: {
      distribution: 'custom',
      executable,
      runnerArgs: [],
      agentArgs,
      env,
    },
  }
}

export async function registerCustomAcpWorker(
  input: CustomAcpRegistrationInput,
  deps: CustomAcpRegistrationDeps = {},
): Promise<WorkerRegistration> {
  const name = input.name?.trim()
  if (!name) throw new CustomAcpRegistrationError('WORKER_NOT_READY', 'Worker name required')
  const store = deps.store ?? getSharedStore()
  const launch = materialize(input, deps.resolveExecutable ?? whichSync)
  const launchDigest = createHash('sha256').update(JSON.stringify(launch.launchSpec)).digest('hex')
  const env = buildEffectiveWorkerEnv({
    ambientEnv: process.env,
    workerEnv: input.env,
  })
  const probe = await (deps.probe ?? probeSpawnedAgent)({
    command: launch.command,
    args: launch.args,
    cwd: deps.cwd ?? process.cwd(),
    env,
    terminalAuthReady: false,
  })
  const protocolAccepted = ['ready', 'auth_required', 'degraded'].includes(probe.readiness.status)
  if (!protocolAccepted) {
    throw new CustomAcpRegistrationError(
      probe.readiness.code ?? 'ACP_PROTOCOL_INCOMPATIBLE',
      `${probe.readiness.code ?? 'ACP_PROTOCOL_INCOMPATIBLE'}: ${
        probe.readiness.message ?? 'ACP protocol probe failed'
      }`,
    )
  }

  const worker: WorkerRegistration = {
    id: createId('worker'),
    name,
    kind: 'custom',
    command: launch.command,
    args: launch.args,
    env: input.env && Object.keys(input.env).length > 0 ? { ...input.env } : undefined,
    primaryRole: 'general',
    roles: ['general'],
    capabilities: ['general'],
    enabled: input.enabled ?? true,
    scope: 'global',
    description: input.description?.trim() || 'Custom ACP Worker',
    defaultRoleType: 'general',
    health: probe.readiness.status === 'ready' ? 'healthy' : 'unknown',
    commandHealth: { status: 'healthy', checkedAt: probe.readiness.checkedAt },
    acpHealth: {
      status:
        probe.readiness.status === 'ready'
          ? 'ready'
          : probe.readiness.status === 'degraded'
            ? 'degraded'
            : 'unavailable',
      checkedAt: probe.readiness.checkedAt,
    },
    model: input.defaultModel?.trim() || undefined,
    source: { type: 'custom', launchKind: input.launchKind, launchDigest },
    runtimeProfile: 'generic-acp',
    launchSpec: launch.launchSpec,
    readiness: probe.readiness,
    capabilitySummary: probe.capabilitySummary as WorkerRegistration['capabilitySummary'],
  }
  return store.upsertWorkerLogged(worker)
}
