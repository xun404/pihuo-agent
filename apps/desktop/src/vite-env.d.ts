/// <reference types="vite/client" />

interface ImportMetaEnv {
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
    settings?: {
      get: () => Promise<unknown>
      save: (payload: {
        leaderModel?: string
        thinkingIntensity?: 'off' | 'low' | 'medium' | 'high' | 'max'
        secrets?: Record<string, string | null>
        customProviders?: {
          id: string
          name: string
          apiKeyEnv: string
          docsUrl?: string
          models: { id: string; label: string }[]
        }[]
      }) => Promise<unknown>
      deleteSecret: (key: string) => Promise<unknown>
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
