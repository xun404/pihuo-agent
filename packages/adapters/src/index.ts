export { WORKER_PRESETS, resolveWorkerCwd } from './presets.js'
export {
  checkWorkerCommand,
  probeWorkerHealth,
  applyHealthReport,
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
  type RunAcpTaskOptions,
  type ListAcpModelsResult,
} from './acp-runner.js'
export {
  detectAcpWorkers,
  applyDetectionToWorkers,
  whichSync,
  type AcpDetectCandidate,
  type ApplyDetectResult,
} from './detect-workers.js'
export {
  prepareOpenCodeAcpEnv,
  pickOpenCodeAcpModel,
  OPENCODE_SAFE_DEFAULT_MODEL,
  OPENCODE_ZEN_FREE_MODELS,
  type OpenCodeAcpPrep,
} from './opencode-acp-env.js'
export {
  isModelDisabledError,
  formatWorkerModelError,
  summarizeWorkerModels,
  type FormatWorkerModelErrorOpts,
} from './acp-errors.js'
export {
  withAcpSession,
  AcpSessionError,
  type AcpSessionConfig,
  type AcpSessionCallbacks,
  type AcpSessionHandle,
  type AcpPromptResult,
} from './acp-session.js'
export { extractModelOptions, type ModelOptionsResult } from './acp-model-options.js'
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
  workerExecutionConfigChanged,
  type SessionReuseKey,
  type SessionEntryConfig,
  type WorkerExecutionConfig,
  type PromptBinding,
  type EnqueuePromptRequest,
  type EnqueuePromptResult,
  type AcpSessionManagerConfig,
} from './acp-session-manager.js'
