/**
 * ACP Registry catalog parser.
 *
 * v2: retains ALL distributions per agent + full metadata.
 * Legacy `AcpRegistryWorkerOption` projection (npx > uvx > binary) kept for UI.
 */
import type {
  AcpRegistryAgentAvailability,
  AcpRegistryAgentMetadata,
  AcpRegistryAuthor,
  AcpRegistryBinaryDistribution,
  AcpRegistryBinaryTarget,
  AcpRegistryCatalogSnapshot,
  AcpRegistryDistribution,
  AcpRegistryPackageDistribution,
  AcpRegistryTarget,
  WorkerLaunchSpec,
} from '@pihuo-agent/shared'
import {
  binaryDistributionToLaunchSpec,
  materializeCommandArgs,
  packageDistributionToLaunchSpec,
  pickDefaultLaunchSpec,
} from './acp-launch-spec.js'
import {
  AcpRegistrySchemaError,
  assertSupportedRegistrySchemaVersion,
  digestOfAgentEntry,
  digestOfRegistryPayload,
} from './acp-registry-schema.js'
import {
  ACP_REGISTRY_CDN,
  isSupportedRegistrySchemaVersion,
} from './bundled/acp-registry-compatibility.js'

export const ACP_REGISTRY_URL = ACP_REGISTRY_CDN.registryJson

export type { AcpRegistryTarget, AcpRegistryDistributionKind } from '@pihuo-agent/shared'

/** @deprecated Prefer AcpRegistryAgentMetadata; kept for Settings combobox */
export interface AcpRegistryWorkerOption {
  id: string
  name: string
  version: string
  description: string
  icon: string
  distribution: 'binary' | 'npx' | 'uvx'
  command: string
  args: string[]
  env: Record<string, string>
  requiresLocalInstall: boolean
  /** Present on v2 projections */
  manifestDigest?: string
  repository?: string
  website?: string
  license?: string
  availability?: AcpRegistryAgentAvailability
}

/** @deprecated Prefer AcpRegistryCatalogSnapshot */
export interface AcpRegistryCatalog {
  version: string
  agents: AcpRegistryWorkerOption[]
}

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredString(record: UnknownRecord, key: string, context: string): string {
  const value = record[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Invalid ACP registry ${context}.${key}`)
  }
  return value
}

function optionalString(record: UnknownRecord, key: string): string | undefined {
  const value = record[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') return undefined
  const t = value.trim()
  return t || undefined
}

function stringArray(value: unknown, context: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`Invalid ACP registry ${context}`)
  }
  return [...value]
}

function stringRecord(value: unknown, context: string): Record<string, string> {
  if (value === undefined) return {}
  if (!isRecord(value)) throw new Error(`Invalid ACP registry ${context}`)
  const entries = Object.entries(value)
  if (entries.some(([, item]) => typeof item !== 'string')) {
    throw new Error(`Invalid ACP registry ${context}`)
  }
  return Object.fromEntries(entries) as Record<string, string>
}

const REGISTRY_TARGETS: AcpRegistryTarget[] = [
  'darwin-aarch64',
  'darwin-x86_64',
  'linux-aarch64',
  'linux-x86_64',
  'windows-aarch64',
  'windows-x86_64',
]

function parseAuthors(value: unknown): AcpRegistryAuthor[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) return undefined
  const out: AcpRegistryAuthor[] = []
  for (const item of value) {
    if (typeof item === 'string' && item.trim()) {
      out.push({ name: item.trim() })
      continue
    }
    if (isRecord(item) && typeof item.name === 'string' && item.name.trim()) {
      out.push({
        name: item.name.trim(),
        url: typeof item.url === 'string' ? item.url : undefined,
      })
    }
  }
  return out.length ? out : undefined
}

function parsePackageDistribution(
  distribution: unknown,
  kind: 'npx' | 'uvx',
  agentId: string,
): AcpRegistryPackageDistribution | null {
  if (distribution === undefined) return null
  if (!isRecord(distribution)) {
    throw new Error(`Invalid ACP registry ${agentId}.distribution.${kind}`)
  }
  const packageSpec = requiredString(distribution, 'package', `${agentId}.distribution.${kind}`)
  return {
    kind,
    package: packageSpec,
    args: stringArray(distribution.args, `${agentId}.distribution.${kind}.args`),
    env: stringRecord(distribution.env, `${agentId}.distribution.${kind}.env`),
  }
}

function parseBinaryDistribution(
  distribution: unknown,
  agentId: string,
): AcpRegistryBinaryDistribution | null {
  if (distribution === undefined) return null
  if (!isRecord(distribution)) {
    throw new Error(`Invalid ACP registry ${agentId}.distribution.binary`)
  }
  const targets: AcpRegistryBinaryTarget[] = []
  for (const [key, raw] of Object.entries(distribution)) {
    if (!REGISTRY_TARGETS.includes(key as AcpRegistryTarget)) {
      // ignore unknown platform keys rather than fail whole agent
      continue
    }
    if (!isRecord(raw)) {
      throw new Error(`Invalid ACP registry ${agentId}.distribution.binary.${key}`)
    }
    const archive = requiredString(raw, 'archive', `${agentId}.distribution.binary.${key}`)
    const cmd = requiredString(raw, 'cmd', `${agentId}.distribution.binary.${key}`)
    const sha256 =
      typeof raw.sha256 === 'string' && /^[a-fA-F0-9]{64}$/.test(raw.sha256)
        ? raw.sha256.toLowerCase()
        : undefined
    targets.push({
      target: key as AcpRegistryTarget,
      archiveUrl: archive,
      sha256,
      cmd,
      args: stringArray(raw.args, `${agentId}.distribution.binary.${key}.args`),
      env: stringRecord(raw.env, `${agentId}.distribution.binary.${key}.env`),
    })
  }
  if (targets.length === 0) {
    throw new Error(`Invalid ACP registry ${agentId}.distribution.binary (no targets)`)
  }
  return { kind: 'binary', targets }
}

function parseDistributions(
  distribution: UnknownRecord,
  agentId: string,
): AcpRegistryDistribution[] {
  const out: AcpRegistryDistribution[] = []
  const npx = parsePackageDistribution(distribution.npx, 'npx', agentId)
  if (npx) out.push(npx)
  const uvx = parsePackageDistribution(distribution.uvx, 'uvx', agentId)
  if (uvx) out.push(uvx)
  const binary = parseBinaryDistribution(distribution.binary, agentId)
  if (binary) out.push(binary)
  if (out.length === 0) {
    throw new Error(`Invalid ACP registry ${agentId}.distribution`)
  }
  return out
}

function availabilityFor(
  distributions: AcpRegistryDistribution[],
  target: AcpRegistryTarget | null,
): { availability: AcpRegistryAgentAvailability; message?: string } {
  if (!target) {
    return {
      availability: 'unsupported_platform',
      message: 'Current platform/arch is not a known ACP registry target',
    }
  }
  const hasPackage = distributions.some((d) => d.kind === 'npx' || d.kind === 'uvx')
  if (hasPackage) return { availability: 'available' }
  const binary = distributions.find((d) => d.kind === 'binary')
  if (binary && binary.kind === 'binary') {
    if (binary.targets.some((t) => t.target === target)) {
      return { availability: 'available' }
    }
    return {
      availability: 'unsupported_platform',
      message: `No binary target for ${target}`,
    }
  }
  return { availability: 'unknown' }
}

export function resolveAcpRegistryTarget(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): AcpRegistryTarget | null {
  const os =
    platform === 'darwin'
      ? 'darwin'
      : platform === 'linux'
        ? 'linux'
        : platform === 'win32'
          ? 'windows'
          : null
  const cpu = arch === 'arm64' ? 'aarch64' : arch === 'x64' ? 'x86_64' : null
  return os && cpu ? (`${os}-${cpu}` as AcpRegistryTarget) : null
}

/**
 * Resolve platform target or structured error code (never empty command silently).
 */
export function resolveAcpRegistryTargetOrError(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
):
  | { ok: true; target: AcpRegistryTarget }
  | { ok: false; code: 'ACP_PLATFORM_UNSUPPORTED'; message: string } {
  const target = resolveAcpRegistryTarget(platform, arch)
  if (target) return { ok: true, target }
  return {
    ok: false,
    code: 'ACP_PLATFORM_UNSUPPORTED',
    message: `Unsupported platform ${platform}/${arch} for ACP registry binaries`,
  }
}

function parseOneAgent(
  raw: unknown,
  index: number,
  target: AcpRegistryTarget | null,
): AcpRegistryAgentMetadata {
  if (!isRecord(raw) || !isRecord(raw.distribution)) {
    throw new Error(`Invalid ACP registry agent at index ${index}`)
  }
  const id = requiredString(raw, 'id', `agents[${index}]`)
  try {
    const distributions = parseDistributions(raw.distribution, id)
    const avail = availabilityFor(distributions, target)
    return {
      id,
      name: requiredString(raw, 'name', id),
      version: requiredString(raw, 'version', id),
      description: requiredString(raw, 'description', id),
      repository: optionalString(raw, 'repository'),
      website: optionalString(raw, 'website'),
      authors: parseAuthors(raw.authors),
      license: optionalString(raw, 'license'),
      icon: optionalString(raw, 'icon') ?? '',
      distributions,
      manifestDigest: digestOfAgentEntry(raw),
      availability: avail.availability,
      availabilityMessage: avail.message,
    }
  } catch (e) {
    // Caller may isolate single-agent failures
    throw e
  }
}

export interface ParseRegistryOptions {
  target?: AcpRegistryTarget | null
  /**
   * When true (default), top-level version must be supported major.
   * Set false only for research tools.
   */
  enforceSchemaMajor?: boolean
  /** Isolate per-agent parse failures as invalid_manifest instead of rejecting catalog */
  isolateAgentErrors?: boolean
}

/**
 * Full catalog parse: keeps every distribution; isolates bad agent entries when configured.
 */
export function parseAcpRegistryCatalogV2(
  source: unknown,
  options: ParseRegistryOptions = {},
): AcpRegistryCatalogSnapshot {
  if (!isRecord(source) || !Array.isArray(source.agents)) {
    throw new AcpRegistrySchemaError('ACP_REGISTRY_ENTRY_INVALID', 'Invalid ACP registry payload')
  }
  // Reject unknown top-level keys except version/agents/extensions
  for (const key of Object.keys(source)) {
    if (key === 'version' || key === 'agents' || key === 'extensions') continue
    throw new AcpRegistrySchemaError(
      'ACP_REGISTRY_ENTRY_INVALID',
      `Unknown top-level registry field: ${key}`,
    )
  }
  if (source.extensions !== undefined && !Array.isArray(source.extensions)) {
    throw new AcpRegistrySchemaError(
      'ACP_REGISTRY_ENTRY_INVALID',
      'extensions must be an array when present',
    )
  }

  const version = requiredString(source, 'version', 'payload')
  const enforce = options.enforceSchemaMajor !== false
  if (enforce) assertSupportedRegistrySchemaVersion(version)

  const target = options.target === undefined ? resolveAcpRegistryTarget() : options.target
  const isolate = options.isolateAgentErrors !== false
  const seen = new Set<string>()
  const agents: AcpRegistryAgentMetadata[] = []

  source.agents.forEach((raw, index) => {
    try {
      const agent = parseOneAgent(raw, index, target)
      if (seen.has(agent.id)) {
        throw new Error(`Duplicate ACP registry agent id: ${agent.id}`)
      }
      seen.add(agent.id)
      agents.push(agent)
    } catch (e) {
      if (!isolate) throw e
      // Try to salvage id for diagnostics
      let id = `agents[${index}]`
      if (isRecord(raw) && typeof raw.id === 'string' && raw.id.trim()) {
        id = raw.id.trim()
        if (seen.has(id)) {
          throw new Error(`Duplicate ACP registry agent id: ${id}`)
        }
        seen.add(id)
      }
      agents.push({
        id,
        name: isRecord(raw) && typeof raw.name === 'string' ? raw.name : id,
        version: isRecord(raw) && typeof raw.version === 'string' ? raw.version : '0.0.0',
        description:
          isRecord(raw) && typeof raw.description === 'string'
            ? raw.description
            : 'Invalid registry entry',
        icon: '',
        distributions: [],
        manifestDigest: digestOfAgentEntry(raw),
        availability: 'invalid_manifest',
        availabilityMessage: e instanceof Error ? e.message : String(e),
      })
    }
  })

  agents.sort(
    (left, right) =>
      left.name.localeCompare(right.name, 'en', { sensitivity: 'base' }) ||
      left.id.localeCompare(right.id),
  )

  return {
    schemaVersion: version,
    version,
    source: 'remote',
    digest: digestOfRegistryPayload(source),
    agents,
  }
}

/** Project v2 agent → legacy flat launch option (default dist preference). */
export function projectAgentToWorkerOption(
  agent: AcpRegistryAgentMetadata,
  target: AcpRegistryTarget | null = resolveAcpRegistryTarget(),
): AcpRegistryWorkerOption {
  const spec: WorkerLaunchSpec | null = pickDefaultLaunchSpec(agent.distributions, target)
  if (!spec) {
    return {
      id: agent.id,
      name: agent.name,
      version: agent.version,
      description: agent.description,
      icon: agent.icon ?? '',
      distribution: 'binary',
      command: '',
      args: [],
      env: {},
      requiresLocalInstall: true,
      manifestDigest: agent.manifestDigest,
      repository: agent.repository,
      website: agent.website,
      license: agent.license,
      availability: agent.availability,
    }
  }
  const mat = materializeCommandArgs(spec)
  return {
    id: agent.id,
    name: agent.name,
    version: agent.version,
    description: agent.description,
    icon: agent.icon ?? '',
    distribution: spec.distribution === 'custom' ? 'binary' : spec.distribution,
    command: mat.command,
    args: mat.args,
    env: mat.env,
    requiresLocalInstall: mat.requiresLocalInstall,
    manifestDigest: agent.manifestDigest,
    repository: agent.repository,
    website: agent.website,
    license: agent.license,
    availability: agent.availability,
  }
}

/**
 * Legacy API: returns flat worker options (npx > uvx > binary default projection).
 * Internally uses v2 parse so multi-dist metadata is available via parseAcpRegistryCatalogV2.
 */
export function parseAcpRegistryCatalog(
  source: unknown,
  target: AcpRegistryTarget | null = resolveAcpRegistryTarget(),
): AcpRegistryCatalog {
  const snapshot = parseAcpRegistryCatalogV2(source, {
    target,
    isolateAgentErrors: false,
  })
  // Filter invalid entries when not isolating — v2 already threw
  const agents = snapshot.agents
    .filter((a) => a.availability !== 'invalid_manifest')
    .map((a) => projectAgentToWorkerOption(a, target))
  return { version: snapshot.version, agents }
}

export async function fetchAcpRegistryCatalog(
  options: {
    target?: AcpRegistryTarget | null
    fetchImpl?: typeof fetch
    signal?: AbortSignal
    timeoutMs?: number
  } = {},
): Promise<AcpRegistryCatalog> {
  const snapshot = await fetchAcpRegistryCatalogV2(options)
  const target = options.target === undefined ? resolveAcpRegistryTarget() : options.target
  return {
    version: snapshot.version,
    agents: snapshot.agents
      .filter((a) => a.availability !== 'invalid_manifest')
      .map((a) => projectAgentToWorkerOption(a, target)),
  }
}

export async function fetchAcpRegistryCatalogV2(
  options: {
    target?: AcpRegistryTarget | null
    fetchImpl?: typeof fetch
    signal?: AbortSignal
    timeoutMs?: number
    etag?: string
  } = {},
): Promise<AcpRegistryCatalogSnapshot & { etag?: string; notModified?: boolean }> {
  const fetchImpl = options.fetchImpl ?? fetch
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 10_000)
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (options.etag) headers['If-None-Match'] = options.etag
  const response = await fetchImpl(ACP_REGISTRY_URL, { headers, signal })
  if (response.status === 304) {
    return {
      schemaVersion: '0.0.0',
      version: '0.0.0',
      source: 'persisted',
      digest: '',
      agents: [],
      notModified: true,
      etag: options.etag,
    }
  }
  if (!response.ok) {
    throw new AcpRegistrySchemaError(
      'ACP_REGISTRY_UNAVAILABLE',
      `ACP registry request failed: HTTP ${response.status}`,
    )
  }
  const body = await response.json()
  if (isRecord(body) && typeof body.version === 'string') {
    if (!isSupportedRegistrySchemaVersion(body.version)) {
      throw new AcpRegistrySchemaError(
        'ACP_REGISTRY_SCHEMA_UNSUPPORTED',
        `Remote registry schema ${body.version} requires an application update`,
      )
    }
  }
  const snapshot = parseAcpRegistryCatalogV2(body, {
    target: options.target === undefined ? resolveAcpRegistryTarget() : options.target,
    isolateAgentErrors: true,
  })
  const etag = response.headers.get('etag') ?? undefined
  return {
    ...snapshot,
    source: 'remote',
    fetchedAt: new Date().toISOString(),
    etag,
  }
}

export function launchSpecFromAgent(
  agent: AcpRegistryAgentMetadata,
  distributionKind: 'npx' | 'uvx' | 'binary',
  target: AcpRegistryTarget | null = resolveAcpRegistryTarget(),
): WorkerLaunchSpec | null {
  if (distributionKind === 'npx' || distributionKind === 'uvx') {
    const dist = agent.distributions.find((d) => d.kind === distributionKind)
    if (!dist || (dist.kind !== 'npx' && dist.kind !== 'uvx')) return null
    return packageDistributionToLaunchSpec(dist)
  }
  const binary = agent.distributions.find((d) => d.kind === 'binary')
  if (!binary || binary.kind !== 'binary' || !target) return null
  return binaryDistributionToLaunchSpec(binary, target)
}
