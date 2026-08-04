import type {
  AcpToolKind,
  PermissionOptionKind,
  PermissionTargetScope,
  SessionApprovalPolicy,
  SessionPermissionMode,
} from '@swarmdesk-agent/shared'

export type {
  AcpToolKind,
  PermissionOptionKind,
  PermissionTargetScope,
  SessionApprovalPolicy,
  SessionPermissionMode,
}

export interface PermissionOption {
  optionId: string
  name: string
  kind: PermissionOptionKind
}

export interface DecidePermissionInput {
  toolKind: AcpToolKind
  options: PermissionOption[]
  permissionMode: SessionPermissionMode
  targetScope: PermissionTargetScope
}

export interface AutomaticDecision {
  mode: 'automatic'
  option: PermissionOption
  decision: 'allow'
  reason: string
}

export interface ManualDecision {
  mode: 'manual'
  reason: string
}

export interface CancelledDecision {
  mode: 'cancelled'
  reason: string
}

export type PermissionDecision = AutomaticDecision | ManualDecision | CancelledDecision

const KNOWN_TOOL_KINDS = new Set<AcpToolKind>([
  'delete',
  'read',
  'search',
  'think',
  'edit',
  'move',
  'execute',
  'fetch',
  'switch_mode',
  'other',
])

function preferredAllowOption(options: PermissionOption[]): PermissionOption | undefined {
  return (
    options.find((option) => option.kind === 'allow_once') ??
    options.find((option) => option.kind === 'allow_always')
  )
}

export function decidePermission(input: DecidePermissionInput): PermissionDecision {
  const kind = KNOWN_TOOL_KINDS.has(input.toolKind) ? input.toolKind : 'other'
  if (input.permissionMode === 'auto') {
    const allow = preferredAllowOption(input.options)
    if (!allow) {
      return {
        mode: 'manual',
        reason: `auto permission mode cannot select an allow option for ${kind}; durable approval must fail closed`,
      }
    }
    return {
      mode: 'automatic',
      option: allow,
      decision: 'allow',
      reason: `auto permission mode selected ${allow.kind} for ${kind}`,
    }
  }

  return {
    mode: 'manual',
    // This function runs only after the Agent has decided to emit an ACP
    // requestPermission call. Safe operations that the Agent handles itself
    // never enter this policy function and must not be reclassified here.
    reason: `the Agent requested manual approval (${kind}, scope ${input.targetScope})`,
  }
}
