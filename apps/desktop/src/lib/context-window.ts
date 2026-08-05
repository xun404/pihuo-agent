/** Parse context window: integer or 20K / 128K / 1M shorthand */
export function parseContextWindow(raw: string): number | undefined {
  const s = raw.trim()
  if (!s) return undefined
  const m = s.match(/^(\d+(?:\.\d+)?)\s*([kKmM])?$/)
  if (!m) {
    const n = Number(s)
    return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined
  }
  const n = Number(m[1])
  if (!Number.isFinite(n) || n <= 0) return undefined
  const unit = (m[2] ?? '').toLowerCase()
  if (unit === 'k') return Math.round(n * 1000)
  if (unit === 'm') return Math.round(n * 1_000_000)
  return Math.round(n)
}

export function formatContextWindow(n?: number): string | null {
  if (n == null || !Number.isFinite(n) || n <= 0) return null
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (n >= 1000) return `${Math.round(n / 1000)}K`
  return String(n)
}

/**
 * Compact token count for chat context tip.
 * Always K / M (no locale-specific 万/亿).
 * `locale` kept for call-site compatibility; unused.
 */
export function formatTokenCountDisplay(n: number, _locale?: string): string {
  if (!Number.isFinite(n) || n < 0) return '0'
  if (n >= 1_000_000) {
    const v = n / 1_000_000
    return `${trimTrailingZero(v.toFixed(v >= 10 ? 0 : 1))}M`
  }
  if (n >= 1000) {
    const v = n / 1000
    return `${trimTrailingZero(v.toFixed(v >= 100 ? 0 : 1))}K`
  }
  return String(Math.round(n))
}

function trimTrailingZero(s: string): string {
  return s.replace(/\.0$/, '')
}
