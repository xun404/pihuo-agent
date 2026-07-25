import { createHash } from 'node:crypto'
import { accessSync, constants, existsSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import type { LocalStore } from '@swarmdesk-agent/core'
import { createId, getSharedStore } from '@swarmdesk-agent/core'
import {
  buildEffectiveWorkerEnv,
  expandHome,
  probeSpawnedAgent,
  whichSync,
  type CapabilityProbeResult,
  type SpawnedAcpSetupInput,
} from '@swarmdesk-agent/adapters'
import type {
  CustomAcpConflictCandidate,
  CustomAcpLaunchKind,
  CustomAcpPreview,
  CustomAcpPreviewCandidate,
  CustomAcpRegistrationInput,
  WorkerLaunchSpec,
  WorkerRegistration,
} from '@swarmdesk-agent/shared'
import { resolveLocalRegistryCatalog } from './acp-registry-service.js'

/**
 * Best-effort fuzzy match of a custom-registered worker (by name + command)
 * against the local registry catalog, so a manually-added CLI can reuse the
 * matching agent's icon. Returns the agentId or undefined.
 *
 * Matching priority:
 *  1. command/package contains the agent id or a known suffix (e.g.
 *     "@agentclientprotocol/claude-agent-acp" → claude-acp)
 *  2. name contains the agent id or display name
 *  3. token overlap between command tokens and agent id tokens
 */
function matchRegistryAgentForIcon(name: string, command: string): string | undefined {
  let agents: { id: string; name: string }[] = []
  try {
    agents = resolveLocalRegistryCatalog().snapshot.agents.map((a) => ({ id: a.id, name: a.name }))
  } catch {
    return undefined
  }
  if (agents.length === 0) return undefined
  const hay = `${name} ${command}`.toLowerCase()
  // 1. command/package contains agent id suffix
  for (const a of agents) {
    if (command.toLowerCase().includes(a.id)) return a.id
  }
  // 2. name matches agent id or display name (substring either direction)
  const nameLower = name.toLowerCase()
  for (const a of agents) {
    const aid = a.id.toLowerCase()
    const aname = a.name.toLowerCase()
    if (hay.includes(aid) || hay.includes(aname) || aname.includes(nameLower) || aid.includes(nameLower)) {
      return a.id
    }
  }
  // 3. token overlap (e.g. "claude code" vs "claude-acp")
  const cmdTokens = new Set(
    command
      .toLowerCase()
      .split(/[^a-z0-9]+/i)
      .filter((t) => t.length >= 3),
  )
  let best: { id: string; score: number } | undefined
  for (const a of agents) {
    const idTokens = a.id.toLowerCase().split(/[^a-z0-9]+/i).filter((t) => t.length >= 3)
    const overlap = idTokens.filter((t) => cmdTokens.has(t)).length
    if (overlap > 0 && (!best || overlap > best.score)) best = { id: a.id, score: overlap }
  }
  return best?.id
}

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

/**
 * Heuristic launch-kind detection so users can hand over a bare command string without
 * knowing the npx/local/system distinction. Order matters: filesystem truth (an existing
 * path) beats npm-name guessing, so a local `~/bin/@scope/x` is not misread as a package.
 */
export function detectLaunchKind(input: {
  launchKind?: CustomAcpLaunchKind
  command?: string
  packageSpec?: string
}): 'npx' | 'uvx' | 'system' | 'local' {
  // Explicit package distribution is unambiguous; keep it.
  if (input.launchKind === 'npx' || input.launchKind === 'uvx') return input.launchKind
  const rawCommand = input.command?.trim() ?? ''
  // A provided packageSpec (with no command) implies a package run; 'uvx' was handled above.
  if (input.packageSpec?.trim() && !rawCommand) return 'npx'
  if (!rawCommand) return 'system'
  const expanded = expandHome(rawCommand)
  // Existing path (absolute or ~)-expanded) is a local executable.
  if (isAbsolute(expanded) || existsSync(expanded)) return 'local'
  // npm package shape: "@scope/name", "name@version", or scoped tarball spec.
  if (/^(@[\w.-]+\/)?[\w.-]+(@[\w.^-]+)?$/.test(rawCommand) && (rawCommand.startsWith('@') || rawCommand.includes('@'))) {
    return 'npx'
  }
  return 'system'
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
  /** The resolved, concrete launch kind ('auto' is never returned here). */
  launchKind: 'npx' | 'uvx' | 'system' | 'local'
  launchSpec: WorkerLaunchSpec
} {
  const agentArgs = cleanArgs(input.args)
  const env = { ...(input.env ?? {}) }
  // Resolve 'auto'/missing launchKind from the command/packageSpec so callers don't need to know
  // the local/system/npx distinction. Explicit choices are honored below.
  const launchKind: 'npx' | 'uvx' | 'system' | 'local' =
    input.launchKind && input.launchKind !== 'auto'
      ? input.launchKind
      : detectLaunchKind(input)
  if (launchKind === 'npx' || launchKind === 'uvx') {
    const packageSpec = input.packageSpec?.trim() || input.command?.trim()
    if (!packageSpec || /\s/u.test(packageSpec)) {
      throw new CustomAcpRegistrationError(
        'ACP_INSTALL_FAILED',
        `Valid packageSpec required for ${launchKind}`,
      )
    }
    const runnerArgs = launchKind === 'npx' ? ['-y'] : []
    const runner = resolveExecutable(launchKind)
    if (!runner || !isAbsolute(runner)) {
      throw new CustomAcpRegistrationError(
        'ACP_RUNNER_MISSING',
        `${launchKind} runner is not installed or executable`,
      )
    }
    return {
      command: runner,
      args: [...runnerArgs, packageSpec, ...agentArgs],
      launchKind,
      launchSpec: {
        distribution: launchKind,
        runnerCommand: runner,
        runnerArgs,
        packageSpec,
        agentArgs,
        env,
      },
    }
  }

  const command = expandHome(input.command?.trim() ?? '')
  if (!command) {
    throw new CustomAcpRegistrationError('ACP_RUNNER_MISSING', 'Executable command required')
  }
  // A path that exists (absolute, ~ expanded, or resolvable) is a local executable; otherwise
  // treat it as a PATH lookup. This removes the brittle local-vs-system mutual exclusion that
  // rejected `~`-paths and forced users to pick the exact launchKind.
  const isLocalPath = isAbsolute(command) || existsSync(command)
  const executable = isLocalPath
    ? resolveLocalExecutable(command)
    : resolveExecutable(input.command!.trim())
  if (!executable || !isAbsolute(executable)) {
    throw new CustomAcpRegistrationError(
      'ACP_RUNNER_MISSING',
      `Executable not found: ${input.command?.trim()}`,
    )
  }
  return {
    command: executable,
    args: agentArgs,
    launchKind: isLocalPath ? 'local' : 'system',
    launchSpec: {
      distribution: 'custom',
      executable,
      runnerArgs: [],
      agentArgs,
      env,
    },
  }
}

/** Shared materialize + probe, used by both preview and register. */
async function probeCustomLaunch(
  input: CustomAcpRegistrationInput,
  deps: CustomAcpRegistrationDeps,
): Promise<{ launch: ReturnType<typeof materialize>; launchDigest: string; probe: CapabilityProbeResult }> {
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
  return { launch, launchDigest, probe }
}

/**
 * Existing workers that clash with a candidate. A clash is same reported agent identity
 * (capabilitySummary.agentName) OR the same resolved command — so a multi-version install of the
 * same CLI is flagged, as is an exact re-registration of one binary.
 */
export function findDuplicateCandidates(
  store: LocalStore,
  agentName: string | undefined,
  command: string,
): CustomAcpConflictCandidate[] {
  const existing = store.listWorkers()
  return existing
    .filter((w) => {
      const sameCommand = w.command === command
      const sameAgent =
        !!agentName && !!w.capabilitySummary?.agentName && w.capabilitySummary.agentName === agentName
      return sameCommand || sameAgent
    })
    .map((w) => ({
      workerId: w.id,
      name: w.name,
      agentName: w.capabilitySummary?.agentName,
      agentVersion: w.capabilitySummary?.agentVersion,
      command: w.command,
      readinessStatus: w.readiness?.status ?? 'cataloged',
    }))
}

function probeToCandidate(
  launch: ReturnType<typeof materialize>,
  probe: CapabilityProbeResult,
): CustomAcpPreviewCandidate {
  const cs = probe.capabilitySummary
  return {
    agentName: cs.agentName,
    agentVersion: cs.agentVersion,
    command: launch.command,
    args: launch.args,
    protocolVersion: cs.protocolVersion,
    sessionLoad: cs.sessionLoad,
    sessionResume: cs.sessionResume,
    sessionList: cs.sessionList,
    authLogout: cs.authLogout,
    authMethods: (cs.authMethods ?? []).map((m) => ({
      id: m.id,
      name: m.name,
      description: m.description,
      type: m.type,
    })),
    readiness: {
      status: probe.readiness.status,
      code: probe.readiness.code,
      message: probe.readiness.message,
    },
  }
}

/**
 * Probe the agent and report what it advertised, plus any existing duplicates. Does NOT persist.
 * Used by the confirmation dialog so the user sees the real ACP identity before committing. Every
 * probe outcome (ready / auth_required / incompatible / failed) is returned as candidate.readiness;
 * the caller decides whether to proceed.
 */
export async function previewCustomAcpWorker(
  input: CustomAcpRegistrationInput,
  deps: CustomAcpRegistrationDeps = {},
): Promise<CustomAcpPreview> {
  const name = input.name?.trim()
  if (!name) throw new CustomAcpRegistrationError('WORKER_NOT_READY', 'Worker name required')
  const store = deps.store ?? getSharedStore()
  const { launch, probe } = await probeCustomLaunch(input, deps)
  const candidate = probeToCandidate(launch, probe)
  const conflicts = findDuplicateCandidates(store, candidate.agentName, candidate.command)
  return { candidate, conflicts }
}

export async function registerCustomAcpWorker(
  input: CustomAcpRegistrationInput,
  deps: CustomAcpRegistrationDeps = {},
): Promise<WorkerRegistration> {
  const name = input.name?.trim()
  if (!name) throw new CustomAcpRegistrationError('WORKER_NOT_READY', 'Worker name required')
  const store = deps.store ?? getSharedStore()
  // Reject duplicate names regardless of `force`: a name collision makes chat
  // routing ambiguous (two workers answer to the same display name), so it is
  // a hard constraint, not a trust decision the user can override.
  const nameConflict = store
    .listWorkers()
    .some((w) => w.name.trim().toLowerCase() === name.toLowerCase())
  if (nameConflict) {
    throw new CustomAcpRegistrationError(
      'WORKER_DUPLICATE_NAME',
      `A worker named "${name}" already exists`,
    )
  }
  const { launch, launchDigest, probe } = await probeCustomLaunch(input, deps)
  const status = probe.readiness.status

  // An unauthenticated agent cannot be used; block unless the user forced it from the dialog.
  // (force also covers the incompatible/failed case where the user opts to add anyway.)
  if (status === 'auth_required' && !input.force) {
    throw new CustomAcpRegistrationError(
      'WORKER_AUTH_REQUIRED',
      probe.readiness.message ?? 'Agent requires authentication',
    )
  }
  if (!input.force && !['ready', 'auth_required', 'degraded'].includes(status)) {
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
    source: { type: 'custom', launchKind: launch.launchKind, launchDigest },
    runtimeProfile: 'generic-acp',
    launchSpec: launch.launchSpec,
    readiness: probe.readiness,
    capabilitySummary: probe.capabilitySummary as WorkerRegistration['capabilitySummary'],
    iconAgentId: matchRegistryAgentForIcon(name, launch.command),
  }
  return store.upsertWorkerLogged(worker)
}
