/**
 * Format elapsed seconds for tool / thinking / worker timers.
 * 0–10s: 0.1s steps (e.g. 3.2s); >10s: 1s steps (e.g. 12s).
 */
export function formatElapsedSeconds(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0.0s'
  if (sec < 10) {
    const tenths = Math.floor(sec * 10) / 10
    return `${tenths.toFixed(1)}s`
  }
  return `${Math.floor(sec)}s`
}

/**
 * Supervisor 消息耗时：支持时分秒换算。
 * zh: 3.2秒 / 45秒 / 2分15秒 / 1时2分3秒
 * en: 3.2s / 45s / 2m 15s / 1h 2m 3s
 */
export function formatElapsedHms(sec: number, locale = 'zh'): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0
  const zh = locale === 'zh' || locale.startsWith('zh')
  const total = Math.floor(sec)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60

  if (h > 0) {
    return zh ? `${h}时${m}分${s}秒` : `${h}h ${m}m ${s}s`
  }
  if (m > 0) {
    return zh ? `${m}分${s}秒` : `${m}m ${s}s`
  }
  // < 1 分钟
  if (sec < 10) {
    const tenths = Math.floor(sec * 10) / 10
    return zh ? `${tenths.toFixed(1)}秒` : `${tenths.toFixed(1)}s`
  }
  return zh ? `${s}秒` : `${s}s`
}

/**
 * Compact duration for process summary rows (worked-for / tool / worker).
 * Always latin units (7m 53s), trims zero units.
 */
export function formatElapsedCompact(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0
  const total = Math.floor(sec)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60

  if (h > 0) {
    if (m === 0 && s === 0) return `${h}h`
    if (s === 0) return `${h}h ${m}m`
    return `${h}h ${m}m ${s}s`
  }
  if (m > 0) {
    if (s === 0) return `${m}m`
    return `${m}m ${s}s`
  }
  if (sec < 10) {
    const tenths = Math.floor(sec * 10) / 10
    return `${tenths.toFixed(1)}s`
  }
  return `${s}s`
}
