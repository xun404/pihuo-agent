import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { PromptSettings, WorkerTimeoutSettings } from '@pihuo-agent/shared'

type SettingsTab = 'general' | 'model' | 'prompts' | 'workers' | 'about'
type DangerZoneAction =
  'reset-settings' | 'clear-workers-and-crews' | 'clear-sessions' | 'clear-cache' | 'reset-all'
type ThemeReloadResult = {
  directory: string
  themes: Array<{ filename: string; raw: unknown }>
  skipped: number
  errors: Array<{ filename: string; reason: string }>
}

contextBridge.exposeInMainWorld('routerAgents', {
  platform: process.platform,
  versions: process.versions,
  isDesktop: true,
  apiBase: process.env.PIHUO_AGENT_DESKTOP_API_URL ?? 'http://127.0.0.1:4111',
  getDesktopToken: () => ipcRenderer.invoke('desktop:getApiToken') as Promise<string | null>,
  themes: {
    reload: () => ipcRenderer.invoke('themes:reload') as Promise<ThemeReloadResult>,
  },
  /**
   * Main-process menu (About / Settings…) → open settings panel on a tab.
   * Returns an unsubscribe function.
   */
  onOpenSettings: (handler: (tab?: SettingsTab) => void) => {
    const listener = (_event: unknown, detail: { tab?: SettingsTab } | undefined) => {
      handler(detail?.tab)
    }
    ipcRenderer.on('app:open-settings', listener)
    return () => {
      ipcRenderer.removeListener('app:open-settings', listener)
    }
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    setThinkingIntensity: (level: 'off' | 'low' | 'medium' | 'high' | 'max') =>
      ipcRenderer.invoke('settings:set-thinking-intensity', level),
    save: (payload: {
      leaderModel?: string
      thinkingIntensity?: 'off' | 'low' | 'medium' | 'high' | 'max'
      leaderMaxSteps?: number
      prompts?: PromptSettings
      workerTimeouts?: WorkerTimeoutSettings
      npmRegistry?: string | null
      secrets?: Record<string, string | null>
      notifications?: {
        enabled?: boolean
        mode?: 'always' | 'hidden-only'
        onCompletion?: boolean
        onError?: boolean
        onApproval?: boolean
      }
      customProviders?: {
        id: string
        name: string
        apiKeyEnv: string
        docsUrl?: string
        models: { id: string; label: string }[]
      }[]
    }) => ipcRenderer.invoke('settings:save', payload),
    deleteSecret: (key: string) => ipcRenderer.invoke('settings:delete-secret', key),
    dangerAction: (action: DangerZoneAction) =>
      ipcRenderer.invoke('settings:danger-action', action),
  },
  notify: {
    show: (payload: { id: string; title: string; body: string; sessionId?: string }) =>
      ipcRenderer.invoke('notifications:show', payload) as Promise<{ ok: boolean }>,
  },
  /**
   * Notification click → open the session in the main window.
   * Returns an unsubscribe function (mirrors onOpenSettings).
   */
  onOpenSession: (handler: (detail: { sessionId?: string }) => void) => {
    const listener = (_event: unknown, detail: { sessionId?: string } | undefined) => {
      handler(detail ?? {})
    }
    ipcRenderer.on('app:open-session', listener)
    return () => {
      ipcRenderer.removeListener('app:open-session', listener)
    }
  },
  dialog: {
    /**
     * Native OS folder picker — system dialog with "选择此文件夹", not HTML upload.
     */
    openDirectory: (labels?: { title?: string; buttonLabel?: string; message?: string }) =>
      ipcRenderer.invoke('dialog:openDirectory', labels) as Promise<
        string | null | { ok: true; path: string } | { ok: false; reason: string }
      >,
    confirm: (message: string) => ipcRenderer.invoke('dialog:confirm', message) as Promise<boolean>,
    /**
     * Electron 32+ replacement for File.path (only if using file input).
     * @see https://www.electronjs.org/docs/latest/api/web-utils
     */
    getPathForFile: (file: File): string => {
      try {
        return webUtils.getPathForFile(file)
      } catch (e) {
        console.error('[preload] getPathForFile failed', e)
        return ''
      }
    },
  },
})
