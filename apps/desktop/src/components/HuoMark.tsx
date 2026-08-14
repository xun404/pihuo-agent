import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { documentPrefersReducedMotion } from '../lib/motion-preference'
import { type BrandAnimHandle, type BrickColor, drawBrick, easeOutCubic, sleep } from './brand-bricks'

/**
 * Modular "Huo" on the same pad/unit grid as the official Pi mark.
 * Color bricks; click replays a drop. Reduced motion stays settled.
 */

const PAD = 165.29
const UNIT = 117.36
const LETTER_W = 3
const GAP = 1
const LETTERS = 3
const COLS = LETTER_W * LETTERS + GAP * (LETTERS - 1)
const ROWS = 4
const VB_W = COLS * UNIT
const VB_H = PAD * 2 + ROWS * UNIT
const FPS = 18
const FRAME = 1000 / FPS

type Cells = Record<string, BrickColor>

type Piece = {
  color: Exclude<BrickColor, 'flash' | 'ink'>
  cells: readonly (readonly [number, number])[]
  startX: number
  startY: number
  targetX: number
  targetY: number
}

const I4 = [
  [0, 0],
  [0, 1],
  [0, 2],
  [0, 3],
] as const

const PIECES: Piece[] = [
  { color: 'orange', cells: I4, startX: 0, startY: -4, targetX: 0, targetY: 0 },
  { color: 'orange', cells: I4, startX: 2, startY: -5, targetX: 2, targetY: 0 },
  { color: 'orange', cells: [[0, 0]], startX: 1, startY: -3, targetX: 1, targetY: 1 },
  { color: 'cyan', cells: I4, startX: 4, startY: -4, targetX: 4, targetY: 0 },
  { color: 'cyan', cells: I4, startX: 6, startY: -5, targetX: 6, targetY: 0 },
  { color: 'cyan', cells: [[0, 0]], startX: 5, startY: -3, targetX: 5, targetY: 3 },
  { color: 'green', cells: I4, startX: 8, startY: -4, targetX: 8, targetY: 0 },
  { color: 'green', cells: I4, startX: 10, startY: -5, targetX: 10, targetY: 0 },
  { color: 'green', cells: [[0, 0]], startX: 9, startY: -3, targetX: 9, targetY: 0 },
  { color: 'green', cells: [[0, 0]], startX: 9, startY: -4, targetX: 9, targetY: 3 },
]

function key(x: number, y: number) {
  return `${x}:${y}`
}

function parseKey(cell: string) {
  const [x, y] = cell.split(':').map(Number)
  return { x: x ?? 0, y: y ?? 0 }
}

function mergePiece(cells: Cells, piece: Piece, x: number, y: number) {
  for (const [dx, dy] of piece.cells) cells[key(x + dx, y + dy)] = piece.color
}

function settledCells(): Cells {
  const cells: Cells = {}
  for (const piece of PIECES) mergePiece(cells, piece, piece.targetX, piece.targetY)
  return cells
}

export const HuoMark = forwardRef<
  BrandAnimHandle,
  {
    className?: string
    size?: number
    title?: string
    controlled?: boolean
  }
>(function HuoMark({ className, size = 24, title = 'Huo', controlled = false }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hostRef = useRef<HTMLElement>(null)
  const apiRef = useRef<BrandAnimHandle>({ play: async () => {}, stop: () => {} })

  useEffect(() => {
    const canvas = canvasRef.current
    const host = hostRef.current
    if (!canvas || !host) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let abort = new AbortController()

    const paint = (cells: Cells) => {
      const dpr = window.devicePixelRatio || 1
      const cssH = size
      const cssW = size * (VB_W / VB_H)
      const bw = Math.max(1, Math.round(cssW * dpr))
      const bh = Math.max(1, Math.round(cssH * dpr))
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw
        canvas.height = bh
      }
      canvas.style.width = `${cssW}px`
      canvas.style.height = `${cssH}px`
      ctx.clearRect(0, 0, bw, bh)
      const scale = bh / VB_H
      const cell = UNIT * scale
      const originY = PAD * scale
      for (const [pos, color] of Object.entries(cells)) {
        const { x, y } = parseKey(pos)
        if (x < 0 || x >= COLS) continue
        drawBrick(ctx, Math.round(x * cell), Math.round(originY + y * cell), Math.max(1, Math.round(cell)), color)
      }
    }

    const showStatic = () => paint(settledCells())

    const hold = async (cells: Cells, ms: number, signal: AbortSignal) => {
      const frames = Math.max(1, Math.round(ms / FRAME))
      for (let i = 0; i < frames; i++) {
        if (signal.aborted) return false
        paint(cells)
        if (!(await sleep(FRAME, signal))) return false
      }
      return true
    }

    const dropPiece = async (settled: Cells, piece: Piece, signal: AbortSignal) => {
      const frames = Math.max(6, Math.round(70 / FRAME))
      for (let i = 0; i < frames; i++) {
        if (signal.aborted) return false
        const t = easeOutCubic((i + 1) / frames)
        const x = Math.round(piece.startX + (piece.targetX - piece.startX) * t)
        const y = Math.round(piece.startY + (piece.targetY - piece.startY) * t)
        const frame = { ...settled }
        mergePiece(frame, piece, x, y)
        paint(frame)
        if (!(await sleep(FRAME, signal))) return false
      }
      mergePiece(settled, piece, piece.targetX, piece.targetY)
      paint(settled)
      return sleep(20, signal)
    }

    const play = async (signal: AbortSignal) => {
      const settled: Cells = {}
      if (!(await hold(settled, 40, signal))) return
      for (const piece of PIECES) {
        if (!(await dropPiece(settled, piece, signal))) return
      }
      if (!(await hold(settled, 80, signal))) return
      if (!signal.aborted) showStatic()
    }

    const run = () => {
      if (documentPrefersReducedMotion()) {
        showStatic()
        return Promise.resolve()
      }
      abort.abort()
      abort = new AbortController()
      return play(abort.signal).finally(() => {
        if (!abort.signal.aborted) showStatic()
      })
    }

    apiRef.current = {
      play: () => run(),
      stop: () => {
        abort.abort()
        paint({})
      },
    }

    showStatic()
    const onClick = () => {
      if (!controlled) void run()
    }
    host.addEventListener('click', onClick)
    return () => {
      abort.abort()
      host.removeEventListener('click', onClick)
    }
  }, [size, controlled])

  useImperativeHandle(ref, () => ({
    play: () => apiRef.current.play(),
    stop: () => apiRef.current.stop(),
  }), [])

  const Tag = controlled ? 'span' : 'button'
  return (
    <Tag
      ref={hostRef as never}
      type={controlled ? undefined : 'button'}
      className={className}
      aria-label={controlled ? undefined : title}
      title={controlled ? undefined : title}
      aria-hidden={controlled ? true : undefined}
    >
      <canvas ref={canvasRef} className="brand-huo-word-canvas" />
    </Tag>
  )
})
