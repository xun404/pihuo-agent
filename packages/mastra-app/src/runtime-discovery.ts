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
} from 'node:fs'
import { dirname } from 'node:path'
import { randomBytes } from 'node:crypto'
import { defaultRuntimeDiscoveryPath as coreDefaultRuntimePath } from '@swarmdesk-agent/core'

/**
 * version 3: split every caller surface into a distinct capability token.
 * - token / internalToken: RemoteRuntimeDispatchPort + /internal/runtime/*
 * - desktopToken: Electron Desktop /api + /chat only
 * - studioToken: Mastra Studio UI/API only
 */
export interface RuntimeDiscoveryFile {
  version: 1 | 2 | 3
  port: number
  pid: number
  startedAt: string
  /**
   * Stable owner process epoch for event cursor reconnect.
   * Defaults to startedAt; clients reset sequence when this changes.
   */
  ownerEpoch?: string
  /** Hash of the owner checkout root; prevents cross-checkout Desktop reuse. */
  workspaceId?: string
  /** @deprecated v1 shared token — prefer internalToken */
  token: string
  /** Internal runtime token (RemoteRuntimeDispatchPort) */
  internalToken?: string
  /** Desktop API token (Electron IPC only) */
  desktopToken?: string
  /** Mastra Studio UI/API token; never accepted by internal or Desktop routes */
  studioToken?: string
}

export class RuntimeDiscoveryError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'RuntimeDiscoveryError'
    this.code = code
  }
}

export function defaultRuntimeDiscoveryPath(): string {
  // Explicit SWARMDESK_AGENT_RUNTIME_PATH / SWARMDESK_AGENT_DATA_DIR > <root>/data/runtime.json
  return coreDefaultRuntimePath()
}

export interface WriteRuntimeDiscoveryInput {
  path?: string
  port: number
  pid?: number
  startedAt?: string
  /** Internal runtime token */
  token?: string
  internalToken?: string
  desktopToken?: string
  studioToken?: string
  workspaceId?: string
}

function isCapabilityToken(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 16
}

function atomicWriteJson(path: string, value: unknown): void {
  const dir = dirname(path)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const tmp = `${path}.tmp.${process.pid}.${randomBytes(4).toString('hex')}`
  let fd: number | undefined
  try {
    fd = openSync(tmp, 'w', 0o600)
    writeFileSync(fd, JSON.stringify(value, null, 2))
    fsyncSync(fd)
    closeSync(fd)
    fd = undefined
    try {
      chmodSync(tmp, 0o600)
    } catch {
      /* best effort */
    }
    renameSync(tmp, path)
    try {
      const dirFd = openSync(dir, 'r')
      try {
        fsyncSync(dirFd)
      } finally {
        closeSync(dirFd)
      }
    } catch {
      /* unsupported on some platforms */
    }
    try {
      chmodSync(path, 0o600)
    } catch {
      /* best effort */
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

function parseDiscovery(raw: string): RuntimeDiscoveryFile | null {
  try {
    const value = JSON.parse(raw) as Partial<RuntimeDiscoveryFile>
    if (
      (value.version !== 1 && value.version !== 2 && value.version !== 3) ||
      typeof value.port !== 'number' ||
      !Number.isInteger(value.port) ||
      value.port <= 0 ||
      typeof value.pid !== 'number' ||
      !Number.isInteger(value.pid) ||
      typeof value.startedAt !== 'string' ||
      !Number.isFinite(Date.parse(value.startedAt)) ||
      typeof value.token !== 'string' ||
      value.token.length < 16 ||
      (value.internalToken !== undefined && !isCapabilityToken(value.internalToken)) ||
      (value.desktopToken !== undefined && !isCapabilityToken(value.desktopToken)) ||
      (value.studioToken !== undefined && !isCapabilityToken(value.studioToken)) ||
      (value.workspaceId !== undefined && !/^[a-f0-9]{64}$/.test(value.workspaceId))
    ) {
      return null
    }
    if (value.version === 3) {
      if (
        !isCapabilityToken(value.internalToken) ||
        !isCapabilityToken(value.desktopToken) ||
        !isCapabilityToken(value.studioToken) ||
        value.token !== value.internalToken ||
        new Set([value.internalToken, value.desktopToken, value.studioToken]).size !== 3
      ) {
        return null
      }
    }
    return value as RuntimeDiscoveryFile
  } catch {
    return null
  }
}

export function writeRuntimeDiscovery(input: WriteRuntimeDiscoveryInput): RuntimeDiscoveryFile {
  const path = input.path ?? defaultRuntimeDiscoveryPath()
  const internalToken = input.internalToken ?? input.token ?? randomBytes(32).toString('hex')
  const desktopToken = input.desktopToken ?? randomBytes(32).toString('hex')
  const studioToken = input.studioToken ?? randomBytes(32).toString('hex')
  if (
    !isCapabilityToken(internalToken) ||
    !isCapabilityToken(desktopToken) ||
    !isCapabilityToken(studioToken) ||
    new Set([internalToken, desktopToken, studioToken]).size !== 3
  ) {
    throw new RuntimeDiscoveryError(
      'RUNTIME_TOKEN_BOUNDARY_INVALID',
      'runtime capability tokens must be strong and distinct',
    )
  }
  const startedAt = input.startedAt ?? new Date().toISOString()
  const file: RuntimeDiscoveryFile = {
    version: 3,
    port: input.port,
    pid: input.pid ?? process.pid,
    startedAt,
    // Epoch identity for remote event cursor (pid + startedAt)
    ownerEpoch: `${input.pid ?? process.pid}:${startedAt}`,
    // Keep token === internalToken for v1 RemoteRuntimeDispatchPort readers
    token: internalToken,
    internalToken,
    desktopToken,
    studioToken,
    workspaceId: input.workspaceId,
  }
  atomicWriteJson(path, file)
  return file
}

export function readRuntimeDiscovery(
  path: string = defaultRuntimeDiscoveryPath(),
): RuntimeDiscoveryFile | null {
  if (!existsSync(path)) return null
  try {
    return parseDiscovery(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

export function resolveInternalToken(file: RuntimeDiscoveryFile): string {
  return file.internalToken ?? file.token
}

export function resolveDesktopToken(file: RuntimeDiscoveryFile): string {
  return file.desktopToken ?? file.token
}

/** No fallback to internalToken: exposing it to Studio would collapse capabilities. */
export function resolveStudioToken(file: RuntimeDiscoveryFile): string | null {
  return isCapabilityToken(file.studioToken) ? file.studioToken : null
}

/**
 * Remove runtime.json only if it was written by this pid (or pid matches).
 * Never throws token-bearing errors.
 */
export function clearRuntimeDiscovery(
  path: string = defaultRuntimeDiscoveryPath(),
  pid = process.pid,
): void {
  try {
    const current = readRuntimeDiscovery(path)
    if (!current || current.pid !== pid) return
    unlinkSync(path)
  } catch {
    /* ok */
  }
}
