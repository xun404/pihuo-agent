import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Brain } from 'lucide-react'
import { formatElapsedHms } from '../../lib/format-elapsed'
import { useStickScrollBottom } from '../../lib/use-stick-scroll-bottom'
import { useCollapsible } from './useCollapsible'

type Props = {
  /** Reasoning text. */
  text: string
  /** True while reasoning is still streaming. */
  streaming: boolean
  /** Controlled open state (parent persists). */
  open: boolean
  onToggle: (open: boolean) => void
  /** Label while streaming, e.g. "思考中" / "Thinking". */
  streamingLabel: string
  /** Label after complete without duration, e.g. "已思考" / "Thought". */
  doneLabel: string
  /**
   * Label after complete with duration.
   * Receives a compact elapsed string (locale-aware via formatElapsedHms).
   */
  doneLabelFor: (time: string) => string
  /** Locale for elapsed formatting (zh / en). */
  locale?: string
  /**
   * Stable key so elapsed survives unmount (e.g. WorkedFor collapse).
   * When set, frozen ms is stored in a module map and restored on remount.
   */
  persistKey?: string
}

/** Survives ThinkingBlock unmount when parent collapses process trail. */
const frozenElapsedByKey = new Map<string, number>()

/**
 * Client-side thinking timer.
 * - Starts when streaming becomes true
 * - Freezes when streaming ends
 * - Remount with persistKey restores frozen value
 * - Historical (never streamed this session) → null
 */
function useThinkingElapsedMs(streaming: boolean, persistKey?: string): number | null {
  const startedAtRef = useRef<number | null>(null)
  const frozenMsRef = useRef<number | null>(
    persistKey != null ? (frozenElapsedByKey.get(persistKey) ?? null) : null,
  )
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (streaming) {
      if (startedAtRef.current == null) {
        startedAtRef.current = Date.now()
        frozenMsRef.current = null
        if (persistKey) frozenElapsedByKey.delete(persistKey)
      }
      setNow(Date.now())
      const id = window.setInterval(() => setNow(Date.now()), 1000)
      return () => window.clearInterval(id)
    }

    if (startedAtRef.current != null && frozenMsRef.current == null) {
      const ms = Math.max(0, Date.now() - startedAtRef.current)
      frozenMsRef.current = ms
      if (persistKey) frozenElapsedByKey.set(persistKey, ms)
    } else if (
      frozenMsRef.current == null &&
      persistKey != null &&
      frozenElapsedByKey.has(persistKey)
    ) {
      frozenMsRef.current = frozenElapsedByKey.get(persistKey)!
    }
  }, [streaming, persistKey])

  if (streaming) {
    if (startedAtRef.current == null) return null
    return Math.max(0, now - startedAtRef.current)
  }
  if (frozenMsRef.current != null) return frozenMsRef.current
  if (persistKey != null) return frozenElapsedByKey.get(persistKey) ?? null
  return null
}

function ChevronIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
      <path
        d="M6 3.5L10.5 8L6 12.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * Reasoning block. Expand/collapse via useCollapsible (JS height animation).
 *
 * - Streaming: body open, live label
 * - Complete: auto-collapse by default; summary shows elapsed when available
 * - Collapsed: summary row only (no body preview); final answer is a sibling text part
 * - Stream body height-capped so long reasoning does not dominate the viewport
 */
export const ThinkingBlock = memo(function ThinkingBlock({
  text,
  streaming,
  open,
  onToggle,
  streamingLabel,
  doneLabel,
  doneLabelFor,
  locale = 'zh',
  persistKey,
}: Props) {
  const isOpen = open
  const { shouldRender, contentRef } = useCollapsible({ open, keepMounted: streaming })
  const elapsedMs = useThinkingElapsedMs(streaming, persistKey)
  // If a height cap is reintroduced later, keep the live body pinned to the tail.
  const bodyScrollRef = useStickScrollBottom(streaming && isOpen, text.length)

  const summaryLabel = (() => {
    if (streaming) return streamingLabel
    if (elapsedMs != null && elapsedMs >= 1000) {
      return doneLabelFor(formatElapsedHms(elapsedMs / 1000, locale))
    }
    return doneLabel
  })()

  const toggle = useCallback(() => onToggle(!isOpen), [isOpen, onToggle])
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        toggle()
      }
    },
    [toggle],
  )

  return (
    <div className={`thinking-block${streaming ? ' live' : ''}${isOpen ? ' is-open' : ''}`}>
      <div
        className="thinking-block-summary process-row-summary"
        role="button"
        tabIndex={0}
        aria-expanded={isOpen}
        onClick={toggle}
        onKeyDown={onKeyDown}
      >
        <span className="tb-icon-slot process-icon-slot" aria-hidden>
          <span className="tb-icon tb-icon-type process-icon-type">
            <Brain aria-hidden="true" />
          </span>
          <span className="tb-icon tb-icon-chevron process-icon-chevron">
            <ChevronIcon />
          </span>
        </span>
        <span className="thinking-block-label">{summaryLabel}</span>
      </div>

      {shouldRender && (
        <div ref={contentRef} aria-hidden={!isOpen} className="thinking-block-collapse">
          <div
            className="thinking-block-inner process-collapse-body"
            style={{
              opacity: isOpen ? 1 : 0,
              transform: isOpen ? 'translateY(0)' : 'translateY(-4px)',
              transition: 'opacity 180ms ease-out, transform 180ms ease-out',
            }}
          >
            <div
              ref={bodyScrollRef}
              className={`thinking-block-body${streaming ? ' live' : ''}`}
            >
              {text || '…'}
            </div>
          </div>
        </div>
      )}
    </div>
  )
})
