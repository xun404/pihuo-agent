/**
 * Shared Registry API service — used by both http-server and routes/api.
 * Owner materializes all launch/auth commands; clients never inject shell.
 */
import {
  addWorkerReference,
  getSharedStore,
  listWorkerSecretKeyNames,
  setWorkerSecret,
  clearWorkerSecrets,
  loadWorkerSecretsSnapshotForSpawn,
  workerSecretsFingerprintHmac,
  findInstallationById,
  markInstallationRemoved,
  listUnreferencedInstallations,
  removeWorkerReference,
  upsertInstallation,
  getWorkerModelCatalogStore,
  type AcpAgentInstallationRecord,
  type LocalStore,
  WorkerStoreConflictError,
} from '@swarmdesk-agent/core'
import {
  AcpInstallError,
  buildEffectiveWorkerEnv,
  getAcpSessionManager,
  logoutSpawnedAgent,
  probeSpawnedAgent,
  resolveAcpRegistryTarget,
  type CapabilityProbeResult,
  type SanitizedAuthMethod,
  type SpawnedAcpLogoutResult,
  type SpawnedAcpSetupInput,
} from '@swarmdesk-agent/adapters'
import {
  type WorkerRegistration,
  type WorkerReadiness,
  type AcpRegistryDistributionKind,
} from '@swarmdesk-agent/shared'
import {
  prepareRegistryWorker,
  registerRegistryWorker,
  RegistryRegistrationError,
  type RegistryPrepareBody,
  type RegistryRegisterBody,
} from './acp-worker-registration.js'
import { detachWorkerFromInstallation } from './acp-worker-detach.js'
import {
  applyReadinessToWorker,
  bumpAuthRevision,
  evaluateWorkerReadinessGate,
} from './acp-worker-readiness.js'
import { reconcileWorkerRuntimeResources } from './acp-resource-lifecycle.js'
import {
  checkRegistryCatalogUpdate,
  getRegistryCatalogForApi,
  resolveLocalRegistryCatalog,
  type ResolveCatalogResult,
} from './acp-registry-service.js'
import {
  clearTerminalAuthProbeMethods,
  isTerminalAuthFeatureEnabled,
  isPtyFeatureReady,
  recordTerminalAuthProbeMethods,
  snapshotTerminalAuthProbeMethods,
} from './acp-auth-terminal.js'
import {
  projectRegistryPublicError,
  unknownRegistryCatalogPublicError,
} from './acp-registry-public-error.js'
import {
  assertRegistryAuthMethodId,
  assertRegistryCandidateInput,
  assertRegistryOperationId,
  assertRegistrySecretInput,
  assertRegistryWorkerId,
  RegistryInputValidationError,
} from './acp-registry-input.js'
import {
  registryOperationManager,
  type RegistryOperationManager,
  type RegistryOperationSnapshot,
} from './acp-registry-operations.js'

export class RegistryApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus: number = 400,
  ) {
    super(message)
    this.name = 'RegistryApiError'
  }
}

type WorkerContextManager = {
  deleteContextByWorker(workerId: string): void
  invalidateWorker?(workerId: string): void
}

type InstallationReferenceManager = WorkerContextManager & {
  listInstallationReferences(): {
    installationIds: string[]
    legacyWorkerIds: string[]
  }
}

type RegistryCleanupDependencies = {
  manager?: InstallationReferenceManager
  catalogStore?: WorkerCatalogStore
  detachWorker?: typeof detachWorkerFromInstallation
}

type WorkerCatalogStore = {
  deleteWorker(workerId: string): void
}

export type RegistryLifecycleDependencies = {
  probeSpawnedAgent?: (input: SpawnedAcpSetupInput) => Promise<CapabilityProbeResult>
  logoutSpawnedAgent?: (input: SpawnedAcpSetupInput) => Promise<SpawnedAcpLogoutResult>
  prepareRegistryWorker?: typeof prepareRegistryWorker
  /** Caller cancellation/deadline propagated to the one-shot ACP child. */
  signal?: AbortSignal
  timeoutMs?: number
  terminalAuthReady?: () => boolean
  ambientEnv?: Readonly<Record<string, string | undefined>>
  manager?: WorkerContextManager
  catalogStore?: WorkerCatalogStore
}

type PublicAuthMethod = NonNullable<
  NonNullable<WorkerRegistration['capabilitySummary']>['authMethods']
>[number]

const SAFE_PROBE_CODES = new Set([
  'ACP_PROTOCOL_INCOMPATIBLE',
  'ACP_RUNNER_MISSING',
  'ACP_INSTALL_FAILED',
  'WORKER_AUTH_REQUIRED',
  'WORKER_AUTH_FAILED',
  'WORKER_NOT_READY',
  'SPAWN_FAILED',
  'INITIALIZE_FAILED',
  'SESSION_FAILED',
  'PROBE_TIMEOUT',
  'PROBE_ABORTED',
  'PROCESS_EXITED',
  'PROCESS_CLEANUP_FAILED',
  'SESSION_READY',
  'DEGRADED',
])

function store(): LocalStore {
  return getSharedStore()
}

let lifecycleGeneration = 0
const workerLifecycleGenerations = new Map<string, number>()

type WorkerLifecycleToken = {
  workerId: string
  generation: number
}

function beginWorkerLifecycle(workerId: string): WorkerLifecycleToken {
  const generation = ++lifecycleGeneration
  workerLifecycleGenerations.set(workerId, generation)
  return { workerId, generation }
}

function invalidateWorkerLifecycle(workerId: string): void {
  workerLifecycleGenerations.set(workerId, ++lifecycleGeneration)
}

function lifecycleConflict(): RegistryApiError {
  return new RegistryApiError(
    'WORKER_NOT_READY',
    'Worker lifecycle changed while the operation was running',
    409,
  )
}

function assertWorkerLifecycle(token: WorkerLifecycleToken): void {
  if (workerLifecycleGenerations.get(token.workerId) !== token.generation) {
    throw lifecycleConflict()
  }
}

function compareAndSwapLifecycleWorker(
  token: WorkerLifecycleToken,
  expected: WorkerRegistration,
  replacement: WorkerRegistration,
): WorkerRegistration {
  assertWorkerLifecycle(token)
  try {
    return store().compareAndSwapWorker(expected, replacement)
  } catch (error) {
    if (error instanceof WorkerStoreConflictError) {
      throw lifecycleConflict()
    }
    throw error
  }
}

function findWorker(workerId: string): WorkerRegistration {
  const w = store()
    .listWorkers()
    .find((x) => x.id === workerId)
  if (!w) {
    throw new RegistryApiError('WORKER_NOT_READY', `Worker not found: ${workerId}`, 404)
  }
  return w
}

function findEnabledRegistryWorker(workerId: string): WorkerRegistration {
  const worker = findWorker(workerId)
  if (!worker.enabled || worker.source?.type !== 'registry') {
    throw new RegistryApiError('WORKER_NOT_READY', 'Worker is not an enabled Registry Worker', 409)
  }
  return worker
}

function publicAuthMethod(method: SanitizedAuthMethod): PublicAuthMethod {
  return {
    id: method.id,
    ...(method.name ? { name: method.name } : {}),
    ...(method.description ? { description: method.description } : {}),
    type: method.type,
    ...(method.type === 'env_var' && method.envVarNames
      ? { envVarNames: [...method.envVarNames] }
      : {}),
    ...(method.type === 'terminal' && method.terminalEnvKeys
      ? { terminalEnvNames: [...method.terminalEnvKeys] }
      : {}),
  }
}

function publicCapabilitySummary(
  result: CapabilityProbeResult,
): WorkerRegistration['capabilitySummary'] {
  return {
    protocolVersion: result.capabilitySummary.protocolVersion,
    authMethods: result.authMethods.map(publicAuthMethod),
    sessionLoad: result.capabilitySummary.sessionLoad,
    sessionResume: result.capabilitySummary.sessionResume,
    sessionList: result.capabilitySummary.sessionList,
    authLogout: result.capabilitySummary.authLogout,
    agentName: result.capabilitySummary.agentName,
    agentVersion: result.capabilitySummary.agentVersion,
    probedAt: result.capabilitySummary.probedAt,
  }
}

function boundedProbeResult(result: CapabilityProbeResult): CapabilityProbeResult {
  if (result.readiness.code && !SAFE_PROBE_CODES.has(result.readiness.code)) {
    return {
      readiness: {
        status: 'failed',
        code: 'WORKER_NOT_READY',
        message: 'ACP setup failed',
        nextAction: 'retry',
        checkedAt: new Date().toISOString(),
      },
      authMethods: [],
      capabilitySummary: { probedAt: new Date().toISOString() },
    }
  }
  return result
}

async function callProbe(
  input: SpawnedAcpSetupInput,
  deps: RegistryLifecycleDependencies,
): Promise<CapabilityProbeResult> {
  try {
    return boundedProbeResult(await (deps.probeSpawnedAgent ?? probeSpawnedAgent)(input))
  } catch {
    const checkedAt = new Date().toISOString()
    return {
      readiness: {
        status: 'failed',
        code: 'WORKER_NOT_READY',
        message: 'ACP setup failed',
        nextAction: 'retry',
        checkedAt,
      },
      authMethods: [],
      capabilitySummary: { probedAt: checkedAt },
    }
  }
}

function exactInstallationForWorker(worker: WorkerRegistration): AcpAgentInstallationRecord {
  const installationId =
    worker.installationId ??
    (worker.source?.type === 'registry' ? worker.source.installationId : undefined)
  const installation = installationId ? findInstallationById(installationId) : undefined
  if (
    !installation ||
    !installation.launchSpec ||
    worker.source?.type !== 'registry' ||
    installation.registryId !== worker.source.registryId ||
    installation.registryVersion !== worker.source.registryVersion ||
    installation.manifestDigest !== worker.source.manifestDigest ||
    installation.distribution !== worker.source.distribution
  ) {
    throw new RegistryApiError(
      'ACP_INSTALL_FAILED',
      'Registry Worker installation facts are unavailable',
      409,
    )
  }
  return installation
}

function materializeInstallationLaunch(installation: AcpAgentInstallationRecord): {
  command: string
  args: string[]
} {
  const spec = installation.launchSpec
  if (!spec) {
    throw new RegistryApiError(
      'ACP_INSTALL_FAILED',
      'Installation launch facts are unavailable',
      409,
    )
  }
  if (spec.distribution === 'npx' || spec.distribution === 'uvx') {
    if (!spec.runnerCommand || !spec.packageSpec) {
      throw new RegistryApiError(
        'ACP_INSTALL_FAILED',
        'Installation launch facts are incomplete',
        409,
      )
    }
    return {
      command: spec.runnerCommand,
      args: [...spec.runnerArgs, spec.packageSpec, ...spec.agentArgs],
    }
  }
  if (spec.distribution === 'binary' && spec.executable) {
    return { command: spec.executable, args: [...spec.agentArgs] }
  }
  throw new RegistryApiError('ACP_INSTALL_FAILED', 'Installation launch facts are incomplete', 409)
}

function spawnedSetupInput(
  worker: WorkerRegistration,
  deps: RegistryLifecycleDependencies,
  authenticateMethodId?: string,
): SpawnedAcpSetupInput {
  const installation = exactInstallationForWorker(worker)
  const launch = materializeInstallationLaunch(installation)
  const secretSnapshot = loadWorkerSecretsSnapshotForSpawn(worker.id)
  const env = buildEffectiveWorkerEnv({
    ambientEnv: deps.ambientEnv ?? process.env,
    workerEnv: installation.launchSpec!.env,
    workerSecrets: secretSnapshot.secrets,
  })
  return {
    command: launch.command,
    args: launch.args,
    cwd: installation.installDir,
    env,
    terminalAuthReady: deps.terminalAuthReady?.() ?? isPtyFeatureReady(),
    ...(authenticateMethodId ? { authenticateMethodId } : {}),
    ...(deps.signal ? { signal: deps.signal } : {}),
    ...(deps.timeoutMs !== undefined ? { timeoutMs: deps.timeoutMs } : {}),
  }
}

function persistInstallationProbe(
  installationId: string,
  readiness: WorkerReadiness,
): AcpAgentInstallationRecord {
  const installation = findInstallationById(installationId)
  if (!installation) {
    throw new RegistryApiError('ACP_INSTALL_FAILED', 'Installation not found', 409)
  }
  const ready = readiness.status === 'ready'
  return upsertInstallation({
    ...installation,
    status: ready
      ? 'installed'
      : installation.status === 'installed'
        ? 'installed'
        : 'probe_failed',
    ...(ready
      ? { installedAt: installation.installedAt ?? readiness.checkedAt ?? new Date().toISOString() }
      : {}),
    lastProbedAt: readiness.checkedAt ?? new Date().toISOString(),
    probeCode: readiness.code ?? (ready ? 'SESSION_READY' : 'WORKER_NOT_READY'),
    probeMessage: readiness.message,
  })
}

function reconcileRegistryWorker(
  before: WorkerRegistration,
  after: WorkerRegistration,
  deps: RegistryLifecycleDependencies,
  options: { preserveSessionHistory?: boolean } = {},
): void {
  reconcileWorkerRuntimeResources({
    before,
    after,
    manager: deps.manager ?? getAcpSessionManager(),
    catalogStore: deps.catalogStore ?? getWorkerModelCatalogStore(),
    ...(options.preserveSessionHistory ? { preserveSessionHistory: true } : {}),
  })
}

function logoutRepairWorker(worker: WorkerRegistration, bumpRevision: boolean): WorkerRegistration {
  return applyReadinessToWorker(
    worker,
    {
      status: 'failed',
      code: 'WORKER_AUTH_FAILED',
      message: 'Logged out; Worker authentication state requires repair',
      nextAction: 'retry',
      checkedAt: new Date().toISOString(),
    },
    bumpRevision ? { authRevision: bumpAuthRevision(worker.authRevision) } : undefined,
  )
}

/** Persist a fail-closed boundary without overwriting a concurrent Worker value. */
function persistLogoutRepairState(
  workerId: string,
  bumpRevision: boolean,
): WorkerRegistration | undefined {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const current = store()
      .listWorkers()
      .find((worker) => worker.id === workerId)
    if (!current) return undefined
    const repair = logoutRepairWorker(current, bumpRevision)
    try {
      return store().compareAndSwapWorker(current, repair)
    } catch (error) {
      if (error instanceof WorkerStoreConflictError) continue
      throw error
    }
  }
  throw new RegistryApiError(
    'WORKER_AUTH_FAILED',
    'Logged out; Worker authentication state requires repair',
    409,
  )
}

function publicError(e: unknown): { error: string; code: string; status: number } {
  if (e instanceof RegistryApiError) {
    return projectRegistryPublicError({ message: e.message, code: e.code, status: e.httpStatus })
  }
  if (e instanceof RegistryRegistrationError) {
    return projectRegistryPublicError({ message: e.message, code: e.code, status: e.httpStatus })
  }
  if (e instanceof AcpInstallError) {
    return projectRegistryPublicError({
      message: e.message,
      code: e.code,
      status: e.code === 'ACP_INSTALL_DIGEST_MISMATCH' ? 409 : 400,
    })
  }
  return {
    error: 'Registry operation failed',
    code: 'ACP_INSTALL_FAILED',
    status: 500,
  }
}

export { publicError as registryApiPublicError }
export { unknownRegistryCatalogPublicError as registryCatalogApiPublicError }

// ── Catalog ──

function projectRegistryCatalog(catalog: ResolveCatalogResult) {
  const workers = store().listWorkers()
  const target = resolveAcpRegistryTarget()
  const agentsV2 = catalog.snapshot.agents.map((agent) => {
    const related = workers.filter(
      (w) => w.source?.type === 'registry' && w.source.registryId === agent.id,
    )
    return {
      ...agent,
      platformTarget: target,
      relatedWorkers: related.map((w) => ({
        id: w.id,
        name: w.name,
        readiness: w.readiness,
        installationId: w.installationId,
        registryVersion: w.source?.type === 'registry' ? w.source.registryVersion : undefined,
      })),
    }
  })
  return {
    version: catalog.legacy.version,
    agents: catalog.legacy.agents,
    schemaVersion: catalog.snapshot.schemaVersion,
    source: catalog.snapshot.source,
    digest: catalog.snapshot.digest,
    fetchedAt: catalog.snapshot.fetchedAt,
    stale: catalog.stale,
    updateRequired: catalog.updateRequired,
    code: catalog.code,
    message: catalog.message,
    agentsV2,
    terminalAuthEnabled: isTerminalAuthFeatureEnabled(),
    ptyReady: isPtyFeatureReady(),
  }
}

export async function apiGetRegistryCatalog() {
  return projectRegistryCatalog(await getRegistryCatalogForApi())
}

export async function apiCheckRegistryUpdate(
  options: { fetchImpl?: typeof fetch; signal?: AbortSignal; timeoutMs?: number } = {},
) {
  const result = await checkRegistryCatalogUpdate(options)
  return {
    ...projectRegistryCatalog(result.catalog),
    updateStatus: result.status,
    agentCount: result.catalog.snapshot.agents.length,
  }
}

// ── Prepare / Register ──

export async function apiPrepareRegistry(
  body: RegistryPrepareBody,
  options: { signal?: AbortSignal } = {},
) {
  const result = await prepareRegistryWorker({ body, signal: options.signal })
  return {
    installationId: result.installation.installationId,
    installation: {
      installationId: result.installation.installationId,
      registryId: result.installation.registryId,
      registryVersion: result.installation.registryVersion,
      distribution: result.installation.distribution,
      status: result.installation.status,
      manifestDigest: result.installation.manifestDigest,
      observedSha256: result.installation.observedSha256,
      declaredSha256: result.installation.declaredSha256,
    },
    command: result.prepare.command,
    args: result.prepare.args,
    distribution: result.prepare.distribution,
    observedSha256: result.prepare.observedSha256,
  }
}

export async function apiRegisterRegistry(body: RegistryRegisterBody) {
  const worker = await registerRegistryWorker({
    body,
    existingWorkers: store().listWorkers(),
  })
  store().upsertWorker(worker)
  return { worker, snapshot: store().snapshot() }
}

type RegistryPrepareOperationResult = Awaited<ReturnType<typeof apiPrepareRegistry>>
type RegistryAuthenticateOperationResult = Awaited<ReturnType<typeof apiAuthenticateWorker>>
type RegistryOperationResult = RegistryPrepareOperationResult | RegistryAuthenticateOperationResult

type RegistryOperationDependencies = {
  manager?: RegistryOperationManager
  prepare?: typeof apiPrepareRegistry
}

function validateRegistryCandidateForApi(body: RegistryPrepareBody): void {
  try {
    assertRegistryCandidateInput(body)
  } catch (error) {
    if (error instanceof RegistryInputValidationError) {
      throw new RegistryApiError(error.code, error.message, error.httpStatus)
    }
    throw error
  }
}

export function apiStartPrepareRegistry(
  body: RegistryPrepareBody,
  deps: RegistryOperationDependencies = {},
): RegistryOperationSnapshot<RegistryPrepareOperationResult> {
  validateRegistryCandidateForApi(body)
  const manager = deps.manager ?? registryOperationManager
  const prepare = deps.prepare ?? apiPrepareRegistry
  return manager.start({
    kind: 'prepare',
    run: async (signal, report) => {
      report({ stage: 'preparing', progress: 0.1 })
      return prepare(body, { signal })
    },
    mapError: (error) => {
      const projected = publicError(error)
      return { code: projected.code, error: projected.error }
    },
  })
}

export function apiGetRegistryOperation(
  operationId: string,
  deps: Pick<RegistryOperationDependencies, 'manager'> = {},
): RegistryOperationSnapshot<RegistryOperationResult> {
  try {
    assertRegistryOperationId(operationId)
  } catch {
    throw new RegistryApiError('WORKER_NOT_READY', 'Registry operation not found', 404)
  }
  const operation = (deps.manager ?? registryOperationManager).get<RegistryOperationResult>(
    operationId,
  )
  if (!operation) {
    throw new RegistryApiError('WORKER_NOT_READY', 'Registry operation not found', 404)
  }
  return operation
}

export function apiCancelRegistryOperation(
  operationId: string,
  deps: Pick<RegistryOperationDependencies, 'manager'> = {},
): RegistryOperationSnapshot<RegistryOperationResult> {
  apiGetRegistryOperation(operationId, deps)
  return (deps.manager ?? registryOperationManager).cancel(
    operationId,
  ) as RegistryOperationSnapshot<RegistryOperationResult>
}

// ── Secrets (env_var auth) ──

export function apiListWorkerSecretStatus(workerId: string) {
  findWorker(workerId)
  const status = listWorkerSecretKeyNames(workerId)
  return {
    workerId,
    configuredKeys: status.configuredKeys,
    revision: status.revision,
  }
}

export function apiSetWorkerSecret(input: { workerId: string; envName: string; value: string }) {
  try {
    assertRegistryWorkerId(input.workerId)
    assertRegistrySecretInput(input)
  } catch (error) {
    if (error instanceof RegistryInputValidationError) {
      throw new RegistryApiError(error.code, error.message, error.httpStatus)
    }
    throw error
  }
  const before = findWorker(input.workerId)
  clearTerminalAuthProbeMethods(input.workerId)
  invalidateWorkerLifecycle(input.workerId)
  const result = setWorkerSecret(input.workerId, input.envName, input.value)
  const after = applyReadinessToWorker(
    before,
    {
      status: 'prepared',
      message: 'Credentials updated; re-probe required',
      nextAction: 'retry',
      checkedAt: new Date().toISOString(),
    },
    { authRevision: bumpAuthRevision(before.authRevision) },
  )
  try {
    reconcileWorkerRuntimeResources({
      before,
      after,
      manager: getAcpSessionManager(),
      catalogStore: getWorkerModelCatalogStore(),
    })
  } catch {
    /* manager may be unavailable in unit tests */
  }
  store().upsertWorker(after)
  return {
    workerId: input.workerId,
    configuredKeys: result.configuredKeys,
    revision: result.revision,
    authRevision: after.authRevision,
    // never return value
  }
}

export function apiClearWorkerSecrets(workerId: string) {
  const before = findWorker(workerId)
  clearTerminalAuthProbeMethods(workerId)
  invalidateWorkerLifecycle(workerId)
  const result = clearWorkerSecrets(workerId)
  const after = applyReadinessToWorker(
    before,
    {
      status: 'auth_required',
      code: 'WORKER_AUTH_REQUIRED',
      message: 'Worker secrets cleared',
      nextAction: 'configure_env_secret',
      checkedAt: new Date().toISOString(),
    },
    { authRevision: bumpAuthRevision(before.authRevision) },
  )
  try {
    reconcileWorkerRuntimeResources({
      before,
      after,
      manager: getAcpSessionManager(),
      catalogStore: getWorkerModelCatalogStore(),
    })
  } catch {
    /* */
  }
  store().upsertWorker(after)
  return { workerId, revision: result.revision, authRevision: after.authRevision }
}

// ── Probe / readiness status ──

export function apiWorkerReadinessStatus(workerId: string) {
  const worker = findWorker(workerId)
  const gate = evaluateWorkerReadinessGate(worker)
  const secrets = listWorkerSecretKeyNames(workerId)
  return {
    workerId,
    readiness: worker.readiness ?? null,
    capabilitySummary: worker.capabilitySummary ?? null,
    authRevision: worker.authRevision ?? 0,
    secretKeys: secrets.configuredKeys,
    secretRevision: secrets.revision,
    dispatchable: gate.ok,
    gate: gate.ok
      ? { ok: true as const }
      : {
          ok: false as const,
          code: gate.code,
          message: gate.message,
          nextAction: gate.nextAction,
        },
  }
}

export function apiGetWorkerAuthMethods(workerId: string): {
  workerId: string
  methods: PublicAuthMethod[]
} {
  const worker = findWorker(workerId)
  return {
    workerId,
    methods: (worker.capabilitySummary?.authMethods ?? []).map((method) => ({
      ...method,
      type: method.type ?? 'unsupported',
      ...(method.envVarNames ? { envVarNames: [...method.envVarNames] } : {}),
      ...(method.terminalEnvNames ? { terminalEnvNames: [...method.terminalEnvNames] } : {}),
    })),
  }
}

export async function apiProbeWorker(workerId: string, deps: RegistryLifecycleDependencies = {}) {
  const before = findEnabledRegistryWorker(workerId)
  const lifecycle = beginWorkerLifecycle(workerId)
  const installation = exactInstallationForWorker(before)
  const setup = spawnedSetupInput(before, deps)
  const initializing = applyReadinessToWorker(before, {
    status: 'initializing',
    message: 'Initializing ACP agent',
    nextAction: 'retry',
    checkedAt: new Date().toISOString(),
  })
  compareAndSwapLifecycleWorker(lifecycle, before, initializing)
  clearTerminalAuthProbeMethods(workerId)

  const result = await callProbe(setup, deps)
  assertWorkerLifecycle(lifecycle)
  const after = applyReadinessToWorker(initializing, result.readiness, {
    capabilitySummary: publicCapabilitySummary(result),
  })
  compareAndSwapLifecycleWorker(lifecycle, initializing, after)
  try {
    persistInstallationProbe(installation.installationId, result.readiness)
  } catch (error) {
    try {
      compareAndSwapLifecycleWorker(lifecycle, after, initializing)
    } catch {
      // A failed Store rollback leaves an explicit initializing repair boundary.
    }
    throw error
  }
  recordTerminalAuthProbeMethods({ worker: after, methods: result.authMethods })
  return { worker: after }
}

export function apiApplyProbeResult(
  workerId: string,
  readiness: WorkerReadiness,
  capabilitySummary?: WorkerRegistration['capabilitySummary'],
  authMethods?: SanitizedAuthMethod[],
) {
  const before = findWorker(workerId)
  invalidateWorkerLifecycle(workerId)
  const summary: WorkerRegistration['capabilitySummary'] = capabilitySummary ?? {
    authMethods: authMethods?.map(publicAuthMethod),
    probedAt: readiness.checkedAt,
  }
  const after = applyReadinessToWorker(before, readiness, {
    capabilitySummary: summary,
  })
  store().upsertWorker(after)
  clearTerminalAuthProbeMethods(workerId)
  if (authMethods) recordTerminalAuthProbeMethods({ worker: after, methods: authMethods })
  return { worker: after }
}

export async function apiAuthenticateWorker(
  input: { workerId: string; methodId: string },
  deps: RegistryLifecycleDependencies = {},
) {
  deps.signal?.throwIfAborted()
  const before = findEnabledRegistryWorker(input.workerId)
  const method = before.capabilitySummary?.authMethods?.find(
    (candidate) => candidate.id === input.methodId && candidate.type === 'agent',
  )
  if (!method) {
    throw new RegistryApiError(
      'WORKER_AUTH_FAILED',
      'Selected authentication method is unavailable',
      409,
    )
  }

  const installation = exactInstallationForWorker(before)
  const setup = spawnedSetupInput(before, deps, input.methodId)
  const lifecycle = beginWorkerLifecycle(input.workerId)
  const privateMethodsBefore = snapshotTerminalAuthProbeMethods(before)

  const authenticating = applyReadinessToWorker(before, {
    status: 'authenticating',
    message: 'Authenticating with ACP agent',
    nextAction: 'authenticate',
    checkedAt: new Date().toISOString(),
  })
  compareAndSwapLifecycleWorker(lifecycle, before, authenticating)
  clearTerminalAuthProbeMethods(input.workerId)

  let restoredAfterAbort = false
  const restoreAfterAbort = () => {
    if (restoredAfterAbort) return
    restoredAfterAbort = true
    try {
      compareAndSwapLifecycleWorker(lifecycle, authenticating, before)
      if (privateMethodsBefore) {
        recordTerminalAuthProbeMethods({ worker: before, methods: privateMethodsBefore })
      }
    } catch {
      // A concurrent lifecycle change owns the current Worker; never overwrite it.
    }
  }
  deps.signal?.addEventListener('abort', restoreAfterAbort, { once: true })
  let result: CapabilityProbeResult
  try {
    result = await callProbe(setup, deps)
    if (deps.signal?.aborted) {
      restoreAfterAbort()
      deps.signal.throwIfAborted()
    }
  } finally {
    deps.signal?.removeEventListener('abort', restoreAfterAbort)
  }
  assertWorkerLifecycle(lifecycle)
  const ready = result.readiness.status === 'ready' || result.readiness.status === 'degraded'
  const after = applyReadinessToWorker(authenticating, result.readiness, {
    capabilitySummary: publicCapabilitySummary(result),
    ...(ready ? { authRevision: bumpAuthRevision(before.authRevision) } : {}),
  })
  persistInstallationProbe(installation.installationId, result.readiness)
  try {
    if (ready) reconcileRegistryWorker(before, after, deps)
    compareAndSwapLifecycleWorker(lifecycle, authenticating, after)
  } catch (error) {
    try {
      compareAndSwapLifecycleWorker(lifecycle, authenticating, before)
    } catch {
      // Leave the explicit authenticating state for operator retry/repair.
    }
    throw error
  }
  recordTerminalAuthProbeMethods({ worker: after, methods: result.authMethods })
  if (!ready) {
    const code =
      result.readiness.code && SAFE_PROBE_CODES.has(result.readiness.code)
        ? result.readiness.code
        : 'WORKER_AUTH_FAILED'
    throw new RegistryApiError(
      code,
      result.readiness.message ?? 'Agent authentication did not become ready',
      409,
    )
  }
  return { worker: after }
}

type RegistryAuthenticateOperationDependencies = {
  manager?: RegistryOperationManager
  authenticate?: typeof apiAuthenticateWorker
}

export function apiStartAuthenticateRegistry(
  input: { workerId: string; methodId: string },
  deps: RegistryAuthenticateOperationDependencies = {},
): RegistryOperationSnapshot<Awaited<ReturnType<typeof apiAuthenticateWorker>>> {
  try {
    assertRegistryWorkerId(input.workerId)
    assertRegistryAuthMethodId(input.methodId)
  } catch (error) {
    if (error instanceof RegistryInputValidationError) {
      throw new RegistryApiError(error.code, error.message, error.httpStatus)
    }
    throw error
  }
  const manager = deps.manager ?? registryOperationManager
  const authenticate = deps.authenticate ?? apiAuthenticateWorker
  return manager.start({
    kind: 'authenticate',
    run: async (signal, report) => {
      report({ stage: 'authenticating', progress: 0.1 })
      return authenticate(input, { signal })
    },
    mapError: (error) => {
      const projected = publicError(error)
      return { code: projected.code, error: projected.error }
    },
  })
}

// ── Logout ──

export async function apiLogoutWorker(workerId: string, deps: RegistryLifecycleDependencies = {}) {
  const before = findEnabledRegistryWorker(workerId)
  const canLogout = before.capabilitySummary?.authLogout === true
  if (!canLogout) {
    throw new RegistryApiError(
      'WORKER_NOT_READY',
      'Agent did not advertise auth.logout capability',
      409,
    )
  }
  // Fail closed before the external logout mutates agent-side credentials.
  clearTerminalAuthProbeMethods(workerId)
  const setup = spawnedSetupInput(before, deps)
  const lifecycle = beginWorkerLifecycle(workerId)
  let logout: SpawnedAcpLogoutResult
  try {
    logout = await (deps.logoutSpawnedAgent ?? logoutSpawnedAgent)(setup)
  } catch {
    throw new RegistryApiError('WORKER_AUTH_FAILED', 'Agent logout failed', 409)
  }
  if (!logout.ok || logout.code !== 'LOGOUT_SUCCEEDED') {
    throw new RegistryApiError(
      logout.code === 'LOGOUT_UNSUPPORTED' ? 'WORKER_NOT_READY' : 'WORKER_AUTH_FAILED',
      logout.code === 'LOGOUT_UNSUPPORTED'
        ? 'Agent does not support logout'
        : 'Agent logout failed',
      409,
    )
  }
  const after = applyReadinessToWorker(
    before,
    {
      status: 'auth_required',
      code: 'WORKER_AUTH_REQUIRED',
      message: 'Logged out; re-authenticate before dispatch',
      nextAction: 'authenticate',
      checkedAt: new Date().toISOString(),
    },
    { authRevision: bumpAuthRevision(before.authRevision) },
  )
  try {
    compareAndSwapLifecycleWorker(lifecycle, before, after)
  } catch {
    persistLogoutRepairState(workerId, true)
    clearTerminalAuthProbeMethods(workerId)
    throw new RegistryApiError(
      'WORKER_AUTH_FAILED',
      'Logged out; Worker authentication state requires repair',
      409,
    )
  }
  try {
    reconcileRegistryWorker(before, after, deps, { preserveSessionHistory: true })
  } catch {
    try {
      compareAndSwapLifecycleWorker(lifecycle, after, logoutRepairWorker(after, false))
    } catch {
      persistLogoutRepairState(workerId, false)
    }
    clearTerminalAuthProbeMethods(workerId)
    throw new RegistryApiError(
      'WORKER_AUTH_FAILED',
      'Logged out; Worker authentication state requires repair',
      409,
    )
  }
  clearTerminalAuthProbeMethods(workerId)
  return { worker: after }
}

// ── Uninstall / delete worker ──

function workerInstallationId(worker: WorkerRegistration): string | undefined {
  return (
    worker.installationId ??
    (worker.source?.type === 'registry' ? worker.source.installationId : undefined)
  )
}

function referencedInstallationIds(
  manager: InstallationReferenceManager = getAcpSessionManager(),
  options: { excludeWorkerId?: string } = {},
): Set<string> {
  let references: ReturnType<InstallationReferenceManager['listInstallationReferences']>
  try {
    references = manager.listInstallationReferences()
  } catch {
    throw new RegistryApiError(
      'ACP_INSTALL_FAILED',
      'Session storage must be available before cleaning up installations',
      409,
    )
  }
  const installationIds = new Set(references.installationIds)
  for (const worker of store().listWorkers()) {
    if (worker.id === options.excludeWorkerId) continue
    const installationId = workerInstallationId(worker)
    if (!installationId) continue
    // Current Workers are an independent fail-closed source of truth. Legacy
    // catalog rows are mapped through the same current Worker identity.
    installationIds.add(installationId)
  }
  return installationIds
}

export function apiDeleteWorker(
  input: {
    workerId: string
    removeUnreferencedInstallation?: boolean
  },
  deps: RegistryCleanupDependencies = {},
) {
  const worker = findWorker(input.workerId)
  if (store().countOpenJobs({ workerId: input.workerId }) > 0) {
    throw new RegistryApiError(
      'WORKER_HAS_OPEN_JOBS',
      'Cancel or finish every open Job for this Worker before deleting it',
      409,
    )
  }
  if (
    store()
      .snapshot()
      .roleDefinitions.some((role) => role.workerId === input.workerId && !role.archivedAt)
  ) {
    throw new RegistryApiError(
      'WORKER_REFERENCED_BY_ROLE',
      'Archive every active role definition that uses this Worker before deleting it',
      409,
    )
  }
  // Deletion becomes an execution boundary at the first lifecycle action.
  clearTerminalAuthProbeMethods(input.workerId)
  const lifecycle = beginWorkerLifecycle(input.workerId)
  const manager = deps.manager ?? getAcpSessionManager()
  const repair = applyReadinessToWorker(worker, {
    status: 'failed',
    code: 'ACP_INSTALL_FAILED',
    message: 'Worker deletion requires repair before retrying',
    nextAction: 'retry',
    checkedAt: new Date().toISOString(),
  })
  compareAndSwapLifecycleWorker(lifecycle, worker, repair)
  try {
    manager.deleteContextByWorker(input.workerId)
  } catch {
    throw new RegistryApiError(
      'ACP_INSTALL_FAILED',
      'Worker deletion requires repair before retrying',
      409,
    )
  }
  try {
    ;(deps.catalogStore ?? getWorkerModelCatalogStore()).deleteWorker(input.workerId)
  } catch {
    throw new RegistryApiError(
      'ACP_INSTALL_FAILED',
      'Worker deletion requires repair before retrying',
      409,
    )
  }
  const sessionReferences = input.removeUnreferencedInstallation
    ? referencedInstallationIds(manager, { excludeWorkerId: input.workerId })
    : undefined
  try {
    assertWorkerLifecycle(lifecycle)
    store().compareAndRemoveWorker(repair)
  } catch {
    throw new RegistryApiError(
      'ACP_INSTALL_FAILED',
      'Worker deletion requires repair before retrying',
      409,
    )
  }
  let detach: ReturnType<typeof detachWorkerFromInstallation>
  try {
    detach = (deps.detachWorker ?? detachWorkerFromInstallation)({
      worker,
      removeUnreferencedInstallation: input.removeUnreferencedInstallation,
      referencedInstallationIds: sessionReferences,
    })
  } catch {
    // The Worker commit succeeded but the installation transition did not.
    // Restore an explicit non-dispatchable repair journal for a safe retry.
    try {
      store().upsertWorker(repair)
    } catch {
      // A stale installation reference still fails cleanup closed. Preserve
      // the original failure without reflecting storage internals.
    }
    throw new RegistryApiError(
      'ACP_INSTALL_FAILED',
      'Worker deletion requires repair before retrying',
      409,
    )
  }
  clearTerminalAuthProbeMethods(input.workerId)
  return { ...detach, snapshot: store().snapshot() }
}

export function apiListCleanupCandidates(deps: RegistryCleanupDependencies = {}) {
  const sessionReferences = referencedInstallationIds(deps.manager ?? getAcpSessionManager())
  return {
    installations: listUnreferencedInstallations()
      .filter((installation) => !sessionReferences.has(installation.installationId))
      .map((i) => ({
        installationId: i.installationId,
        registryId: i.registryId,
        registryVersion: i.registryVersion,
        status: i.status,
      })),
  }
}

export function apiMarkInstallationRemoved(
  installationId: string,
  deps: RegistryCleanupDependencies = {},
) {
  const rec = findInstallationById(installationId)
  if (!rec) {
    throw new RegistryApiError('ACP_INSTALL_FAILED', 'installation not found', 404)
  }
  if (referencedInstallationIds(deps.manager ?? getAcpSessionManager()).has(installationId)) {
    throw new RegistryApiError(
      'ACP_INSTALL_FAILED',
      'Installation is still referenced by an active or persisted Session',
      409,
    )
  }
  try {
    markInstallationRemoved(installationId)
  } catch (e) {
    throw new RegistryApiError(
      'ACP_INSTALL_FAILED',
      e instanceof Error ? e.message : String(e),
      409,
    )
  }
  return { installationId, status: 'removed' as const }
}

type CandidateSwitchInput = {
  registryId: string
  version: string
  distribution: AcpRegistryDistributionKind
  manifestDigest: string
  trust?: RegistryPrepareBody['trust']
}

async function probeAndCommitRegistryCandidate(input: {
  before: WorkerRegistration
  candidate: CandidateSwitchInput
  deps: RegistryLifecycleDependencies
  lifecycle: WorkerLifecycleToken
}): Promise<{ worker: WorkerRegistration; installationId: string }> {
  const prepared = await (input.deps.prepareRegistryWorker ?? prepareRegistryWorker)({
    body: input.candidate,
  })
  assertWorkerLifecycle(input.lifecycle)

  let temporary: WorkerRegistration | undefined
  try {
    temporary = await registerRegistryWorker({
      body: {
        registryId: input.candidate.registryId,
        version: input.candidate.version,
        distribution: input.candidate.distribution,
        manifestDigest: input.candidate.manifestDigest,
        installationId: prepared.installation.installationId,
        name: input.before.name,
        primaryRole: input.before.primaryRole,
        roles: input.before.roles,
        enabled: input.before.enabled,
      },
      existingWorkers: store().listWorkers(),
    })
  } finally {
    if (temporary) {
      removeWorkerReference(prepared.installation.installationId, temporary.id)
    }
  }
  assertWorkerLifecycle(input.lifecycle)

  const candidate: WorkerRegistration = {
    ...input.before,
    command: temporary.command,
    args: [...temporary.args],
    env: temporary.env ? { ...temporary.env } : undefined,
    source: temporary.source,
    installationId: temporary.installationId,
    launchSpec: temporary.launchSpec,
    runtimeProfile: temporary.runtimeProfile ?? 'generic-acp',
    readiness: {
      status: 'initializing',
      message: 'Initializing Registry candidate',
      nextAction: 'retry',
      checkedAt: new Date().toISOString(),
    },
  }
  const probe = await callProbe(spawnedSetupInput(candidate, input.deps), input.deps)
  assertWorkerLifecycle(input.lifecycle)
  persistInstallationProbe(prepared.installation.installationId, probe.readiness)
  if (probe.readiness.status !== 'ready') {
    throw new RegistryApiError(
      probe.readiness.code === 'WORKER_AUTH_REQUIRED' ? 'WORKER_AUTH_REQUIRED' : 'WORKER_NOT_READY',
      probe.readiness.code === 'WORKER_AUTH_REQUIRED'
        ? 'Registry candidate requires authentication'
        : 'Registry candidate probe failed',
      409,
    )
  }

  const after = applyReadinessToWorker(candidate, probe.readiness, {
    capabilitySummary: publicCapabilitySummary(probe),
  })
  const newInstallationId = prepared.installation.installationId
  const oldInstallationId =
    input.before.installationId ??
    (input.before.source?.type === 'registry' ? input.before.source.installationId : undefined)

  addWorkerReference(newInstallationId, input.before.id)
  try {
    compareAndSwapLifecycleWorker(input.lifecycle, input.before, after)
  } catch (error) {
    removeWorkerReference(newInstallationId, input.before.id)
    throw error
  }

  try {
    reconcileRegistryWorker(input.before, after, input.deps, {
      preserveSessionHistory: true,
    })
  } catch {
    try {
      compareAndSwapLifecycleWorker(input.lifecycle, after, input.before)
      removeWorkerReference(newInstallationId, input.before.id)
    } catch {
      throw new RegistryApiError(
        'ACP_INSTALL_FAILED',
        'Registry switch requires repair before retrying',
        409,
      )
    }
    throw new RegistryApiError(
      'ACP_INSTALL_FAILED',
      'Registry switch resource reconciliation failed',
      409,
    )
  }

  if (oldInstallationId && oldInstallationId !== newInstallationId) {
    try {
      detachWorkerFromInstallation({ worker: input.before })
    } catch {
      try {
        addWorkerReference(oldInstallationId, input.before.id)
        compareAndSwapLifecycleWorker(input.lifecycle, after, input.before)
        removeWorkerReference(newInstallationId, input.before.id)
      } catch {
        throw new RegistryApiError(
          'ACP_INSTALL_FAILED',
          'Registry switch requires repair before retrying',
          409,
        )
      }
      throw new RegistryApiError(
        'ACP_INSTALL_FAILED',
        'Registry switch reference transition failed',
        409,
      )
    }
  }
  recordTerminalAuthProbeMethods({ worker: after, methods: probe.authMethods })
  return { worker: after, installationId: newInstallationId }
}

// ── Upgrade (prepare/probe candidate, then switch) ──

export async function apiUpgradeRegistryWorker(
  input: {
    workerId: string
    version: string
    distribution: AcpRegistryDistributionKind
    manifestDigest: string
    trust?: RegistryPrepareBody['trust']
  },
  deps: RegistryLifecycleDependencies = {},
) {
  const before = findWorker(input.workerId)
  if (before.source?.type !== 'registry') {
    throw new RegistryApiError('ACP_REGISTRY_ENTRY_INVALID', 'Worker is not Registry-managed', 409)
  }
  const lifecycle = beginWorkerLifecycle(input.workerId)
  return probeAndCommitRegistryCandidate({
    before,
    candidate: {
      registryId: before.source.registryId,
      version: input.version,
      distribution: input.distribution,
      manifestDigest: input.manifestDigest,
      trust: input.trust,
    },
    deps,
    lifecycle,
  })
}

// ── Adopt custom → registry ──

export async function apiAdoptRegistryManagement(
  input: {
    workerId: string
    registryId: string
    version: string
    distribution: AcpRegistryDistributionKind
    manifestDigest: string
    trust?: RegistryPrepareBody['trust']
  },
  deps: RegistryLifecycleDependencies = {},
) {
  const before = findWorker(input.workerId)
  const lifecycle = beginWorkerLifecycle(input.workerId)
  return probeAndCommitRegistryCandidate({
    before,
    candidate: {
      registryId: input.registryId,
      version: input.version,
      distribution: input.distribution,
      manifestDigest: input.manifestDigest,
      trust: input.trust,
    },
    deps,
    lifecycle,
  })
}

/** Spawn env for a worker including scoped secrets (for probe/session). */
export function buildWorkerSpawnEnv(worker: WorkerRegistration): Record<string, string> {
  const snapshot = loadWorkerSecretsSnapshotForSpawn(worker.id)
  return buildEffectiveWorkerEnv({
    ambientEnv: process.env,
    workerEnv: worker.env,
    workerSecrets: snapshot.secrets,
  })
}

export function workerFingerprintExtras(worker: WorkerRegistration): {
  installationId?: string
  manifestDigest?: string
  runtimeProfile?: string
  authRevision?: number
  workerSecretRevisionHmac?: string
} {
  return {
    installationId: worker.installationId,
    manifestDigest: worker.source?.type === 'registry' ? worker.source.manifestDigest : undefined,
    runtimeProfile: worker.runtimeProfile,
    authRevision: worker.authRevision,
    workerSecretRevisionHmac: workerSecretsFingerprintHmac(worker.id),
  }
}

// re-export local catalog resolve for tests
export { resolveLocalRegistryCatalog }
