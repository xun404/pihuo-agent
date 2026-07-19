import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  openSync,
  closeSync,
  fsyncSync,
  unlinkSync,
  chmodSync,
} from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { resolveRouterDataPaths } from './router-data-paths.js'

export const REGISTRY_SNAPSHOT_FILENAME = 'mastra-model-registry.json'

export interface RegistryModel {
  id: string
  label: string
}

export interface RegistryProvider {
  id: string
  name: string
  apiKeyEnvVar: string | string[]
  baseURL?: string
  models: RegistryModel[]
}

export interface RegistrySnapshot {
  version: 1
  source: 'persisted' | 'bundled' | 'installed'
  mastraPackageVersion: string
  generatedAt: string
  providers: RegistryProvider[]
}

export type LoadRegistryResult =
  (RegistrySnapshot & { ok: true }) | { ok: false; errorCode: 'MODEL_REGISTRY_UNAVAILABLE' }

export function persistedRegistryPath(dataDir = resolveRouterDataPaths().dataDir): string {
  return join(dataDir, REGISTRY_SNAPSHOT_FILENAME)
}

export function writePersistedRegistrySnapshot(
  snapshot: RegistrySnapshot,
  dataDir = resolveRouterDataPaths().dataDir,
): void {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 })
  const target = persistedRegistryPath(dataDir)
  const tmp = `${target}.${process.pid}.${Date.now()}.${randomBytes(4).toString('hex')}.tmp`
  const body = JSON.stringify({ ...snapshot, source: 'persisted', version: 1 }, null, 2)
  try {
    const fd = openSync(tmp, 'w', 0o600)
    try {
      writeFileSync(fd, body)
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    try {
      chmodSync(tmp, 0o600)
    } catch {
      /* windows */
    }
    renameSync(tmp, target)
    try {
      chmodSync(target, 0o600)
    } catch {
      /* windows */
    }
  } finally {
    if (existsSync(tmp)) {
      try {
        unlinkSync(tmp)
      } catch {
        /* best effort */
      }
    }
  }
}

function readPersisted(dataDir: string): RegistrySnapshot | null {
  try {
    const p = persistedRegistryPath(dataDir)
    if (!existsSync(p)) return null
    const raw = JSON.parse(readFileSync(p, 'utf8')) as RegistrySnapshot
    if (raw?.version !== 1 || !Array.isArray(raw.providers)) return null
    return { ...raw, source: 'persisted' }
  } catch {
    return null
  }
}

export function loadRegistrySnapshot(opts: {
  dataDir?: string
  bundled: RegistrySnapshot | null
  installed: RegistrySnapshot | null
}): LoadRegistryResult {
  const dataDir = opts.dataDir ?? resolveRouterDataPaths().dataDir
  const persisted = readPersisted(dataDir)
  if (persisted) return { ...persisted, ok: true }
  if (opts.bundled) return { ...opts.bundled, source: 'bundled', ok: true }
  if (opts.installed) return { ...opts.installed, source: 'installed', ok: true }
  return { ok: false, errorCode: 'MODEL_REGISTRY_UNAVAILABLE' }
}
