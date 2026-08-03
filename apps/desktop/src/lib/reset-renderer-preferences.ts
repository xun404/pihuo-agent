import {
  DARK_THEME_KEY,
  LEGACY_PALETTE_KEY,
  LIGHT_THEME_KEY,
  THEME_MODE_KEY,
} from '../theme/ThemeProvider'
import { MOTION_PREFERENCE_STORAGE_KEY } from './motion-preference'
import { SEND_SHORTCUT_STORAGE_KEY } from './send-shortcut'

/** Renderer-only preferences owned by SwarmDesk (theme files are not storage). */
export const RENDERER_PREFERENCE_KEYS = [
  'swarmdesk-agent.locale',
  THEME_MODE_KEY,
  LEGACY_PALETTE_KEY,
  LIGHT_THEME_KEY,
  DARK_THEME_KEY,
  SEND_SHORTCUT_STORAGE_KEY,
  MOTION_PREFERENCE_STORAGE_KEY,
  'swarmdesk-agent.sidebar-w',
  'swarmdesk-agent.drawer-w',
] as const

export function resetRendererPreferences(): void {
  if (typeof window === 'undefined') return
  for (const key of RENDERER_PREFERENCE_KEYS) {
    try {
      window.localStorage.removeItem(key)
    } catch {
      /* localStorage unavailable */
    }
  }
}
