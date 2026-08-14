import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { documentPrefersReducedMotion } from '../lib/motion-preference'
import type { BrandAnimHandle } from './brand-bricks'
import { PiMark } from './PiMark'

/**
 * Sidebar-scale port of pi.dev `.hero-logo-stage`:
 * four tetrominoes drop on an 8×9 board, a line flashes, the rest settle
 * into the official 4×4 Pi mark. Click replays. Reduced motion stays static.
 */

const BOARD_W = 8
const BOARD_H = 9
const CLEAR_ROW = 6
const VISIBLE_COLS = 4
const VISIBLE_ROWS = 4
const OFFSET_X = 2
const OFFSET_Y = 3
const FPS = 18
const FRAME = 1000 / FPS

type PieceColor = 'cyan' | 'red' | 'green' | 'orange' | 'flash' | 'ink'
type Cells = Record<string, PieceColor>

type Piece = {
  color: Exclude<PieceColor, 'flash' | 'ink'>
  cells: readonly (readonly [number, number])[]
  startX: number
  startY: number
  targetX: number
  targetY: number
}

const COLORS: Record<PieceColor, string> = {
  cyan: '#4B607C',
  red: '#8F4632',
  green: '#A3A473',
  orange: '#D4904E',
  flash: '#fff5b4',
  ink: '#09090B',
}

const TOP: Piece = {
  color: 'cyan',
  cells: [
    [0, 0],
    [0, 1],
    [0, 2],
    [1, 2],
  ],
  startX: 2,
  startY: -2,
  targetX: 2,
  targetY: 2,
}
const LEFT: Piece = {
  color: 'red',
  cells: [
    [0, 0],
    [1, 0],
    [1, 1],
    [2, 0],
  ],
  startX: 0,
  startY: -3,
  targetX: 2,
  targetY: 3,
}
const RIGHT: Piece = {
  color: 'green',
  cells: [
    [0, 0],
    [1, 0],
    [2, 0],
    [2, 1],
  ],
  startX: 5,
  startY: -3,
  targetX: 5,
  targetY: 4,
}
const BASE: Piece = {
  color: 'orange',
  cells: [
    [0, 0],
    [0, 1],
    [0, 2],
    [0, 3],
  ],
  startX: 1,
  startY: -2,
  targetX: 1,
  targetY: 6,
}

const SEQUENCE: { piece: Piece; duration: number; holdAfter: number }[] = [
  { piece: BASE, duration: 91, holdAfter: 11 },
  { piece: LEFT, duration: 91, holdAfter: 11 },
  { piece: TOP, duration: 91, holdAfter: 11 },
  { piece: RIGHT, duration: 91, holdAfter: 49 },
]

const FINAL_LOGO = ['3:2', '3:3', '3:4', '4:2', '4:4', '5:2', '5:3', '5:5', '6:2', '6:5']

function key(y: number, x: number) {
  return `${y}:${x}`
}

function parseKey(cell: string) {
  const [y, x] = cell.split(':').map(Number)
  return { y: y ?? 0, x: x ?? 0 }
}

function mergePiece(cells: Cells, piece: Piece, x: number, y: number) {
  for (const [dy, dx] of piece.cells) cells[key(y + dy, x + dx)] = piece.color
}

function easeOutCubic(t: number) {
  return 1 - (1 - t) ** 3
}

function sleep(ms: number, signal: AbortSignal) {
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

function drawBlock(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  size: number,
  fill: string,
) {
  ctx.fillStyle = fill
  ctx.fillRect(left, top, size, size)
  if (size < 4) return
  ctx.fillStyle = 'rgba(255,255,255,0.18)'
  ctx.fillRect(left, top, size, Math.max(1, Math.floor(size * 0.18)))
  ctx.fillStyle = 'rgba(0,0,0,0.22)'
  ctx.fillRect(left, top + size - Math.max(1, Math.floor(size * 0.16)), size, Math.max(1, Math.floor(size * 0.16)))
}

type Props = {
  className?: string
  size?: number
  label: string
  controlled?: boolean
}

export const PiLogoStage = forwardRef<BrandAnimHandle, Props>(function PiLogoStage(
  { className, size = 24, label, controlled = false },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLElement>(null)
  const inkRef = useRef('#09090B')
  const apiRef = useRef<BrandAnimHandle>({ play: async () => {}, stop: () => {} })
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    const stage = stageRef.current
    if (!canvas || !stage) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let abort = new AbortController()

    const paint = (cells: Cells) => {
      const dpr = window.devicePixelRatio || 1
      const cellCss = size / VISIBLE_COLS
      const cssW = cellCss * BOARD_W
      const cssH = cellCss * BOARD_H
      const bw = Math.max(1, Math.round(cssW * dpr))
      const bh = Math.max(1, Math.round(cssH * dpr))
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw
        canvas.height = bh
      }
      canvas.style.width = `${cssW}px`
      canvas.style.height = `${cssH}px`
      ctx.clearRect(0, 0, bw, bh)
      const cell = bw / BOARD_W
      for (const [pos, color] of Object.entries(cells)) {
        const { y, x } = parseKey(pos)
        // Only the official 4×4 window. Home's float/drop-shadow otherwise
        // leaks 1px of the row above (TOP's hat) as a hairline.
        if (
          y < OFFSET_Y ||
          y >= OFFSET_Y + VISIBLE_ROWS ||
          x < OFFSET_X ||
          x >= OFFSET_X + VISIBLE_COLS
        ) {
          continue
        }
        const fill = color === 'ink' ? inkRef.current : COLORS[color]
        drawBlock(ctx, Math.round(x * cell), Math.round(y * cell), Math.max(1, Math.round(cell)), fill)
      }
    }

    const settledStatic = (): Cells => {
      inkRef.current = getComputedStyle(stage).color || COLORS.ink
      const cells: Cells = {}
      for (const pos of FINAL_LOGO) cells[pos] = 'ink'
      return cells
    }

    const showStatic = () => paint(settledStatic())

    const hold = async (cells: Cells, ms: number, signal: AbortSignal) => {
      const frames = Math.max(1, Math.round(ms / FRAME))
      for (let i = 0; i < frames; i++) {
        if (signal.aborted) return false
        paint(cells)
        if (!(await sleep(FRAME, signal))) return false
      }
      return true
    }

    const dropPiece = async (settled: Cells, piece: Piece, duration: number, signal: AbortSignal) => {
      const startY = piece.startY
      const frames = Math.max(7, Math.round(duration / FRAME))
      for (let i = 0; i < frames; i++) {
        if (signal.aborted) return false
        const t = easeOutCubic((i + 1) / frames)
        const x = Math.round(piece.startX + (piece.targetX - piece.startX) * t)
        const y = Math.round(startY + (piece.targetY - startY) * t)
        const frame = { ...settled }
        mergePiece(frame, piece, x, y)
        paint(frame)
        if (!(await sleep(FRAME, signal))) return false
      }
      mergePiece(settled, piece, piece.targetX, piece.targetY)
      paint(settled)
      return sleep(35, signal)
    }

    const play = async (signal: AbortSignal) => {
      const settled: Cells = {}
      if (!(await hold(settled, 28, signal))) return
      for (const step of SEQUENCE) {
        if (!(await dropPiece(settled, step.piece, step.duration, signal))) return
        if (step.holdAfter && !(await hold(settled, step.holdAfter, signal))) return
      }
      const ink = 'ink' as const
      for (let i = 0; i < 5; i++) {
        const flash: Cells = { ...settled }
        if (i % 2 === 0) {
          for (let x = 1; x <= 6; x++) flash[key(CLEAR_ROW, x)] = 'flash'
          for (const pos of Object.keys(flash)) if (flash[pos] !== 'flash') flash[pos] = ink
        }
        if (!(await hold(flash, 35, signal))) return
      }
      const floating: Cells = {}
      for (const [pos] of Object.entries(settled)) {
        if (parseKey(pos).y !== CLEAR_ROW) floating[pos] = ink
      }
      if (!(await hold(floating, 49, signal))) return
      const dropped: Cells = {}
      for (const [pos, color] of Object.entries(floating)) {
        const p = parseKey(pos)
        dropped[key(p.y + 1, p.x)] = color
      }
      if (!(await hold(dropped, 120, signal))) return
      if (!signal.aborted) {
        showStatic()
        setPlaying(false)
      }
    }

    const run = (replay: boolean) => {
      if (documentPrefersReducedMotion()) {
        setPlaying(false)
        showStatic()
        return Promise.resolve()
      }
      abort.abort()
      abort = new AbortController()
      setPlaying(true)
      const signal = abort.signal
      const start = replay
        ? (async () => {
            for (let step = 1; step <= 6; step++) {
              const slide: Cells = {}
              for (const pos of FINAL_LOGO) {
                const p = parseKey(pos)
                slide[key(p.y + step, p.x)] = 'ink'
              }
              paint(slide)
              if (!(await sleep(63, signal))) return
            }
            paint({})
            await sleep(56, signal)
            await play(signal)
          })()
        : play(signal)
      return start.finally(() => {
        if (!signal.aborted) {
          showStatic()
          setPlaying(false)
        }
      })
    }

    apiRef.current = {
      play: (replay = true) => run(replay),
      stop: () => {
        abort.abort()
        showStatic()
        setPlaying(false)
      },
    }

    showStatic()
    const onClick = () => {
      if (!controlled) void run(true)
    }
    stage.addEventListener('click', onClick)
    return () => {
      abort.abort()
      setPlaying(false)
      stage.removeEventListener('click', onClick)
    }
  }, [size, controlled])

  useImperativeHandle(ref, () => ({
    play: (replay = true) => apiRef.current.play(replay),
    stop: () => apiRef.current.stop(),
  }), [])

  const Tag = controlled ? 'span' : 'button'
  return (
    <Tag
      ref={stageRef as never}
      type={controlled ? undefined : 'button'}
      className={className}
      aria-label={controlled ? undefined : label}
      title={controlled ? undefined : label}
      aria-hidden={controlled ? true : undefined}
      style={{ ['--pi-size' as string]: `${size}px` }}
    >
      <span className="brand-pi-stage-clip" aria-hidden>
        <canvas
          ref={canvasRef}
          className="brand-pi-stage-canvas"
          data-playing={playing ? 'true' : 'false'}
        />
        <PiMark className="brand-pi-stage-mark" size={size} />
      </span>
    </Tag>
  )
})
