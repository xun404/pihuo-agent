import type {
  AcpRegistryAgentAvailability,
  AcpRegistryAuthor,
  AcpRegistryDistribution,
  AcpRegistryTarget,
  WorkerKind,
  WorkerReadinessStatus,
} from '@router-agents/shared'

export type WorkerRegistryDistribution = 'binary' | 'npx' | 'uvx'

export interface WorkerRegistryOption {
  id: string
  name: string
  version: string
  description: string
  icon: string
  distribution: WorkerRegistryDistribution
  /** All distributions when catalog v2 is available */
  distributions?: WorkerRegistryDistribution[]
  command: string
  args: string[]
  env: Record<string, string>
  requiresLocalInstall: boolean
  manifestDigest?: string
  availability?: string
  platformSupported?: boolean
  availabilityMessage?: string
  repository?: string
  website?: string
  authors?: AcpRegistryAuthor[]
  license?: string
  platformTarget?: AcpRegistryTarget
  /** Full v2 distribution facts used by the trust/detail view. */
  distributionDetails?: AcpRegistryDistribution[]
  relatedWorkers?: Array<{
    id: string
    name: string
    readiness?: unknown
    installationId?: string
    registryVersion?: string
  }>
}

export interface WorkerRegistryAgentV2 {
  id: string
  name: string
  version: string
  description?: string
  repository?: string
  website?: string
  authors?: AcpRegistryAuthor[]
  license?: string
  icon?: string
  distributions?: AcpRegistryDistribution[]
  manifestDigest?: string
  availability?: AcpRegistryAgentAvailability
  availabilityMessage?: string
  platformTarget?: AcpRegistryTarget
  relatedWorkers?: WorkerRegistryOption['relatedWorkers']
}

export interface WorkerRegistryCatalog {
  version: string
  agents: WorkerRegistryOption[]
  schemaVersion?: string
  source?: string
  digest?: string
  stale?: boolean
  updateRequired?: boolean
  agentsV2?: WorkerRegistryAgentV2[]
  terminalAuthEnabled?: boolean
  ptyReady?: boolean
}

export type WorkerRegistrationRoute =
  | { kind: 'custom' }
  | { kind: 'registry_unavailable' }
  | { kind: 'registry'; option: WorkerRegistryOption }

/** Keep Registry ownership even when a background refresh removes the selected row. */
export function resolveWorkerRegistrationRoute(
  selectedId: string | null,
  selectedOption: WorkerRegistryOption | null,
  manifestDigest: string,
): WorkerRegistrationRoute {
  if (!selectedId) return { kind: 'custom' }
  if (!selectedOption || !manifestDigest) return { kind: 'registry_unavailable' }
  return { kind: 'registry', option: selectedOption }
}

export type RegistryUiStatus =
  | 'cataloged'
  | 'preparing'
  | 'prepared'
  | 'auth_required'
  | 'ready'
  | 'failed'
  | 'incompatible'
  | 'update_available'

export function readinessToUiStatus(
  status?: WorkerReadinessStatus | string | null,
): RegistryUiStatus {
  switch (status) {
    case 'ready':
    case 'degraded':
      return 'ready'
    case 'auth_required':
    case 'authenticating':
      return 'auth_required'
    case 'preparing':
      return 'preparing'
    case 'prepared':
    case 'initializing':
      return 'prepared'
    case 'incompatible':
      return 'incompatible'
    case 'failed':
      return 'failed'
    default:
      return 'cataloged'
  }
}

export interface WorkerRegistrationDraft {
  selectedId: string
  name: string
  command: string
  args: string
  env: Record<string, string>
  kind: WorkerKind
  description: string
}

export function filterWorkerRegistryOptions(
  options: WorkerRegistryOption[],
  query: string,
  limit = 12,
): WorkerRegistryOption[] {
  const normalized = query.trim().toLocaleLowerCase()
  const filtered = normalized
    ? options.filter((option) =>
        [
          option.name,
          option.id,
          option.description,
          option.distribution,
          ...(option.distributions ?? []),
        ].some((value) => value.toLocaleLowerCase().includes(normalized)),
      )
    : options
  return filtered.slice(0, Math.max(0, limit))
}

/**
 * Registry agents should register via prepare/register API — not by pasting
 * command into the custom form. Draft is identity-only for UI selection.
 */
export function createWorkerDraftFromRegistry(
  option: WorkerRegistryOption,
): WorkerRegistrationDraft {
  const kind: WorkerKind =
    option.id === 'claude-acp'
      ? 'claude'
      : option.id === 'codex-acp'
        ? 'codex'
        : option.id === 'opencode'
          ? 'opencode'
          : 'custom'
  return {
    selectedId: option.id,
    name: option.name,
    // Keep projection for display; Owner register will re-materialize
    command: option.command,
    args: option.args.join(' '),
    env: { ...option.env },
    kind,
    description: option.description,
  }
}

/** Map catalog API response (v1 flat + v2 fields) into combobox options. */
function projectV2LaunchPreview(
  agent: WorkerRegistryAgentV2,
  distribution: WorkerRegistryDistribution,
  legacy: WorkerRegistryOption | undefined,
): Pick<WorkerRegistryOption, 'command' | 'args' | 'env'> {
  if (legacy?.distribution === distribution) {
    return { command: legacy.command, args: [...legacy.args], env: { ...legacy.env } }
  }
  const detail = agent.distributions?.find((entry) => entry.kind === distribution)
  if (!detail) return { command: '', args: [], env: {} }
  if (detail.kind === 'binary') {
    const target = detail.targets.find((entry) => entry.target === agent.platformTarget)
    return target
      ? { command: target.cmd, args: [...target.args], env: { ...target.env } }
      : { command: '', args: [], env: {} }
  }
  return {
    command: detail.kind,
    args: [detail.package, ...detail.args],
    env: { ...detail.env },
  }
}

export function mapCatalogResponseToOptions(body: {
  agents?: WorkerRegistryOption[]
  agentsV2?: WorkerRegistryAgentV2[]
}): WorkerRegistryOption[] {
  if (Array.isArray(body.agentsV2) && body.agentsV2.length > 0) {
    const legacyById = new Map((body.agents ?? []).map((entry) => [entry.id, entry]))
    return body.agentsV2.map((agent) => {
      const distributionDetails = agent.distributions ?? []
      const distributions = distributionDetails.map((entry) => entry.kind)
      const legacy = legacyById.get(agent.id)
      const distribution =
        legacy && distributions.includes(legacy.distribution)
          ? legacy.distribution
          : (distributions[0] ?? 'npx')
      const preview = projectV2LaunchPreview(agent, distribution, legacy)
      return {
        id: agent.id,
        name: agent.name,
        version: agent.version,
        description: agent.description ?? '',
        icon: agent.icon ?? '',
        distribution,
        distributions,
        distributionDetails,
        ...preview,
        requiresLocalInstall: distribution === 'binary',
        manifestDigest: agent.manifestDigest,
        availability: agent.availability,
        availabilityMessage: agent.availabilityMessage,
        platformSupported:
          agent.availability !== 'unsupported_platform' &&
          agent.availability !== 'invalid_manifest',
        repository: agent.repository,
        website: agent.website,
        authors: agent.authors?.map((author) => ({ ...author })),
        license: agent.license,
        platformTarget: agent.platformTarget,
        relatedWorkers: agent.relatedWorkers?.map((worker) => ({ ...worker })),
      }
    })
  }
  if (Array.isArray(body.agents) && body.agents.length > 0) {
    return body.agents.map((a) => ({
      ...a,
      distributions: a.distributions ?? (a.distribution ? [a.distribution] : undefined),
    }))
  }
  return []
}

export function moveWorkerRegistryHighlight(current: number, key: string, count: number): number {
  if (count <= 0) return -1
  if (key === 'ArrowDown') return current < 0 ? 0 : (current + 1) % count
  if (key === 'ArrowUp') return current <= 0 ? count - 1 : current - 1
  return current
}
