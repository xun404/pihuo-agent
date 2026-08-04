import { classifyAcpLocations, type AcpPermissionRequest } from '@swarmdesk-agent/adapters'
import {
  decidePermission,
  globalActivityLog,
  type LocalStore,
  type PermissionDecision,
} from '@swarmdesk-agent/core'
import type {
  AcpToolKind,
  ApprovalItem,
  PermissionTargetScope,
  PermissionModeChangeSource,
  Session,
  SessionApprovalPolicy,
  SessionPermissionMode,
} from '@swarmdesk-agent/shared'

const ACP_TOOL_KIND_MAP: Record<string, AcpToolKind> = {
  read: 'read',
  read_file: 'read',
  search: 'search',
  grep: 'search',
  glob: 'search',
  think: 'think',
  delete: 'delete',
  remove: 'delete',
  edit: 'edit',
  write: 'edit',
  patch: 'edit',
  move: 'move',
  rename: 'move',
  execute: 'execute',
  bash: 'execute',
  exec: 'execute',
  run: 'execute',
  fetch: 'fetch',
  web: 'fetch',
  http: 'fetch',
  switch_mode: 'switch_mode',
}

function resolveAcpToolKind(kind: string | undefined): AcpToolKind {
  if (!kind) return 'other'
  return ACP_TOOL_KIND_MAP[kind.toLowerCase().trim()] ?? 'other'
}

export interface PermissionDecisionForJob {
  decision: PermissionDecision
  permissionMode: SessionPermissionMode
  targetScope: PermissionTargetScope
  toolKind: AcpToolKind
}

export function decidePermissionForJobInStore(input: {
  store: LocalStore
  jobId: string
  request: AcpPermissionRequest
}): PermissionDecisionForJob {
  const toolKind = resolveAcpToolKind(input.request.kind)
  const job = input.store.getJob(input.jobId)
  if (!job) {
    return {
      decision: { mode: 'cancelled', reason: 'job state is unavailable' },
      permissionMode: 'default',
      targetScope: 'unknown',
      toolKind,
    }
  }

  const session = input.store.listSessions().find((candidate) => candidate.id === job.sessionId)
  const project = input.store.listProjects().find((candidate) => candidate.id === job.projectId)
  if (!session || !project) {
    return {
      decision: {
        mode: 'cancelled',
        reason: !session ? 'session state is unavailable' : 'project state is unavailable',
      },
      permissionMode: session?.permissionMode ?? 'default',
      targetScope: 'unknown',
      toolKind,
    }
  }
  const permissionMode = session?.permissionMode ?? 'default'
  const targetScope = classifyAcpLocations({
    projectRoot: project.rootPath,
    locations: input.request.locations,
  })

  return {
    decision: decidePermission({
      toolKind,
      options: input.request.options,
      permissionMode,
      targetScope,
    }),
    permissionMode,
    targetScope,
    toolKind,
  }
}

export interface SetSessionPermissionModeResult {
  session: Session
  approvals: ApprovalItem[]
  failures: Array<{ approvalId: string; error: string }>
}

export interface ReconcileSessionPendingApprovalsResult {
  approvals: ApprovalItem[]
  failures: Array<{ approvalId: string; error: string }>
}

const PUBLIC_RECONCILIATION_FAILURE = 'Approval resolution failed; retry this Session.'

/**
 * Resolve every pending Approval that belongs to a Session whose live mode is
 * auto. Calling this after a manual Approval is persisted closes the race where
 * the shield changes between the permission decision and the durable insert.
 */
export function reconcileSessionPendingApprovalsInStore(input: {
  store: LocalStore
  sessionId: string
  onApprovalResolved?: (approval: ApprovalItem) => void
}): ReconcileSessionPendingApprovalsResult {
  const session = input.store.listSessions().find((candidate) => candidate.id === input.sessionId)
  const approvals: ApprovalItem[] = []
  const failures: Array<{ approvalId: string; error: string }> = []
  if (session?.permissionMode !== 'auto') return { approvals, failures }

  const pending = input.store
    .listPendingApprovals()
    .filter((approval) => approval.sessionId === input.sessionId)
  for (const approval of pending) {
    const allow =
      approval.options.find((option) => option.kind === 'allow_once') ??
      approval.options.find((option) => option.kind === 'allow_always')
    try {
      const result = allow
        ? input.store.tryResolveJobApproval(approval.id, 'allow', allow.optionId, {
            resolutionSource: 'policy',
            resolutionReason: `Auto permission mode selected ${allow.kind}`,
          })
        : input.store.tryResolveJobApproval(approval.id, 'cancel', undefined, {
            resolutionSource: 'system',
            resolutionReason: 'Auto permission mode found no allow option',
          })
      if (!result.resolved) continue
      // The durable CAS has already won. A notification/timer side effect must
      // not turn that committed resolution into a retryable approval failure.
      approvals.push(result.item)
      try {
        input.onApprovalResolved?.(result.item)
      } catch (error) {
        globalActivityLog.append('approval', 'Session approval resolution notification failed', {
          sessionId: input.sessionId,
          approvalId: approval.id,
          errorType: error instanceof Error ? error.name : typeof error,
        })
      }
    } catch (error) {
      // Keep the HTTP/Desktop contract stable and fail-closed. Store/CAS errors
      // can contain paths or implementation details; retain only a type marker
      // in the local activity stream and never return the raw message.
      globalActivityLog.append('approval', 'Session approval reconciliation failed', {
        sessionId: input.sessionId,
        approvalId: approval.id,
        errorType: error instanceof Error ? error.name : typeof error,
      })
      failures.push({
        approvalId: approval.id,
        error: PUBLIC_RECONCILIATION_FAILURE,
      })
    }
  }

  return { approvals, failures }
}

export function setSessionPermissionModeInStore(input: {
  store: LocalStore
  sessionId: string
  permissionMode: SessionPermissionMode
  source?: PermissionModeChangeSource
  /** Legacy five-state route needs to preserve the exact policy value. */
  approvalPolicy?: SessionApprovalPolicy
  onApprovalResolved?: (approval: ApprovalItem) => void
}): SetSessionPermissionModeResult {
  const session = input.approvalPolicy
    ? input.store.updateSessionApprovalPolicy(input.sessionId, input.approvalPolicy, {
        source: input.source,
      })
    : input.store.updateSessionPermissionMode(input.sessionId, input.permissionMode, {
        source: input.source,
      })
  const reconciled = reconcileSessionPendingApprovalsInStore({
    store: input.store,
    sessionId: input.sessionId,
    onApprovalResolved: input.onApprovalResolved,
  })
  return { session, ...reconciled }
}
