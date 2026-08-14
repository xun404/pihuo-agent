/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string
  readonly VITE_MASTRA_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface Window {
  routerAgents?: {
    platform: string
    versions: NodeJS.ProcessVersions
    isDesktop?: boolean
    apiBase?: string
    /** Injected Desktop API bearer (from runtime.json / main process) */
    desktopToken?: string
    getDesktopToken?: () => Promise<string | null>
    themes?: {
      reload: () => Promise<{
        directory: string
        themes: Array<{ filename: string; raw: unknown }>
        skipped: number
        errors: Array<{ filename: string; reason: string }>
      }>
    }
    /** Menu bar About/Settings → open settings panel; returns unsubscribe. */
    onOpenSettings?: (
      handler: (tab?: 'general' | 'model' | 'prompts' | 'workers' | 'about') => void,
    ) => () => void
    /** Notification click → open the session in the main window; returns unsubscribe. */
    onOpenSession?: (handler: (detail: { sessionId?: string }) => void) => () => void
    settings?: {
      get: () => Promise<unknown>
      setThinkingIntensity?: (
        level: 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max',
      ) => Promise<unknown>
      save: (payload: {
        leaderModel?: string
        thinkingIntensity?: 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
        prompts?: import('@pihuo-agent/shared').PromptSettings
        workerTimeouts?: import('@pihuo-agent/shared').WorkerTimeoutSettings
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
      }) => Promise<unknown>
      deleteSecret: (key: string) => Promise<unknown>
      dangerAction?: (
        action:
          | 'reset-settings'
          | 'clear-workers-and-crews'
          | 'clear-sessions'
          | 'clear-cache'
          | 'reset-all',
      ) => Promise<unknown>
    }
    notify?: {
      show: (payload: {
        id: string
        title: string
        body: string
        sessionId?: string
      }) => Promise<{ ok: boolean }>
    }
    dialog?: {
      openDirectory: (labels?: {
        title?: string
        buttonLabel?: string
        message?: string
      }) => Promise<
        | string
        | null
        | { ok: true; path: string }
        | { ok: false; reason: string; filePaths?: string[] }
      >
      confirm: (message: string) => Promise<boolean>
      /** Electron webUtils.getPathForFile — replaces removed File.path */
      getPathForFile?: (file: File) => string
    }
  }
}
