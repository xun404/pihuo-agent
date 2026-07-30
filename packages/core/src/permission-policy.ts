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

const READ_ONLY_KINDS = new Set<AcpToolKind>(['read', 'search', 'think', 'fetch'])
const SCOPED_MUTATION_KINDS = new Set<AcpToolKind>(['edit', 'move', 'delete', 'execute'])

function preferredAllowOption(options: PermissionOption[]): PermissionOption | undefined {
  return (
    options.find((option) => option.kind === 'allow_once') ??
    options.find((option) => option.kind === 'allow_always')
  )
}

export function decidePermission(input: DecidePermissionInput): PermissionDecision {
  const kind = KNOWN_TOOL_KINDS.has(input.toolKind) ? input.toolKind : 'other'
  const allow = preferredAllowOption(input.options)
  if (!allow) {
    return { mode: 'cancelled', reason: `no allow option available for ${kind}` }
  }

  if (input.permissionMode === 'auto') {
    return {
      mode: 'automatic',
      option: allow,
      decision: 'allow',
      reason: `auto permission mode selected ${allow.kind} for ${kind}`,
    }
  }

  if (READ_ONLY_KINDS.has(kind)) {
    return {
      mode: 'automatic',
      option: allow,
      decision: 'allow',
      reason: `default permission mode allows non-changing ${kind} with ${allow.kind}`,
    }
  }

  if (SCOPED_MUTATION_KINDS.has(kind) && input.targetScope === 'inside_project') {
    return {
      mode: 'automatic',
      option: allow,
      decision: 'allow',
      reason: `default permission mode allows project-local ${kind} with ${allow.kind}`,
    }
  }

  return {
    mode: 'manual',
    reason: `default permission mode requires approval for ${kind} scope ${input.targetScope}`,
  }
}
