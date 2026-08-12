import type {
  WorkerKind,
  WorkerLaunchSpec,
  WorkerReadiness,
  WorkerRuntimeProfile,
  WorkerSource,
} from './worker-acp.js'
import type { WorkerRole } from './roles.js'

export type WorkerCapability = 'code-edit' | 'review' | 'research' | 'test' | 'general' | 'plan'

/** Aggregated worker health status (UI + routing). */
export type WorkerHealthStatus = 'unknown' | 'healthy' | 'unhealthy' | 'missing'

/** CLI presence/version health (independent of ACP). */
export type CommandHealthStatus = 'unknown' | 'healthy' | 'missing' | 'unhealthy'

/** ACP boundary health (initialize/session/config/prompt). */
export type AcpHealthStatus = 'unknown' | 'ready' | 'degraded' | 'unavailable'

export interface CommandHealth {
  status: CommandHealthStatus
  checkedAt?: string
}

export interface AcpHealth {
  status: AcpHealthStatus
  checkedAt?: string
  lastSuccessAt?: string
  errorCode?: string
}

/** How deep a health probe ran. */
export type HealthProbeLevel = 'presence' | 'version' | 'acp_handshake'

/**
 * Structured result of a worker health probe.
 * @see packages/adapters health probe
 */
export interface WorkerHealthReport {
  status: WorkerHealthStatus
  /** Deepest level actually executed */
  level: HealthProbeLevel
  checkedAt: string
  latencyMs?: number
  /** One-line human reason */
  message?: string
  /** Short version string if captured */
  version?: string
  /** Actionable install / fix tips */
  hints?: string[]
  detail?: {
    exitCode?: number | null
    errorCode?: string
    stderrTail?: string
    /** spawn_only = process start probe, not real ACP session */
    probeKind?: 'spawn_only' | 'acp_session'
  }
}

/** Selectable model advertised by an ACP agent (or user-entered). */
export interface WorkerModelOption {
  modelId: string
  name: string
  description?: string
  /** UI grouping hint set after shortlisting */
  group?: 'shortlist' | 'openrouter' | 'other'
}

export type ProviderEvidenceState = 'free' | 'authenticated' | 'disabled' | 'unknown'

export type ModelCatalogState = 'empty' | 'fresh' | 'stale'

/**
 * Current worker pin availability — separate from availableModels shortlist.
 * Unavailable pins are never injected into shortlist/searchIndex.
 */
export interface WorkerModelPinState {
  modelId: string
  status: 'available' | 'unavailable' | 'unknown'
  reasonCode?: string
}

export interface WorkerReasoningOption {
  value: string
  name: string
  description?: string
}

export interface WorkerReasoningSelector {
  configId: string
  currentValue?: string
  options: WorkerReasoningOption[]
}

export interface WorkerReasoningCatalogEntry {
  model?: string
  supported: boolean
  selector?: WorkerReasoningSelector
  fetchedAt: string
  expiresAt: string
  lastErrorCode?: string
  lastSuccessfulFetchedAt?: string
}

/** Full worker model catalog (shortlist + search index). Not part of app snapshot. */
export interface WorkerModelCatalog {
  /** v1: shortlist/search only; v2: raw candidates + evidence revision + reasoning entries */
  version: 1 | 2
  workerId: string
  /**
   * Project/cwd scope digest. Empty/undefined = global (legacy workerId-only key).
   * Catalogs are stored under `storageKey = scope ? workerId::scope : workerId`.
   */
  scopeKey?: string
  /** Canonical project root / cwd used for discovery when scoped */
  projectRoot?: string
  source: 'acp_config_options'
  fetchedAt: string
  expiresAt: string
  providers: Array<{ providerId: string; state: ProviderEvidenceState }>
  shortlist: WorkerModelOption[]
  searchIndex: WorkerModelOption[]
  /** Full ACP candidate model ids (membership for pin), even when not shortlisted */
  rawCandidateIds?: string[]
  /** Non-secret revision of provider evidence used at discovery */
  evidenceRevision?: string
  lastErrorCode?: string
  lastSuccessfulFetchedAt?: string
  /** Per-model ACP reasoning catalog entries (v2 only). Key = model id. */
  reasoning?: Record<string, WorkerReasoningCatalogEntry>
}

/** Build catalog map key: workerId or workerId::scopeKey */
export function workerModelCatalogStorageKey(workerId: string, scopeKey?: string | null): string {
  const s = scopeKey?.trim()
  return s ? `${workerId}::${s}` : workerId
}

export interface WorkerRegistration {
  id: string
  name: string
  kind: WorkerKind
  /** Executable or package runner, e.g. npx / opencode */
  command: string
  args: string[]
  env?: Record<string, string>
  /** @deprecated Execution compatibility metadata; Chat routing uses TeamMember.roleType. */
  primaryRole: WorkerRole
  /** @deprecated Execution compatibility metadata; every ready Worker may back any Chat role. */
  roles: WorkerRole[]
  capabilities: WorkerCapability[]
  enabled: boolean
  /** Global vs project-scoped */
  scope: 'global' | 'project'
  projectId?: string
  description: string
  /** Default role type when the user adds this Worker as a Team member. */
  defaultRoleType: WorkerRole
  /** Shortcut = worst of cliHealth and acpSessionHealth (kept for compatibility) */
  health: WorkerHealthStatus
  /** Whether the CLI binary exists and can start */
  cliHealth?: WorkerHealthStatus
  /** Whether the ACP session can actually work */
  acpSessionHealth?: WorkerHealthStatus
  /** CLI presence/version (preferred over cliHealth) */
  commandHealth?: CommandHealth
  /** ACP boundary health (preferred over acpSessionHealth) */
  acpHealth?: AcpHealth
  lastSeenAt?: string
  /** Latest probe report (message, hints, latency) */
  healthReport?: WorkerHealthReport
  /**
   * ACP model id for session/set_config_option (optional).
   * Stable config option validated against session-announced options.
   */
  model?: string
  /** Cached list from last ACP configOptions parse */
  availableModels?: WorkerModelOption[]
  /** When availableModels was last fetched */
  modelsFetchedAt?: string
  /** Fresh after successful refresh; stale after failed refresh with old cache retained */
  modelsState?: 'fresh' | 'stale'
  /** Model catalog freshness: empty | fresh | stale (preferred over modelsState) */
  modelCatalogState?: ModelCatalogState
  /** Most recent model refresh error (truncated, no secrets) */
  modelsError?: string
  /**
   * Install / version ownership. New Workers are Registry-managed or explicitly custom-registered.
   */
  source?: WorkerSource
  /** Execution branching profile (small override set). */
  runtimeProfile?: WorkerRuntimeProfile
  /** Structured launch plan; command/args remain the projection. */
  launchSpec?: WorkerLaunchSpec
  /** Points into acp-agent-installations.json when managed by Registry. */
  installationId?: string
  /** Local path to the cached registry icon (SVG), if prepared. */
  iconPath?: string
  /** Registry agent id used to resolve an icon when no prepared iconPath exists
   *  (e.g. custom-registered workers matched against the catalog). */
  iconAgentId?: string
  /** Prepare / auth / session readiness (not the same as command health). */
  readiness?: WorkerReadiness
  /**
   * Monotonic auth/credential revision for fingerprint invalidation.
   * Never stores secret values.
   */
  authRevision?: number
  /**
   * Default ACP reasoning intensity value (raw Agent string).
   * Absent means use ACP Agent default.
   */
  reasoning?: string
  /** Non-sensitive capability / auth probe summary for UI. */
  capabilitySummary?: {
    protocolVersion?: number
    authMethods?: Array<{
      id: string
      name?: string
      description?: string
      type: 'agent' | 'terminal' | 'env_var' | 'unsupported'
      /** Names only; values and links remain process-private. */
      envVarNames?: string[]
      /** Non-sensitive terminal env names only; no args or values. */
      terminalEnvNames?: string[]
    }>
    sessionLoad?: boolean
    sessionResume?: boolean
    sessionList?: boolean
    authLogout?: boolean
    agentName?: string
    agentVersion?: string
    probedAt?: string
  }
}
