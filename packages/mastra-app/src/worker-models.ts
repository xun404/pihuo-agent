import {
  listAcpModels,
  applyHealthReport,
  validateModelPin,
  buildProviderEvidenceMap,
  resolveEligibilityCandidates,
  resolvePinState,
  OPENCODE_ZEN_FREE_MODELS,
  resolveWorkerModelsTimeoutMs,
  type ListAcpModelsResult,
  type ProviderEvidence,
  type ResolvedPinState,
} from '@router-agents/adapters'
import {
  getSharedStore,
  getWorkerModelCatalogStore,
  type LocalStore,
  type WorkerModelCatalogStore,
} from '@router-agents/core'
import type {
  ModelCatalogState,
  WorkerModelCatalog,
  WorkerModelOption,
  WorkerRegistration,
  ProviderEvidenceState,
  WorkerModelPinState,
} from '@router-agents/shared'
import {
  isModelCacheFresh,
  workerModelCatalogStorageKey,
  WORKER_MODELS_TTL_MS,
} from '@router-agents/shared'
import { createHash } from 'node:crypto'
import { existsSync, realpathSync } from 'node:fs'
import { resolve as pathResolve } from 'node:path'

const DEFAULT_CATALOG_TTL_MS = WORKER_MODELS_TTL_MS
const BACKOFF_MS = [30_000, 120_000, 600_000] as const

/**
 * Canonical project/cwd scope for model catalogs.
 * Empty when cwd is missing → global (legacy workerId-only) slot.
 */
export function resolveModelCatalogScopeKey(cwd?: string | null): string {
  const raw = cwd?.trim()
  if (!raw) return ''
  try {
    const abs = pathResolve(raw)
    const real = existsSync(abs) ? realpathSync(abs) : abs
    return createHash('sha256').update(real).digest('hex').slice(0, 16)
  } catch {
    return createHash('sha256').update(raw).digest('hex').slice(0, 16)
  }
}

function flightKey(workerId: string, scopeKey: string): string {
  return workerModelCatalogStorageKey(workerId, scopeKey || undefined)
}

export type ListModelsFn = (
  worker: Pick<WorkerRegistration, 'id' | 'name' | 'command' | 'args' | 'env' | 'kind' | 'model'>,
  opts?: { cwd?: string; timeoutMs?: number },
) => Promise<ListAcpModelsResult>

export interface RefreshModelsResult {
  ok: boolean
  models: WorkerRegistration['availableModels']
  error?: string
  errorCode?: string
  worker: WorkerRegistration
  cached: boolean
  stale: boolean
  searchIndex?: WorkerModelOption[]
  catalog?: WorkerModelCatalog
  catalogState?: ModelCatalogState
  /** Pin availability — never injected into models/shortlist when unavailable */
  currentPinState?: WorkerModelPinState
}

export interface GetWorkerModelsOpts {
  workerId: string
  cwd?: string
  force?: boolean
  q?: string
  limit?: number
  now?: number
  listModels?: ListModelsFn
  store?: LocalStore
  catalogStore?: WorkerModelCatalogStore
}

type FailState = { count: number; nextAllowedAt: number }

const inFlight = new Map<string, Promise<RefreshModelsResult>>()
const failCounts = new Map<string, FailState>()

export function resetWorkerModelsCacheControllerForTests(): void {
  inFlight.clear()
  failCounts.clear()
}

function providersToArray(
  providers: Record<string, ProviderEvidence> | undefined,
): WorkerModelCatalog['providers'] {
  if (!providers) return []
  return Object.entries(providers).map(([providerId, state]) => ({
    providerId,
    state: state as ProviderEvidenceState,
  }))
}

function providersToRecord(
  providers: WorkerModelCatalog['providers'] | undefined,
): Record<string, ProviderEvidence> {
  const out: Record<string, ProviderEvidence> = {}
  for (const p of providers ?? []) {
    out[p.providerId] = p.state
  }
  return out
}

function resolvePorts(opts: GetWorkerModelsOpts) {
  return {
    store: opts.store ?? getSharedStore(),
    catalogStore: opts.catalogStore ?? getWorkerModelCatalogStore(),
    listModels: opts.listModels ?? listAcpModels,
  }
}

function resolveCatalogState(
  worker: WorkerRegistration,
  catalog: WorkerModelCatalog | undefined,
  nowMs: number,
  opts?: { ignoreWorkerRow?: boolean },
): ModelCatalogState {
  // Catalog row present (even empty shortlist) is not "empty"
  const hasCatalog = Boolean(catalog)
  // Project-scoped lookups must not treat global worker.availableModels as cache for that project
  const hasLegacyModels = opts?.ignoreWorkerRow ? false : worker.availableModels != null
  const legacyFetched = opts?.ignoreWorkerRow ? undefined : worker.modelsFetchedAt
  if (!hasCatalog && !hasLegacyModels && !legacyFetched) return 'empty'
  // Legacy availableModels without v1 catalog = always stale until refresh
  if (!hasCatalog && (hasLegacyModels || legacyFetched)) return 'stale'
  const fetchedAt = catalog?.fetchedAt ?? legacyFetched
  if (isModelCacheFresh(fetchedAt, WORKER_MODELS_TTL_MS, nowMs)) return 'fresh'
  return 'stale'
}

function pinStateFrom(
  worker: WorkerRegistration,
  catalog: WorkerModelCatalog | undefined,
): WorkerModelPinState | undefined {
  const candidates = resolveEligibilityCandidates(worker, catalog) ?? []
  let providers = providersToRecord(catalog?.providers)
  if (Object.keys(providers).length === 0 && candidates.length > 0) {
    providers = buildProviderEvidenceMap({
      modelIds: candidates.map((m) => m.modelId),
      env: { ...process.env, ...worker.env } as Record<string, string | undefined>,
      zenFreeAllowlist: [...OPENCODE_ZEN_FREE_MODELS],
    })
  }
  const resolved: ResolvedPinState | undefined = resolvePinState({
    modelId: worker.model,
    candidates,
    providers,
    zenFreeAllowlist: [...OPENCODE_ZEN_FREE_MODELS],
  })
  return resolved
}

function cachedResult(
  worker: WorkerRegistration,
  catalog: WorkerModelCatalog | undefined,
  catalogState: ModelCatalogState,
  opts: { ok: boolean; error?: string; errorCode?: string },
): RefreshModelsResult {
  // Prefer scoped catalog shortlist; only fall back to worker row for global unscoped
  const models = catalog?.shortlist ?? (catalog?.scopeKey ? [] : worker.availableModels)
  return {
    ok: opts.ok,
    models: models ?? [],
    error: opts.error,
    errorCode: opts.errorCode,
    worker,
    cached: true,
    stale: catalogState !== 'fresh',
    searchIndex: catalog?.searchIndex,
    catalog,
    catalogState,
    currentPinState: pinStateFrom(worker, catalog),
  }
}

function recordFailure(workerId: string, nowMs: number): void {
  const prev = failCounts.get(workerId)
  const count = (prev?.count ?? 0) + 1
  const idx = Math.min(count - 1, BACKOFF_MS.length - 1)
  const delay = BACKOFF_MS[idx]!
  failCounts.set(workerId, { count, nextAllowedAt: nowMs + delay })
}

function clearFailure(workerId: string): void {
  failCounts.delete(workerId)
}

function isBackoffActive(workerId: string, nowMs: number): boolean {
  const state = failCounts.get(workerId)
  if (!state) return false
  return nowMs < state.nextAllowedAt
}

/**
 * Perform one model catalog refresh (no SWR short-circuit).
 * Preserves worker.model pin on success/failure.
 */
async function executeRefresh(
  workerId: string,
  cwd: string | undefined,
  nowMs: number,
  ports: ReturnType<typeof resolvePorts>,
): Promise<RefreshModelsResult> {
  const { store, catalogStore, listModels } = ports
  const worker = store.listWorkers().find((w) => w.id === workerId)
  if (!worker) throw new Error(`Worker not found: ${workerId}`)

  const scopeKey = resolveModelCatalogScopeKey(cwd)
  const fk = flightKey(workerId, scopeKey)
  // Project-scoped catalogs must not clobber the global worker.availableModels row
  const writeWorkerRow = !scopeKey

  const checkedAt = new Date(nowMs).toISOString()
  let result: ListAcpModelsResult
  try {
    result = await listModels(worker, {
      cwd,
      timeoutMs: resolveWorkerModelsTimeoutMs(),
    })
  } catch (e) {
    const safeError = (e instanceof Error ? e.message : String(e)).slice(0, 200)
    recordFailure(fk, nowMs)
    const existing = catalogStore.get(workerId, scopeKey || undefined)
    return {
      ok: false,
      models: existing?.shortlist ?? (writeWorkerRow ? worker.availableModels : undefined) ?? [],
      error: safeError,
      errorCode: 'ACP_MODELS',
      worker,
      cached: Boolean(existing),
      stale: true,
      catalog: existing,
      catalogState: existing ? 'stale' : 'empty',
    }
  }
  const existingCat = catalogStore.get(workerId, scopeKey || undefined)
  const hadCache = Boolean(
    existingCat || (writeWorkerRow && (worker.modelsFetchedAt || worker.availableModels != null)),
  )
  const pin = worker.model

  // Distinguish undefined shortlistModels (legacy: fall back to models) from []
  // (eligibility produced empty shortlist — keep empty, never dump full catalog).
  if (result.ok) {
    const shortlist = result.shortlistModels !== undefined ? result.shortlistModels : result.models
    const searchIndex = result.searchIndex !== undefined ? result.searchIndex : result.models
    const providers = result.providers ?? {}
    const rawCandidateIds = (result.models ?? []).map((m) => m.modelId)
    const evidenceRevision = Object.entries(providers)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, st]) => `${id}:${st}`)
      .join('|')
    const expiresAt = new Date(nowMs + DEFAULT_CATALOG_TTL_MS).toISOString()
    let projectRoot: string | undefined
    try {
      if (cwd?.trim()) {
        const abs = pathResolve(cwd.trim())
        projectRoot = existsSync(abs) ? realpathSync(abs) : abs
      }
    } catch {
      projectRoot = cwd?.trim() || undefined
    }
    const catalog: WorkerModelCatalog = {
      version: 2,
      workerId,
      scopeKey: scopeKey || undefined,
      projectRoot,
      source: 'acp_config_options',
      fetchedAt: checkedAt,
      expiresAt,
      providers: providersToArray(providers),
      shortlist,
      searchIndex,
      rawCandidateIds,
      evidenceRevision,
      lastSuccessfulFetchedAt: checkedAt,
      lastErrorCode: undefined,
    }
    catalogStore.put(catalog)
    clearFailure(fk)

    // Only update worker row for global (unscoped) refresh — never let project A
    // catalog become project B's availableModels.
    if (writeWorkerRow) {
      store.upsertWorker(
        applyHealthReport(
          {
            ...worker,
            model: pin,
            availableModels: shortlist,
            modelsFetchedAt: checkedAt,
            modelsState: 'fresh',
            modelCatalogState: 'fresh',
            modelsError: undefined,
          },
          {
            status: 'healthy',
            level: 'acp_handshake',
            checkedAt,
            message: `ACP 可用 · ${shortlist.length} 个短名单模型 (configOptions)`,
            hints: [],
          },
        ),
      )
    }
    const updated = store.listWorkers().find((w) => w.id === workerId) ?? worker
    const currentPinState = resolvePinState({
      modelId: pin,
      candidates: searchIndex.length ? searchIndex : shortlist,
      providers,
      zenFreeAllowlist: [...OPENCODE_ZEN_FREE_MODELS],
    })
    return {
      ok: true,
      models: shortlist,
      worker: updated,
      cached: false,
      stale: false,
      searchIndex,
      catalog,
      catalogState: 'fresh',
      currentPinState,
    }
  }

  const safeError = (result.error ?? 'Model refresh failed').slice(0, 500)
  recordFailure(fk, nowMs)

  if (!result.ok && hadCache) {
    if (writeWorkerRow) {
      const staleWorker = store.setWorkerModelsStale(workerId, safeError)
      store.upsertWorker(
        applyHealthReport(
          {
            ...staleWorker,
            model: pin ?? staleWorker.model,
            modelCatalogState: 'stale',
          },
          {
            status: 'unhealthy',
            level: 'acp_handshake',
            checkedAt,
            message: safeError,
            hints: ['可稍后重试「更新模型列表」', '或手动填写 model id'],
            detail: { errorCode: 'ACP_MODELS' },
          },
        ),
      )
    }
    const existing = catalogStore.get(workerId, scopeKey || undefined)
    if (existing) {
      catalogStore.put({
        ...existing,
        lastErrorCode: 'ACP_MODELS',
      })
    }
    const updated = store.listWorkers().find((w) => w.id === workerId) ?? worker
    return {
      ok: false,
      models: existing?.shortlist ?? worker.availableModels ?? [],
      error: safeError,
      errorCode: 'ACP_MODELS',
      worker: updated,
      cached: true,
      stale: true,
      searchIndex: existing?.searchIndex,
      catalog: existing,
      catalogState: 'stale',
    }
  }

  if (writeWorkerRow) {
    const staleWorker2 = store.setWorkerModelsStale(workerId, safeError)
    store.upsertWorker(
      applyHealthReport(
        {
          ...staleWorker2,
          model: pin ?? staleWorker2.model,
          modelCatalogState: 'empty',
        },
        {
          status: 'unhealthy',
          level: 'acp_handshake',
          checkedAt,
          message: safeError,
          hints: ['可稍后重试「更新模型列表」', '或手动填写 model id'],
          detail: { errorCode: 'ACP_MODELS' },
        },
      ),
    )
  }
  const updated = store.listWorkers().find((w) => w.id === workerId) ?? worker
  return {
    ok: false,
    models: [],
    error: safeError,
    errorCode: 'ACP_MODELS',
    worker: updated,
    cached: false,
    stale: true,
    catalogState: 'empty',
  }
}

function beginRefresh(
  workerId: string,
  cwd: string | undefined,
  nowMs: number,
  ports: ReturnType<typeof resolvePorts>,
): Promise<RefreshModelsResult> {
  const scopeKey = resolveModelCatalogScopeKey(cwd)
  const fk = flightKey(workerId, scopeKey)
  const existing = inFlight.get(fk)
  if (existing) return existing

  const promise = executeRefresh(workerId, cwd, nowMs, ports).finally(() => {
    if (inFlight.get(fk) === promise) {
      inFlight.delete(fk)
    }
  })
  inFlight.set(fk, promise)
  return promise
}

/**
 * SWR model catalog access (§7.2):
 * - fresh → return immediately
 * - stale + last-known-good → return stale, background refresh
 * - empty → wait for first refresh (still respects backoff)
 * - force → wait for refresh (bypasses backoff)
 * - single-flight per workerId
 * - backoff 30s / 2m / 10m on consecutive failures for all states
 */
export async function getWorkerModels(
  opts: GetWorkerModelsOpts,
): Promise<RefreshModelsResult & { catalogState: ModelCatalogState }> {
  const nowMs = opts.now ?? Date.now()
  const ports = resolvePorts(opts)
  const { store, catalogStore } = ports
  const worker = store.listWorkers().find((w) => w.id === opts.workerId)
  if (!worker) throw new Error(`Worker not found: ${opts.workerId}`)

  const force = Boolean(opts.force)
  const scopeKey = resolveModelCatalogScopeKey(opts.cwd)
  const fk = flightKey(opts.workerId, scopeKey)
  // Scoped reads must not fall back to unscoped worker.availableModels as "good"
  const allowWorkerRowFallback = !scopeKey

  const safeBackgroundRefresh = (workerId: string, cwd: string | undefined, now: number) => {
    const key = flightKey(workerId, resolveModelCatalogScopeKey(cwd))
    if (isBackoffActive(key, now) || inFlight.has(key)) return
    void beginRefresh(workerId, cwd, now, ports).catch(() => {
      // Detached SWR refresh — never leave unhandled rejection
    })
  }

  if (opts.q?.trim()) {
    const catalog = catalogStore.get(opts.workerId, scopeKey || undefined)
    const catalogState = resolveCatalogState(worker, catalog, nowMs, {
      ignoreWorkerRow: !allowWorkerRowFallback,
    })
    if (force) {
      const refreshed = await beginRefresh(opts.workerId, opts.cwd, nowMs, ports)
      const models = ports.catalogStore.search(
        opts.workerId,
        opts.q,
        opts.limit ?? 50,
        scopeKey || undefined,
      )
      return {
        ...refreshed,
        models,
        cached: false,
        catalogState: refreshed.catalogState ?? 'fresh',
      }
    }
    // Search still goes through SWR: empty waits for refresh; stale/empty trigger background
    if (catalogState === 'empty') {
      if (!isBackoffActive(fk, nowMs)) {
        const refreshed = await beginRefresh(opts.workerId, opts.cwd, nowMs, ports)
        const models = ports.catalogStore.search(
          opts.workerId,
          opts.q,
          opts.limit ?? 50,
          scopeKey || undefined,
        )
        return {
          ok: refreshed.ok,
          models,
          worker: refreshed.worker,
          cached: false,
          stale: false,
          searchIndex: refreshed.searchIndex,
          catalog: refreshed.catalog,
          catalogState: refreshed.catalogState ?? 'fresh',
          currentPinState: refreshed.currentPinState,
          error: refreshed.error,
          errorCode: refreshed.errorCode,
        }
      }
      return {
        ...cachedResult(worker, catalog, 'empty', {
          ok: false,
          error: worker.modelsError ?? 'Model refresh backoff',
          errorCode: catalog?.lastErrorCode ?? 'ACP_MODELS',
        }),
        models: [],
        catalogState: 'empty',
      }
    }
    if (catalogState === 'stale') {
      safeBackgroundRefresh(opts.workerId, opts.cwd, nowMs)
    }
    const models = catalogStore.search(
      opts.workerId,
      opts.q,
      opts.limit ?? 50,
      scopeKey || undefined,
    )
    return {
      ok: true,
      models,
      worker,
      cached: true,
      stale: catalogState !== 'fresh',
      searchIndex: catalog?.searchIndex,
      catalog,
      catalogState,
      currentPinState: pinStateFrom(worker, catalog),
    }
  }

  const catalog = catalogStore.get(opts.workerId, scopeKey || undefined)
  const catalogState = resolveCatalogState(worker, catalog, nowMs, {
    ignoreWorkerRow: !allowWorkerRowFallback,
  })

  if (!force && catalogState === 'fresh') {
    return {
      ...cachedResult(worker, catalog, 'fresh', { ok: true }),
      catalogState: 'fresh',
    }
  }

  if (!force && catalogState === 'stale') {
    // Legal empty shortlist is still last-known-good when a catalog row exists
    const hasGood =
      catalog != null ||
      (allowWorkerRowFallback &&
        (worker.availableModels != null || Boolean(worker.modelsFetchedAt)))
    if (hasGood) {
      safeBackgroundRefresh(opts.workerId, opts.cwd, nowMs)
      return {
        ...cachedResult(worker, catalog, 'stale', {
          ok: true,
          error: worker.modelsError,
          errorCode: catalog?.lastErrorCode,
        }),
        catalogState: 'stale',
      }
    }
  }

  // empty / force / stale-without-good → wait for refresh, but respect backoff for all states
  if (!force && isBackoffActive(fk, nowMs)) {
    return {
      ...cachedResult(worker, catalog, catalogState, {
        ok: false,
        error: worker.modelsError ?? 'Model refresh backoff',
        errorCode: catalog?.lastErrorCode ?? 'ACP_MODELS',
      }),
      catalogState,
    }
  }

  // force bypasses backoff wait for caller, but still single-flight
  const refreshed = await beginRefresh(opts.workerId, opts.cwd, nowMs, ports)
  return {
    ...refreshed,
    catalogState:
      refreshed.catalogState ??
      resolveCatalogState(
        refreshed.worker,
        refreshed.catalog ?? catalogStore.get(opts.workerId, scopeKey || undefined),
        nowMs,
      ),
  }
}

/**
 * Refresh worker model catalog from ACP.
 * Honors `force` via SWR controller; default force=true for explicit refresh callers.
 */
export async function refreshWorkerModels(
  workerId: string,
  cwd?: string,
  opts?: { force?: boolean; now?: number; listModels?: ListModelsFn },
): Promise<RefreshModelsResult> {
  return getWorkerModels({
    workerId,
    cwd,
    force: opts?.force !== false,
    now: opts?.now,
    listModels: opts?.listModels,
  })
}

export function evaluateWorkerModelPin(
  workerId: string,
  modelId: string | null | undefined,
  opts?: {
    cwd?: string
    store?: LocalStore
    catalogStore?: WorkerModelCatalogStore
  },
): {
  ok: boolean
  errorCode?: string
  error?: string
} {
  const trimmed = typeof modelId === 'string' ? modelId.trim() : ''
  if (!trimmed) return { ok: true }

  const store = opts?.store ?? getSharedStore()
  const worker = store.listWorkers().find((w) => w.id === workerId)
  if (!worker) return { ok: false, error: `Worker not found: ${workerId}` }

  const scopeKey = resolveModelCatalogScopeKey(opts?.cwd)
  const catalogStore = opts?.catalogStore ?? getWorkerModelCatalogStore()
  const catalog = catalogStore.get(workerId, scopeKey || undefined)
  const candidates = resolveEligibilityCandidates(worker, catalog) ?? []

  let providers = providersToRecord(catalog?.providers)
  if (Object.keys(providers).length === 0 && candidates.length > 0) {
    providers = buildProviderEvidenceMap({
      modelIds: candidates.map((m) => m.modelId),
      env: { ...process.env, ...worker.env } as Record<string, string | undefined>,
      zenFreeAllowlist: [...OPENCODE_ZEN_FREE_MODELS],
    })
  }
  return validateModelPin({
    modelId: trimmed,
    candidates,
    providers,
    zenFreeAllowlist: [...OPENCODE_ZEN_FREE_MODELS],
  })
}

/** Exact catalog lookup used by dispatch; scoped jobs never fall back to the global row. */
export function getWorkerCatalogForDispatch(
  workerId: string,
  cwd?: string,
  catalogStore: WorkerModelCatalogStore = getWorkerModelCatalogStore(),
): WorkerModelCatalog | undefined {
  const scopeKey = resolveModelCatalogScopeKey(cwd)
  return catalogStore.get(workerId, scopeKey || undefined)
}

/**
 * After a successful pin validation, set pin on worker.
 * Does NOT inject pin into availableModels — shortlist stays eligibility-only.
 */
export function applyWorkerModelPin(
  workerId: string,
  model: string | null | undefined,
): WorkerRegistration {
  const store = getSharedStore()
  const worker = store.listWorkers().find((w) => w.id === workerId)
  if (!worker) throw new Error(`Worker not found: ${workerId}`)
  // Keep existing shortlist unchanged; pin is independent state on worker.model
  return store.setWorkerModel(workerId, model, worker.availableModels)
}

export function getWorkerModelSearchResults(
  workerId: string,
  query: string,
  limit = 50,
  cwd?: string,
): WorkerModelOption[] {
  const scopeKey = resolveModelCatalogScopeKey(cwd)
  return getWorkerModelCatalogStore().search(workerId, query, limit, scopeKey || undefined)
}
