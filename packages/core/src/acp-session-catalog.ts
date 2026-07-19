import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  chmodSync,
  renameSync,
  unlinkSync,
  openSync,
  closeSync,
  fsyncSync,
} from 'node:fs'
import { dirname } from 'node:path'
import { randomBytes } from 'node:crypto'
import { tryAcquireProcessFileLock } from './process-file-lock.js'

const LOCK_FILE_SUFFIX = '.lock'

export interface AcpSessionRecord {
  version: 1
  keyDigest: string
  routerSessionId: string
  workerId: string
  installationId?: string
  manifestDigest?: string
  canonicalCwd: string
  executionFingerprint: string
  agentSessionId: string
  capabilities: { loadSession: boolean; resume: boolean; close: boolean; delete: boolean }
  state: 'ready' | 'stale'
  createdAt: string
  lastUsedAt: string
  lastRecoveredAt?: string
  staleReason?: string
}

interface CatalogFile {
  version: number
  records: AcpSessionRecord[]
}

const SUPPORTED_VERSION = 1

type CatalogState = 'normal' | 'unavailable'

export class AcpSessionCatalogError extends Error {
  readonly code = 'catalog_repair_required'

  constructor(message = 'ACP session catalog requires repair', options?: ErrorOptions) {
    super(message, options)
    this.name = 'AcpSessionCatalogError'
  }
}

function cloneRecord(record: AcpSessionRecord): AcpSessionRecord {
  return {
    ...record,
    capabilities: { ...record.capabilities },
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function isRecord(value: unknown): value is AcpSessionRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  const capabilities = record.capabilities as Record<string, unknown> | undefined
  return (
    record.version === SUPPORTED_VERSION &&
    isNonEmptyString(record.keyDigest) &&
    isNonEmptyString(record.routerSessionId) &&
    isNonEmptyString(record.workerId) &&
    (record.installationId === undefined || isNonEmptyString(record.installationId)) &&
    (record.manifestDigest === undefined || isNonEmptyString(record.manifestDigest)) &&
    isNonEmptyString(record.canonicalCwd) &&
    isNonEmptyString(record.executionFingerprint) &&
    isNonEmptyString(record.agentSessionId) &&
    Boolean(capabilities) &&
    typeof capabilities!.loadSession === 'boolean' &&
    typeof capabilities!.resume === 'boolean' &&
    typeof capabilities!.close === 'boolean' &&
    typeof capabilities!.delete === 'boolean' &&
    (record.state === 'ready' || record.state === 'stale') &&
    isIsoTimestamp(record.createdAt) &&
    isIsoTimestamp(record.lastUsedAt) &&
    (record.lastRecoveredAt === undefined || isIsoTimestamp(record.lastRecoveredAt)) &&
    (record.staleReason === undefined || typeof record.staleReason === 'string')
  )
}

export class AcpSessionCatalog {
  private filePath: string
  private sentinelPath: string
  private records: Map<string, AcpSessionRecord> = new Map()
  private state: CatalogState = 'normal'

  constructor(filePath: string) {
    this.filePath = filePath
    this.sentinelPath = filePath + '.corrupted'

    if (existsSync(this.sentinelPath)) {
      this.state = 'unavailable'
      return
    }

    this.loadFromFile()
  }

  isAvailable(): boolean {
    return this.state === 'normal'
  }

  getState(): CatalogState {
    return this.state
  }

  lookup(keyDigest: string): AcpSessionRecord | undefined {
    this.assertAvailable()
    const record = this.records.get(keyDigest)
    return record ? cloneRecord(record) : undefined
  }

  listByRouterSession(routerSessionId: string): AcpSessionRecord[] {
    this.assertAvailable()
    return [...this.records.values()]
      .filter((record) => record.routerSessionId === routerSessionId)
      .map(cloneRecord)
  }

  listByWorker(workerId: string): AcpSessionRecord[] {
    this.assertAvailable()
    return [...this.records.values()]
      .filter((record) => record.workerId === workerId)
      .map(cloneRecord)
  }

  listAll(): AcpSessionRecord[] {
    this.assertAvailable()
    return [...this.records.values()].map(cloneRecord)
  }

  upsert(record: AcpSessionRecord): void {
    this.assertAvailable()
    if (!isRecord(record)) {
      throw new TypeError('Invalid ACP session catalog record')
    }
    const candidate = this.cloneRecords()
    const previous = candidate.get(record.keyDigest)
    candidate.set(
      record.keyDigest,
      cloneRecord({
        ...record,
        createdAt: previous?.createdAt ?? record.createdAt,
      }),
    )
    this.commit(candidate)
  }

  markStale(keyDigest: string, reason?: string): void {
    this.assertAvailable()
    const existing = this.records.get(keyDigest)
    if (!existing) return
    const candidate = this.cloneRecords()
    candidate.set(
      keyDigest,
      cloneRecord({
        ...existing,
        state: 'stale',
        staleReason: reason,
        lastUsedAt: new Date().toISOString(),
      }),
    )
    this.commit(candidate)
  }

  touch(keyDigest: string, opts?: { recovered?: boolean }): void {
    this.assertAvailable()
    const existing = this.records.get(keyDigest)
    if (!existing) return
    const candidate = this.cloneRecords()
    const now = new Date().toISOString()
    candidate.set(
      keyDigest,
      cloneRecord({
        ...existing,
        lastUsedAt: now,
        ...(opts?.recovered
          ? { lastRecoveredAt: now, state: 'ready' as const, staleReason: undefined }
          : {}),
      }),
    )
    this.commit(candidate)
  }

  deleteByKey(keyDigest: string): void {
    this.assertAvailable()
    if (!this.records.has(keyDigest)) return
    const candidate = this.cloneRecords()
    candidate.delete(keyDigest)
    this.commit(candidate)
  }

  deleteByRouterSession(routerSessionId: string): void {
    this.assertAvailable()
    const candidate = this.cloneRecords()
    let changed = false
    for (const [k, r] of candidate) {
      if (r.routerSessionId === routerSessionId) {
        candidate.delete(k)
        changed = true
      }
    }
    if (changed) this.commit(candidate)
  }

  deleteByRouterSessions(routerSessionIds: string[]): void {
    this.assertAvailable()
    const set = new Set(routerSessionIds)
    const candidate = this.cloneRecords()
    let changed = false
    for (const [k, r] of candidate) {
      if (set.has(r.routerSessionId)) {
        candidate.delete(k)
        changed = true
      }
    }
    if (changed) this.commit(candidate)
  }

  deleteByWorker(workerId: string): void {
    this.assertAvailable()
    const candidate = this.cloneRecords()
    let changed = false
    for (const [k, r] of candidate) {
      if (r.workerId === workerId) {
        candidate.delete(k)
        changed = true
      }
    }
    if (changed) this.commit(candidate)
  }

  close(): void {
    this.state = 'unavailable'
    this.records.clear()
  }

  private assertAvailable(): void {
    if (this.state !== 'normal') {
      throw new AcpSessionCatalogError()
    }
  }

  private loadFromFile(): void {
    if (!existsSync(this.filePath)) {
      this.records = new Map()
      return
    }
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8')) as CatalogFile
      if (!raw || raw.version !== SUPPORTED_VERSION || !Array.isArray(raw.records)) {
        this.isolateAndFail()
        return
      }
      const map = new Map<string, AcpSessionRecord>()
      for (const r of raw.records) {
        if (!isRecord(r)) {
          this.isolateAndFail()
          return
        }
        if (map.has(r.keyDigest)) {
          this.isolateAndFail()
          return
        }
        map.set(r.keyDigest, cloneRecord(r))
      }
      this.records = map
    } catch {
      this.isolateAndFail()
    }
  }

  private isolateAndFail(): void {
    this.state = 'unavailable'
    this.records.clear()
    const isolated = `${this.filePath}.corrupt-${Date.now()}-${randomBytes(4).toString('hex')}`
    try {
      writeFileSync(
        this.sentinelPath,
        JSON.stringify({
          corruptedAt: new Date().toISOString(),
          corruptFile: isolated,
        }),
        { mode: 0o600 },
      )
    } catch {
      return
    }
    try {
      renameSync(this.filePath, isolated)
    } catch {
      /* sentinel keeps fail-closed */
    }
  }

  private cloneRecords(): Map<string, AcpSessionRecord> {
    return new Map([...this.records].map(([key, record]) => [key, cloneRecord(record)]))
  }

  private commit(candidate: Map<string, AcpSessionRecord>): void {
    const dir = dirname(this.filePath)
    try {
      // The lock must exist in the same durable parent as the catalog. Creating
      // the directory first ensures even the very first catalog write is locked.
      mkdirSync(dir, { recursive: true, mode: 0o700 })
    } catch (cause) {
      this.state = 'unavailable'
      this.records.clear()
      this.writeFailureSentinel()
      throw new AcpSessionCatalogError(undefined, { cause })
    }
    const lockPath = this.filePath + LOCK_FILE_SUFFIX
    const lock = tryAcquireProcessFileLock(lockPath)
    // Null also covers the interval where another contender owns the takeover
    // mutex but has not created the main lock yet. Never infer safety from the
    // current absence of lockPath and never write unlocked on any platform.
    if (!lock) {
      throw new AcpSessionCatalogError('catalog lock unavailable; retry later')
    }
    try {
      this.flush(candidate)
      this.records = candidate
    } catch (cause) {
      this.state = 'unavailable'
      this.records.clear()
      this.writeFailureSentinel()
      throw new AcpSessionCatalogError(undefined, { cause })
    } finally {
      lock?.release()
    }
  }

  private writeFailureSentinel(): void {
    try {
      writeFileSync(
        this.sentinelPath,
        JSON.stringify({
          corruptedAt: new Date().toISOString(),
          reason: 'mutation_failed',
        }),
        { mode: 0o600 },
      )
    } catch {
      // The parent itself may be the failing boundary; this instance still fails closed.
    }
  }

  private flush(records: Map<string, AcpSessionRecord>): void {
    const dir = dirname(this.filePath)
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    const body: CatalogFile = {
      version: SUPPORTED_VERSION,
      records: [...records.values()].map(cloneRecord),
    }
    const tmp = `${this.filePath}.tmp.${process.pid}.${randomBytes(4).toString('hex')}`
    let fd: number | undefined
    try {
      fd = openSync(tmp, 'w', 0o600)
      writeFileSync(fd, JSON.stringify(body, null, 2))
      fsyncSync(fd)
      closeSync(fd)
      fd = undefined
      try {
        chmodSync(tmp, 0o600)
      } catch {
        /* ok */
      }
      renameSync(tmp, this.filePath)
      // fsync parent dir so rename is durable
      try {
        const dirFd = openSync(dir, 'r')
        try {
          fsyncSync(dirFd)
        } finally {
          closeSync(dirFd)
        }
      } catch {
        /* windows */
      }
      try {
        chmodSync(this.filePath, 0o600)
      } catch {
        /* ok */
      }
    } finally {
      if (fd !== undefined) {
        try {
          closeSync(fd)
        } catch {
          /* best effort */
        }
      }
      if (existsSync(tmp)) {
        try {
          unlinkSync(tmp)
        } catch {
          /* best effort */
        }
      }
    }
  }
}
