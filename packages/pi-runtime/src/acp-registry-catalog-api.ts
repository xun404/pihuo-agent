import { resolveRouterDataPaths, getSharedStore } from '@pihuo-agent/core'
import { downloadToFile, resolveAcpRegistryTarget } from '@pihuo-agent/adapters'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isTerminalAuthFeatureEnabled, isPtyFeatureReady } from './acp-auth-terminal.js'
import {
  checkRegistryCatalogUpdate,
  getRegistryCatalogForApi,
  resolveLocalRegistryCatalog,
  type ResolveCatalogResult,
} from './acp-registry-service.js'

function projectRegistryCatalog(catalog: ResolveCatalogResult) {
  const workers = getSharedStore().listWorkers()
  const target = resolveAcpRegistryTarget()
  const agentsV2 = catalog.snapshot.agents.map((agent) => {
    const related = workers.filter(
      (worker) => worker.source?.type === 'registry' && worker.source.registryId === agent.id,
    )
    return {
      ...agent,
      platformTarget: target,
      relatedWorkers: related.map((worker) => ({
        id: worker.id,
        name: worker.name,
        readiness: worker.readiness,
        installationId: worker.installationId,
        registryVersion:
          worker.source?.type === 'registry' ? worker.source.registryVersion : undefined,
      })),
    }
  })
  return {
    version: catalog.legacy.version,
    agents: catalog.legacy.agents,
    schemaVersion: catalog.snapshot.schemaVersion,
    source: catalog.snapshot.source,
    digest: catalog.snapshot.digest,
    fetchedAt: catalog.snapshot.fetchedAt,
    stale: catalog.stale,
    updateRequired: catalog.updateRequired,
    code: catalog.code,
    message: catalog.message,
    agentsV2,
    terminalAuthEnabled: isTerminalAuthFeatureEnabled(),
    ptyReady: isPtyFeatureReady(),
  }
}

export async function apiGetRegistryCatalog() {
  return projectRegistryCatalog(await getRegistryCatalogForApi())
}

/**
 * Return a cached Registry agent icon, downloading it on its first request.
 * The renderer only receives a validated local SVG string.
 */
export async function apiRegistryAgentIcon(
  agentId: string,
  opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
): Promise<{ svg: string } | null> {
  const { snapshot } = resolveLocalRegistryCatalog()
  const agent = snapshot.agents.find((candidate) => candidate.id === agentId)
  const iconUrl = agent?.icon
  if (!iconUrl) return null
  let parsed: URL
  try {
    parsed = new URL(iconUrl)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:') return null

  const iconsDir = join(resolveRouterDataPaths().dataDir, 'icons')
  const dest = join(iconsDir, `${agentId}.svg`)
  if (!existsSync(dest)) {
    try {
      mkdirSync(iconsDir, { recursive: true, mode: 0o700 })
      await downloadToFile(iconUrl, dest, {
        fetchImpl: opts.fetchImpl,
        signal: opts.signal,
        totalTimeoutMs: 15_000,
        headerTimeoutMs: 8_000,
        stallTimeoutMs: 10_000,
        maxBytes: 256 * 1024,
      })
    } catch {
      return null
    }
  }
  try {
    const svg = readFileSync(dest, 'utf8')
    if (!svg || !/<svg[\s>]/i.test(svg)) return null
    return { svg }
  } catch {
    return null
  }
}

export async function apiCheckRegistryUpdate(
  options: { fetchImpl?: typeof fetch; signal?: AbortSignal; timeoutMs?: number } = {},
) {
  const result = await checkRegistryCatalogUpdate(options)
  return {
    ...projectRegistryCatalog(result.catalog),
    updateStatus: result.status,
    agentCount: result.catalog.snapshot.agents.length,
  }
}

// Kept public through the facade for existing tests and local callers.
export { resolveLocalRegistryCatalog }
