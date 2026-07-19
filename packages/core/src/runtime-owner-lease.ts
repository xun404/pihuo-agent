import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  openSync,
  closeSync,
  fsyncSync,
  chmodSync,
  statSync,
} from 'node:fs'
import { dirname } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'

export interface OwnerLeaseFile {
  version: 1
  pid: number
  processStartedAt: string
  ownerTokenHash: string
  createdAt: string
  heartbeatAt: string
}

export interface OwnerLeaseHandle {
  readonly token: string
  heartbeat(): void
  release(): void
}

export type AcquireOwnerLeaseResult =
  { ok: true; lease: OwnerLeaseHandle } | { ok: false; errorCode: 'RUNTIME_OWNER_EXISTS' }

export interface OwnerLeaseDeps {
  now?: () => number
  pid?: number
  processStartedAt?: string
  isProcessAlive?: (pid: number) => boolean
  getProcessStartedAt?: (pid: number) => string | null
  staleMs?: number
}

const DEFAULT_STALE_MS = 30_000

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function defaultIsProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function defaultGetProcessStartedAt(pid: number): string | null {
  if (!Number.isInteger(pid) || pid <= 0) return null
  try {
    if (process.platform === 'linux' && existsSync(`/proc/${pid}`)) {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
      // Field 22 (1-indexed) is starttime in clock ticks; use status starttime if available.
      // Prefer /proc/pid/stat starttime ticks as opaque identity string.
      const parts = stat.split(' ')
      // After comm field which may contain spaces in parentheses — parse carefully
      const closeParen = stat.lastIndexOf(')')
      if (closeParen >= 0) {
        const after = stat.slice(closeParen + 2).split(' ')
        // fields after comm: state(1) ... starttime is field 20 in after (22-2)
        const starttime = after[19]
        if (starttime) return `proc-starttime:${starttime}`
      }
    }
    const out = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
      encoding: 'utf8',
      timeout: 2_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return out || null
  } catch {
    return null
  }
}

function defaultProcessStartedAt(): string {
  // Best-effort identity for current process; stable for process lifetime.
  const fromPs = defaultGetProcessStartedAt(process.pid)
  if (fromPs) return fromPs
  return `boot:${process.pid}:${Math.floor(Date.now() - process.uptime() * 1000)}`
}

function parseLease(raw: string): OwnerLeaseFile | null {
  try {
    const value = JSON.parse(raw) as Partial<OwnerLeaseFile>
    if (
      value.version !== 1 ||
      typeof value.pid !== 'number' ||
      !Number.isInteger(value.pid) ||
      typeof value.processStartedAt !== 'string' ||
      !value.processStartedAt ||
      typeof value.ownerTokenHash !== 'string' ||
      !value.ownerTokenHash ||
      typeof value.createdAt !== 'string' ||
      typeof value.heartbeatAt !== 'string' ||
      !Number.isFinite(Date.parse(value.createdAt)) ||
      !Number.isFinite(Date.parse(value.heartbeatAt))
    ) {
      return null
    }
    return value as OwnerLeaseFile
  } catch {
    return null
  }
}

function writeLeaseAtomic(path: string, lease: OwnerLeaseFile): void {
  const dir = dirname(path)
  mkdirSync(dir, { recursive: true })
  const tmp = `${path}.tmp.${process.pid}.${randomBytes(4).toString('hex')}`
  const fd = openSync(tmp, 'w', 0o600)
  try {
    writeFileSync(fd, JSON.stringify(lease, null, 2))
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  try {
    chmodSync(tmp, 0o600)
  } catch {
    /* best effort */
  }
  renameSync(tmp, path)
  try {
    chmodSync(path, 0o600)
  } catch {
    /* best effort */
  }
}

function exclusiveCreateLease(path: string, lease: OwnerLeaseFile): boolean {
  const dir = dirname(path)
  mkdirSync(dir, { recursive: true })
  let fd: number | undefined
  try {
    // O_EXCL create — write full JSON + fsync before release so peers never see half-written body.
    fd = openSync(path, 'wx', 0o600)
    const body = JSON.stringify(lease, null, 2)
    writeFileSync(fd, body)
    fsyncSync(fd)
    try {
      chmodSync(path, 0o600)
    } catch {
      /* best effort */
    }
    return true
  } catch {
    return false
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd)
      } catch {
        /* ok */
      }
    }
  }
}

function isolateLease(path: string): void {
  if (!existsSync(path)) return
  const isolated = `${path}.stale.${Date.now()}.${randomBytes(3).toString('hex')}`
  try {
    renameSync(path, isolated)
  } catch {
    // Lost race — another process already renamed/deleted; leave path as-is.
  }
}

const TAKEOVER_STALE_MS = 15_000

/** Exclusive takeover mutex with PID/token/stale recovery so crash cannot block forever. */
function tryAcquireTakeoverMutex(
  leasePath: string,
  deps: {
    pid: number
    processStartedAt: string
    isProcessAlive: (pid: number) => boolean
    getProcessStartedAt: (pid: number) => string | null
    now: () => number
  },
): { ok: true; token: string } | { ok: false } {
  const mutexPath = `${leasePath}.takeover`
  const token = randomBytes(16).toString('hex')
  const tryCreate = (): boolean => {
    try {
      const fd = openSync(mutexPath, 'wx', 0o600)
      try {
        writeFileSync(
          fd,
          JSON.stringify({
            pid: deps.pid,
            processStartedAt: deps.processStartedAt,
            token,
            at: new Date(deps.now()).toISOString(),
          }),
        )
        fsyncSync(fd)
      } finally {
        closeSync(fd)
      }
      return true
    } catch {
      return false
    }
  }
  if (tryCreate()) return { ok: true, token }

  // Stale / dead holder recovery
  try {
    const st = statSync(mutexPath)
    // File mtime is always wall-clock; do not compare against injected test clocks.
    const fileAgeMs = Date.now() - st.mtimeMs
    let raw: {
      pid?: number
      processStartedAt?: string
      token?: string
      at?: string
    }
    try {
      raw = JSON.parse(readFileSync(mutexPath, 'utf8')) as typeof raw
    } catch {
      // Fresh empty/partial mutex = another process mid-write — treat as occupied.
      if (fileAgeMs < FRESH_MALFORMED_MS) return { ok: false }
      // Old malformed: reclaim
      try {
        unlinkSync(mutexPath)
      } catch {
        /* lost race */
      }
      if (tryCreate()) return { ok: true, token }
      return { ok: false }
    }

    // Missing required identity fields on a fresh mutex = mid-write
    if (
      (raw.token == null || raw.pid == null || raw.at == null) &&
      fileAgeMs < FRESH_MALFORMED_MS
    ) {
      return { ok: false }
    }

    const atMs = raw.at ? Date.parse(raw.at) : NaN
    const pastGrace = !Number.isFinite(atMs) || deps.now() - atMs > TAKEOVER_STALE_MS
    const pid = raw.pid ?? 0
    const alive = deps.isProcessAlive(pid)
    const start = deps.getProcessStartedAt(pid)
    const sameIdentity =
      alive && (start == null || raw.processStartedAt == null || start === raw.processStartedAt)

    // Only reclaim when grace exceeded AND holder is dead / identity mismatch.
    // Never steal from a live same-identity holder just because wall-clock is "stale".
    if (pastGrace && !sameIdentity) {
      try {
        unlinkSync(mutexPath)
      } catch {
        /* lost race */
      }
      if (tryCreate()) return { ok: true, token }
    }
  } catch {
    // Mutex vanished between stat and read — retry create once
    if (tryCreate()) return { ok: true, token }
  }
  return { ok: false }
}

function releaseTakeoverMutex(leasePath: string, token: string): void {
  const mutexPath = `${leasePath}.takeover`
  try {
    const raw = JSON.parse(readFileSync(mutexPath, 'utf8')) as { token?: string }
    // Exact token match required — never delete missing/foreign tokens
    if (!raw.token || raw.token !== token) return
    unlinkSync(mutexPath)
  } catch {
    /* ok */
  }
}

/** Fresh malformed lease (< 5s) is treated as occupied, never steal mid-write. */
const FRESH_MALFORMED_MS = 5_000

function isFreshFile(path: string, nowMs: number): boolean {
  try {
    const st = statSync(path)
    return nowMs - st.mtimeMs < FRESH_MALFORMED_MS
  } catch {
    return false
  }
}

function isOwnerIdentityAlive(
  lease: OwnerLeaseFile,
  deps: Required<Pick<OwnerLeaseDeps, 'isProcessAlive' | 'getProcessStartedAt'>>,
): boolean {
  if (!deps.isProcessAlive(lease.pid)) return false
  const currentStart = deps.getProcessStartedAt(lease.pid)
  if (currentStart === null) {
    // Unable to verify start identity — treat as alive only if pid probe succeeded
    // so we never steal while process is clearly running.
    return true
  }
  return currentStart === lease.processStartedAt
}

function isHeartbeatFresh(lease: OwnerLeaseFile, nowMs: number, staleMs: number): boolean {
  const hb = Date.parse(lease.heartbeatAt)
  if (!Number.isFinite(hb)) return false
  return nowMs - hb < staleMs
}

function canTakeOver(
  lease: OwnerLeaseFile,
  nowMs: number,
  staleMs: number,
  deps: Required<Pick<OwnerLeaseDeps, 'isProcessAlive' | 'getProcessStartedAt'>>,
): boolean {
  const identityAlive = isOwnerIdentityAlive(lease, deps)
  const heartbeatFresh = isHeartbeatFresh(lease, nowMs, staleMs)
  // Never steal while identity is alive (even if heartbeat is stale).
  if (identityAlive) return false
  // Dead identity + expired heartbeat → takeover.
  return !heartbeatFresh
}

export function acquireOwnerLease(
  catalogPath: string,
  opts: OwnerLeaseDeps = {},
): AcquireOwnerLeaseResult {
  const nowFn = opts.now ?? Date.now
  const pid = opts.pid ?? process.pid
  const processStartedAt = opts.processStartedAt ?? defaultProcessStartedAt()
  const isProcessAlive = opts.isProcessAlive ?? defaultIsProcessAlive
  const getProcessStartedAt = opts.getProcessStartedAt ?? defaultGetProcessStartedAt
  const staleMs = opts.staleMs ?? DEFAULT_STALE_MS
  const leasePath = `${catalogPath}.owner`
  const identityDeps = { isProcessAlive, getProcessStartedAt }

  const token = randomBytes(32).toString('hex')
  const tokenHash = hashToken(token)
  const createdAt = new Date(nowFn()).toISOString()
  const leaseFile: OwnerLeaseFile = {
    version: 1,
    pid,
    processStartedAt,
    ownerTokenHash: tokenHash,
    createdAt,
    heartbeatAt: createdAt,
  }

  if (exclusiveCreateLease(leasePath, leaseFile)) {
    return { ok: true, lease: createHandle(leasePath, token, tokenHash, nowFn) }
  }

  // Serialize takeover: only one competitor may isolate + recreate.
  const mutex = tryAcquireTakeoverMutex(leasePath, {
    pid,
    processStartedAt,
    isProcessAlive,
    getProcessStartedAt,
    now: nowFn,
  })
  if (!mutex.ok) {
    return { ok: false, errorCode: 'RUNTIME_OWNER_EXISTS' }
  }

  try {
    let existing: OwnerLeaseFile | null = null
    let rawPresent = false
    try {
      if (existsSync(leasePath)) {
        rawPresent = true
        existing = parseLease(readFileSync(leasePath, 'utf8'))
      }
    } catch {
      existing = null
    }

    // Fresh malformed / half-written lease → occupied (do not steal mid-create)
    if (rawPresent && !existing && isFreshFile(leasePath, nowFn())) {
      return { ok: false, errorCode: 'RUNTIME_OWNER_EXISTS' }
    }

    if (existing && !canTakeOver(existing, nowFn(), staleMs, identityDeps)) {
      return { ok: false, errorCode: 'RUNTIME_OWNER_EXISTS' }
    }

    // Isolate stale/dead lease, then re-check before create
    if (existsSync(leasePath)) {
      isolateLease(leasePath)
    }

    // Another owner may have recreated between isolate and create — re-read
    if (existsSync(leasePath)) {
      let after: OwnerLeaseFile | null = null
      try {
        after = parseLease(readFileSync(leasePath, 'utf8'))
      } catch {
        after = null
      }
      if (after && !canTakeOver(after, nowFn(), staleMs, identityDeps)) {
        return { ok: false, errorCode: 'RUNTIME_OWNER_EXISTS' }
      }
      if (!after && isFreshFile(leasePath, nowFn())) {
        return { ok: false, errorCode: 'RUNTIME_OWNER_EXISTS' }
      }
      isolateLease(leasePath)
    }

    if (!exclusiveCreateLease(leasePath, leaseFile)) {
      return { ok: false, errorCode: 'RUNTIME_OWNER_EXISTS' }
    }
    return { ok: true, lease: createHandle(leasePath, token, tokenHash, nowFn) }
  } finally {
    releaseTakeoverMutex(leasePath, mutex.token)
  }
}

function createHandle(
  leasePath: string,
  token: string,
  tokenHash: string,
  nowFn: () => number,
): OwnerLeaseHandle {
  let released = false
  return {
    get token() {
      return token
    },
    heartbeat() {
      if (released) return
      let current: OwnerLeaseFile | null = null
      try {
        current = parseLease(readFileSync(leasePath, 'utf8'))
      } catch {
        return
      }
      if (!current || current.ownerTokenHash !== tokenHash) return
      writeLeaseAtomic(leasePath, {
        ...current,
        heartbeatAt: new Date(nowFn()).toISOString(),
      })
    },
    release() {
      if (released) return
      released = true
      try {
        const raw = readFileSync(leasePath, 'utf8')
        const current = parseLease(raw)
        if (!current || current.ownerTokenHash !== tokenHash) return
        unlinkSync(leasePath)
      } catch {
        /* ok */
      }
    },
  }
}
