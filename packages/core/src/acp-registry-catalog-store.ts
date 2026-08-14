/**
 * Last-known-good ACP Registry catalog store.
 * Path: <root>/data/acp-registry.json (mode 0600)
 */
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import type { AcpRegistryCatalogSnapshot } from '@pihuo-agent/shared'
import { resolveRouterDataPaths } from './router-data-paths.js'

export interface PersistedAcpRegistryCatalog {
  version: 1
  etag?: string
  fetchedAt?: string
  schemaVersion: string
  digest: string
  snapshot: AcpRegistryCatalogSnapshot
  diagnosticCode?: string
  diagnosticMessage?: string
}

function catalogPath(): string {
  return (
    process.env.ACP_REGISTRY_CATALOG_PATH?.trim() ||
    join(resolveRouterDataPaths().dataDir, 'acp-registry.json')
  )
}

function ensurePrivateDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  try {
    chmodSync(dir, 0o700)
  } catch {
    /* windows */
  }
}

function atomicWritePrivate(path: string, body: string): void {
  ensurePrivateDir(dirname(path))
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmp, body, { mode: 0o600 })
  const fd = openSync(tmp, 'r+')
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(tmp, path)
  try {
    chmodSync(path, 0o600)
  } catch {
    /* windows */
  }
}

function isolateCorrupt(path: string): void {
  if (!existsSync(path)) return
  const dest = `${path}.corrupt.${Date.now()}`
  try {
    renameSync(path, dest)
  } catch {
    try {
      unlinkSync(path)
    } catch {
      /* ignore */
    }
  }
}

export function loadAcpRegistryCatalogStore(
  path = catalogPath(),
): PersistedAcpRegistryCatalog | null {
  if (!existsSync(path)) return null
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      isolateCorrupt(path)
      return null
    }
    const rec = raw as Record<string, unknown>
    if (rec.version !== 1 || !rec.snapshot || typeof rec.digest !== 'string') {
      isolateCorrupt(path)
      return null
    }
    const snapshot = rec.snapshot as AcpRegistryCatalogSnapshot
    if (
      !Array.isArray(snapshot.agents) ||
      snapshot.agents.length === 0 ||
      typeof snapshot.version !== 'string' ||
      typeof snapshot.schemaVersion !== 'string' ||
      typeof snapshot.digest !== 'string' ||
      rec.digest !== snapshot.digest ||
      (typeof rec.schemaVersion === 'string' && rec.schemaVersion !== snapshot.schemaVersion) ||
      snapshot.agents.some(
        (agent) =>
          !agent ||
          typeof agent.id !== 'string' ||
          typeof agent.name !== 'string' ||
          typeof agent.version !== 'string' ||
          typeof agent.manifestDigest !== 'string' ||
          !Array.isArray(agent.distributions) ||
          agent.distributions.length === 0,
      )
    ) {
      isolateCorrupt(path)
      return null
    }
    return {
      version: 1,
      etag: typeof rec.etag === 'string' ? rec.etag : undefined,
      fetchedAt: typeof rec.fetchedAt === 'string' ? rec.fetchedAt : undefined,
      schemaVersion:
        typeof rec.schemaVersion === 'string' ? rec.schemaVersion : snapshot.schemaVersion,
      digest: rec.digest,
      snapshot: {
        ...snapshot,
        source: 'persisted',
      },
      diagnosticCode: typeof rec.diagnosticCode === 'string' ? rec.diagnosticCode : undefined,
      diagnosticMessage:
        typeof rec.diagnosticMessage === 'string' ? rec.diagnosticMessage : undefined,
    }
  } catch {
    isolateCorrupt(path)
    return null
  }
}

export function saveAcpRegistryCatalogStore(
  entry: Omit<PersistedAcpRegistryCatalog, 'version'>,
  path = catalogPath(),
): void {
  const body: PersistedAcpRegistryCatalog = {
    version: 1,
    ...entry,
    snapshot: {
      ...entry.snapshot,
      source: 'persisted',
    },
  }
  atomicWritePrivate(path, `${JSON.stringify(body, null, 2)}\n`)
}

export function acpRegistryCatalogStorePath(): string {
  return catalogPath()
}
