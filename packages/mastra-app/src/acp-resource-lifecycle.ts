import { workerExecutionConfigChanged } from '@router-agents/adapters'
import type { WorkerRegistration } from '@router-agents/shared'

interface AcpContextManager {
  deleteContextByRouterSession(sessionId: string): void
  deleteContextsByRouterSessions(sessionIds: string[]): void
}

interface WorkerContextManager {
  deleteContextByWorker(workerId: string): void
  invalidateWorker?(workerId: string): void
}

interface WorkerCatalogStore {
  deleteWorker(workerId: string): void
}

function canonicalEnv(env: WorkerRegistration['env']): string {
  return JSON.stringify(Object.entries(env ?? {}).sort(([a], [b]) => a.localeCompare(b)))
}

export function workerModelDiscoveryConfigChanged(
  before: WorkerRegistration,
  after: WorkerRegistration,
): boolean {
  return (
    before.command !== after.command ||
    before.kind !== after.kind ||
    before.args.length !== after.args.length ||
    before.args.some((arg, index) => arg !== after.args[index]) ||
    canonicalEnv(before.env) !== canonicalEnv(after.env)
  )
}

/**
 * Keep ACP sessions and every project-scoped model catalog within their own
 * invalidation boundary.
 *
 * Invalidates live context when command/args/env/model/kind/enabled OR
 * installationId / runtimeProfile / authRevision / launchSpec change.
 */
export function reconcileWorkerRuntimeResources(input: {
  before: WorkerRegistration
  after: WorkerRegistration
  manager: WorkerContextManager
  catalogStore: WorkerCatalogStore
  /** Close only live contexts; changed fingerprints keep durable rows as history. */
  preserveSessionHistory?: boolean
}): void {
  if (
    workerExecutionConfigChanged(
      {
        command: input.before.command,
        args: input.before.args,
        env: input.before.env,
        model: input.before.model,
        kind: input.before.kind,
        enabled: input.before.enabled,
        installationId: input.before.installationId,
        runtimeProfile: input.before.runtimeProfile,
        authRevision: input.before.authRevision,
        launchSpec: input.before.launchSpec,
      },
      {
        command: input.after.command,
        args: input.after.args,
        env: input.after.env,
        model: input.after.model,
        kind: input.after.kind,
        enabled: input.after.enabled,
        installationId: input.after.installationId,
        runtimeProfile: input.after.runtimeProfile,
        authRevision: input.after.authRevision,
        launchSpec: input.after.launchSpec,
      },
    )
  ) {
    if (input.preserveSessionHistory) {
      if (!input.manager.invalidateWorker) {
        throw new Error('Live ACP Worker invalidation is unavailable')
      }
      input.manager.invalidateWorker(input.before.id)
    } else {
      input.manager.deleteContextByWorker(input.before.id)
    }
  }
  if (workerModelDiscoveryConfigChanged(input.before, input.after)) {
    input.catalogStore.deleteWorker(input.before.id)
  }
}

interface RouterResourceStore {
  listSessions(projectId?: string): Array<{ id: string }>
  deleteSession(sessionId: string): unknown
  deleteProject(projectId: string): unknown
}

export function deleteRouterSessionResource(input: {
  manager: AcpContextManager
  store: RouterResourceStore
  sessionId: string
}): void {
  input.manager.deleteContextByRouterSession(input.sessionId)
  input.store.deleteSession(input.sessionId)
}

export function deleteRouterProjectResource(input: {
  manager: AcpContextManager
  store: RouterResourceStore
  projectId: string
}): void {
  const sessionIds = input.store.listSessions(input.projectId).map((session) => session.id)
  input.manager.deleteContextsByRouterSessions(sessionIds)
  input.store.deleteProject(input.projectId)
}
