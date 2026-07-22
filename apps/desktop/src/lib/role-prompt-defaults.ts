import {
  normalizeWorkerDefaultRole,
  type PromptSettings,
  type WorkerRegistration,
  type WorkerRole,
} from '@swarmdesk-agent/shared'

export interface RolePromptDraft {
  name: string
  workerId: string
  roleType: WorkerRole
  instructions: string
  model: string
}

export function roleDraftFromWorker(worker: WorkerRegistration): RolePromptDraft {
  const role = normalizeWorkerDefaultRole(worker)
  return {
    name: role.name,
    workerId: worker.id,
    roleType: role.roleType,
    instructions: role.instructions,
    model: '',
  }
}

export function roleDraftWithType<T extends { roleType: WorkerRole; instructions: string }>(
  draft: T,
  roleType: WorkerRole,
  rolePrompts: Readonly<PromptSettings['roles']>,
): T {
  return { ...draft, roleType, instructions: rolePrompts[roleType] }
}
