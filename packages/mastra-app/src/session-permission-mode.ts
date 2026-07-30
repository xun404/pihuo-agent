import { classifyAcpLocations, type AcpPermissionRequest } from '@swarmdesk-agent/adapters'
import { decidePermission, type LocalStore, type PermissionDecision } from '@swarmdesk-agent/core'
import type {
  AcpToolKind,
  ApprovalItem,
  PermissionTargetScope,
  Session,
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

export function setSessionPermissionModeInStore(input: {
  store: LocalStore
  sessionId: string
  permissionMode: SessionPermissionMode
  onApprovalResolved?: (approval: ApprovalItem) => void
}): SetSessionPermissionModeResult {
  const session = input.store.updateSessionPermissionMode(input.sessionId, input.permissionMode)
  const approvals: ApprovalItem[] = []
  const failures: Array<{ approvalId: string; error: string }> = []
  if (input.permissionMode !== 'auto') return { session, approvals, failures }

  const pending = input.store
    .listPendingApprovals()
    .filter((approval) => approval.sessionId === input.sessionId)
  const affectedJobIds = new Set(
    pending.map((approval) => approval.jobId).filter((jobId): jobId is string => Boolean(jobId)),
  )

  for (const approval of pending) {
    const allow =
      approval.options.find((option) => option.kind === 'allow_once') ??
      approval.options.find((option) => option.kind === 'allow_always')
    try {
      const result = allow
        ? input.store.tryResolveApproval(approval.id, 'allow', allow.optionId, {
            resolutionSource: 'policy',
            resolutionReason: `Auto permission mode selected ${allow.kind}`,
          })
        : input.store.tryResolveApproval(approval.id, 'cancel', undefined, {
            resolutionSource: 'system',
            resolutionReason: 'Auto permission mode found no allow option',
          })
      if (!result.resolved) continue
      approvals.push(result.item)
      input.onApprovalResolved?.(result.item)
    } catch (error) {
      failures.push({
        approvalId: approval.id,
        error: error instanceof Error ? error.message : 'Approval resolution failed',
      })
    }
  }

  for (const jobId of affectedJobIds) {
    const job = input.store.getJob(jobId)
    if (!job || job.status !== 'pending_approval') continue
    const stillPending = input.store
      .listPendingApprovals()
      .some((approval) => approval.jobId === jobId)
    if (!stillPending) {
      input.store.updateJob(jobId, {
        status: 'running',
        message: `Running on ${job.workerName}`,
      })
    }
  }

  return { session, approvals, failures }
}
