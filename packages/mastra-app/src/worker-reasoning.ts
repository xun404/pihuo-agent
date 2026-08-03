import type {
  WorkerModelCatalog,
  WorkerReasoningSelector,
  WorkerReasoningCatalogEntry,
  WorkerRegistration,
} from '@swarmdesk-agent/shared'
import { getWorkerModelCatalogStore } from '@swarmdesk-agent/core'
import { listAcpReasoningOptions } from '@swarmdesk-agent/adapters'
import type { ListAcpReasoningOptionsResult } from '@swarmdesk-agent/adapters'

function nowISO(): string {
  return new Date().toISOString()
}

function reasoningModelKey(model?: string): string {
  return model?.trim() || '__default__'
}

export interface ReasoningOptionsResult {
  ok: boolean
  supported: boolean
  selector?: WorkerReasoningSelector
  cached: boolean
  stale: boolean
  errorCode?: string
  error?: string
}

/**
 * Look up a reasoning catalog entry for worker+model.
 * When a project scope has no entry, fall back to the global catalog so
 * discovery written under the other key still validates execution config.
 */
export function reasoningEntryFromCatalog(
  workerId: string,
  model?: string,
  scopeKey?: string | null,
): WorkerReasoningCatalogEntry | undefined {
  const key = reasoningModelKey(model)
  const store = getWorkerModelCatalogStore()
  const scoped = store.get(workerId, scopeKey)
  if (scoped?.reasoning?.[key]) return scoped.reasoning[key]
  if (scopeKey) {
    const global = store.get(workerId)
    if (global?.reasoning?.[key]) return global.reasoning[key]
  }
  return undefined
}

/**
 * Persist a successful/failed reasoning entry onto the catalog for this scope.
 * Creates a reasoning-only shell when no model catalog exists yet so later
 * evaluateWorkerReasoningSelection can see the discovery result.
 * (Pin validation already ignores shells without model candidates.)
 */
export function putReasoningCatalogEntry(
  workerId: string,
  model: string | undefined,
  entry: WorkerReasoningCatalogEntry,
  scopeKey?: string | null,
): void {
  const store = getWorkerModelCatalogStore()
  const key = reasoningModelKey(model)
  const scoped = store.get(workerId, scopeKey)
  const global = scopeKey ? store.get(workerId) : undefined
  const base: WorkerModelCatalog | undefined = scoped ?? (!scopeKey ? global : undefined)

  if (base) {
    store.put({
      ...base,
      version: 2,
      reasoning: {
        ...(base.reasoning ?? {}),
        [key]: entry,
      },
    })
    return
  }

  // Prefer writing onto an existing global catalog when scoped is missing,
  // so model membership is not clobbered by a reasoning-only scoped shell.
  if (scopeKey && global) {
    store.put({
      ...global,
      version: 2,
      reasoning: {
        ...(global.reasoning ?? {}),
        [key]: entry,
      },
    })
  }

  // Materialize the target scope key so scoped reads hit immediately.
  store.put({
    version: 2,
    workerId,
    scopeKey: scopeKey?.trim() || undefined,
    source: 'acp_config_options',
    fetchedAt: entry.fetchedAt,
    expiresAt: entry.expiresAt,
    providers: [],
    shortlist: [],
    searchIndex: [],
    reasoning: { [key]: entry },
  })
}

function isEntryFresh(entry: WorkerReasoningCatalogEntry): boolean {
  try {
    return Date.parse(entry.expiresAt) > Date.now()
  } catch {
    return false
  }
}

export function buildSuccessfulReasoningCatalogEntry(
  model: string | undefined,
  result: Pick<ListAcpReasoningOptionsResult, 'supported' | 'selector'>,
  fetchedAt = nowISO(),
): WorkerReasoningCatalogEntry {
  return {
    model: model?.trim() || undefined,
    supported: result.supported,
    selector: result.selector,
    fetchedAt,
    expiresAt: new Date(Date.parse(fetchedAt) + 30 * 60_000).toISOString(),
    lastSuccessfulFetchedAt: fetchedAt,
  }
}

export function markReasoningCatalogEntryFailed(
  cached: WorkerReasoningCatalogEntry,
  errorCode: string,
): WorkerReasoningCatalogEntry {
  return {
    ...cached,
    lastErrorCode: errorCode,
  }
}

export function publicReasoningDiscoveryError(_error?: unknown): string {
  return 'Failed to discover ACP reasoning options.'
}

export async function getWorkerReasoningOptions(input: {
  workerId: string
  model?: string
  cwd?: string
  force?: boolean
  scopeKey?: string | null
}): Promise<ReasoningOptionsResult> {
  const { workerId, model, force } = input

  if (!workerId) {
    return {
      ok: false,
      supported: false,
      cached: false,
      stale: false,
      errorCode: 'ACP_REASONING_UNSUPPORTED',
      error: 'Worker ID required',
    }
  }

  // Check cached entry first
  const cached = reasoningEntryFromCatalog(workerId, model, input.scopeKey)
  const cachedFresh = cached && isEntryFresh(cached)

  if (cachedFresh && !force) {
    return {
      ok: true,
      supported: cached.supported,
      selector: cached.selector,
      cached: true,
      stale: false,
    }
  }

  // Need to load worker to resolve command/args/env
  // Return stale cache if available and not forced refresh
  if (cached && !force) {
    return {
      ok: true,
      supported: cached.supported,
      selector: cached.selector,
      cached: true,
      stale: true,
    }
  }

  return {
    ok: false,
    supported: false,
    cached: false,
    stale: false,
    errorCode: 'ACP_REASONING_UNSUPPORTED',
    error: 'Worker reasoning options are not cached and no Worker instance was provided',
  }
}

export async function getWorkerReasoningOptionsWithWorker(
  worker: Pick<WorkerRegistration, 'id' | 'name' | 'command' | 'args' | 'env' | 'kind'>,
  model?: string,
  opts?: { cwd?: string; force?: boolean; scopeKey?: string | null },
): Promise<ReasoningOptionsResult> {
  const { force, scopeKey } = opts ?? {}

  // Check cache first
  const cached = reasoningEntryFromCatalog(worker.id, model, scopeKey)
  const cachedFresh = cached && isEntryFresh(cached)

  if (cachedFresh && !force) {
    return {
      ok: true,
      supported: cached.supported,
      selector: cached.selector,
      cached: true,
      stale: false,
    }
  }

  // Live discovery
  const result = await listAcpReasoningOptions(worker, model, { cwd: opts?.cwd })

  // Cache successful discovery so later execution-config / team-member validation
  // can resolve the value without requiring a second fetch race.
  if (result.ok) {
    const fetchedAt = nowISO()
    const entry = buildSuccessfulReasoningCatalogEntry(model, result, fetchedAt)
    try {
      putReasoningCatalogEntry(worker.id, model, entry, scopeKey)
    } catch {
      // Non-critical: cache write failure should not fail the request
    }
    return {
      ok: true,
      supported: result.supported,
      selector: result.selector,
      cached: false,
      stale: false,
    }
  }

  // Discovery failed: return stale cache if available
  if (cached) {
    const errorCode = 'ACP_REASONING_CONFIGURATION_FAILED'
    try {
      putReasoningCatalogEntry(
        worker.id,
        model,
        markReasoningCatalogEntryFailed(cached, errorCode),
        scopeKey,
      )
    } catch {
      // Non-critical: stale last-known-good data remains usable in memory.
    }
    return {
      ok: true,
      supported: cached.supported,
      selector: cached.selector,
      cached: true,
      stale: true,
      errorCode,
      error: publicReasoningDiscoveryError(result.error),
    }
  }

  return {
    ok: false,
    supported: false,
    cached: false,
    stale: false,
    errorCode: 'ACP_REASONING_CONFIGURATION_FAILED',
    error: publicReasoningDiscoveryError(result.error),
  }
}

export function evaluateWorkerReasoningSelection(
  workerId: string,
  model: string | undefined,
  reasoning: string | undefined,
  opts?: { scopeKey?: string | null },
): { ok: boolean; errorCode?: string; error?: string } {
  if (!reasoning?.trim()) return { ok: true }

  const entry = reasoningEntryFromCatalog(workerId, model, opts?.scopeKey)

  if (!entry) {
    return {
      ok: false,
      errorCode: 'ACP_REASONING_UNSUPPORTED',
      error: 'Reasoning options are not loaded for this worker/model yet. Try again after options load.',
    }
  }

  if (!entry.supported) {
    return {
      ok: false,
      errorCode: 'ACP_REASONING_UNSUPPORTED',
      error: 'ACP reasoning is not supported for this worker/model configuration.',
    }
  }

  if (!entry.selector?.options.some((o) => o.value === reasoning.trim())) {
    return {
      ok: false,
      errorCode: 'ACP_REASONING_VALUE_UNAVAILABLE',
      error: `The selected reasoning value "${reasoning}" is not available for the current model.`,
    }
  }

  return { ok: true }
}

function evaluateAgainstSelector(
  reasoning: string,
  discovery: Pick<ReasoningOptionsResult, 'ok' | 'supported' | 'selector' | 'error' | 'errorCode'>,
): { ok: boolean; errorCode?: string; error?: string } {
  if (!discovery.ok) {
    return {
      ok: false,
      errorCode: discovery.errorCode ?? 'ACP_REASONING_CONFIGURATION_FAILED',
      error: discovery.error ?? publicReasoningDiscoveryError(),
    }
  }
  if (!discovery.supported) {
    return {
      ok: false,
      errorCode: 'ACP_REASONING_UNSUPPORTED',
      error: 'ACP reasoning is not supported for this worker/model configuration.',
    }
  }
  if (!discovery.selector?.options.some((option) => option.value === reasoning.trim())) {
    return {
      ok: false,
      errorCode: 'ACP_REASONING_VALUE_UNAVAILABLE',
      error: `The selected reasoning value "${reasoning.trim()}" is not available for the current model.`,
    }
  }
  return { ok: true }
}

/**
 * Validate a reasoning selection, auto-fetching ACP options when the catalog
 * has no entry yet (common after model pin before the first options load).
 * Validates against the live discovery result even if catalog persistence fails.
 */
export async function ensureWorkerReasoningSelection(
  worker: Pick<WorkerRegistration, 'id' | 'name' | 'command' | 'args' | 'env' | 'kind'>,
  model: string | undefined,
  reasoning: string | undefined,
  opts?: { cwd?: string; scopeKey?: string | null },
): Promise<{ ok: boolean; errorCode?: string; error?: string }> {
  if (!reasoning?.trim()) return { ok: true }

  const first = evaluateWorkerReasoningSelection(worker.id, model, reasoning, {
    scopeKey: opts?.scopeKey,
  })
  if (first.ok) return first
  // Only auto-fetch when catalog is missing; unsupported / bad value are final.
  if (first.errorCode !== 'ACP_REASONING_UNSUPPORTED') return first
  if (reasoningEntryFromCatalog(worker.id, model, opts?.scopeKey)) return first

  const discovery = await getWorkerReasoningOptionsWithWorker(worker, model, {
    cwd: opts?.cwd,
    force: true,
    scopeKey: opts?.scopeKey,
  })

  const fromCatalog = evaluateWorkerReasoningSelection(worker.id, model, reasoning, {
    scopeKey: opts?.scopeKey,
  })
  if (fromCatalog.ok) return fromCatalog

  // Catalog write can fail (lock/corrupt); still accept a live-valid selection.
  return evaluateAgainstSelector(reasoning, discovery)
}
