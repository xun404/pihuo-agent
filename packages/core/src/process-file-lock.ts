/**
 * Exclusive file lock with identity (pid + processStartedAt + token).
 * Fresh empty/partial locks are treated as occupied (no mid-write steal).
 * Release requires exact token match.
 */

import {
  existsSync,
  openSync,
  closeSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
  renameSync,
  fsyncSync,
  statSync,
} from 'node:fs'
import { randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'

export interface ProcessFileLockHandle {
  readonly token: string
  release(): void
}

export interface ProcessFileLockDeps {
  now?: () => number
  pid?: number
  processStartedAt?: string
  isProcessAlive?: (pid: number) => boolean
  getProcessStartedAt?: (pid: number) => string | null
  /** Grace before reclaiming dead/mismatched holders (ms). Default 15s. */
  staleMs?: number
}

const FRESH_MALFORMED_MS = 5_000
const DEFAULT_STALE_MS = 15_000

function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export function getProcessStartIdentity(pid: number): string | null {
  if (!Number.isInteger(pid) || pid <= 0) return null
  try {
    if (process.platform === 'linux') {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
      const closeParen = stat.lastIndexOf(')')
      if (closeParen < 0) return null
      // After comm: state is field 3; starttime (field 22) is index 19 here.
      const afterComm = stat.slice(closeParen + 2).split(' ')
      const starttime = afterComm[19]
      return starttime ? `proc-starttime:${starttime}` : null
    }
    if (process.platform === 'darwin') {
      const out = execFileSync('ps', ['-p', String(pid), '-o', 'lstart='], {
        encoding: 'utf8',
        timeout: 1000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim()
      return out ? `ps-lstart:${out}` : null
    }
  } catch {
    return null
  }
  return null
}

function defaultProcessStartedAt(): string {
  return (
    getProcessStartIdentity(process.pid) ??
    `boot:${process.pid}:${Math.floor(Date.now() - process.uptime() * 1000)}`
  )
}

interface LockFileBody {
  pid: number
  processStartedAt: string
  token: string
  at: string
}

function tryAcquireTakeoverMutex(input: {
  lockPath: string
  pid: number
  processStartedAt: string
  now: () => number
  isProcessAlive: (pid: number) => boolean
  getProcessStartedAt: (pid: number) => string | null
}): ProcessFileLockHandle | null {
  const mutexPath = `${input.lockPath}.takeover`
  const token = randomBytes(16).toString('hex')
  const tryCreate = (): boolean => {
    try {
      const fd = openSync(mutexPath, 'wx', 0o600)
      try {
        writeFileSync(
          fd,
          JSON.stringify({
            pid: input.pid,
            processStartedAt: input.processStartedAt,
            token,
            at: new Date(input.now()).toISOString(),
          } satisfies LockFileBody),
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
  if (tryCreate()) {
    return { token, release: () => releaseProcessFileLock(mutexPath, token) }
  }

  try {
    const age = Date.now() - statSync(mutexPath).mtimeMs
    let holder: Partial<LockFileBody> | null = null
    try {
      holder = JSON.parse(readFileSync(mutexPath, 'utf8')) as Partial<LockFileBody>
    } catch {
      if (age < FRESH_MALFORMED_MS) return null
    }
    if (holder && (holder.pid == null || holder.token == null || holder.at == null)) {
      if (age < FRESH_MALFORMED_MS) return null
      holder = null
    }
    if (holder) {
      const atMs = holder.at ? Date.parse(holder.at) : NaN
      const pastGrace = !Number.isFinite(atMs) || input.now() - atMs > DEFAULT_STALE_MS
      const alive = input.isProcessAlive(holder.pid ?? 0)
      const currentStart = alive ? input.getProcessStartedAt(holder.pid ?? 0) : null
      // A live PID with unknown start identity is still occupied (fail closed).
      const identityAlive =
        alive &&
        (currentStart == null ||
          holder.processStartedAt == null ||
          currentStart === holder.processStartedAt)
      if (!pastGrace || identityAlive) return null
    }

    const isolated = `${mutexPath}.stale.${process.pid}.${randomBytes(4).toString('hex')}`
    try {
      renameSync(mutexPath, isolated)
    } catch {
      return null
    }
    try {
      unlinkSync(isolated)
    } catch {
      /* best effort */
    }
    if (tryCreate()) {
      return { token, release: () => releaseProcessFileLock(mutexPath, token) }
    }
  } catch {
    if (tryCreate()) {
      return { token, release: () => releaseProcessFileLock(mutexPath, token) }
    }
  }
  return null
}

/**
 * Try to acquire exclusive lock at `lockPath` (typically `${file}.lock`).
 * Returns null if held by a live same-identity process or fresh malformed lock.
 */
export function tryAcquireProcessFileLock(
  lockPath: string,
  deps: ProcessFileLockDeps = {},
): ProcessFileLockHandle | null {
  const now = deps.now ?? Date.now
  const pid = deps.pid ?? process.pid
  const processStartedAt = deps.processStartedAt ?? defaultProcessStartedAt()
  const isProcessAlive = deps.isProcessAlive ?? defaultIsProcessAlive
  const getProcessStartedAt = deps.getProcessStartedAt ?? getProcessStartIdentity
  const staleMs = deps.staleMs ?? DEFAULT_STALE_MS
  const token = randomBytes(16).toString('hex')

  const tryCreate = (): boolean => {
    try {
      const fd = openSync(lockPath, 'wx', 0o600)
      try {
        const body: LockFileBody = {
          pid,
          processStartedAt,
          token,
          at: new Date(now()).toISOString(),
        }
        writeFileSync(fd, JSON.stringify(body))
        fsyncSync(fd)
      } finally {
        closeSync(fd)
      }
      return true
    } catch {
      return false
    }
  }

  // Every contender participates in the same mutex, including the empty-file
  // fast path, so no process can recreate while another is isolating stale state.
  const takeover = tryAcquireTakeoverMutex({
    lockPath,
    pid,
    processStartedAt,
    now,
    isProcessAlive,
    getProcessStartedAt,
  })
  if (!takeover) return null

  try {
    if (tryCreate()) {
      return {
        token,
        release() {
          releaseProcessFileLock(lockPath, token)
        },
      }
    }

    // Recover stale / dead holders while serialized by the takeover mutex.
    try {
      const st = statSync(lockPath)
      const fileAgeMs = Date.now() - st.mtimeMs
      const text = readFileSync(lockPath, 'utf8').trim()
      let raw: Partial<LockFileBody> | null = null
      let legacyPid: number | null = null
      try {
        const parsed: unknown = JSON.parse(text)
        if (typeof parsed === 'number' && Number.isFinite(parsed)) {
          // Legacy lock: bare pid number
          legacyPid = parsed
        } else if (parsed && typeof parsed === 'object') {
          raw = parsed as Partial<LockFileBody>
          // Legacy object with only pid field
          if (raw.token == null && raw.at == null && typeof raw.pid === 'number') {
            legacyPid = raw.pid
            raw = null
          }
        }
      } catch {
        // Non-JSON legacy: plain pid text
        const n = parseInt(text, 10)
        if (text && Number.isFinite(n) && String(n) === text) {
          legacyPid = n
        } else if (fileAgeMs < FRESH_MALFORMED_MS) {
          // Fresh empty/partial = mid-write occupied
          return null
        } else {
          // Old garbage — reclaim
          try {
            unlinkSync(lockPath)
          } catch {
            return null
          }
          if (tryCreate()) {
            return {
              token,
              release() {
                releaseProcessFileLock(lockPath, token)
              },
            }
          }
          return null
        }
      }

      if (legacyPid != null) {
        // Reclaim only when legacy holder is dead
        if (isProcessAlive(legacyPid)) return null
        try {
          unlinkSync(lockPath)
        } catch {
          return null
        }
        if (tryCreate()) {
          return {
            token,
            release() {
              releaseProcessFileLock(lockPath, token)
            },
          }
        }
        return null
      }

      if (!raw) return null

      if (
        (raw.token == null || raw.pid == null || raw.at == null) &&
        fileAgeMs < FRESH_MALFORMED_MS
      ) {
        return null
      }

      const atMs = raw.at ? Date.parse(raw.at) : NaN
      const pastGrace = !Number.isFinite(atMs) || now() - atMs > staleMs
      const holderPid = raw.pid ?? 0
      const alive = isProcessAlive(holderPid)
      const start = getProcessStartedAt(holderPid)
      const sameIdentity =
        alive && (start == null || raw.processStartedAt == null || start === raw.processStartedAt)

      // Only reclaim when grace exceeded AND holder dead / identity mismatch
      if (pastGrace && !sameIdentity) {
        try {
          unlinkSync(lockPath)
        } catch {
          return null
        }
        if (tryCreate()) {
          return {
            token,
            release() {
              releaseProcessFileLock(lockPath, token)
            },
          }
        }
      }
    } catch {
      if (tryCreate()) {
        return {
          token,
          release() {
            releaseProcessFileLock(lockPath, token)
          },
        }
      }
    }
    return null
  } finally {
    takeover.release()
  }
}

/** Release only if token matches exactly. Missing/foreign token → no-op. */
export function releaseProcessFileLock(lockPath: string, token: string): void {
  if (!token) return
  try {
    if (!existsSync(lockPath)) return
    const raw = JSON.parse(readFileSync(lockPath, 'utf8')) as { token?: string }
    if (!raw.token || raw.token !== token) return
    unlinkSync(lockPath)
  } catch {
    /* ok */
  }
}
