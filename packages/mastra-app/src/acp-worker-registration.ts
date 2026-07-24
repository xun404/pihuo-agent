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
  migrateWorkerSourceFields,
  resolveRouterDataPaths,
  upsertInstallation,
  type AcpAgentInstallationRecord,
} from '@swarmdesk-agent/core'
import {
  AcpInstallError,
  AcpRunnerError,
  installationTargetDir,
  prepareRegistryAgent,
  validatePreparedRegistryInstallation,
  resolveAcpRegistryTarget,
  type PrepareResult,
  type PrepareTrustDecision,
} from '@swarmdesk-agent/adapters'
import type {
  AcpRegistryAgentMetadata,
  AcpRegistryDistributionKind,
  WorkerRegistration,
  WorkerRole,
  WorkerSource,
} from '@swarmdesk-agent/shared'
import { defaultRegistryWorkerRoles, WORKER_ROLES } from '@swarmdesk-agent/shared'
import { existsSync, lstatSync, renameSync } from 'node:fs'
import { join, resolve } from 'node:path'
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
  if (spec.distribution === 'npx' || spec.distribution === 'uvx') {
    if (!spec.runnerCommand || !spec.packageSpec) {
      throw new RegistryRegistrationError(
        'ACP_INSTALL_FAILED',
        'Installation launch facts are incomplete',
        409,
      )
    }
    return {
      command: spec.runnerCommand,
      args: [...spec.runnerArgs, spec.packageSpec, ...spec.agentArgs],
      env: { ...spec.env },
    }
  }
  if (spec.distribution === 'binary') {
    if (!spec.executable) {
      throw new RegistryRegistrationError(
        'ACP_INSTALL_FAILED',
        'Installation launch facts are incomplete',
        409,
      )
    }
    return {
      command: spec.executable,
      args: [...spec.agentArgs],
      env: { ...spec.env },
    }
  }
  throw new RegistryRegistrationError(
    'ACP_INSTALL_FAILED',
    'Installation launch facts use an unsupported distribution',
    409,
  )
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

export async function prepareRegistryWorker(input: {
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
  let existing = findInstallation({
    registryId: agent.id,
    registryVersion: agent.version,
    distribution: input.body.distribution,
    target: input.body.distribution === 'binary' ? (target ?? undefined) : undefined,
  })
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
    })
  } catch (e) {
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
    installation = upsertInstallation({
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
    })
  } catch (error) {
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
