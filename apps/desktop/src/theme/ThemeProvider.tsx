import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

export type ThemeMode = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'
/** Light surface palette: warm (Claude-like) vs classic cool gray */
export type ColorPalette = 'warm' | 'classic'

const THEME_KEY = 'router-agents.theme'
const PALETTE_KEY = 'router-agents.palette'

interface ThemeContextValue {
  mode: ThemeMode
  resolved: ResolvedTheme
  setMode: (mode: ThemeMode) => void
  palette: ColorPalette
  setPalette: (palette: ColorPalette) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function readStoredMode(): ThemeMode {
  try {
    const v = localStorage.getItem(THEME_KEY)
    if (v === 'system' || v === 'light' || v === 'dark') return v
  } catch {
    /* ignore */
  }
  return 'system'
}

function readStoredPalette(): ColorPalette {
  try {
    // 跟随系统时浅色固定经典
    const mode = localStorage.getItem(THEME_KEY)
    if (mode === 'system' || mode === null) return 'classic'
    const v = localStorage.getItem(PALETTE_KEY)
    if (v === 'warm' || v === 'classic') return v
  } catch {
    /* ignore */
  }
  return 'classic'
}

function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'dark'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function resolveTheme(mode: ThemeMode): ResolvedTheme {
  return mode === 'system' ? getSystemTheme() : mode
}

function applyTheme(resolved: ResolvedTheme, palette: ColorPalette) {
  const root = document.documentElement
  root.dataset.theme = resolved
  root.dataset.palette = palette
  root.style.colorScheme = resolved
  document.body.dataset.theme = resolved
  document.body.dataset.palette = palette
}

interface Props {
  children: ReactNode
}

export function ThemeProvider({ children }: Props) {
  const [mode, setModeState] = useState<ThemeMode>(() => readStoredMode())
  const [palette, setPaletteState] = useState<ColorPalette>(() => readStoredPalette())
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() => getSystemTheme())

  const resolved = mode === 'system' ? systemTheme : mode

  useEffect(() => {
    applyTheme(resolved, palette)
  }, [resolved, palette])

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setSystemTheme(mq.matches ? 'dark' : 'light')
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next)
    try {
      localStorage.setItem(THEME_KEY, next)
    } catch {
      /* ignore */
    }
  }, [])

  const setPalette = useCallback((next: ColorPalette) => {
    setPaletteState(next)
    try {
      localStorage.setItem(PALETTE_KEY, next)
    } catch {
      /* ignore */
    }
  }, [])

  const value = useMemo(
    () => ({ mode, resolved, setMode, palette, setPalette }),
    [mode, resolved, setMode, palette, setPalette],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}

export { resolveTheme }
