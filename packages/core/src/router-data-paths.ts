/**
 * Single source of truth for Router Agents on-disk data locations.
 *
 * Layout (unified root with data/ and cache/ subdirs):
 *   <root>/                 ← config layer (settings.json, secrets.enc)
 *   <root>/data/            ← data layer (state, runtime, sessions, memory db, agents/)
 *   <root>/cache/           ← cache layer (rebuildable caches)
 *
 * Root resolution (per-platform, XDG-style):
 *   - macOS / Linux: $XDG_CONFIG_HOME ?? $HOME/.config  →  /router-agents
 *   - Windows:       %APPDATA%                          →  /router-agents
 *                   (%LOCALAPPDATA% used for the cache layer)
 *
 * Env overrides:
 *   - ROUTER_DATA_DIR / ROUTER_AGENTS_DIR → pin the entire <root>
 *   - Per-file overrides (ROUTER_AGENTS_STATE, ROUTER_RUNTIME_PATH,
 *     ACP_CATALOG_PATH, MASTRA_MEMORY_URL, ACP_REGISTRY_CATALOG_PATH,
 *     ACP_AGENT_INSTALLATIONS_PATH) still win for individual files.
 */

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export interface RouterDataPaths {
  /** Unified root (e.g. ~/.config/router-agents). Also the config layer. */
  rootDir: string
  /** Config layer (settings/secrets) — equals rootDir. */
  configDir: string
  /** Data layer (rootDir/data): state, runtime, sessions, memory db, agents/. */
  dataDir: string
  /** Cache layer (rootDir/cache): rebuildable caches. */
  cacheDir: string
  statePath: string
  runtimePath: string
  /** ACP Session reuse catalog (agentSessionId map) */
  catalogPath: string
  /** Last-known-good ACP Registry directory snapshot */
  registryCatalogPath: string
  /** ACP Registry agent installations index */
  agentInstallationsPath: string
  /** Config layer directory (settings.json / secrets.enc live here). */
  secretsDir: string
  memoryDbPath: string
  modelRegistryPath: string
  modelsCachePath: string
}

function homeBase(): string {
  return process.env.HOME ?? process.env.USERPROFILE ?? homedir()
}

/**
 * Resolve the config base directory (where <root> lives).
 * - macOS / Linux: $XDG_CONFIG_HOME ?? $HOME/.config
 * - Windows: %APPDATA%
 */
function resolveConfigBase(): string {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA?.trim()
    if (appData) return resolve(appData)
    return resolve(join(homeBase(), 'AppData', 'Roaming'))
  }
  const xdgConfig = process.env.XDG_CONFIG_HOME?.trim()
  if (xdgConfig) return resolve(xdgConfig)
  return resolve(join(homeBase(), '.config'))
}

/**
 * Resolve the cache base directory (Windows uses %LOCALAPPDATA%).
 */
function resolveCacheBase(): string {
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA?.trim()
    if (localAppData) return resolve(localAppData)
    return resolve(join(homeBase(), 'AppData', 'Local'))
  }
  const xdgCache = process.env.XDG_CACHE_HOME?.trim()
  if (xdgCache) return resolve(xdgCache)
  return resolve(join(homeBase(), '.cache'))
}

/**
 * Resolve the unified root directory.
 * - ROUTER_DATA_DIR / ROUTER_AGENTS_DIR pin the entire root
 *   (config + data + cache all live beneath it).
 * - else <configBase>/router-agents
 */
export function resolveRouterDataDir(): string {
  const explicit = process.env.ROUTER_DATA_DIR?.trim() || process.env.ROUTER_AGENTS_DIR?.trim()
  if (explicit) return resolve(explicit)
  return resolve(join(resolveConfigBase(), 'router-agents'))
}

/**
 * Resolve all standard paths. Individual env overrides still win per-file:
 * - ROUTER_AGENTS_STATE → state.json
 * - ROUTER_RUNTIME_PATH → runtime.json
 * - ACP_CATALOG_PATH → acp-sessions.json
 * - MASTRA_MEMORY_URL → memory (file: URL or path)
 */
export function resolveRouterDataPaths(): RouterDataPaths {
  const rootDir = resolveRouterDataDir()
  const configDir = rootDir
  const dataDir = join(rootDir, 'data')
  const cacheDir = join(rootDir, 'cache')

  const statePath = process.env.ROUTER_AGENTS_STATE?.trim()
    ? resolve(process.env.ROUTER_AGENTS_STATE.trim())
    : join(dataDir, 'state.json')
  const runtimePath = process.env.ROUTER_RUNTIME_PATH?.trim()
    ? resolve(process.env.ROUTER_RUNTIME_PATH.trim())
    : join(dataDir, 'runtime.json')
  const catalogPath = process.env.ACP_CATALOG_PATH?.trim()
    ? resolve(process.env.ACP_CATALOG_PATH.trim())
    : join(dataDir, 'acp-sessions.json')
  const memoryDbPath = (() => {
    const raw = process.env.MASTRA_MEMORY_URL?.trim()
    if (!raw) return join(dataDir, 'mastra-memory.db')
    if (raw.startsWith('file:')) return resolve(raw.slice('file:'.length))
    return resolve(raw)
  })()
  const registryCatalogPath = process.env.ACP_REGISTRY_CATALOG_PATH?.trim()
    ? resolve(process.env.ACP_REGISTRY_CATALOG_PATH.trim())
    : join(dataDir, 'acp-registry.json')
  const agentInstallationsPath = process.env.ACP_AGENT_INSTALLATIONS_PATH?.trim()
    ? resolve(process.env.ACP_AGENT_INSTALLATIONS_PATH.trim())
    : join(dataDir, 'acp-agent-installations.json')
  return {
    rootDir,
    configDir,
    dataDir,
    cacheDir,
    statePath,
    runtimePath,
    catalogPath,
    registryCatalogPath,
    agentInstallationsPath,
    secretsDir: configDir,
    memoryDbPath,
    modelRegistryPath: join(dataDir, 'mastra-model-registry.json'),
    modelsCachePath: join(cacheDir, 'models-cache.json'),
  }
}

/** Convenience: default runtime.json path (same as resolveRouterDataPaths().runtimePath). */
export function defaultRuntimeDiscoveryPath(): string {
  return resolveRouterDataPaths().runtimePath
}
