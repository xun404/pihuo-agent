/**
 * Worker-scoped encrypted secrets (env_var auth).
 * Values never appear in Store / API status / logs — only configured key names + revision.
 * Secrets inject only into the target worker process env, never process.env globally.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  openSync,
  closeSync,
  fsyncSync,
  renameSync,
  chmodSync,
  unlinkSync,
} from 'node:fs'
import { join } from 'node:path'
import { createCipheriv, createDecipheriv, randomBytes, createHmac } from 'node:crypto'
import {
  getWorkerSecretsEncryptionKeys,
  secretsDir,
  isConfigurableSecretEnvKey,
} from './secure-secrets.js'
import { tryAcquireProcessFileLock } from './process-file-lock.js'

export type WorkerSecretsRecord = {
  revision: number
  /** env name → value (in memory only after decrypt) */
  secrets: Record<string, string>
}

type WorkerSecretsFile = {
  version: 1
  workers: Record<string, WorkerSecretsRecord>
}

function workerSecretsPath(): string {
  return join(secretsDir(), 'worker-secrets.enc')
}

function workerSecretsLockPath(): string {
  return `${workerSecretsPath()}.lock`
}

function ensureSecretsDir(): void {
  const dir = secretsDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 })
  try {
    chmodSync(dir, 0o700)
  } catch {
    /* windows */
  }
}

function encryptBlob(obj: WorkerSecretsFile, key: Buffer): Buffer {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const plaintext = Buffer.from(JSON.stringify(obj), 'utf8')
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, enc])
}

function decryptBlob(blob: Buffer, key: Buffer): WorkerSecretsFile {
  if (blob.length < 29) throw new Error('Worker secrets payload invalid')
  const iv = blob.subarray(0, 12)
  const tag = blob.subarray(12, 28)
  const data = blob.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  const dec = Buffer.concat([decipher.update(data), decipher.final()])
  const parsed: unknown = JSON.parse(dec.toString('utf8'))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Worker secrets payload invalid')
  }
  const p = parsed as WorkerSecretsFile
  if (p.version !== 1 || !p.workers || typeof p.workers !== 'object') {
    throw new Error('Worker secrets version unsupported')
  }
  for (const [workerId, record] of Object.entries(p.workers)) {
    if (
      !workerId ||
      !record ||
      typeof record !== 'object' ||
      !Number.isSafeInteger(record.revision) ||
      record.revision < 0 ||
      !record.secrets ||
      typeof record.secrets !== 'object' ||
      Array.isArray(record.secrets) ||
      Object.values(record.secrets).some((value) => typeof value !== 'string')
    ) {
      throw new Error('Worker secrets payload contains an invalid record')
    }
  }
  return p
}

function atomicWrite(target: string, data: Buffer): void {
  const tmp = `${target}.tmp.${process.pid}.${randomBytes(4).toString('hex')}`
  let fd: number | undefined
  try {
    fd = openSync(tmp, 'wx', 0o600)
    writeFileSync(fd, data)
    fsyncSync(fd)
    closeSync(fd)
    fd = undefined
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
    if (fd !== undefined) {
      try {
        closeSync(fd)
      } catch {
        /* */
      }
    }
    if (existsSync(tmp)) {
      try {
        unlinkSync(tmp)
      } catch {
        /* */
      }
    }
  }
}

function loadFile(): WorkerSecretsFile {
  const keys = getWorkerSecretsEncryptionKeys()
  if (!existsSync(workerSecretsPath())) return { version: 1, workers: {} }
  try {
    return decryptBlob(readFileSync(workerSecretsPath()), keys.current)
  } catch (currentError) {
    throw new Error('Worker secret storage could not be decrypted', {
      cause: currentError,
    })
  }
}

function saveFile(file: WorkerSecretsFile): void {
  ensureSecretsDir()
  const key = getWorkerSecretsEncryptionKeys().current
  atomicWrite(workerSecretsPath(), encryptBlob(file, key))
}

/**
 * Worker-secret mutation has one logical writer at a time. Electron currently
 * routes production mutations through the trusted API child, while API-only
 * mode mutates locally. The cross-process lock enforces that topology if an
 * owner-side caller is added later and prevents lost revision increments.
 */
function withMutationLock<T>(
  mutate: (file: WorkerSecretsFile) => { result: T; persist: boolean },
): T {
  ensureSecretsDir()
  const lock = tryAcquireProcessFileLock(workerSecretsLockPath())
  if (!lock) {
    throw new Error('Worker secret mutation is busy; retry later')
  }
  try {
    const file = loadFile()
    const outcome = mutate(file)
    if (outcome.persist) saveFile(file)
    return outcome.result
  } finally {
    lock.release()
  }
}

function assertEnvName(envName: string): void {
  if (!isConfigurableSecretEnvKey(envName)) {
    throw new Error(`Invalid or reserved env secret name: ${envName}`)
  }
}

/** Public status: key names only. */
export function listWorkerSecretKeyNames(workerId: string): {
  configuredKeys: string[]
  revision: number
} {
  const rec = loadFile().workers[workerId]
  if (!rec) return { configuredKeys: [], revision: 0 }
  return {
    configuredKeys: Object.keys(rec.secrets).sort(),
    revision: rec.revision,
  }
}

export function getWorkerSecretRevision(workerId: string): number {
  return loadFile().workers[workerId]?.revision ?? 0
}

/**
 * Set or clear one env secret for a worker. Bumps revision on any change.
 * Empty value deletes the key.
 */
export function setWorkerSecret(
  workerId: string,
  envName: string,
  value: string,
): { configuredKeys: string[]; revision: number } {
  if (!workerId.trim()) throw new Error('workerId required')
  assertEnvName(envName)
  return withMutationLock((file) => {
    const prev = file.workers[workerId] ?? { revision: 0, secrets: {} }
    const secrets = { ...prev.secrets }
    const trimmed = value.trim()
    if (!trimmed) delete secrets[envName]
    else secrets[envName] = trimmed
    const revision = prev.revision + 1
    file.workers[workerId] = { revision, secrets }
    return {
      result: {
        configuredKeys: Object.keys(secrets).sort(),
        revision,
      },
      persist: true,
    }
  })
}

export function clearWorkerSecrets(workerId: string): { revision: number } {
  return withMutationLock((file) => {
    const prev = file.workers[workerId]
    if (!prev) return { result: { revision: 0 }, persist: false }
    const revision = prev.revision + 1
    file.workers[workerId] = { revision, secrets: {} }
    return { result: { revision }, persist: true }
  })
}

/**
 * Load plaintext secrets for spawn injection only.
 * Never log / return from HTTP handlers.
 */
export function loadWorkerSecretsForSpawn(workerId: string): Record<string, string> {
  const rec = loadFile().workers[workerId]
  if (!rec) return {}
  return { ...rec.secrets }
}

export interface WorkerSecretRevisionMetadata {
  workerId: string
  configuredKeys: string[]
  revision: number
}

export interface WorkerSecretRevisionHmacOptions {
  /** Explicit shape prevents a production call from falling back to a public constant. */
  testOnlyHmacKey?: Buffer
}

export interface WorkerSecretsSpawnSnapshot {
  /** Plaintext target-process values; never serialize or expose through public APIs. */
  secrets: Record<string, string>
  configuredKeys: string[]
  revision: number
  revisionHmac: string
}

const WORKER_SECRET_REVISION_DOMAIN = 'worker-secret-revision-fingerprint-v1'

/** Pure HMAC over non-secret revision metadata. Secret values cannot enter this API. */
export function computeWorkerSecretRevisionHmac(
  input: WorkerSecretRevisionMetadata,
  options: WorkerSecretRevisionHmacOptions = {},
): string {
  const baseKey = options.testOnlyHmacKey ?? getWorkerSecretsEncryptionKeys().current
  if (baseKey.length !== 32) {
    throw new Error('Worker secret revision HMAC key must be exactly 32 bytes')
  }
  const hmacKey = createHmac('sha256', baseKey).update(WORKER_SECRET_REVISION_DOMAIN).digest()
  const payload = JSON.stringify({
    workerId: input.workerId,
    keys: [...input.configuredKeys].sort(),
    revision: input.revision,
  })
  return createHmac('sha256', hmacKey).update(payload).digest('hex')
}

/** HMAC of worker identity, configured key names, and revision (never values). */
export function workerSecretsFingerprintHmac(
  workerId: string,
  options: WorkerSecretRevisionHmacOptions = {},
): string {
  const { configuredKeys, revision } = listWorkerSecretKeyNames(workerId)
  return computeWorkerSecretRevisionHmac({ workerId, configuredKeys, revision }, options)
}

/**
 * Read one immutable encrypted-file version and derive both spawn values and its
 * reuse discriminator. Atomic rename means the snapshot is wholly before or
 * wholly after a concurrent locked mutation, never old values with a new HMAC.
 */
export function loadWorkerSecretsSnapshotForSpawn(workerId: string): WorkerSecretsSpawnSnapshot {
  const record = loadFile().workers[workerId]
  const secrets = record ? { ...record.secrets } : {}
  const configuredKeys = Object.keys(secrets).sort()
  const revision = record?.revision ?? 0
  const snapshot = {
    configuredKeys,
    revision,
    revisionHmac: computeWorkerSecretRevisionHmac({
      workerId,
      configuredKeys,
      revision,
    }),
  } as WorkerSecretsSpawnSnapshot
  Object.defineProperty(snapshot, 'secrets', {
    value: Object.freeze(secrets),
    enumerable: false,
    configurable: false,
    writable: false,
  })
  return snapshot
}
