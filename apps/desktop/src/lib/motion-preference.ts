/**
 * UI motion preference (Settings → General → Animations).
 * - `system`: follow OS prefers-reduced-motion (default)
 * - `on`: force full motion even if the OS requests reduced
 * - `off`: force reduced motion
 */

export type MotionPreference = 'system' | 'on' | 'off'

export const DEFAULT_MOTION_PREFERENCE: MotionPreference = 'system'

export const MOTION_PREFERENCE_STORAGE_KEY = 'pihuo-agent.motionPreference'
export const MOTION_PREFERENCE_EVENT = 'pihuo-agent:motion-preference'

export function isMotionPreference(value: unknown): value is MotionPreference {
  return value === 'system' || value === 'on' || value === 'off'
}

export function loadMotionPreference(): MotionPreference {
  try {
    const raw = localStorage.getItem(MOTION_PREFERENCE_STORAGE_KEY)
    if (isMotionPreference(raw)) return raw
  } catch {
    /* localStorage unavailable */
  }
  return DEFAULT_MOTION_PREFERENCE
}

export function saveMotionPreference(mode: MotionPreference): void {
  try {
    localStorage.setItem(MOTION_PREFERENCE_STORAGE_KEY, mode)
  } catch {
    /* ignore */
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(MOTION_PREFERENCE_EVENT, { detail: mode }))
  }
}

export function getSystemPrefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Resolve whether motion should be reduced given preference + OS. */
export function resolveReduceMotion(
  preference: MotionPreference,
  systemReduce = getSystemPrefersReducedMotion(),
): boolean {
  if (preference === 'off') return true
  if (preference === 'on') return false
  return systemReduce
}

export type MotionDatasetValue = 'reduce' | 'full'

export function motionDatasetValue(reduceMotion: boolean): MotionDatasetValue {
  return reduceMotion ? 'reduce' : 'full'
}

/** Apply resolved motion to <html data-motion> for CSS hooks. */
export function applyMotionDataset(reduceMotion: boolean): void {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.motion = motionDatasetValue(reduceMotion)
}

/**
 * Read current reduced-motion intent from the document (or OS fallback).
 * Used by non-React code (e.g. useCollapsible) that cannot subscribe to context.
 */
export function documentPrefersReducedMotion(): boolean {
  if (typeof document !== 'undefined') {
    const v = document.documentElement.dataset.motion
    if (v === 'reduce') return true
    if (v === 'full') return false
  }
  return getSystemPrefersReducedMotion()
}
