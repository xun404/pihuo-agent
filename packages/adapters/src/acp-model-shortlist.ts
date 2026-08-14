import { homedir } from 'node:os'
import type { WorkerModelOption } from '@pihuo-agent/shared'
import {
  buildProviderEvidenceMap,
  buildShortlistAndSearchIndex,
  evaluateModelEligibility,
  getProviderId,
  type ProviderEvidence,
} from './model-eligibility.js'
import { readAuthProviderIds, readDisabledProviders } from './opencode-models.js'

export type ShortlistReason = 'pinned' | 'zen_free' | 'direct_provider' | 'connected_gateway'

export interface ShortlistEntry {
  modelId: string
  name: string
  description?: string
  reason: ShortlistReason
}

export interface ShortlistResult {
  shortlist: ShortlistEntry[]
  openRouterModels: WorkerModelOption[]
  remainingModels: WorkerModelOption[]
  totalModelCount: number
  searchIndex?: WorkerModelOption[]
  providers?: Record<string, ProviderEvidence>
}

function modelToEntry(m: WorkerModelOption, reason: ShortlistReason): ShortlistEntry {
  return { modelId: m.modelId, name: m.name, description: m.description, reason }
}

function reasonFromEligibility(
  modelId: string,
  pinnedId: string,
  er: ReturnType<typeof evaluateModelEligibility>,
): ShortlistReason {
  if (pinnedId && modelId === pinnedId) return 'pinned'
  if (er.reason === 'zen_free') return 'zen_free'
  if (er.reason === 'direct_authenticated') return 'direct_provider'
  return 'connected_gateway'
}

export function computeShortlistedModels(params: {
  allModels: WorkerModelOption[]
  pinnedModel?: string | null
  zenFreeModels: string[]
  opencodeEnv: Record<string, string>
  /** When true (default for OpenCode), merge auth.json + disabled_providers */
  useOpenCodeEvidence?: boolean
  realHome?: string
}): ShortlistResult {
  const { allModels, pinnedModel, zenFreeModels, opencodeEnv } = params
  const totalModelCount = allModels.length
  const home = params.realHome ?? opencodeEnv.HOME ?? process.env.HOME ?? homedir()
  // Only merge filesystem evidence when explicitly requested (listAcpModels for opencode)
  // Pass worker XDG so discovery matches pin/dispatch evidence (XDG preferred over HOME).
  const useOc = params.useOpenCodeEvidence === true
  const authProviders = useOc
    ? readAuthProviderIds(home, { xdgDataHome: opencodeEnv.XDG_DATA_HOME })
    : undefined
  const disabledProviders = useOc
    ? [...readDisabledProviders(home, { xdgConfigHome: opencodeEnv.XDG_CONFIG_HOME })]
    : undefined
  const providers = buildProviderEvidenceMap({
    modelIds: allModels.map((m) => m.modelId),
    env: opencodeEnv,
    zenFreeAllowlist: zenFreeModels,
    authProviders,
    disabledProviders,
  })
  const { shortlist: shortModels, searchIndex } = buildShortlistAndSearchIndex({
    candidates: allModels,
    providers,
    zenFreeAllowlist: zenFreeModels,
    pinnedModel,
  })

  const pinnedId = pinnedModel?.trim() || ''
  const shortlistIds = new Set(shortModels.map((m) => m.modelId))
  const shortlist: ShortlistEntry[] = shortModels.map((m) => {
    const er = evaluateModelEligibility({
      modelId: m.modelId,
      candidates: allModels,
      providers,
      zenFreeAllowlist: zenFreeModels,
      purpose: pinnedId && m.modelId === pinnedId ? 'pin' : 'shortlist',
    })
    return modelToEntry(m, reasonFromEligibility(m.modelId, pinnedId, er))
  })

  const openRouterModels: WorkerModelOption[] = []
  const remainingModels: WorkerModelOption[] = []
  const seen = new Set<string>()

  for (const m of allModels) {
    if (seen.has(m.modelId)) continue
    seen.add(m.modelId)
    if (shortlistIds.has(m.modelId)) {
      m.group = 'shortlist'
      continue
    }
    const slug = getProviderId(m.modelId)
    if (slug === 'openrouter') {
      m.group = 'openrouter'
      openRouterModels.push(m)
      continue
    }
    m.group = 'other'
    remainingModels.push(m)
  }

  return {
    shortlist,
    openRouterModels,
    remainingModels,
    totalModelCount,
    searchIndex,
    providers,
  }
}
