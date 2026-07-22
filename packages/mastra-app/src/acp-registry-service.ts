/**
 * Registry catalog service: persisted LKG → bundled → remote refresh.
 * Never returns a forged empty catalog on remote failure.
 */
import {
  AcpRegistrySchemaError,
  BUNDLED_ACP_REGISTRY_ARTIFACTS,
  fetchAcpRegistryCatalogV2,
  parseAcpRegistryCatalogV2,
  projectAgentToWorkerOption,
  resolveAcpRegistryTarget,
  verifyBundledAcpRegistryArtifacts,
  type AcpRegistryCatalog,
  type AcpRegistryWorkerOption,
} from '@swarmdesk-agent/adapters'
import { loadAcpRegistryCatalogStore, saveAcpRegistryCatalogStore } from '@swarmdesk-agent/core'
import type { AcpRegistryCatalogSnapshot } from '@swarmdesk-agent/shared'
import { projectRegistryPublicError } from './acp-registry-public-error.js'

export function loadBundledRegistrySnapshot(): AcpRegistryCatalogSnapshot {
  const verified = verifyBundledAcpRegistryArtifacts()
  const snap = parseAcpRegistryCatalogV2(BUNDLED_ACP_REGISTRY_ARTIFACTS.registry, {
    isolateAgentErrors: true,
    enforceSchemaMajor: true,
  })
  if (snap.digest !== verified.digest || snap.agents.length !== verified.agentCount) {
    throw new AcpRegistrySchemaError(
      'ACP_REGISTRY_ENTRY_INVALID',
      'Bundled ACP Registry release metadata does not match the parsed snapshot',
    )
  }
  return { ...snap, source: 'bundled' }
}

export interface ResolveCatalogResult {
  snapshot: AcpRegistryCatalogSnapshot
  /** Legacy flat projection for current Settings combobox */
  legacy: AcpRegistryCatalog
  stale: boolean
  updateRequired: boolean
  etag?: string
  code?: string
  message?: string
}

export interface RegistryCatalogUpdateResult {
  status: 'updated' | 'up_to_date' | 'failed' | 'update_required'
  catalog: ResolveCatalogResult
}

function toLegacy(snapshot: AcpRegistryCatalogSnapshot): AcpRegistryCatalog {
  const target = resolveAcpRegistryTarget()
  return {
    version: snapshot.version,
    agents: snapshot.agents
      .filter((a) => a.availability !== 'invalid_manifest')
      .map((a) => projectAgentToWorkerOption(a, target)),
  }
}

/**
 * Synchronous local resolve: LKG then bundled. Never empty if bundled exists.
 */
export function resolveLocalRegistryCatalog(): ResolveCatalogResult {
  const lkg = loadAcpRegistryCatalogStore()
  if (lkg?.snapshot?.agents?.length) {
    const snapshot: AcpRegistryCatalogSnapshot = {
      ...lkg.snapshot,
      source: 'persisted',
      stale: true,
    }
    return {
      snapshot,
      legacy: toLegacy(snapshot),
      stale: true,
      updateRequired: false,
      etag: lkg.etag,
    }
  }
  const bundled = loadBundledRegistrySnapshot()
  return {
    snapshot: bundled,
    legacy: toLegacy(bundled),
    stale: false,
    updateRequired: false,
  }
}

/**
 * Background-friendly refresh: uses ETag when available; on failure returns LKG/bundled with stale.
 */
export async function refreshRegistryCatalog(
  options: {
    fetchImpl?: typeof fetch
    signal?: AbortSignal
    timeoutMs?: number
  } = {},
): Promise<ResolveCatalogResult> {
  const local = resolveLocalRegistryCatalog()
  try {
    const remote = await fetchAcpRegistryCatalogV2({
      fetchImpl: options.fetchImpl,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
      etag: local.etag,
    })
    if (remote.notModified) {
      return {
        ...local,
        stale: false,
        snapshot: { ...local.snapshot, stale: false, source: 'persisted' },
      }
    }
    if (!remote.agents.length && !remote.digest) {
      return { ...local, stale: true, code: 'ACP_REGISTRY_UNAVAILABLE' }
    }
    saveAcpRegistryCatalogStore({
      etag: remote.etag,
      fetchedAt: remote.fetchedAt,
      schemaVersion: remote.schemaVersion,
      digest: remote.digest,
      snapshot: remote,
    })
    const snapshot: AcpRegistryCatalogSnapshot = {
      ...remote,
      source: 'remote',
      stale: false,
    }
    return {
      snapshot,
      legacy: toLegacy(snapshot),
      stale: false,
      updateRequired: false,
      etag: remote.etag,
    }
  } catch (e) {
    if (e instanceof AcpRegistrySchemaError && e.code === 'ACP_REGISTRY_SCHEMA_UNSUPPORTED') {
      const diagnostic = projectRegistryPublicError({
        code: e.code,
        message: 'Registry schema is not supported; update SwarmDesk',
        status: 409,
      }).error
      return {
        ...local,
        stale: true,
        updateRequired: true,
        code: e.code,
        message: diagnostic,
        snapshot: {
          ...local.snapshot,
          stale: true,
          updateRequired: true,
          diagnosticCode: e.code,
          diagnosticMessage: diagnostic,
        },
      }
    }
    const message = projectRegistryPublicError({
      code: 'ACP_REGISTRY_UNAVAILABLE',
      message: 'Unable to refresh ACP Registry catalog',
      status: 502,
    }).error
    return {
      ...local,
      stale: true,
      updateRequired: false,
      code: 'ACP_REGISTRY_UNAVAILABLE',
      message,
      snapshot: {
        ...local.snapshot,
        stale: true,
        diagnosticCode: 'ACP_REGISTRY_UNAVAILABLE',
        diagnosticMessage: message,
      },
    }
  }
}

/**
 * Explicit owner action: check the official Registry and persist a complete changed snapshot.
 * Ordinary reads must use resolveLocalRegistryCatalog() and never call this function implicitly.
 */
export async function checkRegistryCatalogUpdate(
  options: {
    fetchImpl?: typeof fetch
    signal?: AbortSignal
    timeoutMs?: number
  } = {},
): Promise<RegistryCatalogUpdateResult> {
  const local = resolveLocalRegistryCatalog()
  try {
    const remote = await fetchAcpRegistryCatalogV2({
      fetchImpl: options.fetchImpl,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
      etag: local.etag,
    })
    if (remote.notModified || remote.digest === local.snapshot.digest) {
      return {
        status: 'up_to_date',
        catalog: {
          ...local,
          stale: false,
          snapshot: { ...local.snapshot, stale: false },
        },
      }
    }
    if (!remote.agents.length || !remote.digest) {
      return {
        status: 'failed',
        catalog: {
          ...local,
          stale: true,
          code: 'ACP_REGISTRY_UNAVAILABLE',
          message: 'Registry catalog is unavailable',
        },
      }
    }
    saveAcpRegistryCatalogStore({
      etag: remote.etag,
      fetchedAt: remote.fetchedAt,
      schemaVersion: remote.schemaVersion,
      digest: remote.digest,
      snapshot: remote,
    })
    const persisted = resolveLocalRegistryCatalog()
    return {
      status: 'updated',
      catalog: {
        ...persisted,
        stale: false,
        snapshot: { ...persisted.snapshot, stale: false },
      },
    }
  } catch (error) {
    if (
      error instanceof AcpRegistrySchemaError &&
      error.code === 'ACP_REGISTRY_SCHEMA_UNSUPPORTED'
    ) {
      const message = projectRegistryPublicError({
        code: error.code,
        message: 'Registry schema is not supported; update SwarmDesk',
        status: 409,
      }).error
      return {
        status: 'update_required',
        catalog: {
          ...local,
          stale: true,
          updateRequired: true,
          code: error.code,
          message,
          snapshot: {
            ...local.snapshot,
            stale: true,
            updateRequired: true,
            diagnosticCode: error.code,
            diagnosticMessage: message,
          },
        },
      }
    }
    const message = projectRegistryPublicError({
      code: 'ACP_REGISTRY_UNAVAILABLE',
      message: 'Unable to refresh ACP Registry catalog',
      status: 502,
    }).error
    return {
      status: 'failed',
      catalog: {
        ...local,
        stale: true,
        code: 'ACP_REGISTRY_UNAVAILABLE',
        message,
        snapshot: {
          ...local.snapshot,
          stale: true,
          diagnosticCode: 'ACP_REGISTRY_UNAVAILABLE',
          diagnosticMessage: message,
        },
      },
    }
  }
}

/** Owner API helper: local first, then optional await refresh. */
export async function getRegistryCatalogForApi(
  options: {
    refresh?: boolean
    fetchImpl?: typeof fetch
    signal?: AbortSignal
  } = {},
): Promise<ResolveCatalogResult & { agents: AcpRegistryWorkerOption[] }> {
  if (options.refresh) {
    const r = await refreshRegistryCatalog({
      fetchImpl: options.fetchImpl,
      signal: options.signal,
    })
    return { ...r, agents: r.legacy.agents }
  }
  const local = resolveLocalRegistryCatalog()
  // Fire-and-forget refresh is caller's choice; here we just return local
  return { ...local, agents: local.legacy.agents }
}
