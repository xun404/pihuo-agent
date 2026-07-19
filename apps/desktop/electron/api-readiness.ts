import { resolve as resolvePath } from 'node:path'
import { createHash } from 'node:crypto'

export interface ApiHealthIdentity {
  ok?: boolean
  pid?: number
  startedAt?: string
  ownerEpoch?: string
  port?: number
  service?: string
  workspaceId?: string
}

export interface ApiDiscoveryIdentity {
  port?: number
  pid?: number
  startedAt?: string
  ownerEpoch?: string
  desktopToken?: string
  token?: string
  workspaceId?: string
}

export interface ExpectedApiChild {
  pid: number
  spawnedAt: number
}

export function workspaceIdentity(workspaceRoot: string): string {
  return createHash('sha256').update(resolvePath(workspaceRoot)).digest('hex')
}

export type ApiRestartMode = 'ensure' | 'apply-settings'

/** Settings are only applied by a process this Electron instance can restart. */
export function allowsExistingApiReuse(mode: ApiRestartMode): boolean {
  return mode === 'ensure'
}

/** Promise queue that remains usable after an individual task rejects. */
export function createSerialTaskRunner(): <T>(task: () => T | Promise<T>) => Promise<T> {
  let tail: Promise<void> = Promise.resolve()
  return <T>(task: () => T | Promise<T>): Promise<T> => {
    const result = tail.then(task)
    tail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}

/** macOS keeps the app resident after the last window closes, so its API must stay alive. */
export function shouldStopApiOnAllWindowsClosed(platform: NodeJS.Platform): boolean {
  return platform !== 'darwin'
}

export function shouldWaitForOwnedApiOnQuit(
  hasOwnedChild: boolean,
  quitAlreadyReissued: boolean,
): boolean {
  return hasOwnedChild && !quitAlreadyReissued
}

export function matchesApiIdentity(input: {
  health: ApiHealthIdentity
  discovery: ApiDiscoveryIdentity
  expectedPort: number
  expectedWorkspaceRoot?: string
  expectedChild?: ExpectedApiChild
}): boolean {
  const { health, discovery, expectedPort, expectedChild, expectedWorkspaceRoot } = input
  if (health.ok !== true || health.service !== 'swarmdesk-agent-api') return false
  if (!Number.isInteger(expectedPort) || expectedPort <= 0) return false
  if (health.port !== expectedPort || discovery.port !== expectedPort) return false
  if (!Number.isInteger(health.pid) || !Number.isInteger(discovery.pid)) return false
  if (health.pid !== discovery.pid) return false
  if (typeof health.startedAt !== 'string' || typeof discovery.startedAt !== 'string') return false
  if (health.startedAt !== discovery.startedAt) return false

  const startedAtMs = Date.parse(health.startedAt)
  if (!Number.isFinite(startedAtMs)) return false
  const canonicalEpoch = `${health.pid}:${health.startedAt}`
  if (health.ownerEpoch !== canonicalEpoch || discovery.ownerEpoch !== canonicalEpoch) return false
  if (expectedWorkspaceRoot) {
    const expectedWorkspaceId = workspaceIdentity(expectedWorkspaceRoot)
    if (health.workspaceId !== expectedWorkspaceId) return false
    if (discovery.workspaceId !== expectedWorkspaceId) return false
  }

  const desktopToken = discovery.desktopToken ?? discovery.token
  if (typeof desktopToken !== 'string' || desktopToken.length < 16) return false

  if (expectedChild) {
    if (health.pid !== expectedChild.pid) return false
    if (startedAtMs < expectedChild.spawnedAt) return false
  }
  return true
}

export function parseListenerPids(raw: string): number[] {
  const pids: number[] = []
  const seen = new Set<number>()
  for (const line of raw.split(/\r?\n/)) {
    const value = Number(line.trim())
    if (!Number.isInteger(value) || value <= 0 || seen.has(value)) continue
    seen.add(value)
    pids.push(value)
  }
  return pids
}

/**
 * Fail-safe boundary for retiring an incompatible SwarmDesk API left by an
 * older development run. Never authorize terminating an unrelated listener.
 */
export function isOwnedLegacyApiProcess(input: {
  health: ApiHealthIdentity
  listenerPid: number
  command: string
  cwd: string
  expectedMastraRoot: string
  expectedPort: number
}): boolean {
  const { health, listenerPid, command, cwd, expectedMastraRoot, expectedPort } = input
  if (health.ok !== true || health.service !== 'swarmdesk-agent-api') return false
  if (!Number.isInteger(listenerPid) || listenerPid <= 0) return false
  if (health.pid !== undefined && health.pid !== listenerPid) return false
  if (health.port !== undefined && health.port !== expectedPort) return false
  if (resolvePath(cwd) !== resolvePath(expectedMastraRoot)) return false
  if (!/(?:^|[\s/\\])http-server\.(?:ts|js)(?:\s|$)/.test(command)) return false
  return true
}
