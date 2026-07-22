export { resolveWorkerCwd } from './presets.js'
export { whichSync } from './which.js'
export {
  checkWorkerCommand,
  probeWorkerHealth,
  applyHealthReport,
  acpHealthFromJobOutcome,
  isHardAcpJobFailure,
  parseHealthDepth,
  healthHintsForKind,
  type ProbeOptions,
  type ProbeDepth,
  type SpawnProbeResult,
} from './health.js'
export {
  selectWorkerByRole,
  listWorkersForRole,
  type SelectWorkerOptions,
} from './select-worker.js'
export { buildAcpSpawnConfig, type AcpSpawnConfig } from './acp-config.js'
export {
  dispatchToWorker,
  type DispatchRequest,
  type DispatchResult,
  type DispatchMode,
} from './dispatch.js'
export {
  defaultCanRunAcp,
  runAcpTask,
  listAcpModels,
  resolveWorkerModelsTimeoutMs,
  DEFAULT_WORKER_MODELS_TIMEOUT_MS,
  MAX_WORKER_MODELS_TIMEOUT_MS,
  type RunAcpTaskOptions,
  type ListAcpModelsResult,
} from './acp-runner.js'
export {
  ACP_REGISTRY_URL,
  fetchAcpRegistryCatalog,
  fetchAcpRegistryCatalogV2,
  parseAcpRegistryCatalog,
  parseAcpRegistryCatalogV2,
  projectAgentToWorkerOption,
  resolveAcpRegistryTarget,
  resolveAcpRegistryTargetOrError,
  launchSpecFromAgent,
  type AcpRegistryCatalog,
  type AcpRegistryWorkerOption,
} from './acp-registry.js'
export {
  packageDistributionToLaunchSpec,
  binaryDistributionToLaunchSpec,
  pickDefaultLaunchSpec,
  materializeCommandArgs,
} from './acp-launch-spec.js'
export {
  SUPPORTED_REGISTRY_SCHEMA_MAJOR,
  BUNDLED_REGISTRY_SCHEMA_VERSION,
  REGISTRY_TOP_LEVEL_COMPAT_PROPERTIES,
  ACP_REGISTRY_CDN,
  parseSchemaMajor,
  isSupportedRegistrySchemaVersion,
} from './bundled/acp-registry-compatibility.js'
export {
  AcpRegistrySchemaError,
  assertSupportedRegistrySchemaVersion,
  digestOfAgentEntry,
  digestOfRegistryPayload,
  canonicalJson,
  sha256HexOfCanonical,
} from './acp-registry-schema.js'
export { BUNDLED_ACP_REGISTRY_META } from './bundled/acp-registry-meta.js'
export {
  BUNDLED_ACP_REGISTRY_ARTIFACTS,
  verifyBundledAcpRegistryArtifacts,
  type BundledAcpRegistryVerification,
} from './acp-registry-bundled.js'
export type { AcpRegistryTarget, AcpRegistryDistributionKind } from '@swarmdesk-agent/shared'
export {
  resolveAcpRunner,
  resolveRunnerAbsolutePath,
  buildPackageAgentArgv,
  AcpRunnerError,
  type ResolvedRunner,
  type AcpRunnerKind,
} from './acp-runner-resolver.js'
export {
  extractArchiveSafe,
  safeResolveEntryPath,
  detectArchiveKind,
  sha256File,
  assertExecutableInsideStaging,
  AcpArchiveError,
  ARCHIVE_LIMITS,
} from './acp-archive-reader.js'
export {
  prepareRegistryAgent,
  validatePreparedRegistryInstallation,
  installationTargetDir,
  cleanupStaging,
  AcpInstallError,
  type PrepareRequest,
  type PrepareResult,
  type PrepareTrustDecision,
} from './acp-agent-installer.js'
export {
  prepareOpenCodeAcpEnv,
  pickOpenCodeAcpModel,
  OPENCODE_SAFE_DEFAULT_MODEL,
  OPENCODE_ZEN_FREE_MODELS,
  ModelEligibilityError,
  type OpenCodeAcpPrep,
  type PickOpenCodeAcpModelOpts,
} from './opencode-acp-env.js'
export {
  readAuthProviderIds,
  readDisabledProviders,
  resolveOpenCodeEvidencePaths,
  type OpenCodeEvidencePaths,
} from './opencode-models.js'
export {
  evaluateModelEligibility,
  buildShortlistAndSearchIndex,
  buildProviderEvidenceMap,
  validateModelPin,
  resolveEligibilityCandidates,
  projectPinIntoAvailableModels,
  resolvePinState,
  buildCurrentEligibilityEvidence,
  getProviderId,
  type ProviderEvidence,
  type EligibilityPurpose,
  type EligibilityInput,
  type EligibilityResult,
  type ValidateModelPinResult,
  type ResolvedPinState,
} from './model-eligibility.js'
export {
  isModelDisabledError,
  publicErrorMessage,
  formatPublicError,
  formatWorkerModelError,
  summarizeWorkerModels,
  type FormatWorkerModelErrorOpts,
  type PublicErrorCode,
  type PublicErrorLocale,
} from './acp-errors.js'
export {
  withAcpSession,
  AcpSessionError,
  mapPermissionRequest,
  InvalidAcpApprovalOptionsError,
  type AcpPermissionRequest,
  type AcpSessionConfig,
  type AcpSessionCallbacks,
  type AcpSessionHandle,
  type AcpPromptResult,
} from './acp-session.js'
export { extractModelOptions, type ModelOptionsResult } from './acp-model-options.js'
export {
  computeShortlistedModels,
  type ShortlistEntry,
  type ShortlistReason,
  type ShortlistResult,
} from './acp-model-shortlist.js'
export {
  resolveContainedPath,
  resolveContainedParent,
  readContainedText,
  writeContainedText,
  DEFAULT_MAX_FILE_BYTES,
  DEFAULT_WRITE_MAX_BYTES,
} from './acp-filesystem.js'
export {
  AcpSessionManager,
  getAcpSessionManager,
  resetAcpSessionManager,
  buildSessionReuseKey,
  computeExecutionFingerprint,
  computeKeyDigest,
  applyPinnedModelOrThrow,
  workerExecutionConfigChanged,
  type AcpFingerprintInput,
  type AcpFingerprintFn,
  type SessionReuseKey,
  type SessionEntryConfig,
  type WorkerExecutionConfig,
  type PromptBinding,
  type EnqueuePromptRequest,
  type EnqueuePromptResult,
  type AcpSessionManagerConfig,
  type AcpRecoveryError,
  type OnSessionReadyResult,
  type SessionDisposition,
} from './acp-session-manager.js'
export {
  AcpSessionDriver,
  AcpSessionRuntimeError,
  isAcpSessionRuntimeError,
  normalizeStopReason,
  type PromptResult,
  type AcpRuntimeErrorCode,
  type InitializeDriverOptions,
  type NormalizedStopReason,
} from './acp-session-driver.js'
export {
  type AcpSessionCatalogPort,
  type AcpSessionCatalogRecord,
} from './acp-session-catalog-port.js'
export { cleanupRemoteAcpSession, type AcpRemoteCleanupConfig } from './acp-remote-cleanup.js'
export {
  buildEffectiveWorkerEnv,
  credentialKeysForModel,
  type BuildEffectiveWorkerEnvOpts,
} from './worker-env.js'
export {
  isAuthRequiredError,
  isRequestError,
  sanitizeAuthMethods,
  toPublicAuthMethodSummary,
  type SanitizedAuthMethod,
} from './acp-auth.js'
export {
  probeConnectedAgent,
  probeSpawnedAgent,
  logoutSpawnedAgent,
  readinessForSpawnFailure,
  readinessPrepared,
  type CapabilityProbeResult,
  type CapabilityProbeOptions,
  type CapabilityProbeCode,
  type SpawnedAcpSetupInput,
  type SpawnedAcpLogoutCode,
  type SpawnedAcpLogoutResult,
} from './acp-capability-probe.js'
