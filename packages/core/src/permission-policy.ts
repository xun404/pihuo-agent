export type AcpToolKind =
  | 'delete'
  | 'read'
  | 'search'
  | 'think'
  | 'edit'
  | 'move'
  | 'execute'
  | 'fetch'
  | 'switch_mode'
  | 'other'

export type PermissionOptionKind = 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always'

export type SessionApprovalPolicy = PermissionOptionKind | 'manual'

export interface PermissionOption {
  optionId: string
  name: string
  kind: PermissionOptionKind
}

export interface DecidePermissionInput {
  toolKind: AcpToolKind
  options: PermissionOption[]
  sessionPolicy: SessionApprovalPolicy
}

export interface AutomaticDecision {
  mode: 'automatic'
  option: { optionId: string; name: string; kind: PermissionOptionKind }
  decision: 'allow' | 'deny'
  reason: string
}

export interface ManualDecision {
  mode: 'manual'
  reason: string
}

export type PermissionDecision = AutomaticDecision | ManualDecision

/**
 * Decide whether a permission request can be auto-approved based on
 * toolKind, available options, and session approval policy.
 *
 * Decision order (§7.2):
 * 1. `delete` → always manual (priority 1, no exceptions)
 * 2. `read/search/think` → prefer allow_once, then allow_always, else manual
 *    (priority 2, regardless of session policy)
 * 3. `edit/move/execute/fetch/switch_mode/other` → match exact option.kind
 *    against sessionPolicy; allow_* → allow, reject_* → deny; manual if no match
 * 4. Never infer kind from option name/ID text
 * 5. Unknown ToolKind → `other`; unknown option.kind → manual
 */
export function decidePermission(input: DecidePermissionInput): PermissionDecision {
  const { toolKind, options, sessionPolicy } = input

  const kind: AcpToolKind = KNOWN_TOOL_KINDS.has(toolKind) ? toolKind : 'other'

  // Priority 1: delete is always manual (no exceptions)
  if (kind === 'delete') {
    return { mode: 'manual', reason: 'delete operations require manual approval' }
  }

  // Priority 2: read/search/think have readonly whitelist
  // These prefer allow_once/allow_always regardless of session policy
  if (kind === 'read' || kind === 'search' || kind === 'think') {
    const allowOnce = options.find((o) => o.kind === 'allow_once')
    if (allowOnce) {
      return {
        mode: 'automatic',
        option: allowOnce,
        decision: 'allow',
        reason: `auto-approved ${kind} with allow_once`,
      }
    }
    const allowAlways = options.find((o) => o.kind === 'allow_always')
    if (allowAlways) {
      return {
        mode: 'automatic',
        option: allowAlways,
        decision: 'allow',
        reason: `auto-approved ${kind} with allow_always`,
      }
    }
    return {
      mode: 'manual',
      reason: `no allow_once or allow_always option available for ${kind}`,
    }
  }

  // Priority 3: controlled group — match sessionPolicy against exact option.kind
  if (sessionPolicy === 'manual') {
    return { mode: 'manual', reason: 'manual session approval policy' }
  }

  const match = options.find((o) => o.kind === sessionPolicy)
  if (match) {
    const decision = sessionPolicy.startsWith('allow') ? 'allow' : 'deny'
    return {
      mode: 'automatic',
      option: match,
      decision,
      reason: `auto-approved ${kind} matching session policy ${sessionPolicy}`,
    }
  }

  return {
    mode: 'manual',
    reason: `no option matching session policy ${sessionPolicy} for ${kind}`,
  }
}

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
