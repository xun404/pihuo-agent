/** Stable public facade for domain contracts shared by desktop, core, and runtime. */

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
  ChatRunAbortDecision,
  ChatRunAbortIntent,
  ChatRunAbortReason,
  ChatRunPhase,
  ChatRunStatus,
  ChatRunTerminal,
  FollowUpRequestMeta,
  FollowUpSource,
} from './contracts/chat-run.js'
export {
  CHAT_RUN_ABORT_INTENTS,
  CHAT_RUN_PHASES,
  CHAT_RUN_TERMINALS,
  FOLLOW_UP_SOURCES,
  isChatRunAbortIntent,
  isChatRunIdentifier,
  isFollowUpRequestMeta,
  isFollowUpSource,
} from './contracts/chat-run.js'

export type {
  LeaderChatCustom,
  LeaderChatEvent,
  LeaderChatMessage,
  LeaderChatRole,
  LeaderChatStartBody,
  LeaderContentBlock,
  LeaderCustomKind,
  LeaderRunMeta,
  LeaderTaskItem,
  LeaderTaskStatus,
  LeaderThinkingIntensity,
  LeaderWorkMode,
} from './contracts/leader-chat.js'
export {
  DEFAULT_LEADER_WORK_MODE,
  LEADER_CHAT_EVENT_TYPES,
  LEADER_CHAT_ROLES,
  LEADER_CUSTOM_KINDS,
  LEADER_TASK_STATUSES,
  LEADER_THINKING_INTENSITIES,
  LEADER_WORK_MODES,
  isLeaderChatEvent,
  isLeaderChatMessage,
  isLeaderChatRole,
  isLeaderContentBlock,
  isLeaderCustomKind,
  isLeaderTaskItem,
  isLeaderThinkingIntensity,
  isLeaderWorkMode,
  normalizeLeaderWorkMode,
  parseLeaderChatStartBody,
  userTextFromLeaderMessage,
} from './contracts/leader-chat.js'

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
export { isTerminalWorkerEvent, LEADER_STEP_BUDGET_PART_TYPE } from './contracts/worker-events.js'

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
