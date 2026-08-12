import type { WorkerRole } from './roles.js'
import type { WorkerRegistration } from './worker.js'

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
