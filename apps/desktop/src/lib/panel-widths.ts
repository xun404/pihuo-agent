/**
 * Chat shell panel widths (left sidebar + right inspector).
 * Persisted in localStorage so resize survives restarts.
 */

const SIDEBAR_KEY = 'pihuo-agent.sidebar-w'
const DRAWER_KEY = 'pihuo-agent.drawer-w'

export const SIDEBAR_W_DEFAULT = 232
export const SIDEBAR_W_MIN = 180
export const SIDEBAR_W_MAX = 360

export const DRAWER_W_DEFAULT = 300
export const DRAWER_W_MIN = 260
export const DRAWER_W_MAX = 480

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(n)))
}

function readNumber(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    const n = Number(raw)
    return Number.isFinite(n) ? n : fallback
  } catch {
    return fallback
  }
}

function writeNumber(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value))
  } catch {
    /* localStorage unavailable */
  }
}

export function loadSidebarWidth(): number {
  return clamp(readNumber(SIDEBAR_KEY, SIDEBAR_W_DEFAULT), SIDEBAR_W_MIN, SIDEBAR_W_MAX)
}

export function loadDrawerWidth(): number {
  return clamp(readNumber(DRAWER_KEY, DRAWER_W_DEFAULT), DRAWER_W_MIN, DRAWER_W_MAX)
}

export function saveSidebarWidth(value: number): number {
  const next = clamp(value, SIDEBAR_W_MIN, SIDEBAR_W_MAX)
  writeNumber(SIDEBAR_KEY, next)
  return next
}

export function saveDrawerWidth(value: number): number {
  const next = clamp(value, DRAWER_W_MIN, DRAWER_W_MAX)
  writeNumber(DRAWER_KEY, next)
  return next
}

export function clampSidebarWidth(value: number): number {
  return clamp(value, SIDEBAR_W_MIN, SIDEBAR_W_MAX)
}

export function clampDrawerWidth(value: number): number {
  return clamp(value, DRAWER_W_MIN, DRAWER_W_MAX)
}
