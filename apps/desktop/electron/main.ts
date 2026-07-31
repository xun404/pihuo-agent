import {
  app,
  BrowserWindow,
  shell,
  ipcMain,
  dialog,
  utilityProcess,
  nativeImage,
  type IpcMainInvokeEvent,
} from 'electron'
import { flushPendingSettingsTab, installApplicationMenu } from './app-menu.js'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { createManagedApiProcess, type ManagedApiProcess } from './api-process.js'
import { ignoreBrokenHostPipe, writeHostLog } from './host-log.js'
import {
  isPackagedSmoke,
  resolvePackagedSmokeUserDataPath,
  runPackagedSmoke,
  shouldCreateDesktopWindow,
} from './packaged-smoke.js'
import { resolveDesktopRuntimeLayout } from './runtime-layout.js'
import { pickProjectDirectory } from './pick-directory.js'
import { settingsMutationRequiresApiRestart } from './settings-restart.js'
import {
  isSafeExternalUrl,
  isTrustedRendererUrl,
  resolveDesktopApiPort,
  resolveTrustedDevServerUrl,
} from './renderer-security.js'
import {
  allowsExistingApiReuse,
  createSerialTaskRunner,
  matchesApiIdentity,
  isOwnedLegacyApiProcess,
  isWatchSupervisor,
  parseListenerPids,
  shouldStopApiOnAllWindowsClosed,
  shouldWaitForOwnedApiOnQuit,
  type ApiDiscoveryIdentity,
  type ApiHealthIdentity,
  type ExpectedApiChild,
  type ApiRestartMode,
  workspaceIdentity,
} from './api-readiness.js'
import {
  applySecretsToEnv,
  setSecret,
  deleteSecret,
  loadSettings,
  saveSettings,
  getSecretsStatus,
  getAcpFingerprintKeyForChild,
  getWorkerSecretsKeyForChild,
  SECRET_ENV_KEYS,
  MASTRA_PROVIDERS,
  mergeProvidersWithCustom,
  normalizeThinkingIntensity,
  normalizeThinkingIntensityList,
  parseWorkerTimeoutSettings,
  parseNpmRegistryInput,
  resolveSupportedThinkingIntensities,
  resolveRouterDataPaths,
  isConfigurableSecretEnvKey,
  type CustomProviderSettings,
  type ThinkingIntensity,
  type WorkerTimeoutSettings,
} from '@swarmdesk-agent/core'
import {
  isValidPromptSettings,
  normalizePromptSettings,
  type PromptSettings,
} from '@swarmdesk-agent/shared'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Optional Chrome DevTools Protocol for headless inspection/debugging.
// The development launcher defaults this to 8315; packaged apps remain off by default.
// SWARMDESK_AGENT_CDP_PORT can override the port (loopback only).
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-software-rasterizer')
if (process.env.SWARMDESK_AGENT_CDP_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.SWARMDESK_AGENT_CDP_PORT)
  app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1')
}

const PACKAGED_SMOKE = app.isPackaged && isPackagedSmoke(process.argv)
const PACKAGED_SMOKE_USER_DATA = resolvePackagedSmokeUserDataPath({
  packagedSmoke: PACKAGED_SMOKE,
  temporaryDirectory: tmpdir(),
  pid: process.pid,
})
if (PACKAGED_SMOKE_USER_DATA) {
  app.setPath('userData', PACKAGED_SMOKE_USER_DATA)
  process.env.SWARMDESK_AGENT_DATA_DIR = path.join(PACKAGED_SMOKE_USER_DATA, 'router-data')
}
const runtimeLayout = resolveDesktopRuntimeLayout({
  isPackaged: app.isPackaged,
  moduleDir: __dirname,
  resourcesPath: process.resourcesPath,
  userDataPath: app.getPath('userData'),
})
const API_PORT = String(resolveDesktopApiPort(process.env.MASTRA_PORT))
const API_URL = `http://127.0.0.1:${API_PORT}`

// This marker is minted only for the trusted API child. Never let an inherited
// shell value suppress safeStorage decryption in the Electron owner process.
delete process.env.SWARMDESK_AGENT_SECRETS_PARENT_INJECTED
// Preload must never trust VITE_MASTRA_URL: the renderer attaches a bearer token
// to this base URL. Mint the loopback URL in the owner process instead.
process.env.SWARMDESK_AGENT_DESKTOP_API_URL = API_URL

process.env.DIST = runtimeLayout.rendererDist
const DEV_SERVER_URL = resolveTrustedDevServerUrl(process.env.VITE_DEV_SERVER_URL)

// Electron GUI often has no stable stdout/stderr pipe; unhandled EPIPE kills the app.
ignoreBrokenHostPipe(process.stdout)
ignoreBrokenHostPipe(process.stderr)

let win: BrowserWindow | null = null
let apiChild: ManagedApiProcess | null = null
let apiStartedByUs = false
/** Track last child we spawned so restart can wait on the real process, not a nulled ref. */
let lastApiChildMeta: {
  child: ManagedApiProcess
  pid: number
  startedAt: number
} | null = null
const runApiLifecycleTask = createSerialTaskRunner()
const isPrimaryInstance = app.requestSingleInstanceLock()
if (!isPrimaryInstance) app.quit()

// Menu / About labels use app.name; package name is scoped (@swarmdesk-agent/desktop).
app.setName('SwarmDesk')

function secretsEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    MASTRA_PORT: API_PORT,
    SWARMDESK_AGENT_WORKSPACE_ROOT: runtimeLayout.identityRoot,
  }
  // Drop shell-ambient provider keys before inject — otherwise fill-if-empty /
  // dual OPENCODE_* names keep a stale CLI key after the user saved a new one.
  for (const k of Object.keys(env)) {
    if (
      /_API_KEY$|_API_TOKEN$|_ACCESS_KEY$|_SECRET_KEY$/.test(k) &&
      !k.startsWith('SWARMDESK_AGENT_')
    ) {
      delete env[k]
    }
  }
  applySecretsToEnv(env)
  // These capabilities are minted by the child and persisted mode 0600. Never
  // accept stored values or an auth bypass inherited from the shell. Scrub
  // after secret injection as a defense against legacy encrypted payloads.
  delete env.SWARMDESK_AGENT_INTERNAL_TOKEN
  delete env.SWARMDESK_AGENT_DESKTOP_TOKEN
  delete env.SWARMDESK_AGENT_STUDIO_TOKEN
  delete env.SWARMDESK_AGENT_DESKTOP_ORIGINS
  delete env.SWARMDESK_AGENT_ACP_FINGERPRINT_KEY
  delete env.SWARMDESK_AGENT_WORKER_SECRETS_KEY
  delete env.SWARMDESK_AGENT_SECRETS_PARENT_INJECTED
  env.SWARMDESK_AGENT_SECRETS_PARENT_INJECTED = '1'
  env.SWARMDESK_AGENT_DESKTOP_AUTH = '1'
  if (DEV_SERVER_URL) {
    env.SWARMDESK_AGENT_DESKTOP_ORIGINS = new URL(DEV_SERVER_URL).origin
  }
  env.SWARMDESK_AGENT_ACP_FINGERPRINT_KEY = getAcpFingerprintKeyForChild()
  env.SWARMDESK_AGENT_WORKER_SECRETS_KEY = getWorkerSecretsKeyForChild()
  return env
}

async function fetchHealth(): Promise<ApiHealthIdentity | null> {
  try {
    const res = await fetch(`${API_URL}/health`, {
      signal: AbortSignal.timeout(1500),
    })
    if (!res.ok) return null
    return (await res.json()) as ApiHealthIdentity
  } catch {
    return null
  }
}

/**
 * Reuse an existing API only when discovery identity + desktop token match this port.
 * A bare 200 on /health is not enough (wrong process / stale token risk).
 */
async function verifiedDesktopApiToken(expectedChild?: ExpectedApiChild): Promise<string | null> {
  const health = await fetchHealth()
  if (!health) return null

  const paths = resolveRouterDataPaths()
  let discovery: ApiDiscoveryIdentity | null = null
  try {
    if (!existsSync(paths.runtimePath)) return null
    discovery = JSON.parse(readFileSync(paths.runtimePath, 'utf8')) as ApiDiscoveryIdentity
  } catch {
    return null
  }
  if (!discovery) return null

  const expectedPort = Number(API_PORT)
  if (
    !matchesApiIdentity({
      health,
      discovery,
      expectedPort,
      expectedChild,
      expectedWorkspaceRoot: runtimeLayout.identityRoot,
    })
  )
    return null

  const desktopTok = discovery.desktopToken ?? discovery.token
  if (!desktopTok) return null

  // Auth handshake: desktop token must be accepted by this process
  try {
    const res = await fetch(`${API_URL}/api/snapshot`, {
      signal: AbortSignal.timeout(2000),
      headers: {
        Authorization: `Bearer ${desktopTok}`,
        'X-SwarmDesk-Agent-Desktop-Token': desktopTok,
      },
    })
    if (res.status === 401 || res.status === 403) return null
    if (!res.ok) return null
  } catch {
    return null
  }
  // Return the exact token that completed the identity + auth handshake. Do not
  // re-read runtime.json here: a concurrent owner rotation would create a TOCTOU.
  return desktopTok
}

async function canReuseExistingApi(expectedChild?: ExpectedApiChild): Promise<boolean> {
  return (await verifiedDesktopApiToken(expectedChild)) !== null
}

async function waitForApi(timeoutMs = 15000, expectedChild?: ExpectedApiChild): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await canReuseExistingApi(expectedChild)) return true
    await new Promise((r) => setTimeout(r, 300))
  }
  return false
}

function listenerPids(port: string): number[] {
  try {
    const raw = execFileSync('lsof', ['-nP', `-tiTCP:${port}`, '-sTCP:LISTEN'], {
      encoding: 'utf8',
      timeout: 2000,
    })
    return parseListenerPids(raw)
  } catch {
    return []
  }
}

function processCommand(pid: number): string {
  try {
    return execFileSync('ps', ['-p', String(pid), '-o', 'command='], {
      encoding: 'utf8',
      timeout: 2000,
    }).trim()
  } catch {
    return ''
  }
}

function processCwd(pid: number): string {
  try {
    const raw = execFileSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], {
      encoding: 'utf8',
      timeout: 2000,
    })
    return (
      raw
        .split(/\r?\n/)
        .find((line) => line.startsWith('n'))
        ?.slice(1)
        .trim() ?? ''
    )
  } catch {
    return ''
  }
}

/** Returns the parent PID for a process, or null if it cannot be determined. */
function processPpid(pid: number): number | null {
  try {
    const raw = execFileSync('ps', ['-p', String(pid), '-o', 'ppid='], {
      encoding: 'utf8',
      timeout: 2000,
    }).trim()
    const ppid = Number(raw)
    return Number.isInteger(ppid) && ppid > 0 ? ppid : null
  } catch {
    return null
  }
}

async function waitForPidExit(pid: number, timeoutMs = 8000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0)
    } catch {
      return true
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return false
}

/**
 * Upgrade path for a legacy instance from this exact checkout that occupies the
 * API port but has no valid discovery/token identity. The ownership checks are
 * intentionally strict; unrelated listeners are never terminated.
 *
 * Also handles a same-workspace API that is still healthy but externally owned
 * (e.g. a `tsx watch` started from the terminal): the listening child is killed
 * along with any watch supervisor parent, so the port is freed for the new API
 * this Electron instance is about to start. Without retiring the supervisor,
 * it would respawn the child and reclaim the port.
 */
async function retireOwnedLegacyApi(): Promise<boolean> {
  const health = await fetchHealth()
  if (!health) return false
  const expectedMastraRoot = runtimeLayout.apiCwd
  for (const pid of listenerPids(API_PORT)) {
    if (
      !isOwnedLegacyApiProcess({
        health,
        listenerPid: pid,
        command: processCommand(pid),
        cwd: processCwd(pid),
        expectedMastraRoot,
        expectedPort: Number(API_PORT),
      })
    ) {
      continue
    }

    // If a supervisor (tsx watch / nodemon) parents this listener, kill it
    // first so it cannot respawn the child and reclaim the port.
    const supervisorPpid = processPpid(pid)
    if (supervisorPpid) {
      const supervisorCommand = processCommand(supervisorPpid)
      if (isWatchSupervisor(supervisorCommand)) {
        console.warn('[electron] retiring API watch supervisor before listener', supervisorPpid)
        await terminateProcessTree(supervisorPpid)
      }
    }

    console.warn('[electron] retiring incompatible SwarmDesk API process', pid)
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      return true
    }
    if (await waitForPidExit(pid, 8000)) return true
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      return true
    }
    return await waitForPidExit(pid, 2000)
  }
  return false
}

/**
 * Gracefully terminate a process: SIGTERM, then SIGKILL after a short grace.
 * Used for watch supervisors that would otherwise respawn killed children.
 */
async function terminateProcessTree(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    return true
  }
  if (await waitForPidExit(pid, 4000)) return true
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    return true
  }
  return waitForPidExit(pid, 2000)
}

/**
 * Wait for a specific child process to exit. Does NOT compare discovery pid to Electron pid.
 * Escalates to SIGKILL after half the deadline if still alive.
 */
async function waitForChildExit(
  meta: { child: ManagedApiProcess; pid: number } | null,
  timeoutMs = 8000,
): Promise<boolean> {
  if (!meta) return true
  const { child } = meta
  if (child.exited) return true

  const gracefulDeadline = Math.max(1, Math.floor(timeoutMs / 2))
  if (await child.waitForExit(gracefulDeadline)) return true
  child.kill(true)
  return await child.waitForExit(Math.max(1, timeoutMs - gracefulDeadline))
}

async function startApiServer(): Promise<ExpectedApiChild | null> {
  const httpServer = runtimeLayout.apiEntry
  if (!existsSync(httpServer)) {
    console.warn('[electron] API entry not found:', httpServer)
    return null
  }

  console.log('[electron] starting API with injected secrets env')
  let child: ManagedApiProcess
  try {
    if (runtimeLayout.mode === 'packaged') {
      child = createManagedApiProcess(
        utilityProcess.fork(httpServer, [], {
          cwd: runtimeLayout.apiCwd,
          env: secretsEnv(),
          stdio: 'pipe',
          serviceName: 'SwarmDesk API',
        }),
      )
    } else {
      const nodeBin = process.env.NODE_BINARY || 'node'
      child = createManagedApiProcess(
        spawn(nodeBin, ['--import', 'tsx', httpServer], {
          cwd: runtimeLayout.apiCwd,
          env: secretsEnv(),
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: false,
        }),
      )
    }
  } catch (error) {
    console.error('[electron] API process could not be started', error)
    return null
  }
  apiChild = child
  apiStartedByUs = true
  const spawnedAt = Date.now()

  child.stdout?.on('data', (d) => {
    writeHostLog(process.stdout, '[api] ', d)
  })
  child.stderr?.on('data', (d) => {
    writeHostLog(process.stderr, '[api] ', d)
  })
  child.onError((error) => {
    console.error('[electron] API process failed to spawn', error)
    if (lastApiChildMeta?.child === child) lastApiChildMeta = null
    if (apiChild === child) {
      apiChild = null
      apiStartedByUs = false
    }
  })
  child.onExit((code) => {
    console.log('[electron] API process exited', code)
    if (lastApiChildMeta?.child === child) lastApiChildMeta = null
    if (apiChild === child) {
      apiChild = null
      apiStartedByUs = false
    }
  })
  const pid = await child.waitForSpawn(5_000)
  if (!pid) {
    console.error('[electron] API process did not report a pid')
    child.kill()
    if (apiChild === child) {
      apiChild = null
      apiStartedByUs = false
    }
    return null
  }
  lastApiChildMeta = { child, pid, startedAt: spawnedAt }
  return pid ? { pid, spawnedAt } : null
}

function stopApiServer(): { child: ManagedApiProcess; pid: number } | null {
  if (apiChild && apiStartedByUs) {
    const meta =
      lastApiChildMeta?.child === apiChild
        ? { child: apiChild, pid: lastApiChildMeta.pid }
        : apiChild.pid
          ? { child: apiChild, pid: apiChild.pid }
          : null
    try {
      apiChild.kill()
    } catch {
      /* ok */
    }
    // Keep meta for waitForChildExit — do not null apiChild until exit fires
    return meta
  }
  return null
}

async function restartApiServerNow(mode: ApiRestartMode): Promise<boolean> {
  if (mode === 'ensure' && (await canReuseExistingApi())) {
    if (!apiChild) apiStartedByUs = false
    return true
  }

  const oldMeta = stopApiServer()
  const exited = await waitForChildExit(oldMeta, 10_000)
  if (!exited) {
    console.error('[electron] previous API process did not exit; refusing overlapping restart')
    return false
  }
  if (oldMeta && apiChild === oldMeta.child) apiChild = null
  if (oldMeta && lastApiChildMeta?.child === oldMeta.child) lastApiChildMeta = null

  // Only reuse when discovery identity + desktop token handshake succeeds
  const externalApiHealthy = await canReuseExistingApi()
  if (externalApiHealthy && allowsExistingApiReuse(mode)) {
    console.log('[electron] verified external API; reusing')
    apiStartedByUs = false
    return true
  }
  if (externalApiHealthy) {
    // A healthy external API that we cannot reuse (apply-settings needs a
    // restart to pick up new secrets). Retire the same-workspace listener
    // (and any watch supervisor) so we can start our own with the new env,
    // instead of giving up and leaving the saved settings inactive.
    console.warn('[electron] settings saved; retiring external API to apply them')
  }
  await retireOwnedLegacyApi()
  const expectedChild = await startApiServer()
  if (!expectedChild) return false
  const ready = await waitForApi(20_000, expectedChild)
  if (ready) return true

  // A child that never proves its identity must not become a hidden late
  // listener after the renderer has already reported startup failure.
  const failedMeta = stopApiServer()
  const exitedAfterFailure = await waitForChildExit(failedMeta, 8_000)
  if (!exitedAfterFailure) {
    console.error('[electron] unready API child could not be stopped cleanly')
  }
  if (failedMeta && apiChild === failedMeta.child) apiChild = null
  if (failedMeta && lastApiChildMeta?.child === failedMeta.child) lastApiChildMeta = null
  if (failedMeta) apiStartedByUs = false
  return false
}

function restartApiServer(mode: ApiRestartMode): Promise<boolean> {
  return runApiLifecycleTask(() => restartApiServerNow(mode))
}

function providersPayload() {
  const settings = loadSettings()
  const merged = mergeProvidersWithCustom(MASTRA_PROVIDERS, settings.customProviders)
  const secretKeys = [...new Set([...SECRET_ENV_KEYS, ...merged.map((p) => p.apiKeyEnv)])]
  const status = getSecretsStatus(secretKeys)
  return {
    status,
    customProviders: settings.customProviders ?? [],
    providers: merged.map((p) => {
      const custom = settings.customProviders?.find((c) => c.id === p.id)
      const isCustom = Boolean(custom)
      const rawThinking = (p as { thinkingIntensities?: ThinkingIntensity[] }).thinkingIntensities
      return {
        id: p.id,
        name: p.name,
        apiKeyEnv: p.apiKeyEnv,
        docsUrl: p.docsUrl,
        models: p.models,
        thinkingIntensities: resolveSupportedThinkingIntensities({
          custom: isCustom,
          thinkingIntensities: rawThinking,
        }),
        configured: status.configuredKeys.includes(p.apiKeyEnv),
        custom: isCustom,
        baseURL: custom?.baseURL ?? (p as { baseURL?: string }).baseURL,
        apiStyle: custom?.apiStyle ?? (p as { apiStyle?: string }).apiStyle,
        enabled: isCustom ? custom?.enabled !== false : true,
      }
    }),
  }
}

function requireTrustedRenderer(event: IpcMainInvokeEvent): void {
  if (
    !win ||
    event.sender !== win.webContents ||
    !isTrustedRendererUrl({
      url: event.sender.getURL(),
      devServerUrl: DEV_SERVER_URL,
      distDir: process.env.DIST!,
    })
  ) {
    throw new Error('IPC request rejected from an untrusted renderer')
  }
}

function registerIpc(): void {
  ipcMain.handle('desktop:getApiToken', async (event) => {
    requireTrustedRenderer(event)
    // Never return a token from a stale or different checkout's runtime file.
    return await verifiedDesktopApiToken()
  })

  ipcMain.handle('settings:get', (event) => {
    requireTrustedRenderer(event)
    const { status, providers, customProviders } = providersPayload()
    const paths = resolveRouterDataPaths()
    return {
      ...status,
      providers,
      customProviders,
      leaderMaxSteps: status.settings.leaderMaxSteps,
      platform: process.platform,
      storagePaths: { root: paths.rootDir, data: paths.dataDir, cache: paths.cacheDir },
    }
  })

  ipcMain.handle('settings:set-thinking-intensity', (event, level: ThinkingIntensity) => {
    requireTrustedRenderer(event)
    const previous = loadSettings()
    const thinkingIntensity = normalizeThinkingIntensity(level)
    const next = saveSettings({
      ...previous,
      thinkingIntensity,
    })
    process.env.THINKING_INTENSITY = thinkingIntensity
    // The API reads this preference per chat request; no child restart is
    // necessary, so active jobs and other sessions remain uninterrupted.
    return { ok: true, thinkingIntensity: next.thinkingIntensity }
  })

  ipcMain.handle(
    'settings:save',
    async (
      event,
      payload: {
        leaderModel?: string
        thinkingIntensity?: ThinkingIntensity
        leaderMaxSteps?: number
        prompts?: PromptSettings
        workerTimeouts?: WorkerTimeoutSettings
        npmRegistry?: string | null
        secrets?: Record<string, string | null>
        customProviders?: CustomProviderSettings[]
      },
    ) => {
      requireTrustedRenderer(event)
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error('Settings payload is invalid')
      }
      if (payload.customProviders !== undefined && !Array.isArray(payload.customProviders)) {
        throw new Error('Custom providers payload is invalid')
      }
      if (payload.prompts !== undefined && !isValidPromptSettings(payload.prompts)) {
        throw new Error('Complete non-empty prompt settings required')
      }
      if (
        payload.customProviders?.some(
          (provider) => !provider || typeof provider !== 'object' || Array.isArray(provider),
        )
      ) {
        throw new Error('Custom provider entry is invalid')
      }
      if (payload.secrets !== undefined) {
        if (typeof payload.secrets !== 'object' || Array.isArray(payload.secrets)) {
          throw new Error('Secrets payload is invalid')
        }
        for (const value of Object.values(payload.secrets)) {
          if (value !== null && typeof value !== 'string') {
            throw new Error('Secret value is invalid')
          }
        }
      }
      const prev = loadSettings()
      let nextNpmRegistry: string | undefined = prev.npmRegistry
      if (payload.npmRegistry !== undefined) {
        nextNpmRegistry = parseNpmRegistryInput(payload.npmRegistry)
      }
      const next = saveSettings({
        leaderModel: payload.leaderModel?.trim() || prev.leaderModel,
        thinkingIntensity:
          payload.thinkingIntensity !== undefined
            ? normalizeThinkingIntensity(payload.thinkingIntensity)
            : prev.thinkingIntensity,
        leaderMaxSteps: payload.leaderMaxSteps ?? prev.leaderMaxSteps,
        prompts: normalizePromptSettings(payload.prompts ?? prev.prompts),
        workerTimeouts:
          payload.workerTimeouts !== undefined
            ? parseWorkerTimeoutSettings(payload.workerTimeouts)
            : prev.workerTimeouts,
        npmRegistry:
          payload.npmRegistry !== undefined ? (nextNpmRegistry ?? '') : prev.npmRegistry,
        customProviders:
          payload.customProviders !== undefined
            ? payload.customProviders.map((c) => ({
                ...c,
                thinkingIntensities:
                  c.thinkingIntensities !== undefined
                    ? normalizeThinkingIntensityList(c.thinkingIntensities)
                    : c.thinkingIntensities,
              }))
            : prev.customProviders,
      })
      process.env.LEADER_MODEL = next.leaderModel
      if (next.thinkingIntensity) {
        process.env.THINKING_INTENSITY = next.thinkingIntensity
      }

      if (payload.secrets) {
        const allowed = new Set([
          ...SECRET_ENV_KEYS,
          ...(next.customProviders ?? []).map((c) => c.apiKeyEnv),
        ])
        for (const [k, v] of Object.entries(payload.secrets)) {
          if (!isConfigurableSecretEnvKey(k) || !allowed.has(k)) continue
          if (v === null || v === '' || (typeof v === 'string' && v.includes('••••'))) {
            if (v === null || v === '') {
              deleteSecret(k)
              delete process.env[k]
            }
            continue
          }
          setSecret(k, v)
          process.env[k] = v.trim()
        }
      }
      applySecretsToEnv(process.env)
      const ok = settingsMutationRequiresApiRestart(payload)
        ? await restartApiServer('apply-settings')
        : true
      // Sticky chat errors stay until the user starts the next turn (status=running).
      const { status, providers, customProviders } = providersPayload()
      return {
        ok,
        error: ok ? undefined : 'API restart failed; settings were saved but are not active yet.',
        ...status,
        providers,
        customProviders,
      }
    },
  )

  ipcMain.handle('settings:delete-secret', async (event, key: string) => {
    requireTrustedRenderer(event)
    if (!isConfigurableSecretEnvKey(key)) {
      throw new Error('Secret key is not configurable')
    }
    const settings = loadSettings()
    const allowed = new Set([
      ...SECRET_ENV_KEYS,
      ...(settings.customProviders ?? []).map((provider) => provider.apiKeyEnv),
    ])
    if (!allowed.has(key)) throw new Error('Secret key is not configurable')
    deleteSecret(key)
    delete process.env[key]
    const ok = await restartApiServer('apply-settings')
    const { status, providers, customProviders } = providersPayload()
    return {
      ok,
      error: ok
        ? undefined
        : 'API restart failed; the secret was deleted but the running API was not reloaded.',
      ...status,
      providers,
      customProviders,
    }
  })

  /**
   * System folder picker — macOS uses osascript `choose folder` (real system panel,
   * NOT HTML "upload", and avoids Electron empty_selection bugs).
   */
  ipcMain.removeHandler('dialog:openDirectory')
  ipcMain.handle(
    'dialog:openDirectory',
    async (event, labels?: { title?: string; buttonLabel?: string; message?: string }) => {
      requireTrustedRenderer(event)
      try {
        try {
          if (process.platform === 'darwin') app.focus({ steal: true })
        } catch {
          /* ignore */
        }

        const result = await pickProjectDirectory(labels ?? {}, win)
        console.log('[dialog:openDirectory] pick result', result)

        if (result.ok) {
          return { ok: true as const, path: result.path, via: result.via }
        }
        return {
          ok: false as const,
          reason: result.reason,
          via: result.via,
          filePaths: [] as string[],
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        console.error('[dialog:openDirectory] failed', msg)
        return { ok: false as const, reason: msg, filePaths: [] as string[] }
      }
    },
  )

  ipcMain.removeHandler('dialog:confirm')
  ipcMain.handle('dialog:confirm', async (event, message: string) => {
    requireTrustedRenderer(event)
    try {
      const parent =
        BrowserWindow.getFocusedWindow() ?? win ?? BrowserWindow.getAllWindows()[0] ?? null
      const opts: Electron.MessageBoxOptions = {
        type: 'question',
        buttons: ['Cancel', 'OK'],
        defaultId: 1,
        cancelId: 0,
        message: String(message ?? ''),
      }
      const result = parent
        ? await dialog.showMessageBox(parent, opts)
        : await dialog.showMessageBox(opts)
      return result.response === 1
    } catch (e) {
      console.error('[dialog:confirm] failed', e)
      return false
    }
  })
}

/** macOS traffic lights: keep system-native size; only place them in the titleband. */
const MAC_TRAFFIC_LIGHT = {
  // Standard left inset for hiddenInset-style chrome (matches common native apps).
  x: 16,
  // Vertically center ~14pt buttons in a ~52pt titleband (macOS 26+ larger controls).
  y: 19,
} as const

function resolveAppIconPath(): string | undefined {
  // Prefer packaged build resources, then Vite public/dist copies.
  const candidates = [
    process.env.DIST ? path.join(process.env.DIST, 'icon.png') : '',
    path.join(__dirname, '../dist/icon.png'),
    path.join(__dirname, '../public/icon.png'),
    path.join(__dirname, '../../../build/icon.icns'),
    path.join(__dirname, '../../../build/icon.png'),
  ].filter(Boolean)
  return candidates.find((p) => existsSync(p))
}

/** Dock / taskbar / window icon — keep in sync with build/icon.* */
function applyAppIcon(): void {
  const iconPath = resolveAppIconPath()
  if (!iconPath) return
  try {
    const image = nativeImage.createFromPath(iconPath)
    if (image.isEmpty()) return
    if (process.platform === 'darwin' && app.dock) {
      app.dock.setIcon(image)
    }
  } catch (e) {
    console.warn('[electron] failed to apply app icon', e)
  }
}

function createWindow() {
  const icon = resolveAppIconPath()
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    // hiddenInset = system-native traffic lights (not HTML). Size follows Electron/macOS SDK.
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : undefined,
    ...(process.platform === 'darwin'
      ? { trafficLightPosition: { x: MAC_TRAFFIC_LIGHT.x, y: MAC_TRAFFIC_LIGHT.y } }
      : {}),
    ...(icon ? { icon } : {}),
    backgroundColor: '#f7f4ef',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  if (process.platform === 'darwin') {
    // Ensure standard window buttons stay visible and at system metrics.
    win.setWindowButtonVisibility(true)
    win.setWindowButtonPosition({ x: MAC_TRAFFIC_LIGHT.x, y: MAC_TRAFFIC_LIGHT.y })
  }

  win.once('ready-to-show', () => {
    win?.show()
    flushPendingSettingsTab(win)
  })
  win.on('closed', () => {
    win = null
  })

  if (DEV_SERVER_URL) {
    void win.loadURL(DEV_SERVER_URL)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    void win.loadFile(path.join(process.env.DIST!, 'index.html'))
  }

  win.webContents.once('did-finish-load', () => {
    flushPendingSettingsTab(win)
  })

  const handleNavigation = (event: Electron.Event, url: string) => {
    if (
      isTrustedRendererUrl({
        url,
        devServerUrl: DEV_SERVER_URL,
        distDir: process.env.DIST!,
      })
    )
      return
    event.preventDefault()
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
  }
  win.webContents.on('will-navigate', handleNavigation)
  win.webContents.on('will-redirect', handleNavigation)

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
}

app.whenReady().then(async () => {
  if (!isPrimaryInstance) return
  applySecretsToEnv(process.env)
  if (!PACKAGED_SMOKE) registerIpc()

  if (PACKAGED_SMOKE) {
    let code = 1
    try {
      code = await runPackagedSmoke({
        startApi: async () => {
          const expectedChild = await startApiServer()
          return Boolean(expectedChild && (await waitForApi(20_000, expectedChild)))
        },
        stopApi: async () => {
          const ownedMeta = stopApiServer()
          const exited = await waitForChildExit(ownedMeta, 24_000)
          if (ownedMeta && apiChild === ownedMeta.child) apiChild = null
          if (ownedMeta && lastApiChildMeta?.child === ownedMeta.child) {
            lastApiChildMeta = null
          }
          if (ownedMeta) apiStartedByUs = false
          return exited
        },
        log: (message) => console.log(`[packaged-smoke] ${message}`),
      })
    } catch (error) {
      console.error('[packaged-smoke] failed', error)
      code = 1
    }
    if (PACKAGED_SMOKE_USER_DATA) {
      try {
        // Windows may still hold files under userData (EPERM); never fail the smoke on cleanup.
        rmSync(PACKAGED_SMOKE_USER_DATA, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 100,
        })
      } catch (error) {
        console.warn('[packaged-smoke] userData cleanup skipped', String(error))
      }
    }
    // app.exit alone can leave Chromium/ConPTY handles open on Windows CI so the
    // parent spawnSync never returns. Force a hard process exit after a short grace.
    app.exit(code)
    setTimeout(() => process.exit(code), 250)
    return
  }

  const ok = await restartApiServer('ensure')
  if (!ok) {
    console.error('[electron] API failed to become ready at', API_URL)
  } else {
    console.log('[electron] API ready at', API_URL)
  }

  if (shouldCreateDesktopWindow({ packagedSmoke: PACKAGED_SMOKE })) {
    applyAppIcon()
    installApplicationMenu({
      getMainWindow: () => win,
      ensureMainWindow: () => {
        if (!win || win.isDestroyed()) createWindow()
      },
    })
    createWindow()
  }
})

app.on('window-all-closed', () => {
  if (shouldStopApiOnAllWindowsClosed(process.platform)) {
    app.quit()
  }
})

let quitReissuedAfterApi = false
let apiQuitDrain: Promise<void> | null = null
app.on('before-quit', (event) => {
  const ownedMeta = stopApiServer()
  if (!shouldWaitForOwnedApiOnQuit(Boolean(ownedMeta), quitReissuedAfterApi)) return
  event.preventDefault()
  if (apiQuitDrain) return
  apiQuitDrain = waitForChildExit(ownedMeta, 24_000)
    .then((exited) => {
      if (!exited) console.error('[electron] API did not exit cleanly before app quit')
    })
    .finally(() => {
      quitReissuedAfterApi = true
      app.quit()
    })
})

let activatingWindow = false
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length > 0 || activatingWindow) return
  activatingWindow = true
  void restartApiServer('ensure')
    .then((ok) => {
      if (!ok) console.error('[electron] API unavailable while reopening window')
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
    .finally(() => {
      activatingWindow = false
    })
})

if (isPrimaryInstance) {
  app.on('second-instance', () => {
    const existing = BrowserWindow.getAllWindows()[0]
    if (existing) {
      if (existing.isMinimized()) existing.restore()
      existing.focus()
      return
    }
    app.emit('activate')
  })
}
