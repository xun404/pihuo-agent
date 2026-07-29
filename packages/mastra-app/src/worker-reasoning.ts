import type { WorkerReasoningSelector, WorkerReasoningCatalogEntry } from '@swarmdesk-agent/shared'
import type { WorkerRegistration } from '@swarmdesk-agent/shared'
import { getWorkerModelCatalogStore } from '@swarmdesk-agent/core'
import { listAcpReasoningOptions } from '@swarmdesk-agent/adapters'
import type { ListAcpReasoningOptionsResult } from '@swarmdesk-agent/adapters'

function nowISO(): string {
  return new Date().toISOString()
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

function reasoningEntryFromCatalog(
  workerId: string,
  model?: string,
  scopeKey?: string | null,
): WorkerReasoningCatalogEntry | undefined {
  const catalog = getWorkerModelCatalogStore().get(workerId, scopeKey)
  if (!catalog?.reasoning) return undefined
  const key = model?.trim() || '__default__'
  return catalog.reasoning[key]
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

  // Update cache if discovery succeeded
  if (result.ok) {
    const fetchedAt = nowISO()
    const entry = buildSuccessfulReasoningCatalogEntry(model, result, fetchedAt)
    try {
      const store = getWorkerModelCatalogStore()
      const cat = store.get(worker.id, scopeKey)
      const catalogEntry = cat
        ? {
            ...cat,
            version: 2 as const,
            reasoning: { ...(cat.reasoning ?? {}), [model?.trim() ?? '__default__']: entry },
          }
        : {
            version: 2 as const,
            workerId: worker.id,
            scopeKey: scopeKey ?? undefined,
            source: 'acp_config_options' as const,
            fetchedAt,
            expiresAt: entry.expiresAt,
            providers: [],
            shortlist: [],
            searchIndex: [],
            reasoning: { [model?.trim() ?? '__default__']: entry },
          }
      store.put(catalogEntry)
    } catch {
      // Non-critical: cache write failure should not fail the request
    }
  }

  if (result.ok) {
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
      const store = getWorkerModelCatalogStore()
      const cat = store.get(worker.id, scopeKey)
      if (cat) {
        store.put({
          ...cat,
          version: 2,
          reasoning: {
            ...(cat.reasoning ?? {}),
            [model?.trim() || '__default__']: markReasoningCatalogEntryFailed(cached, errorCode),
          },
        })
      }
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
      error: `No reasoning information found for worker ${workerId}${model ? ` model ${model}` : ''}. Fetch reasoning options first.`,
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
