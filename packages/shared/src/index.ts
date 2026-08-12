/** Stable public facade for domain contracts shared by desktop, core, and Mastra. */

export type {
  AcpPublicErrorCode,
  AcpRegistryAgentAvailability,
  AcpRegistryAgentMetadata,
  AcpRegistryAuthor,
  AcpRegistryBinaryDistribution,
  AcpRegistryBinaryTarget,
  AcpRegistryCatalogSnapshot,
  AcpRegistryDistribution,
  AcpRegistryDistributionKind,
  AcpRegistryPackageDistribution,
  AcpRegistrySnapshotStatus,
  AcpRegistryTarget,
  CustomAcpConflictCandidate,
  CustomAcpLaunchKind,
  CustomAcpPreview,
  CustomAcpPreviewCandidate,
  CustomAcpRegistrationInput,
  LeaderMode,
  SessionStatus,
  WorkerKind,
  WorkerLaunchSpec,
  WorkerReadiness,
  WorkerReadinessNextAction,
  WorkerReadinessStatus,
  WorkerRuntimeProfile,
  WorkerSource,
} from './contracts/worker-acp.js'
export {
  ACP_PUBLIC_ERROR_CODES,
  defaultRegistryWorkerRoles,
  isAcpPublicErrorCode,
} from './contracts/worker-acp.js'

export type {
  AcpToolKind,
  PermissionModeChangeSource,
  PermissionOptionKind,
  PermissionTargetScope,
  SessionApprovalPolicy,
  SessionDisposition,
  SessionPermissionMode,
} from './contracts/permissions.js'
export {
  isValidPermissionModeChangeSource,
  isValidSessionApprovalPolicy,
  isValidSessionPermissionMode,
  permissionModeFromLegacyPolicy,
  SESSION_APPROVAL_POLICIES,
  SESSION_PERMISSION_MODES,
} from './contracts/permissions.js'

export type { WorkerRole } from './contracts/roles.js'
export { PROMPT_ROLE_ORDER, WORKER_ROLES } from './contracts/roles.js'

export type {
  AcpHealth,
  AcpHealthStatus,
  CommandHealth,
  CommandHealthStatus,
  HealthProbeLevel,
  ModelCatalogState,
  ProviderEvidenceState,
  WorkerCapability,
  WorkerHealthReport,
  WorkerHealthStatus,
  WorkerModelCatalog,
  WorkerModelOption,
  WorkerModelPinState,
  WorkerReasoningCatalogEntry,
  WorkerReasoningOption,
  WorkerReasoningSelector,
  WorkerRegistration,
} from './contracts/worker.js'
export { workerModelCatalogStorageKey } from './contracts/worker.js'
export {
  ACP_HEALTH_TTL_MS,
  COMMAND_HEALTH_TTL_MS,
  isAcpHealthFresh,
  isCommandHealthFresh,
  isHealthReportFresh,
  isModelCacheFresh,
  normalizeWorkerHealth,
  normalizeWorkerRoles,
  projectLegacyHealth,
  shouldSkipWorkerDispatch,
  WORKER_HEALTH_TTL_MS,
  WORKER_MODELS_TTL_MS,
  workerHealthRank,
} from './worker-health.js'

export type { PromptLocale, PromptSettings, WorkerTimeoutSettings } from './prompt-settings.js'
export {
  DEFAULT_GENERAL_ROLE_INSTRUCTIONS,
  DEFAULT_PROMPT_SETTINGS,
  defaultPromptSettings,
  isValidPromptSettings,
  normalizePromptSettings,
  normalizeWorkerDefaultRoleType,
  promptsMatchLocaleDefaults,
  toPromptLocale,
} from './prompt-settings.js'

export type {
  Locale,
  Project,
  Session,
  SessionLampClass,
  SessionLampTimes,
} from './contracts/session.js'
export {
  DEFAULT_SESSION_TITLE,
  isAppLocale,
  isPlaceholderSessionTitle,
  SESSION_LAMP_ACTIVE_TTL_MS,
  SESSION_LAMP_ERROR_GRACE_MS,
  sessionHasUnreadLamp,
  sessionLampClass,
  sessionLampTimes,
} from './contracts/session.js'

export type {
  ChatMessage,
  ChatMessagePart,
  DelegationEvent,
  JobSource,
  JobStatus,
  WorkerJob,
} from './contracts/chat-jobs.js'
export {
  isJobOpen,
  JOB_HISTORY_LIMIT,
  JOB_OPEN_STATUSES,
  JOB_OUTPUT_MAX_CHARS,
} from './contracts/chat-jobs.js'

export type {
  ApprovalDecision,
  ApprovalItem,
  ApprovalLocation,
  ApprovalOption,
  ApprovalOptionKind,
  ApprovalStatus,
} from './contracts/approvals.js'
export { compareApprovalOrder, sortPendingApprovals } from './contracts/approvals.js'

export type {
  ApprovalCursor,
  LeaderStepBudgetEvent,
  WorkerActivityItem,
  WorkerPlanEntryView,
  WorkerRunEvent,
  WorkerRunState,
  WorkerToolCallStatus,
  WorkerToolCallView,
} from './contracts/worker-events.js'
export {
  isTerminalWorkerEvent,
  LEADER_STEP_BUDGET_PART_TYPE,
} from './contracts/worker-events.js'

export type {
  ApplyTeamTemplateInput,
  CreateTeamMemberInput,
  CreateTeamTemplateInput,
  TeamMember,
  TeamTemplate,
  TeamTemplateApplicationMemberPreview,
  TeamTemplateApplicationPreview,
  TeamTemplateAvailability,
  TeamTemplateAvailabilityIssue,
  TeamTemplateMember,
  TeamTemplateMemberMapping,
  UpdateTeamMemberInput,
  UpdateTeamTemplateInput,
} from './contracts/team.js'
export { evaluateTeamTemplateAvailability } from './contracts/team.js'

export type { AppSnapshot } from './contracts/app-snapshot.js'

export {
  DEFAULT_NOTIFICATION_SETTINGS,
  isNotificationMode,
  type NotificationMode,
  type NotificationSettings,
} from './notification-settings.js'

export { matchRegistryAgentForIcon } from './worker-icon-match.js'
