import type { WorkerRole } from './roles.js'

export type SessionStatus = 'idle' | 'running' | 'needs_approval' | 'error'

export type LeaderMode = 'ask' | 'plan' | 'build' | 'review'

/**
 * CLI product family / brand bucket — NOT a Registry ID enum.
 * Registry agents stay `custom` (or keep legacy kinds for builtins) and use
 * `source` + `runtimeProfile` for execution branching.
 */
export type WorkerKind = 'claude' | 'codex' | 'opencode' | 'custom'

/** Platform target string used by ACP Registry binary distributions. */
export type AcpRegistryTarget =
  | 'darwin-aarch64'
  | 'darwin-x86_64'
  | 'linux-aarch64'
  | 'linux-x86_64'
  | 'windows-aarch64'
  | 'windows-x86_64'

export type AcpRegistryDistributionKind = 'binary' | 'npx' | 'uvx'
export type CustomAcpLaunchKind = 'auto' | 'npx' | 'uvx' | 'system' | 'local'

/** How the Worker is managed for install / version / trust. */
export type WorkerSource =
  | {
      type: 'registry'
      registryId: string
      registryVersion: string
      registrySchemaVersion: string
      manifestDigest: string
      distribution: AcpRegistryDistributionKind
      target?: AcpRegistryTarget
      installationId: string
    }
  | { type: 'custom'; launchKind?: CustomAcpLaunchKind; launchDigest?: string }

/**
 * Runtime execution profile (small set of verified overrides).
 * generic-acp is the default for unknown Registry agents.
 */
export type WorkerRuntimeProfile = 'generic-acp' | 'claude' | 'codex' | 'opencode'

/**
 * Structured launch plan for Registry / custom workers.
 * `command/args` on WorkerRegistration remain the materialized projection.
 */
export interface WorkerLaunchSpec {
  distribution: AcpRegistryDistributionKind | 'custom'
  runnerCommand?: string
  runnerArgs: string[]
  packageSpec?: string
  executable?: string
  /** Verified interpreter for managed script entrypoints (for example node.exe on Windows). */
  interpreter?: string
  agentArgs: string[]
  env: Record<string, string>
  artifact?: {
    archiveUrl: string
    declaredSha256?: string
    observedSha256?: string
    executableRelativePath: string
  }
}

export interface CustomAcpRegistrationInput {
  name: string
  /** Omit or set to 'auto' to let the backend detect npx/uvx/system/local from the command. */
  launchKind?: CustomAcpLaunchKind
  /** Required for npx/uvx. */
  packageSpec?: string
  /** Required for system/local executable launch. */
  command?: string
  args?: string[]
  env?: Record<string, string>
  description?: string
  defaultModel?: string
  enabled?: boolean
  /**
   * Registry agent id used for the worker icon.
   * - omit / undefined → auto-match from name+command against the local catalog
   * - non-empty string → use that agent icon
   * - empty string → no registry icon (brand fallback only)
   */
  iconAgentId?: string
  /** Confirm-time: allow persisting despite a probe failure (incompatible/failed). */
  force?: boolean
  /** Confirm-time: acknowledge the duplicate-CLI conflict and add anyway. */
  duplicateDecision?: 'add_anyway'
}

/** ACP agent identity + capabilities surfaced from the initialize handshake, for confirmation UI. */
export interface CustomAcpPreviewCandidate {
  agentName?: string
  agentVersion?: string
  command: string
  args: string[]
  protocolVersion?: number
  sessionLoad?: boolean
  sessionResume?: boolean
  sessionList?: boolean
  authLogout?: boolean
  authMethods: Array<{ id: string; name?: string; description?: string; type?: string }>
  readiness: Pick<WorkerReadiness, 'status' | 'code' | 'message'>
}

/** An existing worker that clashes with the candidate (same agentName or same command). */
export interface CustomAcpConflictCandidate {
  workerId: string
  name: string
  agentName?: string
  agentVersion?: string
  command: string
  readinessStatus: WorkerReadiness['status']
}

/** Result of the preview step: what the agent reported + any existing duplicates. Never persists. */
export interface CustomAcpPreview {
  candidate: CustomAcpPreviewCandidate
  conflicts: CustomAcpConflictCandidate[]
}

/**
 * Local readiness after prepare / initialize / auth / session-new.
 * cataloged ≠ ready.
 */
export type WorkerReadinessStatus =
  | 'cataloged'
  | 'preparing'
  | 'prepared'
  | 'initializing'
  | 'auth_required'
  | 'authenticating'
  | 'ready'
  | 'degraded'
  | 'incompatible'
  | 'failed'

export type WorkerReadinessNextAction =
  | 'none'
  | 'install_runner'
  | 'prepare'
  | 'confirm_trust'
  | 'authenticate'
  | 'open_terminal_auth'
  | 'configure_env_secret'
  | 'upgrade_application'
  | 'retry'
  | 'view_logs'

export interface WorkerReadiness {
  status: WorkerReadinessStatus
  code?: string
  message?: string
  checkedAt?: string
  nextAction?: WorkerReadinessNextAction
}

/** Stable public error codes (design §15). */
export const ACP_PUBLIC_ERROR_CODES = [
  'ACP_REGISTRY_UNAVAILABLE',
  'ACP_REGISTRY_SCHEMA_UNSUPPORTED',
  'ACP_REGISTRY_ENTRY_INVALID',
  'ACP_PLATFORM_UNSUPPORTED',
  'ACP_RUNNER_MISSING',
  'ACP_INSTALL_TRUST_REQUIRED',
  'ACP_INSTALL_DIGEST_MISMATCH',
  'ACP_INSTALL_ARCHIVE_UNSAFE',
  'ACP_INSTALL_DOWNLOAD_FAILED',
  'ACP_INSTALL_FAILED',
  'ACP_PROTOCOL_INCOMPATIBLE',
  'WORKER_AUTH_REQUIRED',
  'WORKER_AUTH_FAILED',
  'WORKER_NOT_READY',
  'WORKER_HAS_OPEN_JOBS',
  'WORKER_REFERENCED_BY_ROLE',
  'WORKER_DUPLICATE_REGISTRY',
  'WORKER_DUPLICATE_NAME',
  'ACP_REASONING_UNSUPPORTED',
  'ACP_REASONING_VALUE_UNAVAILABLE',
  'ACP_REASONING_CONFIGURATION_FAILED',
] as const

export type AcpPublicErrorCode = (typeof ACP_PUBLIC_ERROR_CODES)[number]

export function isAcpPublicErrorCode(v: unknown): v is AcpPublicErrorCode {
  return typeof v === 'string' && (ACP_PUBLIC_ERROR_CODES as readonly string[]).includes(v)
}

/** Catalog snapshot availability for UI / API. */
export type AcpRegistrySnapshotStatus =
  'bundled' | 'persisted' | 'remote' | 'stale' | 'update_required'

export interface AcpRegistryAuthor {
  name: string
  url?: string
}

export interface AcpRegistryPackageDistribution {
  kind: 'npx' | 'uvx'
  package: string
  args: string[]
  env: Record<string, string>
}

export interface AcpRegistryBinaryTarget {
  target: AcpRegistryTarget
  archiveUrl: string
  sha256?: string
  cmd: string
  args: string[]
  env: Record<string, string>
}

export interface AcpRegistryBinaryDistribution {
  kind: 'binary'
  targets: AcpRegistryBinaryTarget[]
}

export type AcpRegistryDistribution = AcpRegistryPackageDistribution | AcpRegistryBinaryDistribution

export type AcpRegistryAgentAvailability =
  'available' | 'unsupported_platform' | 'invalid_manifest' | 'unknown'

/**
 * Full Registry agent metadata retained from catalog (non-secret).
 * All distributions are preserved — parser must not pick a single winner.
 */
export interface AcpRegistryAgentMetadata {
  id: string
  name: string
  version: string
  description: string
  repository?: string
  website?: string
  authors?: AcpRegistryAuthor[]
  license?: string
  icon?: string
  distributions: AcpRegistryDistribution[]
  /** Canonical digest of the agent entry for trust / TOCTOU checks. */
  manifestDigest: string
  availability: AcpRegistryAgentAvailability
  availabilityMessage?: string
}

export interface AcpRegistryCatalogSnapshot {
  schemaVersion: string
  version: string
  source: AcpRegistrySnapshotStatus
  fetchedAt?: string
  digest: string
  etag?: string
  agents: AcpRegistryAgentMetadata[]
  stale?: boolean
  updateRequired?: boolean
  diagnosticCode?: string
  diagnosticMessage?: string
}

/**
 * Default roles for a newly registered Registry agent.
 * Never infer roles from description text.
 */
export function defaultRegistryWorkerRoles(): {
  primaryRole: WorkerRole
  roles: WorkerRole[]
} {
  return { primaryRole: 'general', roles: ['general'] }
}
