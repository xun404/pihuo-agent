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
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import {
  workerModelCatalogStorageKey,
  type WorkerModelCatalog,
  type WorkerModelOption,
  type WorkerReasoningCatalogEntry,
} from '@pihuo-agent/shared'
import { resolveRouterDataDir } from './router-data-paths.js'
import { tryAcquireProcessFileLock } from './process-file-lock.js'

const LOCK_SUFFIX = '.lock'

function acquireCatalogLock(filePath: string): { release: () => void } | null {
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 })
  return tryAcquireProcessFileLock(filePath + LOCK_SUFFIX)
}

const CATALOG_FILENAME = 'worker-model-catalogs.json'
const FILE_VERSION = 1 as const

interface CatalogsFile {
  version: typeof FILE_VERSION
  catalogs: Record<string, WorkerModelCatalog>
}

export function workerModelCatalogsPath(dataDir?: string): string {
  const root = dataDir ?? resolveRouterDataDir()
  return join(root, CATALOG_FILENAME)
}

function emptyFile(): CatalogsFile {
  return { version: FILE_VERSION, catalogs: {} }
}

function atomicWrite(filePath: string, body: string): void {
  const dir = dirname(filePath)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const tmp = `${filePath}.${process.pid}.${Date.now()}.${randomBytes(4).toString('hex')}.tmp`
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
    renameSync(tmp, filePath)
    // fsync parent directory so rename is durable across crash
    try {
      const dirFd = openSync(dir, 'r')
      try {
        fsyncSync(dirFd)
      } finally {
        closeSync(dirFd)
      }
    } catch {
      /* windows / unsupported */
    }
    try {
      chmodSync(filePath, 0o600)
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

function isModelOption(v: unknown): v is WorkerModelOption {
  if (!v || typeof v !== 'object') return false
  const m = v as Record<string, unknown>
  return typeof m.modelId === 'string' && typeof m.name === 'string'
}

function parseCatalogEntry(raw: unknown, storageKey: string): WorkerModelCatalog | null {
  if (!raw || typeof raw !== 'object') return null
  const c = raw as Record<string, unknown>
  if (c.version !== 1 && c.version !== 2) return null
  // storageKey may be "workerId" or "workerId::scope"
  const separator = storageKey.indexOf('::')
  const workerIdFromKey = separator >= 0 ? storageKey.slice(0, separator) : storageKey
  const scopeKeyFromKey = separator >= 0 ? storageKey.slice(separator + 2) : undefined
  if (typeof c.workerId !== 'string' || c.workerId !== workerIdFromKey) return null
  const workerId = c.workerId
  if (scopeKeyFromKey) {
    if (typeof c.scopeKey !== 'string' || c.scopeKey !== scopeKeyFromKey) return null
  } else if (typeof c.scopeKey === 'string' && c.scopeKey.trim()) {
    return null
  }
  if (c.source !== 'acp_config_options') return null
  if (typeof c.fetchedAt !== 'string' || typeof c.expiresAt !== 'string') return null
  if (!Array.isArray(c.providers) || !Array.isArray(c.shortlist) || !Array.isArray(c.searchIndex)) {
    return null
  }
  if (!c.shortlist.every(isModelOption) || !c.searchIndex.every(isModelOption)) {
    return null
  }
  const providers = (c.providers as Array<Record<string, unknown>>).map((p) => ({
    providerId: String(p.providerId ?? ''),
    state: p.state as WorkerModelCatalog['providers'][0]['state'],
  }))
  if (
    providers.some(
      (p) => !p.providerId || !['free', 'authenticated', 'disabled', 'unknown'].includes(p.state),
    )
  ) {
    return null
  }
  const rawCandidateIds = Array.isArray(c.rawCandidateIds)
    ? (c.rawCandidateIds as unknown[]).filter((x): x is string => typeof x === 'string')
    : undefined
  // Parse reasoning entries for v2 catalogs (optional field)
  let reasoning: WorkerModelCatalog['reasoning'] | undefined
  if (c.reasoning && typeof c.reasoning === 'object' && !Array.isArray(c.reasoning)) {
    const reasoningEntries = c.reasoning as Record<string, Record<string, unknown>>
    const parsed: Record<string, WorkerReasoningCatalogEntry> = {}
    let hasCorruptReasoning = false
    for (const [modelId, entry] of Object.entries(reasoningEntries)) {
      if (!entry || typeof entry !== 'object') {
        hasCorruptReasoning = true
        continue
      }
      if (typeof modelId !== 'string' || !modelId.trim()) {
        hasCorruptReasoning = true
        continue
      }
      const e = entry as Record<string, unknown>
      if (typeof e.supported !== 'boolean') {
        hasCorruptReasoning = true
        continue
      }
      if (typeof e.fetchedAt !== 'string' || typeof e.expiresAt !== 'string') {
        hasCorruptReasoning = true
        continue
      }
      const selector = e.selector
      let parsedSelector: WorkerReasoningCatalogEntry['selector'] | undefined
      if (selector !== undefined && selector !== null) {
        if (typeof selector !== 'object' || Array.isArray(selector)) {
          hasCorruptReasoning = true
          continue
        }
        const s = selector as Record<string, unknown>
        if (typeof s.configId !== 'string' || !Array.isArray(s.options)) {
          hasCorruptReasoning = true
          continue
        }
        const opts = (s.options as Array<Record<string, unknown>>).map((o) => ({
          value: String(o.value ?? ''),
          name: String(o.name ?? ''),
          description: typeof o.description === 'string' ? o.description : undefined,
        }))
        parsedSelector = {
          configId: String(s.configId),
          currentValue: typeof s.currentValue === 'string' ? s.currentValue : undefined,
          options: opts,
        }
      }
      parsed[modelId] = {
        model: typeof e.model === 'string' && e.model.trim() ? e.model.trim() : undefined,
        supported: Boolean(e.supported),
        selector: parsedSelector,
        fetchedAt: String(e.fetchedAt),
        expiresAt: String(e.expiresAt),
        lastErrorCode: typeof e.lastErrorCode === 'string' ? e.lastErrorCode : undefined,
        lastSuccessfulFetchedAt:
          typeof e.lastSuccessfulFetchedAt === 'string' ? e.lastSuccessfulFetchedAt : undefined,
      }
    }
    if (!hasCorruptReasoning && Object.keys(parsed).length > 0) {
      reasoning = parsed
    }
  }
  const scopeKey = scopeKeyFromKey
  return {
    version: c.version === 2 ? 2 : 1,
    workerId,
    scopeKey,
    projectRoot: typeof c.projectRoot === 'string' ? c.projectRoot : undefined,
    source: 'acp_config_options',
    fetchedAt: c.fetchedAt,
    expiresAt: c.expiresAt,
    providers,
    shortlist: c.shortlist as WorkerModelOption[],
    searchIndex: c.searchIndex as WorkerModelOption[],
    rawCandidateIds,
    evidenceRevision: typeof c.evidenceRevision === 'string' ? c.evidenceRevision : undefined,
    lastErrorCode: typeof c.lastErrorCode === 'string' ? c.lastErrorCode : undefined,
    lastSuccessfulFetchedAt:
      typeof c.lastSuccessfulFetchedAt === 'string' ? c.lastSuccessfulFetchedAt : undefined,
    reasoning,
  }
}

export type CatalogsReadResult =
  { ok: true; file: CatalogsFile } | { ok: false; errorCode: 'CATALOG_CORRUPT'; file: CatalogsFile }

function readFile(filePath: string): CatalogsReadResult {
  if (!existsSync(filePath)) return { ok: true, file: emptyFile() }
  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf8')) as CatalogsFile
    if (!raw || raw.version !== FILE_VERSION || typeof raw.catalogs !== 'object' || !raw.catalogs) {
      return { ok: false, errorCode: 'CATALOG_CORRUPT', file: emptyFile() }
    }
    const catalogs: Record<string, WorkerModelCatalog> = {}
    let hasCorruptEntry = false
    for (const [id, entry] of Object.entries(raw.catalogs)) {
      const parsed = parseCatalogEntry(entry, id)
      if (!parsed) {
        // Keep valid rows readable, but mark the file corrupt so no later RMW
        // can silently rewrite the file while dropping this sibling row.
        hasCorruptEntry = true
        continue
      }
      catalogs[id] = parsed
    }
    const file = { version: FILE_VERSION, catalogs }
    return hasCorruptEntry ? { ok: false, errorCode: 'CATALOG_CORRUPT', file } : { ok: true, file }
  } catch {
    // Isolate corrupt whole-file
    try {
      renameSync(filePath, `${filePath}.corrupt.${Date.now()}`)
    } catch {
      /* best effort */
    }
    return { ok: false, errorCode: 'CATALOG_CORRUPT', file: emptyFile() }
  }
}

export class WorkerModelCatalogStore {
  private readonly filePath: string
  private corrupt = false

  constructor(private readonly dataDir = resolveRouterDataDir()) {
    this.filePath = workerModelCatalogsPath(dataDir)
  }

  /**
   * @param workerId worker id
   * @param scopeKey optional project/cwd digest — when set, looks up scoped catalog
   */
  get(workerId: string, scopeKey?: string | null): WorkerModelCatalog | undefined {
    const result = readFile(this.filePath)
    if (!result.ok) this.corrupt = true
    const key = workerModelCatalogStorageKey(workerId, scopeKey)
    const cat = result.file.catalogs[key] ?? (scopeKey ? undefined : result.file.catalogs[workerId])
    return cat ? structuredClone(cat) : undefined
  }

  put(catalog: WorkerModelCatalog): void {
    if (this.corrupt) {
      throw new Error('CATALOG_CORRUPT: refusing write after isolating a corrupt catalogs file')
    }
    const storageKey = workerModelCatalogStorageKey(catalog.workerId, catalog.scopeKey)
    const parsed = parseCatalogEntry(catalog, storageKey)
    if (!parsed) {
      throw new Error('CATALOG_SCHEMA: invalid WorkerModelCatalog')
    }
    const lock = acquireCatalogLock(this.filePath)
    if (!lock) {
      throw new Error('CATALOG_LOCK: another process holds the catalog lock; retry later')
    }
    try {
      // Re-read under lock for cross-process RMW
      const result = readFile(this.filePath)
      if (!result.ok) {
        this.corrupt = true
        throw new Error('CATALOG_CORRUPT: refusing write after isolating a corrupt catalogs file')
      }
      const file = result.file
      file.catalogs[storageKey] = structuredClone(parsed)
      atomicWrite(this.filePath, JSON.stringify(file, null, 2))
    } finally {
      lock?.release()
    }
  }

  /** Remove all catalog rows for a worker (global + all scopes). */
  deleteWorker(workerId: string): void {
    if (this.corrupt) {
      throw new Error('CATALOG_CORRUPT: refusing write after detecting a corrupt catalogs file')
    }
    const lock = acquireCatalogLock(this.filePath)
    if (!lock) {
      throw new Error('CATALOG_LOCK: another process holds the catalog lock; retry later')
    }
    try {
      const result = readFile(this.filePath)
      if (!result.ok) {
        this.corrupt = true
        throw new Error('CATALOG_CORRUPT: refusing delete after detecting a corrupt catalogs file')
      }
      let changed = false
      for (const key of Object.keys(result.file.catalogs)) {
        if (key === workerId || key.startsWith(`${workerId}::`)) {
          delete result.file.catalogs[key]
          changed = true
        }
      }
      if (changed) atomicWrite(this.filePath, JSON.stringify(result.file, null, 2))
    } finally {
      lock?.release()
    }
  }

  search(
    workerId: string,
    query: string,
    limit = 50,
    scopeKey?: string | null,
  ): WorkerModelOption[] {
    const cat = this.get(workerId, scopeKey)
    if (!cat) return []
    const q = query.trim().toLowerCase()
    const max = Math.max(1, Math.min(limit, 200))
    const index = Array.isArray(cat.searchIndex) ? cat.searchIndex : []
    if (!q) return index.slice(0, max)
    return index
      .filter(
        (m) =>
          m.modelId.toLowerCase().includes(q) ||
          m.name.toLowerCase().includes(q) ||
          (m.description?.toLowerCase().includes(q) ?? false),
      )
      .slice(0, max)
  }
}

let shared: WorkerModelCatalogStore | null = null

export function getWorkerModelCatalogStore(dataDir?: string): WorkerModelCatalogStore {
  if (dataDir) return new WorkerModelCatalogStore(dataDir)
  if (!shared) shared = new WorkerModelCatalogStore()
  return shared
}
