/** Shared tetromino brick paint — same palette as pi.dev hero-logo-stage. */

export const BRICK_COLORS = {
  cyan: '#4B607C',
  red: '#8F4632',
  green: '#A3A473',
  orange: '#D4904E',
  flash: '#fff5b4',
  ink: '#09090B',
} as const

export const BRICK_BORDERS = {
  cyan: '#2D3D55',
  red: '#4F271C',
  green: '#5A5A3F',
  orange: '#754F2B',
  flash: '#c4b56a',
  ink: '#09090B',
} as const

export type BrickColor = keyof typeof BRICK_COLORS

export type BrandAnimHandle = {
  play: (replay?: boolean) => Promise<void>
  stop: () => void
}

export function easeOutCubic(t: number) {
  return 1 - (1 - t) ** 3
}

export function sleep(ms: number, signal: AbortSignal) {
  return new Promise<boolean>((resolve) => {
    if (signal.aborted) {
      resolve(false)
      return
    }
    const timer = window.setTimeout(() => resolve(!signal.aborted), ms)
    signal.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timer)
        resolve(false)
      },
      { once: true },
    )
  })
}

export function drawBrick(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  size: number,
  color: BrickColor | string,
) {
  const named = color in BRICK_COLORS ? (color as BrickColor) : null
  const fill = named ? BRICK_COLORS[named] : color
  const border = named ? BRICK_BORDERS[named] : 'rgba(0,0,0,0.45)'
  const gap = size >= 6 ? Math.max(1, Math.round(size * 0.1)) : 0
  const s = size - gap
  const x = left + Math.floor(gap / 2)
  const y = top + Math.floor(gap / 2)
  if (s <= 0) {
    ctx.fillStyle = fill
    ctx.fillRect(left, top, size, size)
    return
  }

  ctx.fillStyle = fill
  ctx.fillRect(x, y, s, s)

  const topH = Math.max(1, Math.round(s * 0.2))
  const botH = Math.max(1, Math.round(s * 0.22))
  const sideW = Math.max(1, Math.round(s * 0.16))

  ctx.fillStyle = 'rgba(255,255,255,0.3)'
  ctx.fillRect(x, y, s, topH)
  ctx.fillStyle = 'rgba(255,255,255,0.12)'
  ctx.fillRect(x, y, sideW, s)

  ctx.fillStyle = border
  ctx.globalAlpha = 0.55
  ctx.fillRect(x, y + s - botH, s, botH)
  ctx.globalAlpha = 0.32
  ctx.fillRect(x + s - sideW, y, sideW, s)
  ctx.globalAlpha = 1

  if (s >= 7) {
    const stud = Math.max(2, Math.round(s * 0.28))
    const sx = x + Math.round((s - stud) / 2)
    const sy = y + Math.max(1, Math.round(s * 0.28))
    ctx.fillStyle = 'rgba(255,255,255,0.22)'
    ctx.fillRect(sx, sy, stud, Math.max(1, Math.round(stud * 0.4)))
    ctx.fillStyle = 'rgba(0,0,0,0.18)'
    ctx.fillRect(sx, sy + Math.max(1, Math.round(stud * 0.4)), stud, 1)
  }
}
