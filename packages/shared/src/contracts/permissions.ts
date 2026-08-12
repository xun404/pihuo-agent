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
