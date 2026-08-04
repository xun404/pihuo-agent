/** Domain types shared by desktop UI, core store, and Mastra app. */

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

export type AcpToolKind =
  | 'read'
  | 'edit'
  | 'delete'
  | 'move'
  | 'search'
  | 'execute'
  | 'think'
  | 'fetch'
  | 'switch_mode'
  | 'other'

export type PermissionOptionKind = 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always'

export type SessionApprovalPolicy = 'manual' | PermissionOptionKind

export type SessionPermissionMode = 'default' | 'auto'

/** Origin recorded when a Session permission mode changes. */
export type PermissionModeChangeSource = 'manual_chat' | 'manual_panel' | 'migration'

export type PermissionTargetScope = 'inside_project' | 'outside_project' | 'unknown'

export const SESSION_PERMISSION_MODES: SessionPermissionMode[] = ['default', 'auto']

export function isValidSessionPermissionMode(v: unknown): v is SessionPermissionMode {
  return typeof v === 'string' && (SESSION_PERMISSION_MODES as string[]).includes(v)
}

export function isValidPermissionModeChangeSource(v: unknown): v is PermissionModeChangeSource {
  return v === 'manual_chat' || v === 'manual_panel' || v === 'migration'
}

export function permissionModeFromLegacyPolicy(value: unknown): SessionPermissionMode {
  return value === 'allow_once' || value === 'allow_always' ? 'auto' : 'default'
}

export type SessionDisposition = 'new' | 'live_reused' | 'resumed' | 'loaded'

export const SESSION_APPROVAL_POLICIES: SessionApprovalPolicy[] = [
  'manual',
  'allow_once',
  'allow_always',
  'reject_once',
  'reject_always',
]

export function isValidSessionApprovalPolicy(v: unknown): v is SessionApprovalPolicy {
  return typeof v === 'string' && (SESSION_APPROVAL_POLICIES as string[]).includes(v)
}

/**
 * Functional roles a worker can play when the Leader delegates.
 * Distinct from `kind` (which CLI product) and `capabilities` (raw abilities).
 */
export type WorkerRole = 'plan' | 'coder' | 'review' | 'test' | 'research' | 'general'

export const PROMPT_ROLE_ORDER = [
  'general',
  'plan',
  'coder',
  'review',
  'test',
  'research',
] as const satisfies readonly WorkerRole[]

export interface PromptSettings {
  leader: string
  roles: Record<WorkerRole, string>
}

/** Non-secret user-facing deadlines for scheduled Worker jobs. */
export interface WorkerTimeoutSettings {
  jobTimeoutMs: number
  queueTimeoutMs: number
}

/** Locale used only for built-in default prompt text (UI language). */
export type PromptLocale = 'zh' | 'en'

/** Map any UI locale to the prompt-default catalog (zh covers simplified + traditional). */
export function toPromptLocale(locale: string | undefined | null): PromptLocale {
  if (!locale) return 'zh'
  return locale === 'en' || locale.startsWith('en') ? 'en' : 'zh'
}

const LEGACY_PLAN_PROMPT_ZH =
  '作为规划角色，分析目标、约束和代码现状，输出可执行且可验证的步骤；除非明确要求，不直接实施。'
const LEGACY_PLAN_PROMPT_EN =
  'As a planning role, analyze goals, constraints, and the current codebase; produce executable and verifiable steps. Do not implement unless explicitly asked.'
const LEGACY_LEADER_PROMPT_ZH =
  '准确理解用户目标，优先复用合适的角色完成任务，并清楚说明关键决策、风险和验证结果。'
const LEGACY_LEADER_PROMPT_EN =
  'Understand the user goal accurately, prefer reusing the right roles to complete the work, and clearly explain key decisions, risks, and verification results.'

const DEFAULT_PROMPT_SETTINGS_ZH = {
  leader:
    '准确理解用户目标，优先复用合适的角色完成任务，并清楚说明关键决策、风险和验证结果。语气保持务实、简洁、直接且专注；减少非必要的 emoji，仅在确实有助于表达时使用，但不完全禁止。',
  roles: {
    general: '作为通用执行角色，完成 Leader 委派的任务并返回清晰、可验证的结果。',
    plan: '作为规划角色，只生成供其他 Agent 或工程师执行的指导性 Markdown plan，不直接实现代码。先阅读相关代码、配置和文档，定位真实入口、关键调用链与测试位置；根据范围和风险选择轻量、标准或严格档位，在 plan 中写明档位和原因，能用轻量就不扩写。除非用户指定其他路径，将中文 plan 写入 docs/superpowers/plans/YYYY-MM-DD-<topic>.md。步骤只需定位到相关文件、方法、字段、断言或验证命令，并区分代码事实、需验证假设与非目标。文件变更计划只描述文件职责、行为变化和验收结果，不写具体实现方式。禁止输出实现代码、伪代码、diff、完整 proto 或消息定义、SQL 或查询语句、方法体；也不要替 coder 决定具体语法、控制流或代码结构。所有 plan 必须包含目标、范围、计划档位、当前诊断、文件变更计划、任务拆分、测试与验证计划、文档更新要求、Todo、Check、Review Todo List 和 Result Return Area；标准或严格 plan 再按复杂度补充需求拆解、调用链、关键字段、风险与测试矩阵。Review Todo List 供后续 review 角色逐项验收，每一项关联一个用户验收标准或关键设计决策，使用复选框写明需要检查的行为和证据；它只定义审查目标和所需证据，不写实现代码，也不预判审查结论。要求 review 角色按 Review Todo List 逐项回写 PASS/FAIL、证据和未覆盖项。要求执行者完成后回写 Todo、Check、Result Return Area 和文档更新结果，并明确全部验收结束前不要提交 git。不要声称尚未验证的问题已经修复。最终只返回 plan 路径和这段提示，不复述整份 plan：请严格根据 plan 执行，如有问题先表述出来。任务结束后请更新 plan 中的 Todo、Check 和 Result Return Area。全部验收结束前不要提交 git。计划文件：<path>',
    coder: '作为实现角色，根据任务修改代码，遵循现有架构，并运行相关验证后返回结果。',
    review: '作为审查角色，优先发现正确性、安全性、兼容性和测试缺口，按严重程度给出可定位的问题。',
    test: '作为测试角色，设计并执行与风险匹配的测试，报告可复现的失败、覆盖范围和验证结果。',
    research: '作为研究角色，收集并核验相关事实，区分证据与推断，返回来源、结论和未决问题。',
  },
} as const satisfies {
  leader: string
  roles: Readonly<Record<WorkerRole, string>>
}

const DEFAULT_PROMPT_SETTINGS_EN = {
  leader:
    'Understand the user goal accurately, prefer reusing the right roles to complete the work, and clearly explain key decisions, risks, and verification results. Keep the tone pragmatic, concise, direct, and focused. Reduce unnecessary emoji and use them only when they materially improve clarity; do not prohibit them.',
  roles: {
    general:
      'As a general execution role, complete tasks delegated by the Leader and return clear, verifiable results.',
    plan: 'As a planning role, produce only a guidance-only Markdown plan for another Agent or engineer; do not implement code, and read the relevant code, configuration, and documentation first to locate real entry points, the key call chain, and test locations. Select a lightweight, standard, or strict tier from scope and risk, state the tier and reason in the plan, and prefer the smallest sufficient tier. Unless the user provides another path, write the plan in Chinese to docs/superpowers/plans/YYYY-MM-DD-<topic>.md. Locate steps to relevant files, methods, fields, assertions, or verification commands, and distinguish code facts, hypotheses requiring verification, and non-goals. The File Change Plan describes only file responsibilities, behavior changes, and acceptance outcomes, not concrete implementation. Do not output implementation code, pseudocode, diffs, complete proto or message definitions, SQL or query statements, or method bodies; do not decide concrete syntax, control flow, or code structure for the coder. Every plan must include Goal, Scope, Plan Tier, Current Diagnosis, File Change Plan, Task Breakdown, Test and Verification Plan, Documentation Update Requirements, Todo, Check, and Result Return Area, plus a Review Todo List; add requirements, call chain, key fields, risks, and a test matrix only when the standard or strict tier needs them. The Review Todo List is for downstream review. Each checkbox maps to one user acceptance criterion or key design decision and states the behavior and evidence to inspect; it defines review targets and required evidence only, contains no implementation code, and does not prejudge the review outcome. The review role processes every Review Todo List item and records PASS/FAIL, evidence, and uncovered gaps. Require the executor to update Todo, Check, Result Return Area, and the documentation update result after execution. Do not claim an unverified issue is fixed. Do not commit git changes before all acceptance checks pass. In the final response, return only the plan path and this execution reminder without repeating the plan: 请严格根据 plan 执行，如有问题先表述出来。任务结束后请更新 plan 中的 Todo、Check 和 Result Return Area。全部验收结束前不要提交 git。计划文件：<path>',
    coder:
      'As an implementation role, modify code according to the task, follow the existing architecture, run relevant verification, and return results.',
    review:
      'As a review role, prioritize correctness, security, compatibility, and testing gaps; report actionable issues ordered by severity.',
    test: 'As a testing role, design and run risk-matched tests; report reproducible failures, coverage, and verification outcomes.',
    research:
      'As a research role, gather and verify relevant facts, separate evidence from inference, and return sources, conclusions, and open questions.',
  },
} as const satisfies {
  leader: string
  roles: Readonly<Record<WorkerRole, string>>
}

function migrateLegacyPlanPrompt(prompt: string): string {
  if (prompt === LEGACY_PLAN_PROMPT_ZH) return DEFAULT_PROMPT_SETTINGS_ZH.roles.plan
  if (prompt === LEGACY_PLAN_PROMPT_EN) return DEFAULT_PROMPT_SETTINGS_EN.roles.plan
  return prompt
}

function migrateLegacyLeaderPrompt(prompt: string): string {
  if (prompt === LEGACY_LEADER_PROMPT_ZH) return DEFAULT_PROMPT_SETTINGS_ZH.leader
  if (prompt === LEGACY_LEADER_PROMPT_EN) return DEFAULT_PROMPT_SETTINGS_EN.leader
  return prompt
}

/** Built-in defaults (Chinese). Prefer `defaultPromptSettings(locale)` for locale-aware UI. */
export const DEFAULT_PROMPT_SETTINGS: Readonly<{
  leader: string
  roles: Readonly<Record<WorkerRole, string>>
}> = DEFAULT_PROMPT_SETTINGS_ZH

/** Fresh copy of built-in prompt defaults for the given UI locale. */
export function defaultPromptSettings(locale: PromptLocale = 'zh'): PromptSettings {
  const source = locale === 'en' ? DEFAULT_PROMPT_SETTINGS_EN : DEFAULT_PROMPT_SETTINGS_ZH
  return {
    leader: source.leader,
    roles: { ...source.roles },
  }
}

/** True when prompts equal the built-in defaults for the given locale. */
export function promptsMatchLocaleDefaults(
  prompts: PromptSettings,
  locale: PromptLocale = 'zh',
): boolean {
  const defaults = defaultPromptSettings(locale)
  if (prompts.leader.trim() !== defaults.leader.trim()) return false
  return WORKER_ROLES.every((role) => prompts.roles[role].trim() === defaults.roles[role].trim())
}

export function normalizePromptSettings(
  input: unknown,
  locale: PromptLocale = 'zh',
): PromptSettings {
  const defaults = defaultPromptSettings(locale)
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  const rawLeader = (raw as { leader?: unknown }).leader
  const rawRolesValue = (raw as { roles?: unknown }).roles
  const rawRoles =
    rawRolesValue && typeof rawRolesValue === 'object' && !Array.isArray(rawRolesValue)
      ? (rawRolesValue as Record<string, unknown>)
      : {}
  const normalizedRoles = {} as Record<WorkerRole, string>
  for (const role of WORKER_ROLES) {
    const candidate = rawRoles[role]
    const normalizedCandidate = typeof candidate === 'string' ? candidate.trim() : ''
    normalizedRoles[role] = normalizedCandidate
      ? role === 'plan'
        ? migrateLegacyPlanPrompt(normalizedCandidate)
        : normalizedCandidate
      : defaults.roles[role]
  }
  return {
    leader:
      typeof rawLeader === 'string' && rawLeader.trim()
        ? migrateLegacyLeaderPrompt(rawLeader.trim())
        : defaults.leader,
    roles: normalizedRoles,
  }
}

export function isValidPromptSettings(input: unknown): input is PromptSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false
  const candidate = input as { leader?: unknown; roles?: unknown }
  if (typeof candidate.leader !== 'string' || !candidate.leader.trim()) return false
  if (!candidate.roles || typeof candidate.roles !== 'object' || Array.isArray(candidate.roles)) {
    return false
  }
  const roles = candidate.roles as Record<string, unknown>
  return WORKER_ROLES.every(
    (role) => typeof roles[role] === 'string' && Boolean((roles[role] as string).trim()),
  )
}

export const DEFAULT_GENERAL_ROLE_INSTRUCTIONS = DEFAULT_PROMPT_SETTINGS.roles.general

export function normalizeWorkerDefaultRoleType(value: unknown): WorkerRole {
  return typeof value === 'string' && WORKER_ROLES.includes(value as WorkerRole)
    ? (value as WorkerRole)
    : 'general'
}

/**
 * A Chat-scoped Team member bound to an installed ACP Worker.
 * Multiple members may bind the same Worker while retaining independent ACP sessions.
 */
export interface TeamMember {
  id: string
  chatSessionId: string
  workerId: string
  name: string
  roleType: WorkerRole
  instructions: string
  /** Optional role override; absent means inherit the Worker's default model. */
  model?: string
  /** Optional ACP reasoning override; absent means inherit Worker default. */
  reasoning?: string
  enabled: boolean
  /** Increments only when execution semantics change. */
  revision: number
  createdAt: string
  updatedAt: string
  archivedAt?: string
}

export interface CreateTeamMemberInput {
  chatSessionId: string
  workerId: string
  name: string
  roleType: WorkerRole
  instructions: string
  model?: string
  reasoning?: string
  enabled?: boolean
}

export interface UpdateTeamMemberInput {
  workerId?: string
  name?: string
  roleType?: WorkerRole
  instructions?: string
  model?: string | null
  reasoning?: string | null
  enabled?: boolean
  expectedRevision?: number
}

export interface TeamTemplateMember {
  name: string
  preferredWorkerId: string
  roleType: WorkerRole
  instructions: string
  model?: string
  reasoning?: string
}

export interface TeamTemplate {
  id: string
  name: string
  description?: string
  members: TeamTemplateMember[]
  createdAt: string
  updatedAt: string
}

export interface CreateTeamTemplateInput {
  name: string
  description?: string
  members: TeamTemplateMember[]
}

export interface UpdateTeamTemplateInput {
  name?: string
  description?: string | null
  members?: TeamTemplateMember[]
}

export interface TeamTemplateMemberMapping {
  memberIndex: number
  workerId: string
  model?: string | null
  reasoning?: string | null
}

export interface ApplyTeamTemplateInput {
  templateId: string
  expectedTeamRevision: number
  mappings?: TeamTemplateMemberMapping[]
}

export interface TeamTemplateApplicationMemberPreview {
  memberIndex: number
  name: string
  roleType: WorkerRole
  instructions: string
  preferredWorkerId: string
  workerId?: string
  model?: string
  reasoning?: string
  issueCode?: 'WORKER_MAPPING_REQUIRED' | 'MODEL_MAPPING_REQUIRED' | 'REASONING_MAPPING_REQUIRED'
}

export interface TeamTemplateApplicationPreview {
  templateId: string
  templateName: string
  teamRevision: number
  ready: boolean
  members: TeamTemplateApplicationMemberPreview[]
}

export interface TeamTemplateAvailabilityIssue {
  memberIndex: number
  code: 'WORKER_MAPPING_REQUIRED' | 'MODEL_MAPPING_REQUIRED' | 'REASONING_MAPPING_REQUIRED'
}

export interface TeamTemplateAvailability {
  templateId: string
  ready: boolean
  issues: TeamTemplateAvailabilityIssue[]
}

export function evaluateTeamTemplateAvailability(input: {
  template: TeamTemplate
  workers: readonly WorkerRegistration[]
  projectId?: string | null
}): TeamTemplateAvailability {
  const issues: TeamTemplateAvailabilityIssue[] = []
  input.template.members.forEach((member, memberIndex) => {
    const worker = input.workers.find((candidate) => candidate.id === member.preferredWorkerId)
    const workerAvailable =
      worker?.enabled === true &&
      (worker.scope === 'global' ||
        (Boolean(input.projectId) && worker.projectId === input.projectId))
    if (!worker || !workerAvailable) {
      issues.push({ memberIndex, code: 'WORKER_MAPPING_REQUIRED' })
      return
    }
    if (
      member.model &&
      worker.availableModels?.length &&
      !worker.availableModels.some((candidate) => candidate.modelId === member.model)
    ) {
      issues.push({ memberIndex, code: 'MODEL_MAPPING_REQUIRED' })
    }
  })
  return {
    templateId: input.template.id,
    ready: issues.length === 0,
    issues,
  }
}

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

export type Locale = 'zh' | 'zh-TW' | 'en'

export function isAppLocale(value: unknown): value is Locale {
  return value === 'zh' || value === 'zh-TW' || value === 'en'
}

export const WORKER_ROLES: WorkerRole[] = ['plan', 'coder', 'review', 'test', 'research', 'general']

export interface Project {
  id: string
  name: string
  rootPath: string
  defaultBranch?: string
  workerIds: string[]
  createdAt: string
  updatedAt: string
}

export interface Session {
  id: string
  projectId: string
  title: string
  /**
   * Provenance of `title`. `'auto'` = placeholder or Leader-generated on first
   * task completion (may be overwritten by future auto-naming); `'user'` = user
   * renamed it via the sidebar, locked against auto-overwrite. Missing on
   * legacy snapshots → treated as `'auto'`.
   */
  titleSource?: 'auto' | 'user'
  status: SessionStatus
  mode: LeaderMode
  activeWorkerIds: string[]
  memoryThreadId: string
  approvalPolicy: SessionApprovalPolicy
  /** Authoritative runtime permission state. Legacy approvalPolicy is compatibility-only. */
  permissionMode: SessionPermissionMode
  /** Increments once for every persisted Team mutation. */
  teamRevision: number
  /** New Sessions ask once whether the bootstrapped Team needs adjustment. */
  roleReviewState?: 'pending' | 'prompted'
  roleReviewPromptedAt?: string
  /** Last chat/stream error message for UI (survives reload) */
  lastChatError?: string
  lastChatErrorAt?: string
  /**
   * Sidebar lamp "read" watermark. Notification lamps (error / done) stay lit
   * while their event timestamp is newer than `lastReadAt`; opening a session
   * stamps this via `store.markSessionRead`. Never bumps `updatedAt`.
   * Missing on legacy snapshots → migrated to the session's `updatedAt`.
   */
  lastReadAt?: string
  /**
   * Timestamp of the last error event relevant to the sidebar red lamp:
   * chat send failure (stamped alongside `lastChatErrorAt`) or a worker job
   * failing / timing out. The lamp derives purely from this timestamp +
   * `lastReadAt`, so it can extinguish on read without wiping the sticky
   * `lastChatError` card payload.
   */
  lastErrorAt?: string
  /**
   * Timestamp of the last successful worker job completion (chat replies use
   * `lastReplyAt` instead). The steady green "done" lamp lights when
   * max(`lastReplyAt`, `lastFinishedAt`) is newer than `lastReadAt`.
   */
  lastFinishedAt?: string
  createdAt: string
  updatedAt: string
  /**
   * Timestamp of the last assistant reply (chat onFinish). The sidebar uses
   * `lastReplyAt ?? createdAt` as the relative-time source so opening / renaming /
   * switching mode does not falsely "freshen" it. Missing on legacy snapshots and on
   * sessions that have not received a reply yet → callers fall back to
   * `createdAt`. Bumped via `store.markSessionReply(sessionId)`.
   */
  lastReplyAt?: string
  /**
   * Cumulative token usage across all turns (real model-reported values from the
   * chat `onFinish` step.usage). Used by the chat context popup to show a real
   * cache-hit rate and context size. All fields missing on legacy snapshots and
   * before the first turn → treated as 0. Stamped via
   * `store.markSessionUsage(sessionId, delta)` (does NOT bump `updatedAt`).
   */
  usageInputTokens?: number
  usageCachedTokens?: number
  usageOutputTokens?: number
  /**
   * Real input-token count of the MOST RECENT turn (overwritten each turn, not
   * accumulated). This is what the context-window ring should show: it reflects
   * the actual prompt size the model just saw, so it correctly drops after a
   * context compression (the next turn's prompt is shorter). Falls back to the
   * live chars/4 estimate when missing (legacy snapshots / before first turn).
   */
  usageLastInputTokens?: number
  usageLastUpdatedAt?: string
}

/**
 * Placeholder title assigned at session creation when the user did not supply
 * one. The UI renders this via i18n (`sidebar.untitledSession`); the raw value
 * is also the gate for auto-naming: only sessions whose title is still the
 * placeholder (or explicitly `titleSource === 'auto'`) are eligible for Leader
 * auto-naming during the first Leader response.
 */
export const DEFAULT_SESSION_TITLE = 'New session'

/** True if the title is missing or still the placeholder (eligible for auto-naming). */
export function isPlaceholderSessionTitle(title: string | undefined | null): boolean {
  return !title || title === DEFAULT_SESSION_TITLE
}

/** Red lamp lingers this long after the session is read ("阅读后延迟3秒熄灭"). */
export const SESSION_LAMP_ERROR_GRACE_MS = 3_000
/** Lamps auto-extinguish this long after the event while the session is active. */
export const SESSION_LAMP_ACTIVE_TTL_MS = 60_000

export interface SessionLampTimes {
  /** Last error event (ms epoch, 0 = none). Falls back to legacy lastChatErrorAt. */
  errAt: number
  /** Last successful completion (ms epoch, 0 = none): chat reply or worker job. */
  doneAt: number
  /** Read watermark (ms epoch, 0 = never). */
  readAt: number
}

function parseLampTime(value: string | undefined): number {
  if (!value) return 0
  const t = Date.parse(value)
  return Number.isFinite(t) ? t : 0
}

export function sessionLampTimes(s: Session): SessionLampTimes {
  return {
    errAt: parseLampTime(s.lastErrorAt ?? s.lastChatErrorAt),
    doneAt: Math.max(parseLampTime(s.lastReplyAt), parseLampTime(s.lastFinishedAt)),
    readAt: parseLampTime(s.lastReadAt),
  }
}

export type SessionLampClass = 'approve' | 'run' | 'error' | 'done' | 'idle'

/**
 * Single source of truth for the sidebar session lamp, highest priority first:
 *   approve — needs authorization (actionable)
 *   run     — executing (`busy` is the optimistic in-flight send, not persisted)
 *   error   — unread error event; lingers SESSION_LAMP_ERROR_GRACE_MS after read
 *   done    — steady green, unread successful completion
 *   idle    — nothing to report
 * Notification lamps (error/done) extinguish on read, or via the active-session
 * TTL handled by the caller stamping `lastReadAt`.
 */
export function sessionLampClass(s: Session, busy: boolean, now: number): SessionLampClass {
  if (s.status === 'needs_approval') return 'approve'
  if (busy || s.status === 'running') return 'run'
  const { errAt, doneAt, readAt } = sessionLampTimes(s)
  if (errAt > 0 && (errAt > readAt || now - readAt < SESSION_LAMP_ERROR_GRACE_MS)) return 'error'
  if (doneAt > readAt) return 'done'
  return 'idle'
}

/** True when an error/done lamp event is newer than the read watermark. */
export function sessionHasUnreadLamp(s: Session): boolean {
  const { errAt, doneAt, readAt } = sessionLampTimes(s)
  return errAt > readAt || doneAt > readAt
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

export interface ChatMessagePart {
  type: 'text' | 'plan' | 'delegation' | 'diff' | 'approval' | 'tool'
  text?: string
  data?: Record<string, unknown>
}

export interface ChatMessage {
  id: string
  sessionId: string
  role: 'user' | 'assistant' | 'system'
  parts: ChatMessagePart[]
  createdAt: string
}

/** @deprecated Prefer WorkerJob — kept for type compatibility */
export interface DelegationEvent {
  id: string
  sessionId: string
  workerId: string
  workerName: string
  status: 'running' | 'done' | 'error' | 'pending_approval'
  task: string
  /** Role the leader requested for this delegation */
  role?: WorkerRole
  startedAt: string
  finishedAt?: string
  summary?: string
}

/** Lifecycle of a scheduled worker (ACP) job */
export type JobStatus =
  'queued' | 'running' | 'pending_approval' | 'succeeded' | 'failed' | 'cancelled' | 'timed_out'

export type JobSource = 'leader' | 'api' | 'ui'

/**
 * Durable worker dispatch unit — selected worker + task + lifecycle.
 * @see WorkerScheduler
 */
export interface WorkerJob {
  id: string
  sessionId: string
  projectId: string
  threadId?: string
  workerId: string
  workerName: string
  role?: WorkerRole
  /** Immutable Team-member snapshot captured at dispatch time. */
  teamMemberId?: string
  teamMemberName?: string
  roleType?: WorkerRole
  teamMemberRevision?: number
  effectiveModel?: string
  /** ACP reasoning value frozen at dispatch time (TeamMember override → Worker default → Agent default). */
  effectiveReasoning?: string
  instructionsSnapshot?: string
  effectivePrompt?: string
  task: string
  cwd: string
  status: JobStatus
  approvalPolicy: SessionApprovalPolicy
  createdAt: string
  startedAt?: string
  finishedAt?: string
  message?: string
  /** Truncated ACP / CLI output */
  output?: string
  error?: string
  /** Stable public error code (e.g. WORKER_AUTH_REQUIRED) — no secrets */
  errorCode?: string
  approvalIds?: string[]
  source: JobSource
  meta?: Record<string, unknown>
  /**
   * Opaque ACP reuse key digest at job start (no agentSessionId).
   * Used by reset-context so config/auth drift cannot recompute the wrong key.
   */
  reuseKeyDigest?: string
  /**
   * Set when session recovery fails (worker process died, session not found,
   * recovery unsupported). Persisted on the job so the "Reset ACP context"
   * button survives a page refresh / session switch, not just the live SSE event.
   */
  recoveryError?: string
  canResetAcpContext?: boolean
}

export const JOB_OPEN_STATUSES: JobStatus[] = ['queued', 'running', 'pending_approval']

export function isJobOpen(status: JobStatus): boolean {
  return status === 'queued' || status === 'running' || status === 'pending_approval'
}

/** Max jobs retained in snapshot */
export const JOB_HISTORY_LIMIT = 100

/** Truncate job output stored on disk */
export const JOB_OUTPUT_MAX_CHARS = 32_000

/**
 * Typed event stream for worker execution (Scheduler → tool bridge → Chat UI).
 * Order: started -> delta* -> completed | failed | cancelled | timed_out
 * Preflight failure (e.g. Worker not found) may skip started and emit failed directly.
 */
export type WorkerRunEvent =
  | {
      type: 'started'
      jobId: string
      workerId: string
      workerName: string
      /** Immutable Chat Team member display name captured at dispatch time. */
      teamMemberName?: string
      workerKind: WorkerKind
      role?: WorkerRole
      model?: string
      reasoning?: string
      /** Dispatch task text — shown as worker card input while running. */
      task?: string
      reusedSession: boolean
      sessionDisposition?: string
    }
  | {
      type: 'delta'
      jobId: string
      sequence: number
      delta: string
    }
  | {
      type: 'completed'
      jobId: string
      workerId?: string
      output: string
      truncated: boolean
      workerName?: string
      teamMemberName?: string
      workerKind?: WorkerKind
      role?: WorkerRole
      model?: string
      reasoning?: string
      errorCode?: string
    }
  | {
      type: 'failed' | 'cancelled' | 'timed_out'
      jobId: string
      workerId?: string
      output?: string
      error?: string
      /** Stable public code preserved through stream → reducer → card */
      errorCode?: string
      truncated: boolean
      workerName?: string
      teamMemberName?: string
      workerKind?: WorkerKind
      role?: WorkerRole
      model?: string
      reasoning?: string
      recoveryError?: string
      canResetAcpContext?: boolean
    }
  | {
      type: 'approval_requested'
      jobId: string
      approval: ApprovalItem
    }
  | {
      type: 'approval_resolved'
      jobId: string
      approval: ApprovalItem
    }

export function isTerminalWorkerEvent(
  event: WorkerRunEvent,
): event is WorkerRunEvent & { type: 'completed' | 'failed' | 'cancelled' | 'timed_out' } {
  return (
    event.type === 'completed' ||
    event.type === 'failed' ||
    event.type === 'cancelled' ||
    event.type === 'timed_out'
  )
}

export const LEADER_STEP_BUDGET_PART_TYPE = 'data-leader-step-budget'

export interface LeaderStepBudgetEvent {
  type: typeof LEADER_STEP_BUDGET_PART_TYPE
  data: {
    reason: 'max_steps'
    maxSteps: number
    usedSteps: number
    runId: string
    occurredAt: string
  }
}

export interface ApprovalCursor {
  approvalId: string
  createdAt: string
  resolved: boolean
}

/** Per-job accumulated state for UI reducer */
export interface WorkerRunState {
  jobId: string
  /** Stable Worker identity retained for Registry/auth deep links. */
  workerId?: string
  workerName: string
  /** Chat Team member display name; falls back to workerName for legacy jobs. */
  teamMemberName?: string
  workerKind: WorkerKind
  role?: WorkerRole
  model?: string
  reasoning?: string
  /**
   * Dispatch task / prompt shown as the worker card "input" section.
   * Available from started event, durable job, or tool payload — not only at completion.
   */
  task?: string
  reusedSession: boolean
  sequence: number
  output: string
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'timed_out' | 'pending_approval'
  truncated: boolean
  error?: string
  /** Stable public error code from terminal event / job */
  errorCode?: string
  /** Set when session recovery fails (e.g. worker process died, session not found) */
  recoveryError?: string
  canResetAcpContext?: boolean
  startedAt: number
  lastDeltaAt: number
  /**
   * Every currently pending permission request for this Job, ordered by
   * createdAt then id. This is the authoritative UI state; a Job may have
   * more than one request in flight at once.
   */
  pendingApprovals: ApprovalItem[]
  /** Per-approval cursors used to ignore stale/duplicated live events. */
  approvalCursors?: Record<string, ApprovalCursor>
  /**
   * Deprecated compatibility projection of pendingApprovals[0]. New code
   * must read pendingApprovals instead.
   */
  pendingApproval?: ApprovalItem
  /** Monotonic approval cursor used to prevent stale snapshot resurrection. */
  approvalCursor?: ApprovalCursor
  /** Added from durable Job state so a refreshed card keeps its placement. */
  snapshotHydrated?: boolean
}

/** Pending or resolved permission from ACP / tool approval path. */
export type ApprovalStatus = 'pending' | 'allowed' | 'denied' | 'cancelled'

export type ApprovalDecision = 'allow' | 'deny' | 'cancel'

export type ApprovalOptionKind = 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always'

export interface ApprovalOption {
  optionId: string
  name: string
  kind: ApprovalOptionKind
}

export interface ApprovalLocation {
  filePath?: string
  line?: number
  column?: number
  description?: string
}

export interface ApprovalItem {
  id: string
  status: ApprovalStatus
  title: string
  detail?: string
  /** e.g. write, execute_command */
  action?: string
  pathOrTarget?: string
  workerId?: string
  workerName?: string
  sessionId?: string | null
  jobId?: string
  toolCallId?: string
  toolKind?: AcpToolKind
  locations?: ApprovalLocation[]
  options: ApprovalOption[]
  /** Option id chosen when allowed */
  selectedOptionId?: string
  /** Exact immutable option selected at resolution time. */
  selectedOption?: ApprovalOption
  decision?: ApprovalDecision
  source: 'acp' | 'tool' | 'manual'
  resolutionSource?: 'manual_chat' | 'manual_panel' | 'policy' | 'system'
  resolutionReason?: string
  createdAt: string
  resolvedAt?: string
}

/** Stable pending-approval order shared by worker cards and the approvals panel. */
export function compareApprovalOrder(a: ApprovalItem, b: ApprovalItem): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1
  if (a.id === b.id) return 0
  return a.id < b.id ? -1 : 1
}

/** Return pending approvals in their deterministic createdAt + id order. */
export function sortPendingApprovals(approvals: ApprovalItem[]): ApprovalItem[] {
  return approvals.filter((approval) => approval.status === 'pending').sort(compareApprovalOrder)
}

export interface AppSnapshot {
  projects: Project[]
  sessions: Session[]
  workers: WorkerRegistration[]
  teamMembers: TeamMember[]
  teamTemplates: TeamTemplate[]
  approvals: ApprovalItem[]
  /** Recent worker jobs (dispatch history + in-flight) */
  jobs?: WorkerJob[]
  activeProjectId: string | null
  activeSessionId: string | null
  /** UI locale preference persisted with app state */
  locale?: Locale
  /**
   * Monotonic revision for client race protection.
   * Clients should ignore snapshots with revision <= last applied.
   */
  revision?: number
}

/** Normalize legacy workers that lack role fields. */
export function normalizeWorkerRoles<
  T extends Partial<WorkerRegistration> & Pick<WorkerRegistration, 'name' | 'kind'>,
>(worker: T): T & Pick<WorkerRegistration, 'primaryRole' | 'roles'> {
  const roles =
    worker.roles && worker.roles.length > 0
      ? worker.roles
      : worker.capabilities?.includes('review')
        ? (['review', 'coder', 'general'] as WorkerRole[])
        : (['coder', 'general'] as WorkerRole[])
  const primaryRole =
    worker.primaryRole && roles.includes(worker.primaryRole) ? worker.primaryRole : roles[0]!
  return { ...worker, primaryRole, roles }
}

function commandStatusToLegacy(status: CommandHealthStatus): WorkerHealthStatus {
  return status
}

function legacyToCommandStatus(status: WorkerHealthStatus): CommandHealthStatus {
  return status
}

function acpStatusToLegacy(status: AcpHealthStatus): WorkerHealthStatus {
  switch (status) {
    case 'ready':
      return 'healthy'
    case 'degraded':
      return 'unhealthy'
    case 'unavailable':
      return 'missing'
    default:
      return 'unknown'
  }
}

function legacyToAcpStatus(status: WorkerHealthStatus): AcpHealthStatus {
  switch (status) {
    case 'healthy':
      return 'ready'
    case 'unhealthy':
      return 'degraded'
    case 'missing':
      return 'unavailable'
    default:
      return 'unknown'
  }
}

/**
 * Bidirectionally project commandHealth ↔ cliHealth, acpHealth ↔ acpSessionHealth.
 * `health` is the worst of the two legacy statuses.
 */
export function projectLegacyHealth<T extends Partial<WorkerRegistration>>(
  worker: T,
): T & {
  health: WorkerHealthStatus
  cliHealth: WorkerHealthStatus
  acpSessionHealth: WorkerHealthStatus
  commandHealth: CommandHealth
  acpHealth: AcpHealth
} {
  const fallbackStatus: WorkerHealthStatus =
    worker.health ?? worker.healthReport?.status ?? 'unknown'
  const checkedAt =
    worker.commandHealth?.checkedAt ??
    worker.acpHealth?.checkedAt ??
    worker.healthReport?.checkedAt ??
    worker.lastSeenAt

  // Design: legacy `health` is command input only — never projected as ACP ready.
  let commandStatus: CommandHealthStatus
  if (worker.commandHealth?.status) {
    commandStatus = worker.commandHealth.status
  } else if (worker.cliHealth) {
    commandStatus = legacyToCommandStatus(worker.cliHealth)
  } else {
    commandStatus = legacyToCommandStatus(fallbackStatus)
  }

  let acpStatus: AcpHealthStatus
  if (worker.acpHealth?.status) {
    acpStatus = worker.acpHealth.status
  } else if (worker.acpSessionHealth) {
    acpStatus = legacyToAcpStatus(worker.acpSessionHealth)
  } else {
    // Without explicit ACP fields, stay unknown (do not copy command health into ACP)
    acpStatus = 'unknown'
  }

  const cliHealth = commandStatusToLegacy(commandStatus)
  const acpSessionHealth = acpStatusToLegacy(acpStatus)
  // Aggregate display health prefers command; ACP unknown does not mark unhealthy
  const health = acpStatus === 'unknown' ? cliHealth : worstHealth(cliHealth, acpSessionHealth)

  const commandHealth: CommandHealth = {
    status: commandStatus,
    checkedAt: worker.commandHealth?.checkedAt ?? checkedAt,
  }
  const acpHealth: AcpHealth = {
    status: acpStatus,
    checkedAt: worker.acpHealth?.checkedAt ?? checkedAt,
    lastSuccessAt: worker.acpHealth?.lastSuccessAt,
    errorCode: worker.acpHealth?.errorCode,
  }

  return {
    ...worker,
    cliHealth,
    acpSessionHealth,
    commandHealth,
    acpHealth,
    health,
  }
}

/** Ensure health + healthReport are consistent for migrated store rows. */
export function normalizeWorkerHealth<T extends Partial<WorkerRegistration>>(
  worker: T,
): T & {
  health: WorkerHealthStatus
  cliHealth: WorkerHealthStatus
  acpSessionHealth: WorkerHealthStatus
  commandHealth: CommandHealth
  acpHealth: AcpHealth
} {
  const projected = projectLegacyHealth(worker)
  // healthReport is diagnostic only — must not override computed aggregate health
  const report =
    worker.healthReport ??
    (worker.health || worker.lastSeenAt || worker.commandHealth || worker.acpHealth
      ? {
          status: projected.health,
          level: 'presence' as const,
          checkedAt:
            projected.commandHealth.checkedAt ?? worker.lastSeenAt ?? new Date(0).toISOString(),
          message: projected.health === 'unknown' ? 'Not checked yet' : undefined,
        }
      : undefined)
  return {
    ...projected,
    // Keep projected aggregate; report status is informational only
    health: projected.health,
    healthReport: report ? { ...report, status: projected.health } : report,
  }
}

/** Rank for routing: higher = preferred. */
export function workerHealthRank(status: WorkerHealthStatus | undefined): number {
  switch (status) {
    case 'healthy':
      return 4
    case 'unknown':
      return 3
    case 'unhealthy':
      return 2
    case 'missing':
      return 1
    default:
      return 0
  }
}

/** Default TTL for considering a health report fresh (5 minutes). */
export const WORKER_HEALTH_TTL_MS = 5 * 60 * 1000

/** CLI command health TTL (5 minutes). */
export const COMMAND_HEALTH_TTL_MS = 5 * 60 * 1000

/** ACP boundary health TTL (15 minutes). */
export const ACP_HEALTH_TTL_MS = 15 * 60 * 1000

function isTimestampFresh(
  checkedAt: string | undefined,
  ttlMs: number,
  nowMs = Date.now(),
): boolean {
  if (!checkedAt) return false
  const t = Date.parse(checkedAt)
  if (!Number.isFinite(t)) return false
  return nowMs - t < ttlMs
}

export function isHealthReportFresh(
  report: WorkerHealthReport | undefined,
  ttlMs = WORKER_HEALTH_TTL_MS,
  nowMs = Date.now(),
): boolean {
  return isTimestampFresh(report?.checkedAt, ttlMs, nowMs)
}

export function isCommandHealthFresh(
  health: CommandHealth | undefined,
  nowMs = Date.now(),
  ttlMs = COMMAND_HEALTH_TTL_MS,
): boolean {
  return isTimestampFresh(health?.checkedAt, ttlMs, nowMs)
}

export function isAcpHealthFresh(
  health: AcpHealth | undefined,
  nowMs = Date.now(),
  ttlMs = ACP_HEALTH_TTL_MS,
): boolean {
  return isTimestampFresh(health?.checkedAt, ttlMs, nowMs)
}

/**
 * Non-force dispatch skip rules (§7.1):
 * - fresh commandHealth missing/unhealthy → skip
 * - fresh acpHealth unavailable → skip
 * - degraded or expired ACP → allow try
 */
export function shouldSkipWorkerDispatch(
  worker: Partial<WorkerRegistration>,
  opts?: { forced?: boolean; now?: number },
): boolean {
  if (opts?.forced) return false
  const nowMs = opts?.now ?? Date.now()
  const projected = projectLegacyHealth(worker)
  if (
    isCommandHealthFresh(projected.commandHealth, nowMs) &&
    (projected.commandHealth.status === 'missing' || projected.commandHealth.status === 'unhealthy')
  ) {
    return true
  }
  if (
    isAcpHealthFresh(projected.acpHealth, nowMs) &&
    projected.acpHealth.status === 'unavailable'
  ) {
    return true
  }
  return false
}

/**
 * Default TTL for considering a model cache entry fresh (30 minutes).
 * After this period, models are considered stale and should be refreshed.
 */
export const WORKER_MODELS_TTL_MS = 30 * 60 * 1000

/** Returns the worst (least healthy) of two health statuses. */
function worstHealth(a: WorkerHealthStatus, b: WorkerHealthStatus): WorkerHealthStatus {
  const rank: Record<WorkerHealthStatus, number> = {
    healthy: 0,
    unknown: 1,
    unhealthy: 2,
    missing: 3,
  }
  return rank[a] >= rank[b] ? a : b
}

/**
 * Check whether a model cache timestamp is still within the TTL.
 */
export function isModelCacheFresh(
  modelsFetchedAt: string | undefined,
  ttlMs = WORKER_MODELS_TTL_MS,
  nowMs = Date.now(),
): boolean {
  return isTimestampFresh(modelsFetchedAt, ttlMs, nowMs)
}

export { matchRegistryAgentForIcon } from './worker-icon-match.js'
