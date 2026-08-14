import { existsSync, mkdirSync, readdirSync, rmSync, unlinkSync } from 'node:fs'
import { relative, sep } from 'node:path'
import type { AppSnapshot } from '@pihuo-agent/shared'
import { resetSettingsToDefaults, clearAllSecrets, type AppSettings } from './secure-secrets.js'
import { clearAllWorkerSecrets } from './worker-secrets.js'
import {
  getWorkerModelCatalogStore,
  workerModelCatalogsPath,
} from './worker-model-catalog-store.js'
import { resolveRouterDataPaths, resolveRouterDataDir } from './router-data-paths.js'
import { LocalStore, type DangerZoneClearResult } from './store.js'

export type DangerZoneAction =
  'reset-settings' | 'clear-workers-and-crews' | 'clear-sessions' | 'clear-cache' | 'reset-all'

export interface DangerZoneStats {
  /** Persisted project records (directories are not deleted). */
  projects: number
  /** Registered global Worker/Agent records. */
  workers: number
  /** Chat-scoped TeamMember assignments, including archived assignments. */
  workerSessions: number
  /** Saved crew/team templates. */
  crews: number
  /** Router chat sessions. */
  chatSessions: number
}

export function dangerZoneStats(snapshot: AppSnapshot): DangerZoneStats {
  return {
    projects: snapshot.projects.length,
    workers: snapshot.workers.length,
    workerSessions: snapshot.teamMembers.length,
    crews: snapshot.teamTemplates.length,
    chatSessions: snapshot.sessions.length,
  }
}

export class DangerZoneBusyError extends Error {
  readonly code = 'DANGER_ZONE_OPEN_JOBS'

  constructor(readonly openJobs: number) {
    super(`Stop ${openJobs} active Worker job${openJobs === 1 ? '' : 's'} before resetting data`)
    this.name = 'DangerZoneBusyError'
  }
}

export interface DangerZoneRuntimeCleanup {
  deleteContextsByRouterSessions(sessionIds: string[]): void
  deleteContextByWorker(workerId: string): void
}

export interface DangerZoneDependencies {
  store: LocalStore
  runtime: DangerZoneRuntimeCleanup
  /** Delete the Mastra Memory threads for the supplied Router sessions. */
  deleteMemoryThreads: (threadIds: readonly string[]) => Promise<void>
  clearWorkerSecrets?: () => { workers: number }
  deleteWorkerCatalog?: (workerId: string) => void
  clearCache?: () => { removed: string[] }
}

export type DangerZoneActionResult =
  DangerZoneClearResult | { removed: string[] } | (DangerZoneClearResult & { cacheRemoved: number })

function assertSafeChild(root: string, target: string): void {
  const rel = relative(root, target)
  if (!rel || rel.startsWith(`..${sep}`) || rel === '..') {
    throw new Error(`Refusing to clear unsafe path: ${target}`)
  }
}

/**
 * Clear rebuildable model/runtime caches only.  The state snapshot, settings,
 * encrypted secrets, theme directory, and ACP installation artifacts remain.
 */
export function clearRebuildableCaches(): { removed: string[] } {
  const paths = resolveRouterDataPaths()
  const root = resolveRouterDataDir()
  const removed: string[] = []
  assertSafeChild(root, paths.cacheDir)
  if (existsSync(paths.cacheDir)) {
    const entries = readdirSync(paths.cacheDir)
    rmSync(paths.cacheDir, { recursive: true, force: true })
    mkdirSync(paths.cacheDir, { recursive: true, mode: 0o700 })
    removed.push(...entries.map((entry) => `${paths.cacheDir}/${entry}`))
  } else {
    mkdirSync(paths.cacheDir, { recursive: true, mode: 0o700 })
  }
  for (const file of [paths.modelRegistryPath, workerModelCatalogsPath()]) {
    assertSafeChild(root, file)
    if (existsSync(file)) {
      unlinkSync(file)
      removed.push(file)
    }
  }
  return { removed }
}

export function resetSettingsForDangerZone(): AppSettings {
  clearAllSecrets()
  return resetSettingsToDefaults()
}

function ensureNoOpenJobs(store: LocalStore): void {
  const openJobs = store.countOpenJobs()
  if (openJobs > 0) throw new DangerZoneBusyError(openJobs)
}

function sessionMemoryThreadIds(snapshot: AppSnapshot): string[] {
  return snapshot.sessions.map((session) => {
    const memoryThreadId =
      typeof session.memoryThreadId === 'string' ? session.memoryThreadId.trim() : ''
    return memoryThreadId || session.id
  })
}

/** Execute state/cache actions in the API owner process. */
export async function performDangerZoneAction(
  action: Exclude<DangerZoneAction, 'reset-settings'>,
  deps: DangerZoneDependencies,
): Promise<{ result: DangerZoneActionResult; snapshot: AppSnapshot }> {
  const { store, runtime } = deps
  if (action !== 'clear-cache') ensureNoOpenJobs(store)

  if (action === 'clear-cache') {
    const result = (deps.clearCache ?? clearRebuildableCaches)()
    return { result, snapshot: store.snapshot() }
  }

  const before = store.snapshot()
  if (action === 'clear-workers-and-crews') {
    for (const worker of before.workers) {
      runtime.deleteContextByWorker(worker.id)
      ;(
        deps.deleteWorkerCatalog ??
        getWorkerModelCatalogStore().deleteWorker.bind(getWorkerModelCatalogStore())
      )(worker.id)
    }
    ;(deps.clearWorkerSecrets ?? clearAllWorkerSecrets)()
    const result = store.clearWorkersAndCrews()
    return { result, snapshot: store.snapshot() }
  }

  if (action === 'clear-sessions') {
    runtime.deleteContextsByRouterSessions(before.sessions.map((session) => session.id))
    // Memory is an external durable store.  Await it before committing the
    // LocalStore mutation so a failed cleanup cannot report sessions deleted
    // while their chat history remains recoverable.
    await deps.deleteMemoryThreads(sessionMemoryThreadIds(before))
    const result = store.clearAllChatSessions()
    return { result, snapshot: store.snapshot() }
  }

  runtime.deleteContextsByRouterSessions(before.sessions.map((session) => session.id))
  await deps.deleteMemoryThreads(sessionMemoryThreadIds(before))
  for (const worker of before.workers) runtime.deleteContextByWorker(worker.id)
  for (const worker of before.workers) {
    ;(
      deps.deleteWorkerCatalog ??
      getWorkerModelCatalogStore().deleteWorker.bind(getWorkerModelCatalogStore())
    )(worker.id)
  }
  ;(deps.clearWorkerSecrets ?? clearAllWorkerSecrets)()
  const result = store.resetAllPersistedData()
  const cacheResult = (deps.clearCache ?? clearRebuildableCaches)()
  return {
    result: { ...result, cacheRemoved: cacheResult.removed.length },
    snapshot: store.snapshot(),
  }
}

export { resetSettingsToDefaults }
