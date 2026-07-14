import { app, BrowserWindow, shell, ipcMain, safeStorage, dialog } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { installElectronSafeStorage } from './secure-bridge'
import { pickProjectDirectory } from './pick-directory'
import {
  applySecretsToEnv,
  setSecret,
  deleteSecret,
  loadSettings,
  saveSettings,
  getSecretsStatus,
  SECRET_ENV_KEYS,
  MASTRA_PROVIDERS,
  mergeProvidersWithCustom,
  normalizeThinkingIntensity,
  normalizeThinkingIntensityList,
  resolveSupportedThinkingIntensities,
  type CustomProviderSettings,
  type ThinkingIntensity,
} from '@router-agents/core'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Repo root: apps/desktop/dist-electron -> ../../..
const REPO_ROOT = path.resolve(__dirname, '../../..')
const API_PORT = process.env.MASTRA_PORT ?? '4111'
const API_URL = `http://127.0.0.1:${API_PORT}`

process.env.DIST = path.join(__dirname, '../dist')

let win: BrowserWindow | null = null
let apiChild: ChildProcess | null = null
let apiStartedByUs = false

function secretsEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env, MASTRA_PORT: API_PORT }
  applySecretsToEnv(env)
  return env
}

async function waitForApi(timeoutMs = 15000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${API_URL}/health`)
      if (res.ok) return true
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  return false
}

function startApiServer(): void {
  const httpServer = path.join(REPO_ROOT, 'packages/mastra-app/src/http-server.ts')
  if (!existsSync(httpServer)) {
    console.warn('[electron] API entry not found:', httpServer)
    return
  }

  const nodeBin = process.env.NODE_BINARY || 'node'
  const args = ['--import', 'tsx', httpServer]

  console.log('[electron] starting API with injected secrets env')
  apiChild = spawn(nodeBin, args, {
    cwd: path.join(REPO_ROOT, 'packages/mastra-app'),
    env: secretsEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  })
  apiStartedByUs = true

  apiChild.stdout?.on('data', (d) => process.stdout.write(`[api] ${d}`))
  apiChild.stderr?.on('data', (d) => process.stderr.write(`[api] ${d}`))
  apiChild.on('exit', (code) => {
    console.log('[electron] API process exited', code)
    apiChild = null
  })
}

function stopApiServer(): void {
  if (apiChild && apiStartedByUs) {
    apiChild.kill('SIGTERM')
    apiChild = null
  }
}

async function restartApiServer(): Promise<boolean> {
  stopApiServer()
  await new Promise((r) => setTimeout(r, 400))
  // If another API is already listening (not ours), leave it
  if (await waitForApi(600)) {
    console.log('[electron] external API still up; secrets applied in-process only')
    return true
  }
  startApiServer()
  return waitForApi(20000)
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
      const isCustom = Boolean(settings.customProviders?.some((c) => c.id === p.id))
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
      }
    }),
  }
}

function registerIpc(): void {
  ipcMain.handle('settings:get', () => {
    const { status, providers, customProviders } = providersPayload()
    return {
      ...status,
      providers,
      customProviders,
      leaderMaxSteps: status.settings.leaderMaxSteps,
      safeStorageAvailable: safeStorage.isEncryptionAvailable(),
      platform: process.platform,
      storagePath: `${process.env.HOME ?? '~'}/.router-agents`,
    }
  })

  ipcMain.handle(
    'settings:save',
    async (
      _e,
      payload: {
        leaderModel?: string
        thinkingIntensity?: ThinkingIntensity
        leaderMaxSteps?: number
        secrets?: Record<string, string | null>
        customProviders?: CustomProviderSettings[]
      },
    ) => {
      const prev = loadSettings()
      const next = saveSettings({
        leaderModel: payload.leaderModel?.trim() || prev.leaderModel,
        thinkingIntensity:
          payload.thinkingIntensity !== undefined
            ? normalizeThinkingIntensity(payload.thinkingIntensity)
            : prev.thinkingIntensity,
        leaderMaxSteps: payload.leaderMaxSteps ?? prev.leaderMaxSteps,
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
          if (!allowed.has(k) && k !== 'OPENAI_API_KEY') continue
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
      const ok = await restartApiServer()
      const { status, providers, customProviders } = providersPayload()
      return {
        ok,
        ...status,
        providers,
        customProviders,
        safeStorageAvailable: safeStorage.isEncryptionAvailable(),
      }
    },
  )

  ipcMain.handle('settings:delete-secret', async (_e, key: string) => {
    deleteSecret(key)
    delete process.env[key]
    await restartApiServer()
    const { status, providers, customProviders } = providersPayload()
    return { ...status, providers, customProviders }
  })

  /**
   * System folder picker — macOS uses osascript `choose folder` (real system panel,
   * NOT HTML "upload", and avoids Electron empty_selection bugs).
   */
  ipcMain.removeHandler('dialog:openDirectory')
  ipcMain.handle(
    'dialog:openDirectory',
    async (
      _event,
      labels?: { title?: string; buttonLabel?: string; message?: string },
    ) => {
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
  ipcMain.handle('dialog:confirm', async (_e, message: string) => {
    try {
      const parent =
        BrowserWindow.getFocusedWindow() ??
        win ??
        BrowserWindow.getAllWindows()[0] ??
        null
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

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 12 },
    backgroundColor: '#0c0d10',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win.once('ready-to-show', () => win?.show())

  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) {
    void win.loadURL(devUrl)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    void win.loadFile(path.join(process.env.DIST!, 'index.html'))
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
}

app.whenReady().then(async () => {
  installElectronSafeStorage()
  applySecretsToEnv(process.env)
  registerIpc()

  const alreadyUp = await waitForApi(800)
  if (!alreadyUp) {
    startApiServer()
    const ok = await waitForApi(20000)
    if (!ok) {
      console.error('[electron] API failed to become ready at', API_URL)
    } else {
      console.log('[electron] API ready at', API_URL)
    }
  } else {
    console.log('[electron] reusing existing API at', API_URL)
  }

  createWindow()
})

app.on('window-all-closed', () => {
  stopApiServer()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  stopApiServer()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
