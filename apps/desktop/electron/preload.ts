import { contextBridge, ipcRenderer, webUtils } from 'electron'

contextBridge.exposeInMainWorld('routerAgents', {
  platform: process.platform,
  versions: process.versions,
  isDesktop: true,
  apiBase: process.env.VITE_MASTRA_URL ?? 'http://127.0.0.1:4111',
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (payload: {
      leaderModel?: string
      thinkingIntensity?: 'off' | 'low' | 'medium' | 'high' | 'max'
      leaderMaxSteps?: number
      secrets?: Record<string, string | null>
      customProviders?: {
        id: string
        name: string
        apiKeyEnv: string
        docsUrl?: string
        models: { id: string; label: string }[]
      }[]
    }) => ipcRenderer.invoke('settings:save', payload),
    deleteSecret: (key: string) => ipcRenderer.invoke('settings:delete-secret', key),
  },
  dialog: {
    /**
     * Native OS folder picker — system dialog with "选择此文件夹", not HTML upload.
     */
    openDirectory: (labels?: {
      title?: string
      buttonLabel?: string
      message?: string
    }) =>
      ipcRenderer.invoke('dialog:openDirectory', labels) as Promise<
        string | null | { ok: true; path: string } | { ok: false; reason: string }
      >,
    confirm: (message: string) =>
      ipcRenderer.invoke('dialog:confirm', message) as Promise<boolean>,
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
