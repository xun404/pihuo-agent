// Apply the saved built-in theme before React mounts (no inline script / CSP-safe).
// Custom files are loaded by ThemeProvider after the renderer IPC bridge is ready.
import { applyAppearanceVariables } from './theme/appearance.config'
import {
  builtinColorThemes,
  DEFAULT_DARK_THEME_ID,
  DEFAULT_LIGHT_THEME_ID,
  findBuiltinColorTheme,
  type ColorTheme,
} from './theme/theme.config'

const MODE_KEY = 'swarmdesk-agent.theme'
const LEGACY_PALETTE_KEY = 'swarmdesk-agent.palette'
const LIGHT_THEME_KEY = 'swarmdesk-agent.light-theme'
const DARK_THEME_KEY = 'swarmdesk-agent.dark-theme'

function validThemeId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,63}$/u.test(value.trim())
}

function readLightThemeId(): string {
  const current = localStorage.getItem(LIGHT_THEME_KEY)
  if (validThemeId(current)) {
    const normalized = current.trim().toLowerCase()
    if (normalized !== 'classic' && normalized !== 'mono-plus' && normalized !== 'warm')
      return normalized
    localStorage.setItem(LIGHT_THEME_KEY, DEFAULT_LIGHT_THEME_ID)
    return DEFAULT_LIGHT_THEME_ID
  }
  const legacy = localStorage.getItem(LEGACY_PALETTE_KEY)
  const migrated = DEFAULT_LIGHT_THEME_ID
  if (legacy !== null) {
    localStorage.setItem(LIGHT_THEME_KEY, migrated)
    localStorage.removeItem(LEGACY_PALETTE_KEY)
  }
  return migrated
}

function readDarkThemeId(): string {
  const value = localStorage.getItem(DARK_THEME_KEY)
  if (!validThemeId(value)) return DEFAULT_DARK_THEME_ID
  const normalized = value.trim().toLowerCase()
  if (normalized === 'dark') {
    localStorage.setItem(DARK_THEME_KEY, DEFAULT_DARK_THEME_ID)
    return DEFAULT_DARK_THEME_ID
  }
  return normalized
}

/** Resolve a stored ID to a bundled theme without ever applying a wrong variant. */
export function resolveBuiltinThemeForBootstrap(
  id: string,
  resolved: 'light' | 'dark',
): ColorTheme {
  const selected = findBuiltinColorTheme(id)
  if (selected?.variant === resolved) return selected

  const fallback = findBuiltinColorTheme(
    resolved === 'dark' ? DEFAULT_DARK_THEME_ID : DEFAULT_LIGHT_THEME_ID,
  )
  if (fallback?.variant === resolved) return fallback

  return builtinColorThemes.find((theme) => theme.variant === resolved) ?? builtinColorThemes[0]!
}

function applyFallbackAppearance(): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const theme = resolveBuiltinThemeForBootstrap(DEFAULT_LIGHT_THEME_ID, 'light')
  root.dataset.theme = 'light'
  root.dataset.themeId = theme.id
  root.dataset.palette = theme.id
  root.style.colorScheme = 'light'
  applyAppearanceVariables('light', theme, root)
}

try {
  const mode = localStorage.getItem(MODE_KEY) || 'system'
  const dark =
    mode === 'dark' ||
    (mode !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  const resolved = dark ? 'dark' : 'light'
  const themeId = resolved === 'dark' ? readDarkThemeId() : readLightThemeId()
  const theme = resolveBuiltinThemeForBootstrap(themeId, resolved)

  document.documentElement.dataset.theme = resolved
  document.documentElement.dataset.themeId = theme.id
  document.documentElement.dataset.palette = theme.id
  document.documentElement.style.colorScheme = resolved
  applyAppearanceVariables(resolved, theme)
} catch {
  // localStorage/matchMedia may be unavailable during a constrained launch.
  applyFallbackAppearance()
}

export {}
