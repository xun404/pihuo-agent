import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useInsertionEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { applyAppearanceVariables, type ResolvedTheme } from './appearance.config'
import {
  DEFAULT_DARK_THEME_ID,
  DEFAULT_LIGHT_THEME_ID,
  fallbackThemeId,
  findThemeById,
  getBuiltinColorTheme,
  mergeAvailableColorThemes,
  normalizeCustomThemes,
  type ColorTheme,
  type ColorThemeVariant,
} from './theme.config'

export type ThemeMode = 'system' | 'light' | 'dark'
export type { ColorTheme, ColorThemeId, ColorThemeVariant } from './theme.config'

export const THEME_MODE_KEY = 'swarmdesk-agent.theme'
export const LEGACY_PALETTE_KEY = 'swarmdesk-agent.palette'
export const LIGHT_THEME_KEY = 'swarmdesk-agent.light-theme'
export const DARK_THEME_KEY = 'swarmdesk-agent.dark-theme'

export interface ThemeReloadSummary {
  ok: boolean
  directory: string
  loaded: number
  skipped: number
  errors: Array<{ filename: string; reason: string }>
  error?: string
  stale?: boolean
}

interface ThemeContextValue {
  mode: ThemeMode
  resolved: ResolvedTheme
  setMode: (mode: ThemeMode) => void
  lightThemeId: string
  darkThemeId: string
  activeThemeId: string
  lightTheme: ColorTheme
  darkTheme: ColorTheme
  activeTheme: ColorTheme
  availableThemes: ColorTheme[]
  lightThemes: ColorTheme[]
  darkThemes: ColorTheme[]
  setLightThemeId: (id: string) => void
  setDarkThemeId: (id: string) => void
  /** Alias names keep the API discoverable for settings integrations. */
  setLightTheme: (id: string) => void
  setDarkTheme: (id: string) => void
  reloadThemes: () => Promise<ThemeReloadSummary>
  themesDirectory: string
  themesLoading: boolean
  themesLoaded: boolean
  lastThemeReload: ThemeReloadSummary | null
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function isThemeId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,63}$/u.test(value.trim())
}

/** Migrate legacy palette IDs while preserving arbitrary valid custom IDs. */
export function migrateStoredLightTheme(value: unknown): string {
  if (value === 'classic' || value === 'mono-plus' || value === 'warm' || !isThemeId(value)) {
    return DEFAULT_LIGHT_THEME_ID
  }
  return value.trim().toLowerCase()
}

export function migrateStoredDarkTheme(value: unknown): string {
  if (value === 'dark') return DEFAULT_DARK_THEME_ID
  return isThemeId(value) ? value.trim().toLowerCase() : DEFAULT_DARK_THEME_ID
}

function getStored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function setStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* ignore unavailable storage */
  }
}

function removeStored(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    /* ignore unavailable storage */
  }
}

function readStoredMode(): ThemeMode {
  const value = getStored(THEME_MODE_KEY)
  return value === 'system' || value === 'light' || value === 'dark' ? value : 'system'
}

function readStoredLightTheme(): string {
  const current = getStored(LIGHT_THEME_KEY)
  if (current) {
    const migrated = migrateStoredLightTheme(current)
    if (migrated !== current.trim().toLowerCase()) setStored(LIGHT_THEME_KEY, migrated)
    removeStored(LEGACY_PALETTE_KEY)
    return migrated
  }
  const legacy = getStored(LEGACY_PALETTE_KEY)
  const migrated = migrateStoredLightTheme(legacy)
  if (legacy !== null) {
    setStored(LIGHT_THEME_KEY, migrated)
    removeStored(LEGACY_PALETTE_KEY)
  }
  return migrated
}

function readStoredDarkTheme(): string {
  const current = getStored(DARK_THEME_KEY)
  const migrated = migrateStoredDarkTheme(current)
  if (current !== null && migrated !== current.trim().toLowerCase()) {
    setStored(DARK_THEME_KEY, migrated)
  }
  return migrated
}

function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'dark'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function resolveTheme(mode: ThemeMode, systemTheme = getSystemTheme()): ResolvedTheme {
  return mode === 'system' ? systemTheme : mode
}

function applyTheme(resolved: ResolvedTheme, theme: ColorTheme): void {
  const root = document.documentElement
  root.dataset.theme = resolved
  root.dataset.themeId = theme.id
  // Compatibility for styles/extensions that read the former palette marker.
  root.dataset.palette = theme.id
  root.style.colorScheme = resolved
  if (document.body) {
    document.body.dataset.theme = resolved
    document.body.dataset.themeId = theme.id
    document.body.dataset.palette = theme.id
  }
  applyAppearanceVariables(resolved, theme, root)
}

function activeThemeFor(
  themes: readonly ColorTheme[],
  resolved: ResolvedTheme,
  selectedId: string,
): ColorTheme {
  const variant: ColorThemeVariant = resolved === 'dark' ? 'dark' : 'light'
  return (
    findThemeById(themes, selectedId, variant) ??
    findThemeById(themes, fallbackThemeId(variant), variant) ??
    getBuiltinColorTheme(variant === 'dark' ? DEFAULT_DARK_THEME_ID : DEFAULT_LIGHT_THEME_ID)
  )
}

/** Only a successful registry read may invalidate a persisted theme choice. */
export function shouldFallbackThemeSelection(
  registryReady: boolean,
  themes: readonly ColorTheme[],
  id: string,
  variant: ColorThemeVariant,
): boolean {
  return registryReady && !findThemeById(themes, id, variant)
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => readStoredMode())
  const [lightThemeId, setLightThemeIdState] = useState(() => readStoredLightTheme())
  const [darkThemeId, setDarkThemeIdState] = useState(() => readStoredDarkTheme())
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() => getSystemTheme())
  const [customThemes, setCustomThemes] = useState<ColorTheme[]>([])
  const [themesDirectory, setThemesDirectory] = useState('')
  const [themesLoading, setThemesLoading] = useState(false)
  const [themesLoaded, setThemesLoaded] = useState(false)
  const [themesRegistryReady, setThemesRegistryReady] = useState(false)
  const [lastThemeReload, setLastThemeReload] = useState<ThemeReloadSummary | null>(null)
  const reloadSequence = useRef(0)
  const themesDirectoryRef = useRef('')
  const customThemesRef = useRef<ColorTheme[]>([])
  themesDirectoryRef.current = themesDirectory
  customThemesRef.current = customThemes

  const availableThemes = useMemo(() => mergeAvailableColorThemes(customThemes), [customThemes])
  const lightThemes = useMemo(
    () => availableThemes.filter((theme) => theme.variant === 'light'),
    [availableThemes],
  )
  const darkThemes = useMemo(
    () => availableThemes.filter((theme) => theme.variant === 'dark'),
    [availableThemes],
  )
  const resolved = resolveTheme(mode, systemTheme)
  const activeTheme = activeThemeFor(
    availableThemes,
    resolved,
    resolved === 'dark' ? darkThemeId : lightThemeId,
  )
  const selectedLightTheme = activeThemeFor(availableThemes, 'light', lightThemeId)
  const selectedDarkTheme = activeThemeFor(availableThemes, 'dark', darkThemeId)

  useInsertionEffect(() => {
    applyTheme(resolved, activeTheme)
  }, [activeTheme, resolved])

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setSystemTheme(mq.matches ? 'dark' : 'light')
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next)
    setStored(THEME_MODE_KEY, next)
  }, [])

  const setLightThemeId = useCallback((next: string) => {
    const normalized = migrateStoredLightTheme(next)
    setLightThemeIdState(normalized)
    setStored(LIGHT_THEME_KEY, normalized)
  }, [])

  const setDarkThemeId = useCallback((next: string) => {
    const normalized = migrateStoredDarkTheme(next)
    setDarkThemeIdState(normalized)
    setStored(DARK_THEME_KEY, normalized)
  }, [])

  const reloadThemes = useCallback(async (): Promise<ThemeReloadSummary> => {
    const sequence = ++reloadSequence.current
    const bridge = typeof window !== 'undefined' ? window.routerAgents?.themes?.reload : undefined
    setThemesLoading(true)
    if (!bridge) {
      const summary: ThemeReloadSummary = {
        ok: true,
        directory: '',
        loaded: 0,
        skipped: 0,
        errors: [],
      }
      if (sequence === reloadSequence.current) {
        setThemesLoaded(true)
        setThemesLoading(false)
        setLastThemeReload(summary)
      }
      return summary
    }

    try {
      const loaded = await bridge()
      const normalized = normalizeCustomThemes(loaded.themes)
      const invalidCount = Math.max(0, loaded.themes.length - normalized.length)
      const summary: ThemeReloadSummary = {
        ok: true,
        directory: loaded.directory,
        loaded: normalized.length,
        skipped: loaded.skipped + invalidCount,
        errors: loaded.errors,
      }
      if (sequence !== reloadSequence.current) return { ...summary, stale: true }
      // Keep a last-known-good custom registry when a reload only contains
      // invalid payloads or could not parse any files.
      const preserveExisting =
        normalized.length === 0 &&
        customThemesRef.current.length > 0 &&
        (loaded.themes.length > 0 || loaded.errors.length > 0)
      if (!preserveExisting) setCustomThemes(normalized)
      setThemesDirectory(loaded.directory)
      setThemesLoaded(true)
      setThemesRegistryReady(true)
      setLastThemeReload(summary)
      setThemesLoading(false)
      return summary
    } catch (error) {
      const summary: ThemeReloadSummary = {
        ok: false,
        directory: themesDirectoryRef.current,
        loaded: 0,
        skipped: 0,
        errors: [],
        error: error instanceof Error ? error.message : String(error),
      }
      if (sequence === reloadSequence.current) {
        setThemesLoaded(true)
        setThemesLoading(false)
        setLastThemeReload(summary)
      }
      return summary
    }
  }, [])

  useEffect(() => {
    void reloadThemes()
  }, [reloadThemes])

  useEffect(() => {
    if (shouldFallbackThemeSelection(themesRegistryReady, availableThemes, lightThemeId, 'light')) {
      setLightThemeId(DEFAULT_LIGHT_THEME_ID)
    }
    if (shouldFallbackThemeSelection(themesRegistryReady, availableThemes, darkThemeId, 'dark')) {
      setDarkThemeId(DEFAULT_DARK_THEME_ID)
    }
  }, [
    availableThemes,
    darkThemeId,
    lightThemeId,
    setDarkThemeId,
    setLightThemeId,
    themesRegistryReady,
  ])

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode,
      resolved,
      setMode,
      lightThemeId,
      darkThemeId,
      activeThemeId: activeTheme.id,
      lightTheme: selectedLightTheme,
      darkTheme: selectedDarkTheme,
      activeTheme,
      availableThemes,
      lightThemes,
      darkThemes,
      setLightThemeId,
      setDarkThemeId,
      setLightTheme: setLightThemeId,
      setDarkTheme: setDarkThemeId,
      reloadThemes,
      themesDirectory,
      themesLoading,
      themesLoaded,
      lastThemeReload,
    }),
    [
      activeTheme.id,
      availableThemes,
      darkThemeId,
      darkThemes,
      activeTheme,
      lastThemeReload,
      lightThemeId,
      lightThemes,
      selectedDarkTheme,
      selectedLightTheme,
      mode,
      reloadThemes,
      resolved,
      setDarkThemeId,
      setLightThemeId,
      setMode,
      themesDirectory,
      themesLoaded,
      themesLoading,
    ],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used within ThemeProvider')
  return context
}
