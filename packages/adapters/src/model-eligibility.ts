import type { WorkerModelOption } from '@pihuo-agent/shared'

export type ProviderEvidence = 'free' | 'authenticated' | 'disabled' | 'unknown'
export type EligibilityPurpose = 'shortlist' | 'search' | 'pin' | 'execute'

export interface EligibilityInput {
  modelId: string
  candidates: WorkerModelOption[]
  providers: Record<string, ProviderEvidence>
  zenFreeAllowlist: string[]
  purpose: EligibilityPurpose
}

export interface EligibilityResult {
  eligible: boolean
  reason?: 'zen_free' | 'direct_authenticated' | 'openrouter_authenticated' | 'pinned_openrouter'
  errorCode?:
    | 'MODEL_NOT_IN_CANDIDATES'
    | 'MODEL_PROVIDER_UNAVAILABLE'
    | 'MODEL_SELECTION_UNVERIFIED'
    | 'MODEL_OPENROUTER_SEARCH_ONLY'
  providerId: string
  evidence: ProviderEvidence
}

export class ModelEligibilityError extends Error {
  readonly errorCode: NonNullable<EligibilityResult['errorCode']>
  readonly providerId: string
  readonly evidence: ProviderEvidence

  constructor(
    message: string,
    opts: {
      errorCode: NonNullable<EligibilityResult['errorCode']>
      providerId: string
      evidence: ProviderEvidence
    },
  ) {
    super(message)
    this.name = 'ModelEligibilityError'
    this.errorCode = opts.errorCode
    this.providerId = opts.providerId
    this.evidence = opts.evidence
  }
}

const KNOWN_DIRECT_PROVIDER_KEYS: Record<string, string[]> = {
  openai: ['OPENAI_API_KEY'],
  anthropic: ['ANTHROPIC_API_KEY'],
  google: ['GOOGLE_GENERATIVE_AI_API_KEY', 'GOOGLE_API_KEY'],
  gemini: ['GOOGLE_GENERATIVE_AI_API_KEY', 'GOOGLE_API_KEY'],
  xai: ['XAI_API_KEY'],
  deepseek: ['DEEPSEEK_API_KEY'],
  openrouter: ['OPENROUTER_API_KEY'],
  opencode: ['OPENCODE_API_KEY'],
  'opencode-go': ['OPENCODE_API_KEY'],
  alibaba: ['DASHSCOPE_API_KEY'],
  'alibaba-cn': ['DASHSCOPE_API_KEY'],
  moonshotai: ['MOONSHOT_API_KEY'],
  zhipuai: ['ZHIPU_API_KEY'],
  groq: ['GROQ_API_KEY'],
  mistral: ['MISTRAL_API_KEY'],
  cohere: ['COHERE_API_KEY'],
  together: ['TOGETHER_API_KEY'],
  fireworks: ['FIREWORKS_API_KEY'],
  perplexity: ['PERPLEXITY_API_KEY'],
  huggingface: ['HUGGINGFACE_API_KEY', 'HF_TOKEN'],
}

export function getProviderId(modelId: string): string {
  const i = modelId.indexOf('/')
  return i > 0 ? modelId.slice(0, i) : modelId
}

function hasAnyKey(keys: string[], env: Record<string, string | undefined>): boolean {
  return keys.some((k) => Boolean(env[k]?.trim()))
}

/**
 * Build provider evidence map from env keys + optional auth store + disabled list.
 * Custom/unknown providers without known key mapping stay `unknown` unless authProviders has them.
 */
export function buildProviderEvidenceMap(params: {
  modelIds: string[]
  env: Record<string, string | undefined>
  zenFreeAllowlist: string[]
  disabledProviders?: string[] | Iterable<string>
  /** Provider IDs present in OpenCode auth.json (or equivalent) */
  authProviders?: Iterable<string>
}): Record<string, ProviderEvidence> {
  const disabled = new Set(
    [...(params.disabledProviders ?? [])].map((p) => String(p).trim()).filter(Boolean),
  )
  const auth = new Set(
    [...(params.authProviders ?? [])].map((p) => String(p).trim()).filter(Boolean),
  )
  const providers = new Set(params.modelIds.map(getProviderId))
  const out: Record<string, ProviderEvidence> = {}

  for (const providerId of providers) {
    if (disabled.has(providerId)) {
      out[providerId] = 'disabled'
      continue
    }
    if (providerId === 'opencode') {
      // Prefer authenticated when OPENCODE_API_KEY is set so paid models stay eligible;
      // free is evidence that zen free models exist (display / free-tier presence).
      if (
        hasAnyKey(KNOWN_DIRECT_PROVIDER_KEYS.opencode ?? [], params.env) ||
        auth.has('opencode')
      ) {
        // auth.json always lists opencode for zen; only elevate to authenticated when key present
        if (hasAnyKey(KNOWN_DIRECT_PROVIDER_KEYS.opencode ?? [], params.env)) {
          out[providerId] = 'authenticated'
          continue
        }
      }
      const hasZen = params.modelIds.some(
        (id) => getProviderId(id) === 'opencode' && params.zenFreeAllowlist.includes(id),
      )
      out[providerId] = hasZen ? 'free' : 'unknown'
      continue
    }
    const keys = KNOWN_DIRECT_PROVIDER_KEYS[providerId]
    if (keys && hasAnyKey(keys, params.env)) {
      out[providerId] = 'authenticated'
      continue
    }
    if (auth.has(providerId)) {
      out[providerId] = 'authenticated'
      continue
    }
    if (keys) {
      out[providerId] = 'unknown'
      continue
    }
    out[providerId] = 'unknown'
  }
  return out
}

export function evaluateModelEligibility(input: EligibilityInput): EligibilityResult {
  const modelId = input.modelId.trim()
  const providerId = getProviderId(modelId)
  const evidence = input.providers[providerId] ?? 'unknown'
  // An explicit provider disable is authoritative. It must override even the
  // built-in Zen allowlist; otherwise UI/pin/execute disagree with OpenCode config.
  if (evidence === 'disabled') {
    return { eligible: false, errorCode: 'MODEL_PROVIDER_UNAVAILABLE', providerId, evidence }
  }
  // Zen free allowlist is the only execute path when candidates are empty (fail-closed otherwise).
  if (input.zenFreeAllowlist.includes(modelId)) {
    return {
      eligible: true,
      reason: 'zen_free',
      providerId,
      evidence: evidence === 'free' || evidence === 'unknown' ? 'free' : evidence,
    }
  }
  const inCandidates = input.candidates.some((m) => m.modelId === modelId)
  if (!inCandidates) {
    return { eligible: false, errorCode: 'MODEL_NOT_IN_CANDIDATES', providerId, evidence }
  }
  if (providerId === 'openrouter') {
    if (evidence !== 'authenticated') {
      return { eligible: false, errorCode: 'MODEL_PROVIDER_UNAVAILABLE', providerId, evidence }
    }
    if (input.purpose === 'shortlist') {
      return { eligible: false, errorCode: 'MODEL_OPENROUTER_SEARCH_ONLY', providerId, evidence }
    }
    return {
      eligible: true,
      reason:
        input.purpose === 'pin' || input.purpose === 'execute'
          ? 'pinned_openrouter'
          : 'openrouter_authenticated',
      providerId,
      evidence,
    }
  }
  if (evidence === 'authenticated') {
    return { eligible: true, reason: 'direct_authenticated', providerId, evidence }
  }
  return { eligible: false, errorCode: 'MODEL_SELECTION_UNVERIFIED', providerId, evidence }
}

export function buildShortlistAndSearchIndex(params: {
  candidates: WorkerModelOption[]
  providers: Record<string, ProviderEvidence>
  zenFreeAllowlist: string[]
  pinnedModel?: string | null
}): { shortlist: WorkerModelOption[]; searchIndex: WorkerModelOption[] } {
  const shortlist: WorkerModelOption[] = []
  const searchIndex: WorkerModelOption[] = []
  const seen = new Set<string>()
  const pin = params.pinnedModel?.trim()
  if (pin) {
    const er = evaluateModelEligibility({
      modelId: pin,
      candidates: params.candidates,
      providers: params.providers,
      zenFreeAllowlist: params.zenFreeAllowlist,
      purpose: 'pin',
    })
    const m = params.candidates.find((c) => c.modelId === pin)
    if (er.eligible && m && !seen.has(pin)) {
      seen.add(pin)
      shortlist.push({ ...m, group: 'shortlist' })
    }
  }
  for (const m of params.candidates) {
    const erShort = evaluateModelEligibility({
      modelId: m.modelId,
      candidates: params.candidates,
      providers: params.providers,
      zenFreeAllowlist: params.zenFreeAllowlist,
      purpose: 'shortlist',
    })
    if (erShort.eligible && !seen.has(m.modelId)) {
      seen.add(m.modelId)
      shortlist.push({ ...m, group: 'shortlist' })
    }
    const erSearch = evaluateModelEligibility({
      modelId: m.modelId,
      candidates: params.candidates,
      providers: params.providers,
      zenFreeAllowlist: params.zenFreeAllowlist,
      purpose: 'search',
    })
    if (erSearch.eligible) {
      searchIndex.push({
        ...m,
        group: getProviderId(m.modelId) === 'openrouter' ? 'openrouter' : m.group,
      })
    }
  }
  return { shortlist, searchIndex }
}

export interface ValidateModelPinResult {
  ok: boolean
  errorCode?: NonNullable<EligibilityResult['errorCode']> | 'MODEL_REFRESH_FAILED'
  error?: string
}

/**
 * Pin validation shared by worker pin API and callers with an empty catalog.
 * Empty candidates → fail closed unless model is on zen free allowlist.
 */
export function validateModelPin(params: {
  modelId: string
  candidates: WorkerModelOption[]
  providers: Record<string, ProviderEvidence>
  zenFreeAllowlist: string[]
}): ValidateModelPinResult {
  const trimmed = typeof params.modelId === 'string' ? params.modelId.trim() : ''
  if (!trimmed) return { ok: true }

  if (params.candidates.length === 0) {
    const result = evaluateModelEligibility({
      modelId: trimmed,
      candidates: [],
      providers: params.providers,
      zenFreeAllowlist: params.zenFreeAllowlist,
      purpose: 'pin',
    })
    if (result.eligible) return { ok: true }
    if (result.errorCode === 'MODEL_PROVIDER_UNAVAILABLE') {
      return {
        ok: false,
        errorCode: result.errorCode,
        error: `Model "${trimmed}" is not eligible to pin: ${result.errorCode}`,
      }
    }
    return {
      ok: false,
      errorCode: 'MODEL_REFRESH_FAILED',
      error: `Cannot verify model "${trimmed}" without a model catalog; refresh models first`,
    }
  }

  const er = evaluateModelEligibility({
    modelId: trimmed,
    candidates: params.candidates,
    providers: params.providers,
    zenFreeAllowlist: params.zenFreeAllowlist,
    purpose: 'pin',
  })
  if (er.eligible) return { ok: true }
  return {
    ok: false,
    errorCode: er.errorCode,
    error: `Model "${trimmed}" is not eligible to pin: ${er.errorCode ?? 'unknown'}`,
  }
}

/**
 * Execute-time eligibility candidates: prefer full searchIndex (includes OpenRouter)
 * over UI shortlist so pin/search/execute share the same eligibility set.
 */
export function resolveEligibilityCandidates(
  worker: { availableModels?: WorkerModelOption[] | null },
  catalog?: {
    searchIndex?: WorkerModelOption[] | null
    /** Full ACP candidate IDs when shortlist/search exclude disabled */
    rawCandidateIds?: string[] | null
  } | null,
): WorkerModelOption[] | undefined {
  // Prefer raw candidate membership (pin checks) over shortlist-filtered searchIndex
  if (catalog?.rawCandidateIds && catalog.rawCandidateIds.length > 0) {
    const byId = new Map((catalog.searchIndex ?? []).map((m) => [m.modelId, m]))
    return catalog.rawCandidateIds.map((modelId) => byId.get(modelId) ?? { modelId, name: modelId })
  }
  // Prefer full search index (includes OpenRouter)
  if (catalog?.searchIndex && catalog.searchIndex.length > 0) {
    return catalog.searchIndex.map((m) => ({ ...m }))
  }
  // Explicit empty searchIndex with defined catalog → empty candidates (fail-closed)
  if (catalog && Array.isArray(catalog.searchIndex)) {
    return []
  }
  if (worker.availableModels && worker.availableModels.length > 0) {
    return worker.availableModels.map((m) => ({ ...m }))
  }
  if (worker.availableModels && worker.availableModels.length === 0) {
    return []
  }
  return undefined
}

/**
 * Single evidence builder for discovery / pin / dispatch.
 * Merges catalog providers with live env + optional OpenCode auth/disabled.
 */
export function buildCurrentEligibilityEvidence(params: {
  modelIds: string[]
  env: Record<string, string | undefined>
  zenFreeAllowlist: string[]
  catalogProviders?: Record<string, ProviderEvidence>
  authProviders?: Iterable<string>
  disabledProviders?: Iterable<string>
}): Record<string, ProviderEvidence> {
  const live = buildProviderEvidenceMap({
    modelIds: params.modelIds,
    env: params.env,
    zenFreeAllowlist: params.zenFreeAllowlist,
    authProviders: params.authProviders,
    disabledProviders: params.disabledProviders,
  })
  const out: Record<string, ProviderEvidence> = {
    ...(params.catalogProviders ?? {}),
  }
  // Live evidence only upgrades/overrides with concrete signals. `unknown` is
  // "no env key / no auth store match" — for generic ACP workers (claude/codex
  // etc.) it must NOT clobber discovery evidence, or dispatch degrades
  // authenticated → MODEL_SELECTION_UNVERIFIED.
  for (const [k, v] of Object.entries(live)) {
    if (v !== 'unknown') out[k] = v
    else if (!(k in out)) out[k] = v
  }
  return out
}

/**
 * @deprecated Pins must not pollute availableModels. Prefer resolvePinState.
 * Only projects an *eligible* pin into the shortlist (never disabled/unknown).
 */
export function projectPinIntoAvailableModels(
  availableModels: WorkerModelOption[] | undefined | null,
  pinModelId: string | null | undefined,
  searchIndex?: WorkerModelOption[] | null,
  opts?: {
    candidates?: WorkerModelOption[]
    providers?: Record<string, ProviderEvidence>
    zenFreeAllowlist?: string[]
  },
): WorkerModelOption[] | undefined {
  const pin = typeof pinModelId === 'string' ? pinModelId.trim() : ''
  const list = availableModels?.length ? availableModels.map((m) => ({ ...m })) : []
  if (!pin) return list.length ? list : undefined
  if (list.some((m) => m.modelId === pin)) return list

  // When eligibility context is available, only project eligible pins
  if (opts?.candidates && opts?.providers && opts.zenFreeAllowlist) {
    const er = evaluateModelEligibility({
      modelId: pin,
      candidates: opts.candidates,
      providers: opts.providers,
      zenFreeAllowlist: opts.zenFreeAllowlist,
      purpose: 'pin',
    })
    if (!er.eligible) return list.length ? list : undefined
  }

  const fromSearch = searchIndex?.find((m) => m.modelId === pin)
  if (!fromSearch && opts?.candidates) {
    // Pin not in candidates → do not pollute shortlist
    return list.length ? list : undefined
  }
  const entry: WorkerModelOption = fromSearch
    ? { ...fromSearch, group: 'shortlist' }
    : { modelId: pin, name: pin, group: 'shortlist' }
  return [entry, ...list]
}

export type PinStateStatus = 'available' | 'unavailable' | 'unknown'

export interface ResolvedPinState {
  modelId: string
  status: PinStateStatus
  reasonCode?: string
}

/**
 * Resolve pin availability without injecting into shortlist.
 * Empty candidates → unknown (cannot verify).
 */
export function resolvePinState(params: {
  modelId: string | null | undefined
  candidates: WorkerModelOption[]
  providers: Record<string, ProviderEvidence>
  zenFreeAllowlist: string[]
}): ResolvedPinState | undefined {
  const pin = typeof params.modelId === 'string' ? params.modelId.trim() : ''
  if (!pin) return undefined
  if (params.candidates.length === 0) {
    return { modelId: pin, status: 'unknown', reasonCode: 'MODEL_REFRESH_FAILED' }
  }
  const er = evaluateModelEligibility({
    modelId: pin,
    candidates: params.candidates,
    providers: params.providers,
    zenFreeAllowlist: params.zenFreeAllowlist,
    purpose: 'pin',
  })
  if (er.eligible) return { modelId: pin, status: 'available' }
  return {
    modelId: pin,
    status: 'unavailable',
    reasonCode: er.errorCode ?? 'MODEL_SELECTION_UNVERIFIED',
  }
}
