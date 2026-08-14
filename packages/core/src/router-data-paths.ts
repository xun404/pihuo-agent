/**
 * Single source of truth for PiHuo on-disk data locations.
 *
 * Layout (unified root with data/ and cache/ subdirs):
 *   <root>/                 ← config layer (settings.json, secrets.enc)
 *   <root>/data/            ← data layer (state, runtime, sessions, memory db, agents/)
 *   <root>/cache/           ← cache layer (rebuildable caches)
 *
 * Root resolution (per-platform, XDG-style):
 *   - macOS / Linux: $XDG_CONFIG_HOME ?? $HOME/.config  →  /pihuo-agent
 *   - Windows:       %APPDATA%                          →  /pihuo-agent
 *                   (%LOCALAPPDATA% used for the cache layer)
 *
 * Env overrides:
 *   - PIHUO_AGENT_DATA_DIR / PIHUO_AGENT_AGENTS_DIR → pin the entire <root>
 *   - Per-file overrides (PIHUO_AGENT_AGENTS_STATE, PIHUO_AGENT_RUNTIME_PATH,
 *     ACP_CATALOG_PATH, ACP_REGISTRY_CATALOG_PATH,
 *     ACP_AGENT_INSTALLATIONS_PATH) still win for individual files.
 */

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/** On-disk folder name under the platform config base. */
export const APP_DATA_DIRNAME = 'pihuo-agent'

export interface RouterDataPaths {
  /** Unified root (e.g. ~/.config/pihuo-agent). Also the config layer. */
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
  /** Leader JSONL sessions. */
  sessionsDir: string
  /** Project-scoped markdown memory. */
  projectMemoryDir: string
  /** Isolated Pi agentDir (never ~/.pi). */
  piAgentDir: string
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
 * Resolve the unified root directory.
 * - PIHUO_AGENT_DATA_DIR / PIHUO_AGENT_AGENTS_DIR pin the entire root
 *   (config + data + cache all live beneath it).
 * - else <configBase>/pihuo-agent
 */
export function resolveRouterDataDir(): string {
  const explicit =
    process.env.PIHUO_AGENT_DATA_DIR?.trim() || process.env.PIHUO_AGENT_AGENTS_DIR?.trim()
  if (explicit) return resolve(explicit)
  return resolve(join(resolveConfigBase(), APP_DATA_DIRNAME))
}

/**
 * Resolve all standard paths. Individual env overrides still win per-file:
 * - PIHUO_AGENT_AGENTS_STATE → state.json
 * - PIHUO_AGENT_RUNTIME_PATH → runtime.json
 * - ACP_CATALOG_PATH → acp-sessions.json
 */
export function resolveRouterDataPaths(): RouterDataPaths {
  const rootDir = resolveRouterDataDir()
  const configDir = rootDir
  const dataDir = join(rootDir, 'data')
  const cacheDir = join(rootDir, 'cache')

  const statePath = process.env.PIHUO_AGENT_AGENTS_STATE?.trim()
    ? resolve(process.env.PIHUO_AGENT_AGENTS_STATE.trim())
    : join(dataDir, 'state.json')
  const runtimePath = process.env.PIHUO_AGENT_RUNTIME_PATH?.trim()
    ? resolve(process.env.PIHUO_AGENT_RUNTIME_PATH.trim())
    : join(dataDir, 'runtime.json')
  const catalogPath = process.env.ACP_CATALOG_PATH?.trim()
    ? resolve(process.env.ACP_CATALOG_PATH.trim())
    : join(dataDir, 'acp-sessions.json')
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
    sessionsDir: join(dataDir, 'sessions'),
    projectMemoryDir: join(dataDir, 'project-memory'),
    piAgentDir: join(dataDir, 'pi-agent'),
    modelRegistryPath: join(dataDir, 'model-registry.json'),
    modelsCachePath: join(cacheDir, 'models-cache.json'),
  }
}

/** Convenience: default runtime.json path (same as resolveRouterDataPaths().runtimePath). */
export function defaultRuntimeDiscoveryPath(): string {
  return resolveRouterDataPaths().runtimePath
}
