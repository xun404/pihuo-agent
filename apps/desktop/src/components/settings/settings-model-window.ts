/** Card min-height 64px + list gap 6px. Keep in sync with `.settings-model-list` / `.model-card`. */
export const MODEL_ROW_STRIDE_PX = 70
export const MODEL_LIST_OVERSCAN = 4

export type ModelListWindow = {
  start: number
  end: number
}

/**
 * Visible slice for the catalog model list. The settings main pane scrolls;
 * `listOffset` is the list's offset from the scroller content origin.
 */
export function modelListWindow(input: {
  count: number
  scrollTop: number
  viewportHeight: number
  listOffset: number
  rowStride?: number
  overscan?: number
}): ModelListWindow {
  const count = Math.max(0, Math.floor(input.count))
  if (count === 0) return { start: 0, end: 0 }
  const stride = input.rowStride ?? MODEL_ROW_STRIDE_PX
  const overscan = input.overscan ?? MODEL_LIST_OVERSCAN
  const viewport = Math.max(1, input.viewportHeight)
  const top = Math.max(0, input.scrollTop - input.listOffset)
  const start = Math.min(count, Math.max(0, Math.floor(top / stride) - overscan))
  const visible = Math.max(1, Math.ceil(viewport / stride))
  const end = Math.min(count, start + visible + overscan * 2)
  return { start, end }
}

export function formatModelContextLabel(n?: number): string | null {
  if (n == null || !Number.isFinite(n) || n <= 0) return null
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(n)
}
