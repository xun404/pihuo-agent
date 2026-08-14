/**
 * Registry worker registration: Owner materializes launchSpec from LKG + installation.
 * Clients cannot inject arbitrary command/args as Registry-sourced workers.
 */
import {
  addWorkerReference,
  createId,
  createInstallationId,
  findInstallation,
  findInstallationById,
  markInstallationRemoved,
  migrateLegacyNpxInstallation,
  migrateWorkerSourceFields,
  resolveRouterDataPaths,
  upsertInstallation,
  type AcpAgentInstallationRecord,
} from '@pihuo-agent/core'
import {
  AcpInstallError,
  AcpRunnerError,
  downloadToFile,
  installationTargetDir,
  materializeWorkerLaunch,
  prepareRegistryAgent,
  validatePreparedRegistryInstallation,
  resolveAcpRegistryTarget,
  type PrepareResult,
  type PrepareRequest,
  type PrepareTrustDecision,
} from '@pihuo-agent/adapters'
import type {
  AcpRegistryAgentMetadata,
  AcpRegistryDistributionKind,
  WorkerRegistration,
  WorkerRole,
  WorkerSource,
} from '@pihuo-agent/shared'
import { defaultRegistryWorkerRoles, WORKER_ROLES } from '@pihuo-agent/shared'
import { existsSync, lstatSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { resolveLocalRegistryCatalog } from './acp-registry-service.js'
import {
  assertRegistryCandidateInput,
  assertRegistryRegistrationInput,
  RegistryInputValidationError,
} from './acp-registry-input.js'

export class RegistryRegistrationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus: number = 400,
  ) {
    super(message)
    this.name = 'RegistryRegistrationError'
  }
}

const registryPrepareLocks = new Map<string, Promise<void>>()

async function withRegistryPrepareLock<T>(
  key: string,
  signal: AbortSignal | undefined,
  run: () => Promise<T>,
): Promise<T> {
  const previous = registryPrepareLocks.get(key) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((resolveGate) => {
    release = resolveGate
  })
  const queued = previous.then(() => gate)
  registryPrepareLocks.set(key, queued)
  try {
    if (signal?.aborted) signal.throwIfAborted()
    if (signal) {
      await new Promise<void>((resolveWait, rejectWait) => {
        const onAbort = () => rejectWait(signal.reason ?? new DOMException('Aborted', 'AbortError'))
        signal.addEventListener('abort', onAbort, { once: true })
        void previous.then(resolveWait, rejectWait).finally(() => {
          signal.removeEventListener('abort', onAbort)
        })
      })
    } else {
      await previous
    }
    signal?.throwIfAborted()
    return await run()
  } finally {
    release()
    void queued.finally(() => {
      if (registryPrepareLocks.get(key) === queued) registryPrepareLocks.delete(key)
    })
  }
}

function projectInputValidation(run: () => void): void {
  try {
    run()
  } catch (error) {
    if (error instanceof RegistryInputValidationError) {
      throw new RegistryRegistrationError(error.code, error.message, error.httpStatus)
    }
    throw error
  }
}

export type RegistryPrepareBody = {
  registryId: string
  version?: string
  distribution: AcpRegistryDistributionKind
  manifestDigest: string
  trust?: {
    explicitNoSha?: boolean
    acceptedAt?: string
  }
}

export type RegistryRegisterBody = {
  registryId: string
  version: string
  distribution: AcpRegistryDistributionKind
  manifestDigest: string
  installationId: string
  name?: string
  primaryRole?: WorkerRole
  roles?: WorkerRole[]
  enabled?: boolean
  /** Rejected if present for registry register */
  command?: unknown
  args?: unknown
  env?: unknown
}

function findAgentInLocalCatalog(registryId: string, version?: string): AcpRegistryAgentMetadata {
  const { snapshot } = resolveLocalRegistryCatalog()
  const matches = snapshot.agents.filter((a) => a.id === registryId)
  if (matches.length === 0) {
    throw new RegistryRegistrationError(
      'ACP_REGISTRY_ENTRY_INVALID',
      `Registry agent not found in local catalog: ${registryId}`,
      404,
    )
  }
  if (version) {
    const hit = matches.find((a) => a.version === version)
    if (!hit) {
      throw new RegistryRegistrationError(
        'ACP_REGISTRY_ENTRY_INVALID',
        `Version ${version} not found for ${registryId}`,
        404,
      )
    }
    return hit
  }
  // Prefer first available
  return matches[0]!
}

function assertNoCommandInjection(body: RegistryRegisterBody): void {
  if (body.command !== undefined || body.args !== undefined || body.env !== undefined) {
    throw new RegistryRegistrationError(
      'ACP_REGISTRY_ENTRY_INVALID',
      'Registry register rejects client command/args/env; Owner materializes launch from catalog',
      409,
    )
  }
}

function validateRoles(
  primaryRole: WorkerRole | undefined,
  roles: WorkerRole[] | undefined,
): { primaryRole: WorkerRole; roles: WorkerRole[] } {
  const defaults = defaultRegistryWorkerRoles()
  const primary = primaryRole ?? defaults.primaryRole
  const list = roles && roles.length > 0 ? roles : defaults.roles
  if (!WORKER_ROLES.includes(primary)) {
    throw new RegistryRegistrationError(
      'ACP_REGISTRY_ENTRY_INVALID',
      `Invalid primaryRole: ${primary}`,
    )
  }
  for (const r of list) {
    if (!WORKER_ROLES.includes(r)) {
      throw new RegistryRegistrationError('ACP_REGISTRY_ENTRY_INVALID', `Invalid role: ${r}`)
    }
  }
  const normalized = list.includes(primary) ? list : [primary, ...list]
  return { primaryRole: primary, roles: normalized }
}

function materializeTrustedLaunchSpec(
  spec: NonNullable<AcpAgentInstallationRecord['launchSpec']>,
): { command: string; args: string[]; env: Record<string, string> } {
  try {
    return { ...materializeWorkerLaunch(spec), env: { ...spec.env } }
  } catch {
    throw new RegistryRegistrationError(
      'ACP_INSTALL_FAILED',
      'Installation launch facts are incomplete',
      409,
    )
  }
}

function assertInstallationArtifactDigests(installation: AcpAgentInstallationRecord): void {
  const artifact = installation.launchSpec?.artifact
  if (
    artifact &&
    (Boolean(
      installation.observedSha256 &&
      artifact.observedSha256 &&
      installation.observedSha256.toLowerCase() !== artifact.observedSha256.toLowerCase(),
    ) ||
      Boolean(
        installation.declaredSha256 &&
        artifact.declaredSha256 &&
        installation.declaredSha256.toLowerCase() !== artifact.declaredSha256.toLowerCase(),
      ))
  ) {
    throw new RegistryRegistrationError(
      'ACP_INSTALL_DIGEST_MISMATCH',
      'Existing installation contains conflicting artifact digests',
      409,
    )
  }
}

function prepareResultFromInstallation(installation: AcpAgentInstallationRecord): PrepareResult {
  if (!installation.launchSpec) {
    throw new RegistryRegistrationError(
      'ACP_INSTALL_FAILED',
      'Existing installation is missing trusted launch facts',
      409,
    )
  }
  assertInstallationArtifactDigests(installation)
  const materialized = materializeTrustedLaunchSpec(installation.launchSpec)
  return {
    installDir: installation.installDir,
    stagingDir: installation.installDir,
    distribution: installation.distribution,
    launchSpec: installation.launchSpec,
    command: materialized.command,
    args: materialized.args,
    env: materialized.env,
    observedSha256: installation.observedSha256,
    declaredSha256: installation.declaredSha256,
    packageSpec: installation.packageSpec,
    runner: installation.runnerCommand
      ? {
          kind: installation.distribution === 'uvx' ? 'uvx' : 'npx',
          command: installation.runnerCommand,
          version: installation.runnerVersion ?? installation.launchSpec.runnerVersion ?? 'unknown',
        }
      : undefined,
    resolvedExecutable: installation.resolvedExecutable,
    trustDecision: installation.trustDecision,
    payloadDigest: installation.payloadDigest,
  }
}

function retireLegacyInstallation(input: {
  installation: AcpAgentInstallationRecord
  agentsRoot: string
  target: string
}): void {
  const record = input.installation
  if (record.workerIds.length > 0) {
    throw new RegistryRegistrationError(
      'ACP_INSTALL_IN_USE',
      'Legacy installation is still referenced and cannot be re-prepared',
      409,
    )
  }
  const expectedDir = installationTargetDir({
    agentsRoot: input.agentsRoot,
    registryId: record.registryId,
    registryVersion: record.registryVersion,
    target: input.target,
  })
  if (resolve(record.installDir) !== resolve(expectedDir)) {
    throw new RegistryRegistrationError(
      'ACP_INSTALL_FAILED',
      'Legacy installation is outside the managed artifact root',
      409,
    )
  }
  let quarantine: string | undefined
  if (existsSync(record.installDir)) {
    const stat = lstatSync(record.installDir)
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new RegistryRegistrationError(
        'ACP_INSTALL_FAILED',
        'Legacy installation is not a managed directory',
        409,
      )
    }
    quarantine = `${record.installDir}.legacy.${record.installationId}`
    if (existsSync(quarantine)) {
      throw new RegistryRegistrationError(
        'ACP_INSTALL_FAILED',
        'Legacy installation quarantine already exists',
        409,
      )
    }
    renameSync(record.installDir, quarantine)
  }
  try {
    markInstallationRemoved(record.installationId)
  } catch (error) {
    if (quarantine && existsSync(quarantine) && !existsSync(record.installDir)) {
      renameSync(quarantine, record.installDir)
    }
    throw error
  }
}

function quarantineReferencedLegacyNpx(input: {
  installation: AcpAgentInstallationRecord
  agentsRoot: string
}): string | undefined {
  const record = input.installation
  const expectedDir = installationTargetDir({
    agentsRoot: input.agentsRoot,
    registryId: record.registryId,
    registryVersion: record.registryVersion,
    target: 'npx',
  })
  if (resolve(record.installDir) !== resolve(expectedDir)) {
    throw new RegistryRegistrationError(
      'ACP_INSTALL_FAILED',
      'Legacy installation is outside the managed artifact root',
      409,
    )
  }
  if (!existsSync(record.installDir)) return undefined
  const stat = lstatSync(record.installDir)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new RegistryRegistrationError(
      'ACP_INSTALL_FAILED',
      'Legacy installation is not a managed directory',
      409,
    )
  }
  const quarantine = `${record.installDir}.legacy.${record.installationId}`
  if (existsSync(quarantine)) {
    // Resume an Owner transaction interrupted before Store commit/cleanup.
    return quarantine
  }
  renameSync(record.installDir, quarantine)
  return quarantine
}

function restoreQuarantinedLegacyNpx(input: { installDir: string; quarantine?: string }): void {
  if (existsSync(input.installDir)) rmSync(input.installDir, { recursive: true, force: true })
  if (input.quarantine && existsSync(input.quarantine)) {
    renameSync(input.quarantine, input.installDir)
  }
}

export type RegistryPrepareProgress = {
  stage: string
  progress?: number
}

export async function prepareRegistryWorker(input: {
  body: RegistryPrepareBody
  fetchImpl?: typeof fetch
  localArchivePath?: string
  runnerEnv?: NodeJS.ProcessEnv
  signal?: AbortSignal
  downloadTimeoutMs?: number
  downloadHeaderTimeoutMs?: number
  downloadStallTimeoutMs?: number
  packageInstaller?: PrepareRequest['packageInstaller']
  /** Optional coarse progress for UI (stage + 0..1). Never throws from the callback. */
  onProgress?: (event: RegistryPrepareProgress) => void
}): Promise<{
  installation: AcpAgentInstallationRecord
  prepare: PrepareResult
}> {
  const resolvedVersion = findAgentInLocalCatalog(input.body.registryId, input.body.version).version
  const key = `${input.body.registryId}\0${resolvedVersion}\0${input.body.distribution}`
  const lockedInput = { ...input, body: { ...input.body, version: resolvedVersion } }
  return withRegistryPrepareLock(key, input.signal, () =>
    prepareRegistryWorkerUnlocked(lockedInput),
  )
}

function emitPrepareProgress(
  onProgress: ((event: RegistryPrepareProgress) => void) | undefined,
  event: RegistryPrepareProgress,
): void {
  if (!onProgress) return
  try {
    onProgress(event)
  } catch {
    // Progress is best-effort UI signal; never fail the install path.
  }
}

async function prepareRegistryWorkerUnlocked(input: {
  body: RegistryPrepareBody
  fetchImpl?: typeof fetch
  localArchivePath?: string
  runnerEnv?: NodeJS.ProcessEnv
  signal?: AbortSignal
  /** Total download deadline for binary archives; defaults to the installer's safety valve. */
  downloadTimeoutMs?: number
  /** Per-request connection/header deadline, bounded by downloadTimeoutMs. */
  downloadHeaderTimeoutMs?: number
  /** No-progress stall deadline for the response body; a steady stream is never killed. */
  downloadStallTimeoutMs?: number
  packageInstaller?: PrepareRequest['packageInstaller']
  onProgress?: (event: RegistryPrepareProgress) => void
}): Promise<{
  installation: AcpAgentInstallationRecord
  prepare: PrepareResult
}> {
  projectInputValidation(() => assertRegistryCandidateInput(input.body))
  const agent = findAgentInLocalCatalog(input.body.registryId, input.body.version)
  if (agent.manifestDigest !== input.body.manifestDigest) {
    throw new RegistryRegistrationError(
      'ACP_INSTALL_TRUST_REQUIRED',
      'manifestDigest does not match local catalog entry (catalog may have refreshed)',
      409,
    )
  }
  if (agent.availability === 'invalid_manifest') {
    throw new RegistryRegistrationError(
      'ACP_REGISTRY_ENTRY_INVALID',
      agent.availabilityMessage ?? 'Invalid registry entry',
    )
  }

  const target = resolveAcpRegistryTarget()
  if (!target && input.body.distribution === 'binary') {
    throw new RegistryRegistrationError(
      'ACP_PLATFORM_UNSUPPORTED',
      'Current platform is not supported for binary agents',
    )
  }

  const trust: PrepareTrustDecision | undefined = input.body.trust
    ? {
        acceptedAt: input.body.trust.acceptedAt ?? new Date().toISOString(),
        manifestDigest: input.body.manifestDigest,
        explicitNoSha: Boolean(input.body.trust.explicitNoSha),
      }
    : undefined

  const agentsRoot = join(resolveRouterDataPaths().dataDir, 'agents')
  emitPrepareProgress(input.onProgress, { stage: 'fetching_icon', progress: 0.15 })
  // Download the registry icon (SVG) to the agent's version dir so it can be
  // rendered locally without depending on the remote CDN. Failure is non-fatal:
  // a missing icon falls back to the kind-based default in the UI.
  const iconPath = await downloadAgentIcon(agent.icon, agentsRoot, agent.id, agent.version, {
    fetchImpl: input.fetchImpl,
    signal: input.signal,
  })
  emitPrepareProgress(input.onProgress, {
    stage: input.body.distribution === 'binary' ? 'downloading' : 'installing',
    progress: 0.35,
  })
  let existing = findInstallation({
    registryId: agent.id,
    registryVersion: agent.version,
    distribution: input.body.distribution,
    target: input.body.distribution === 'binary' ? (target ?? undefined) : undefined,
  })
  let referencedLegacyNpx: AcpAgentInstallationRecord | undefined
  let legacyQuarantine: string | undefined
  if (existing) {
    if (existing.manifestDigest !== agent.manifestDigest) {
      throw new RegistryRegistrationError(
        'ACP_INSTALL_DIGEST_MISMATCH',
        'Existing installation manifest digest does not match the catalog entry',
        409,
      )
    }
    if (!existing.launchSpec) {
      retireLegacyInstallation({
        installation: existing,
        agentsRoot,
        target: input.body.distribution === 'binary' ? target! : input.body.distribution,
      })
      existing = undefined
    } else if (
      existing.distribution === 'npx' &&
      existing.launchSpec.distribution === 'npx' &&
      !existing.resolvedExecutable &&
      !existing.launchSpec.executable
    ) {
      referencedLegacyNpx = existing
      legacyQuarantine = quarantineReferencedLegacyNpx({ installation: existing, agentsRoot })
    } else if (existing.distribution === 'npx') {
      const interruptedQuarantine = `${existing.installDir}.legacy.${existing.installationId}`
      if (existsSync(interruptedQuarantine)) legacyQuarantine = interruptedQuarantine
    }
  }

  let prepare: PrepareResult
  try {
    prepare = await prepareRegistryAgent({
      agent,
      distribution: input.body.distribution,
      target: target ?? 'darwin-aarch64',
      agentsRoot,
      trust,
      fetchImpl: input.fetchImpl,
      localArchivePath: input.localArchivePath,
      runnerEnv: input.runnerEnv,
      signal: input.signal,
      downloadTimeoutMs: input.downloadTimeoutMs,
      downloadHeaderTimeoutMs: input.downloadHeaderTimeoutMs,
      downloadStallTimeoutMs: input.downloadStallTimeoutMs,
      packageInstaller: input.packageInstaller,
    })
    emitPrepareProgress(input.onProgress, { stage: 'finalizing', progress: 0.88 })
  } catch (e) {
    if (referencedLegacyNpx && legacyQuarantine) {
      restoreQuarantinedLegacyNpx({
        installDir: referencedLegacyNpx.installDir,
        quarantine: legacyQuarantine,
      })
    }
    if (e instanceof AcpInstallError || e instanceof AcpRunnerError) {
      throw new RegistryRegistrationError(
        e.code,
        e.message,
        e.code === 'ACP_INSTALL_DIGEST_MISMATCH' ? 409 : 400,
      )
    }
    throw e
  }

  const installationId = existing?.installationId ?? createInstallationId()
  const launchSpec: NonNullable<AcpAgentInstallationRecord['launchSpec']> = {
    ...prepare.launchSpec,
    ...(prepare.runner?.command || prepare.launchSpec.runnerCommand
      ? { runnerCommand: prepare.runner?.command ?? prepare.launchSpec.runnerCommand }
      : {}),
    ...(prepare.runner?.version ? { runnerVersion: prepare.runner.version } : {}),
    ...(prepare.resolvedExecutable || prepare.launchSpec.executable
      ? { executable: prepare.resolvedExecutable ?? prepare.launchSpec.executable }
      : {}),
    ...(prepare.launchSpec.artifact
      ? {
          artifact: {
            ...prepare.launchSpec.artifact,
            ...(prepare.observedSha256 || prepare.launchSpec.artifact.observedSha256
              ? {
                  observedSha256:
                    prepare.observedSha256 ?? prepare.launchSpec.artifact.observedSha256,
                }
              : {}),
          },
        }
      : {}),
  }
  let installation: AcpAgentInstallationRecord
  try {
    const preparedRecord: AcpAgentInstallationRecord = {
      installationId,
      registryId: agent.id,
      registryVersion: agent.version,
      distribution: input.body.distribution,
      target: input.body.distribution === 'binary' ? (target ?? undefined) : undefined,
      manifestDigest: agent.manifestDigest,
      archiveUrl: prepare.launchSpec.artifact?.archiveUrl,
      declaredSha256: prepare.declaredSha256,
      observedSha256: prepare.observedSha256,
      installDir: prepare.installDir,
      resolvedExecutable: prepare.resolvedExecutable,
      packageSpec: prepare.packageSpec,
      runnerCommand: prepare.runner?.command,
      runnerVersion: prepare.runner?.version,
      payloadDigest: prepare.payloadDigest,
      launchSpec,
      iconPath: iconPath ?? existing?.iconPath,
      status: existing?.status ?? 'prepared',
      preparedAt: existing?.preparedAt ?? new Date().toISOString(),
      installedAt: existing?.installedAt,
      lastProbedAt: existing?.lastProbedAt,
      probeCode: existing?.probeCode,
      probeMessage: existing?.probeMessage,
      workerIds: existing?.workerIds ?? [],
      trustDecision:
        existing?.trustDecision ??
        (prepare.trustDecision
          ? {
              acceptedAt: prepare.trustDecision.acceptedAt,
              manifestDigest: prepare.trustDecision.manifestDigest,
              explicitNoSha: prepare.trustDecision.explicitNoSha,
            }
          : undefined),
    }
    installation = referencedLegacyNpx
      ? migrateLegacyNpxInstallation(referencedLegacyNpx.installationId, preparedRecord)
      : upsertInstallation(preparedRecord)
    if (legacyQuarantine) {
      try {
        rmSync(legacyQuarantine, { recursive: true, force: true })
      } catch {
        // The migrated installation is already committed; stale quarantine cleanup is non-fatal.
      }
    }
  } catch (error) {
    if (referencedLegacyNpx) {
      restoreQuarantinedLegacyNpx({
        installDir: referencedLegacyNpx.installDir,
        quarantine: legacyQuarantine,
      })
    }
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ACP_INSTALL_DIGEST_MISMATCH'
    ) {
      throw new RegistryRegistrationError(
        'ACP_INSTALL_DIGEST_MISMATCH',
        'Existing installation digest conflicts with the prepared artifact',
        409,
      )
    }
    throw error
  }

  return { installation, prepare }
}

export async function registerRegistryWorker(input: {
  body: RegistryRegisterBody
  existingWorkers: WorkerRegistration[]
}): Promise<WorkerRegistration> {
  projectInputValidation(() => assertRegistryRegistrationInput(input.body))
  assertNoCommandInjection(input.body)
  const agent = findAgentInLocalCatalog(input.body.registryId, input.body.version)
  if (agent.manifestDigest !== input.body.manifestDigest) {
    throw new RegistryRegistrationError(
      'ACP_INSTALL_TRUST_REQUIRED',
      'manifestDigest mismatch with local catalog',
      409,
    )
  }

  // Reject duplicates: the same registry agent + version must not be registered
  // twice. Re-registering the same agent offers no benefit and clutters the
  // worker list with indistinguishable entries.
  const duplicate = input.existingWorkers.find(
    (w) =>
      w.source?.type === 'registry' &&
      w.source.registryId === input.body.registryId &&
      w.source.registryVersion === input.body.version,
  )
  if (duplicate) {
    throw new RegistryRegistrationError(
      'WORKER_DUPLICATE_REGISTRY',
      `Registry agent ${input.body.registryId}@${input.body.version} is already registered as "${duplicate.name}"`,
      409,
    )
  }

  // Reject name collisions: the final worker name (explicit or the agent's
  // display name) must not match an existing worker, since routing keys off
  // the display name and a duplicate would be ambiguous.
  const finalName = (input.body.name?.trim() || agent.name).toLowerCase()
  const nameConflict = input.existingWorkers.some((w) => w.name.trim().toLowerCase() === finalName)
  if (nameConflict) {
    throw new RegistryRegistrationError(
      'WORKER_DUPLICATE_NAME',
      `A worker named "${input.body.name?.trim() || agent.name}" already exists`,
      409,
    )
  }

  const exact = findInstallationById(input.body.installationId)
  const record = exact?.installationId === input.body.installationId ? exact : undefined
  if (!record || (record.status !== 'prepared' && record.status !== 'installed')) {
    throw new RegistryRegistrationError(
      'ACP_INSTALL_FAILED',
      'installationId not found or not prepared; call prepare first',
      409,
    )
  }
  if (
    record.registryId !== agent.id ||
    record.registryVersion !== agent.version ||
    record.manifestDigest !== agent.manifestDigest
  ) {
    throw new RegistryRegistrationError(
      'ACP_INSTALL_TRUST_REQUIRED',
      'installation does not match catalog agent/digest',
      409,
    )
  }
  if (record.distribution !== input.body.distribution) {
    throw new RegistryRegistrationError(
      'ACP_REGISTRY_ENTRY_INVALID',
      'distribution does not match installation',
      409,
    )
  }
  if (!record.launchSpec) {
    throw new RegistryRegistrationError(
      'ACP_INSTALL_FAILED',
      'Installation is missing trusted launch facts',
      409,
    )
  }
  if (record.launchSpec.distribution !== record.distribution) {
    throw new RegistryRegistrationError(
      'ACP_INSTALL_TRUST_REQUIRED',
      'Installation launch facts do not match its immutable identity',
      409,
    )
  }
  assertInstallationArtifactDigests(record)

  if (!record.payloadDigest) {
    throw new RegistryRegistrationError(
      'ACP_INSTALL_FAILED',
      'Installation is missing its immutable payload digest',
      409,
    )
  }
  try {
    await validatePreparedRegistryInstallation({
      agentsRoot: join(resolveRouterDataPaths().dataDir, 'agents'),
      installDir: record.installDir,
      registryId: record.registryId,
      registryVersion: record.registryVersion,
      distribution: record.distribution,
      target: record.target,
      manifestDigest: record.manifestDigest,
      expectedLaunchSpec: record.launchSpec,
      expectedPayloadDigest: record.payloadDigest,
    })
  } catch (error) {
    if (error instanceof AcpInstallError) {
      throw new RegistryRegistrationError(
        error.code,
        error.message,
        error.code === 'ACP_INSTALL_DIGEST_MISMATCH' ? 409 : 400,
      )
    }
    throw error
  }

  const roles = validateRoles(input.body.primaryRole, input.body.roles)
  const materialized = materializeTrustedLaunchSpec(record.launchSpec)

  const source: WorkerSource = {
    type: 'registry',
    registryId: agent.id,
    registryVersion: agent.version,
    registrySchemaVersion: '1.0.0',
    manifestDigest: agent.manifestDigest,
    distribution: input.body.distribution,
    target: record.target,
    installationId: record.installationId,
  }

  const worker: WorkerRegistration = migrateWorkerSourceFields({
    id: createId('worker'),
    name: input.body.name?.trim() || agent.name,
    kind: 'custom',
    command: materialized.command,
    args: materialized.args,
    env: materialized.env,
    primaryRole: roles.primaryRole,
    roles: roles.roles,
    capabilities: ['general'],
    enabled: input.body.enabled !== false,
    scope: 'global',
    description: agent.description,
    defaultRoleType: 'general',
    health: 'unknown',
    source,
    runtimeProfile: 'generic-acp',
    installationId: record.installationId,
    iconPath: record.iconPath,
    launchSpec: record.launchSpec,
    readiness: {
      status: 'prepared',
      code: undefined,
      message: 'Prepared; ACP probe/auth not yet completed',
      checkedAt: new Date().toISOString(),
      nextAction: 'retry',
    },
    authRevision: 0,
  })

  addWorkerReference(record.installationId, worker.id)
  return worker
}

/**
 * Download the registry agent icon (SVG) into the agent's version dir, shared
 * across distributions/targets. Returns the local path, or undefined if there
 * is no icon URL, the download failed, or the result is not a usable SVG.
 *
 * Non-fatal: callers treat a missing icon as "fall back to the default mark".
 */
async function downloadAgentIcon(
  iconUrl: string | undefined,
  agentsRoot: string,
  registryId: string,
  registryVersion: string,
  opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
): Promise<string | undefined> {
  if (!iconUrl) return undefined
  // Only https icons are fetched — never http / file / data.
  let parsed: URL
  try {
    parsed = new URL(iconUrl)
  } catch {
    return undefined
  }
  if (parsed.protocol !== 'https:') return undefined

  const dir = join(agentsRoot, registryId, registryVersion)
  const dest = join(dir, 'icon.svg')
  // Reuse an already-downloaded icon (e.g. re-prepare of the same version).
  if (existsSync(dest)) return dest
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    const result = await downloadToFile(iconUrl, dest, {
      fetchImpl: opts.fetchImpl,
      signal: opts.signal,
      totalTimeoutMs: 15_000,
      headerTimeoutMs: 8_000,
      stallTimeoutMs: 10_000,
      maxBytes: 256 * 1024, // SVG icons are tiny; cap to avoid a malicious blob
    })
    // Reject empty / implausibly large payloads — treat as no icon.
    if (result.bytes === 0) return undefined
    return dest
  } catch {
    return undefined
  }
}
