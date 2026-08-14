import {
  DARK_THEME_KEY,
  LEGACY_PALETTE_KEY,
  LIGHT_THEME_KEY,
  THEME_MODE_KEY,
} from '../theme/ThemeProvider'
import { MOTION_PREFERENCE_STORAGE_KEY } from './motion-preference'
import { SEND_SHORTCUT_STORAGE_KEY } from './send-shortcut'
import { MODEL_THINKING_MEMORY_STORAGE_KEY } from './model-thinking-memory'
import { FOLLOW_UP_BEHAVIOR_STORAGE_KEY } from './follow-up-behavior'
import { FOLLOW_UP_OUTBOX_STORAGE_KEY } from './follow-up-outbox'

/** Renderer-only preferences owned by PiHuo (theme files are not storage). */
export const RENDERER_PREFERENCE_KEYS = [
  'pihuo-agent.locale',
  THEME_MODE_KEY,
  LEGACY_PALETTE_KEY,
  LIGHT_THEME_KEY,
  DARK_THEME_KEY,
  SEND_SHORTCUT_STORAGE_KEY,
  FOLLOW_UP_BEHAVIOR_STORAGE_KEY,
  FOLLOW_UP_OUTBOX_STORAGE_KEY,
  MOTION_PREFERENCE_STORAGE_KEY,
  MODEL_THINKING_MEMORY_STORAGE_KEY,
  'pihuo-agent.sidebar-w',
  'pihuo-agent.drawer-w',
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
