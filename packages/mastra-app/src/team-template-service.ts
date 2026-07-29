import { getSharedStore, type LocalStore } from '@swarmdesk-agent/core'
import { getAcpSessionManager } from '@swarmdesk-agent/adapters'
import { evaluateWorkerReasoningSelection } from './worker-reasoning.js'
import { resolveModelCatalogScopeKey } from './worker-models.js'
import type {
  ApplyTeamTemplateInput,
  CreateTeamMemberInput,
  TeamMember,
  TeamTemplateMemberMapping,
  TeamTemplateApplicationMemberPreview,
  TeamTemplateApplicationPreview,
  WorkerRegistration,
} from '@swarmdesk-agent/shared'
import { evaluateTeamTemplateAvailability } from '@swarmdesk-agent/shared'
import { getWorkerScheduler } from './scheduler.js'

export type TeamTemplateServiceErrorCode =
  | 'TEAM_HAS_OPEN_JOBS'
  | 'TEAM_REPLACEMENT_IN_PROGRESS'
  | 'TEAM_REVISION_CONFLICT'
  | 'TEAM_TEMPLATE_MAPPING_REQUIRED'
  | 'TEAM_ACP_CLEANUP_FAILED'
  | 'TEAM_TEMPLATE_NOT_FOUND'
  | 'TEAM_SESSION_NOT_FOUND'
  | 'PROJECT_NOT_FOUND'

export class TeamTemplateServiceError extends Error {
  constructor(
    readonly code: TeamTemplateServiceErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'TeamTemplateServiceError'
  }
}

interface Dependencies {
  store: LocalStore
  withSessionAdmission<T>(sessionId: string, operation: () => Promise<T>): Promise<T>
  cleanupTeamMember(sessionId: string, memberId: string): Promise<void>
  evaluateReasoning?: typeof evaluateWorkerReasoningSelection
}

function mappingFor(
  mappings: TeamTemplateMemberMapping[] | undefined,
  memberIndex: number,
): TeamTemplateMemberMapping | undefined {
  return mappings?.find((candidate) => candidate.memberIndex === memberIndex)
}

function workerAvailable(worker: WorkerRegistration | undefined, projectId: string): boolean {
  if (!worker?.enabled) return false
  return worker.scope === 'global' || worker.projectId === projectId
}

function modelAvailable(worker: WorkerRegistration, model: string | undefined): boolean {
  if (!model) return true
  if (!worker.availableModels?.length) return true
  return worker.availableModels.some((candidate) => candidate.modelId === model)
}

function reasoningAvailable(
  worker: WorkerRegistration,
  model: string | undefined,
  reasoning: string | undefined,
  scopeKey: string | undefined,
  evaluate: typeof evaluateWorkerReasoningSelection,
): boolean {
  if (!reasoning) return true
  const effectiveModel = model || worker.model?.trim() || undefined
  const result = evaluate(worker.id, effectiveModel, reasoning, { scopeKey })
  return result.ok
}

export class TeamTemplateService {
  constructor(private readonly deps: Dependencies) {}

  resolveForProject(input: {
    projectId: string
    templateId: string
  }): Array<Omit<CreateTeamMemberInput, 'chatSessionId'>> {
    const project = this.deps.store
      .listProjects()
      .find((candidate) => candidate.id === input.projectId)
    if (!project) {
      throw new TeamTemplateServiceError('PROJECT_NOT_FOUND', 'Project not found')
    }
    const template = this.deps.store.getTeamTemplate(input.templateId)
    if (!template) {
      throw new TeamTemplateServiceError('TEAM_TEMPLATE_NOT_FOUND', 'Team template not found')
    }
    const workers = this.deps.store.listWorkers()
    const availability = evaluateTeamTemplateAvailability({
      template,
      workers,
      projectId: project.id,
    })
    const scopeKey = resolveModelCatalogScopeKey(project.rootPath) || undefined
    const reasoningReady = template.members.every((member) => {
      const worker = workers.find((candidate) => candidate.id === member.preferredWorkerId)
      return (
        !member.reasoning ||
        Boolean(
          worker &&
          reasoningAvailable(
            worker,
            member.model,
            member.reasoning,
            scopeKey,
            this.deps.evaluateReasoning ?? evaluateWorkerReasoningSelection,
          ),
        )
      )
    })
    if (!availability.ready || !reasoningReady) {
      throw new TeamTemplateServiceError(
        'TEAM_TEMPLATE_MAPPING_REQUIRED',
        'Team template Worker or model mapping is incomplete',
      )
    }
    return template.members.map((member) => ({
      workerId: member.preferredWorkerId,
      name: member.name,
      roleType: member.roleType,
      instructions: member.instructions,
      model: member.model,
      ...(member.reasoning?.trim() ? { reasoning: member.reasoning.trim() } : {}),
    }))
  }

  preview(input: {
    sessionId: string
    templateId: string
    mappings?: TeamTemplateMemberMapping[]
  }): TeamTemplateApplicationPreview {
    const session = this.deps.store
      .listSessions()
      .find((candidate) => candidate.id === input.sessionId)
    if (!session) {
      throw new TeamTemplateServiceError('TEAM_SESSION_NOT_FOUND', 'Team Session not found')
    }
    const template = this.deps.store.getTeamTemplate(input.templateId)
    if (!template) {
      throw new TeamTemplateServiceError('TEAM_TEMPLATE_NOT_FOUND', 'Team template not found')
    }
    const workers = this.deps.store.listWorkers()
    const project = this.deps.store
      .listProjects()
      .find((candidate) => candidate.id === session.projectId)
    const scopeKey = resolveModelCatalogScopeKey(project?.rootPath) || undefined
    const members = template.members.map((member, memberIndex) => {
      const mapping = mappingFor(input.mappings, memberIndex)
      const workerId = mapping?.workerId || member.preferredWorkerId
      const worker = workers.find((candidate) => candidate.id === workerId)
      const model =
        mapping && Object.prototype.hasOwnProperty.call(mapping, 'model')
          ? mapping.model?.trim() || undefined
          : member.model?.trim() || undefined
      const reasoning =
        mapping && Object.prototype.hasOwnProperty.call(mapping, 'reasoning')
          ? mapping.reasoning?.trim() || undefined
          : member.reasoning?.trim() || undefined
      const preview: TeamTemplateApplicationMemberPreview = {
        memberIndex,
        name: member.name,
        roleType: member.roleType,
        instructions: member.instructions,
        preferredWorkerId: member.preferredWorkerId,
        workerId: workerAvailable(worker, session.projectId) ? workerId : undefined,
        model,
        reasoning,
      }
      if (!preview.workerId || !worker) {
        preview.issueCode = 'WORKER_MAPPING_REQUIRED'
      } else if (!modelAvailable(worker, model)) {
        preview.issueCode = 'MODEL_MAPPING_REQUIRED'
      } else if (
        reasoning &&
        !reasoningAvailable(
          worker,
          model,
          reasoning,
          scopeKey,
          this.deps.evaluateReasoning ?? evaluateWorkerReasoningSelection,
        )
      ) {
        preview.issueCode = 'REASONING_MAPPING_REQUIRED'
      }
      return preview
    })
    return {
      templateId: template.id,
      templateName: template.name,
      teamRevision: session.teamRevision,
      ready: members.every((member) => !member.issueCode),
      members,
    }
  }

  async apply(
    input: ApplyTeamTemplateInput & { sessionId: string },
  ): Promise<{ members: TeamMember[]; teamRevision: number }> {
    try {
      return await this.deps.withSessionAdmission(input.sessionId, async () => {
        const openJobs = this.deps.store.listJobs({
          sessionId: input.sessionId,
          status: ['queued', 'running', 'pending_approval'],
          limit: 500,
        })
        if (openJobs.length > 0) {
          throw new TeamTemplateServiceError(
            'TEAM_HAS_OPEN_JOBS',
            'Current Team has open Worker jobs',
          )
        }
        const preview = this.preview(input)
        if (preview.teamRevision !== input.expectedTeamRevision) {
          throw new TeamTemplateServiceError(
            'TEAM_REVISION_CONFLICT',
            'Team changed after the template preview',
          )
        }
        if (!preview.ready) {
          throw new TeamTemplateServiceError(
            'TEAM_TEMPLATE_MAPPING_REQUIRED',
            'Team template Worker or model mapping is incomplete',
          )
        }
        const currentMembers = this.deps.store.listTeamMembers(input.sessionId)
        try {
          for (const member of currentMembers) {
            await this.deps.cleanupTeamMember(input.sessionId, member.id)
          }
        } catch {
          throw new TeamTemplateServiceError(
            'TEAM_ACP_CLEANUP_FAILED',
            'Unable to clean the current Team ACP context',
          )
        }
        let result: ReturnType<LocalStore['replaceTeamMembers']>
        try {
          result = this.deps.store.replaceTeamMembers({
            chatSessionId: input.sessionId,
            expectedTeamRevision: input.expectedTeamRevision,
            members: preview.members.map((member) => ({
              workerId: member.workerId!,
              name: member.name,
              roleType: member.roleType,
              instructions: member.instructions,
              model: member.model,
              ...(member.reasoning?.trim() ? { reasoning: member.reasoning.trim() } : {}),
            })),
          })
        } catch (error) {
          if (error instanceof Error && error.message.startsWith('Team revision conflict:')) {
            throw new TeamTemplateServiceError(
              'TEAM_REVISION_CONFLICT',
              'Team changed while applying the template',
            )
          }
          throw error
        }
        return { members: result.members, teamRevision: result.session.teamRevision }
      })
    } catch (error) {
      if (error instanceof Error && error.message === 'TEAM_REPLACEMENT_IN_PROGRESS') {
        throw new TeamTemplateServiceError(
          'TEAM_REPLACEMENT_IN_PROGRESS',
          'Another Team replacement is already in progress',
        )
      }
      throw error
    }
  }
}

let sharedTeamTemplateService: TeamTemplateService | undefined

export function getTeamTemplateService(): TeamTemplateService {
  sharedTeamTemplateService ??= new TeamTemplateService({
    store: getSharedStore(),
    withSessionAdmission: (sessionId, operation) =>
      getWorkerScheduler().withSessionAdmission(sessionId, operation),
    cleanupTeamMember: async (sessionId, memberId) => {
      getAcpSessionManager().deleteContextsByTeamMember(sessionId, memberId)
    },
  })
  return sharedTeamTemplateService
}
