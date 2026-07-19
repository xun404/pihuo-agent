/**
 * Immutable ACP agent installation records.
 * Index: <root>/data/acp-agent-installations.json
 * Artifacts: <root>/data/agents/<registryId>/<version>/<target>/
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
import { randomBytes } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type {
  AcpRegistryDistributionKind,
  AcpRegistryTarget,
  WorkerLaunchSpec,
} from '@swarmdesk-agent/shared'
import { resolveRouterDataPaths } from './router-data-paths.js'

export type AcpInstallationStatus =
  'staging' | 'prepared' | 'installed' | 'probe_failed' | 'removed'

export interface AcpAgentInstallationRecord {
  installationId: string
  registryId: string
  registryVersion: string
  distribution: AcpRegistryDistributionKind
  target?: AcpRegistryTarget
  manifestDigest: string
  archiveUrl?: string
  declaredSha256?: string
  observedSha256?: string
  installDir: string
  resolvedExecutable?: string
  packageSpec?: string
  runnerCommand?: string
  runnerVersion?: string
  /** Immutable digest of the private prepared payload file inventory. */
  payloadDigest?: string
  /** Immutable, non-secret facts used to materialize the launch exactly. */
  launchSpec?: WorkerLaunchSpec & { runnerVersion?: string }
  status: AcpInstallationStatus
  preparedAt?: string
  installedAt?: string
  lastProbedAt?: string
  probeCode?: string
  probeMessage?: string
  /** Worker ids that currently reference this installation */
  workerIds: string[]
  trustDecision?: {
    acceptedAt: string
    manifestDigest: string
    explicitNoSha: boolean
  }
}

export class AcpInstallationStoreError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'AcpInstallationStoreError'
  }
}

export interface AcpAgentInstallationIndex {
  version: 1
  installations: AcpAgentInstallationRecord[]
}

function installationsPath(): string {
  return resolveRouterDataPaths().agentInstallationsPath
}

function agentsRoot(): string {
  return join(resolveRouterDataPaths().dataDir, 'agents')
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
  try {
    renameSync(path, `${path}.corrupt.${Date.now()}`)
  } catch {
    try {
      unlinkSync(path)
    } catch {
      /* ignore */
    }
  }
}

function emptyIndex(): AcpAgentInstallationIndex {
  return { version: 1, installations: [] }
}

export function loadAcpAgentInstallationIndex(
  path = installationsPath(),
): AcpAgentInstallationIndex {
  if (!existsSync(path)) return emptyIndex()
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      isolateCorrupt(path)
      return emptyIndex()
    }
    const rec = raw as Record<string, unknown>
    if (rec.version !== 1 || !Array.isArray(rec.installations)) {
      isolateCorrupt(path)
      return emptyIndex()
    }
    return {
      version: 1,
      installations: rec.installations as AcpAgentInstallationRecord[],
    }
  } catch {
    isolateCorrupt(path)
    return emptyIndex()
  }
}

export function saveAcpAgentInstallationIndex(
  index: AcpAgentInstallationIndex,
  path = installationsPath(),
): void {
  atomicWritePrivate(
    path,
    `${JSON.stringify({ version: 1, installations: index.installations }, null, 2)}\n`,
  )
}

export function createInstallationId(): string {
  return `inst_${randomBytes(8).toString('hex')}`
}

export function resolveInstallationDir(input: {
  registryId: string
  registryVersion: string
  target: string
}): string {
  // Sanitize path segments
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9._-]+/g, '_')
  return join(agentsRoot(), safe(input.registryId), safe(input.registryVersion), safe(input.target))
}

export function findInstallationById(
  installationId: string,
  path = installationsPath(),
): AcpAgentInstallationRecord | undefined {
  return loadAcpAgentInstallationIndex(path).installations.find(
    (i) => i.installationId === installationId,
  )
}

export function findInstallation(
  query: {
    registryId: string
    registryVersion: string
    distribution: AcpRegistryDistributionKind
    target?: AcpRegistryTarget
  },
  path = installationsPath(),
): AcpAgentInstallationRecord | undefined {
  return loadAcpAgentInstallationIndex(path).installations.find(
    (i) =>
      i.registryId === query.registryId &&
      i.registryVersion === query.registryVersion &&
      i.distribution === query.distribution &&
      (query.target ? i.target === query.target : true) &&
      (i.status === 'prepared' || i.status === 'installed'),
  )
}

function sameInstallationIdentity(
  a: AcpAgentInstallationRecord,
  b: AcpAgentInstallationRecord,
): boolean {
  return (
    a.registryId === b.registryId &&
    a.registryVersion === b.registryVersion &&
    a.distribution === b.distribution &&
    a.target === b.target
  )
}

function activeInstallation(record: AcpAgentInstallationRecord): boolean {
  return record.status === 'prepared' || record.status === 'installed'
}

function immutableInstallationProjection(record: AcpAgentInstallationRecord): unknown {
  return {
    registryId: record.registryId,
    registryVersion: record.registryVersion,
    distribution: record.distribution,
    target: record.target,
    manifestDigest: record.manifestDigest,
    archiveUrl: record.archiveUrl,
    declaredSha256: record.declaredSha256,
    observedSha256: record.observedSha256,
    installDir: record.installDir,
    resolvedExecutable: record.resolvedExecutable,
    packageSpec: record.packageSpec,
    runnerCommand: record.runnerCommand,
    runnerVersion: record.runnerVersion,
    payloadDigest: record.payloadDigest,
    launchSpec: record.launchSpec,
    trustDecision: record.trustDecision,
  }
}

function immutableConflict(
  existing: AcpAgentInstallationRecord,
  incoming: AcpAgentInstallationRecord,
): boolean {
  return !isDeepStrictEqual(
    immutableInstallationProjection(existing),
    immutableInstallationProjection(incoming),
  )
}

export function upsertInstallation(
  record: AcpAgentInstallationRecord,
  path = installationsPath(),
): AcpAgentInstallationRecord {
  const index = loadAcpAgentInstallationIndex(path)
  const idx = index.installations.findIndex((i) => i.installationId === record.installationId)
  const sameId = idx >= 0 ? index.installations[idx] : undefined
  if (sameId && (!sameInstallationIdentity(sameId, record) || immutableConflict(sameId, record))) {
    throw new AcpInstallationStoreError(
      'ACP_INSTALL_DIGEST_MISMATCH',
      'ACP_INSTALL_DIGEST_MISMATCH: installation identity or digest is immutable',
    )
  }

  const existingIdentity = index.installations.find(
    (candidate) =>
      candidate.installationId !== record.installationId &&
      activeInstallation(candidate) &&
      sameInstallationIdentity(candidate, record),
  )
  if (existingIdentity) {
    if (immutableConflict(existingIdentity, record)) {
      throw new AcpInstallationStoreError(
        'ACP_INSTALL_DIGEST_MISMATCH',
        'ACP_INSTALL_DIGEST_MISMATCH: existing installation has a different digest',
      )
    }
    return existingIdentity
  }
  if (idx >= 0) index.installations[idx] = record
  else index.installations.push(record)
  saveAcpAgentInstallationIndex(index, path)
  return record
}

export function addWorkerReference(
  installationId: string,
  workerId: string,
  path = installationsPath(),
): void {
  const index = loadAcpAgentInstallationIndex(path)
  const rec = index.installations.find((i) => i.installationId === installationId)
  if (!rec) return
  if (!rec.workerIds.includes(workerId)) rec.workerIds.push(workerId)
  saveAcpAgentInstallationIndex(index, path)
}

export function removeWorkerReference(
  installationId: string,
  workerId: string,
  path = installationsPath(),
): void {
  const index = loadAcpAgentInstallationIndex(path)
  const rec = index.installations.find((i) => i.installationId === installationId)
  if (!rec) return
  rec.workerIds = rec.workerIds.filter((id) => id !== workerId)
  saveAcpAgentInstallationIndex(index, path)
}

/** Installations with zero worker references (cleanup candidates only). */
export function listUnreferencedInstallations(
  path = installationsPath(),
): AcpAgentInstallationRecord[] {
  return loadAcpAgentInstallationIndex(path).installations.filter(
    (i) => i.workerIds.length === 0 && i.status !== 'staging',
  )
}

export function markInstallationRemoved(installationId: string, path = installationsPath()): void {
  const index = loadAcpAgentInstallationIndex(path)
  const rec = index.installations.find((i) => i.installationId === installationId)
  if (!rec) return
  if (rec.workerIds.length > 0) {
    throw new Error('ACP_INSTALL_IN_USE: installation still referenced by workers')
  }
  rec.status = 'removed'
  saveAcpAgentInstallationIndex(index, path)
}
