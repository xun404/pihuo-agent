import {
  normalizeWorkerDefaultRoleType,
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

export function roleDraftFromWorker(
  worker: WorkerRegistration,
  rolePrompts: Readonly<PromptSettings['roles']>,
): RolePromptDraft {
  const roleType = normalizeWorkerDefaultRoleType(worker.defaultRoleType)
  return {
    name: worker.name,
    workerId: worker.id,
    roleType,
    instructions: rolePrompts[roleType],
    model: '',
  }
}

export function roleDraftWithType<T extends { roleType: WorkerRole; instructions: string }>(
  draft: T,
  roleType: WorkerRole,
  _rolePrompts?: Readonly<PromptSettings['roles']>,
): T {
  return { ...draft, roleType }
}

export function roleDraftWithDefaultPrompt<
  T extends { roleType: WorkerRole; instructions: string },
>(draft: T, rolePrompts: Readonly<PromptSettings['roles']>): T {
  return { ...draft, instructions: rolePrompts[draft.roleType] }
}
