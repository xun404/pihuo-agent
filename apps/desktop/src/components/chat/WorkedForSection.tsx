import { memo, useCallback, type ReactNode } from 'react'
import { useCollapsible } from './useCollapsible'

type Props = {
  /** Controlled expand state. Default collapsed when turn is done. */
  open: boolean
  onToggle: (open: boolean) => void
  /**
   * Summary label, e.g. "已处理 7m 53s" / "Worked for 7m 53s".
   * Parent owns i18n + elapsed formatting.
   */
  label: string
  /** Process rows: thinking / tools / workers / task lists. */
  children: ReactNode
}

function ChevronIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden>
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
 * Turn-level process collapse (worked-for summary).
 *
 * - Collapsed: one secondary summary row + divider; final answer stays outside
 * - Expanded: full process trail (thinking / tools / workers)
 * - Height animation via useCollapsible
 */
export const WorkedForSection = memo(function WorkedForSection({
  open,
  onToggle,
  label,
  children,
}: Props) {
  const { shouldRender, contentRef } = useCollapsible({ open, keepMounted: false })

  const toggle = useCallback(() => onToggle(!open), [open, onToggle])
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
    <div className={`worked-for${open ? ' is-open' : ''}`}>
      <div
        className="worked-for-summary"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={toggle}
        onKeyDown={onKeyDown}
      >
        <span className="worked-for-label">{label}</span>
        <span className={`worked-for-chevron${open ? ' is-open' : ''}`} aria-hidden>
          <ChevronIcon />
        </span>
      </div>
      <div className="worked-for-rule" aria-hidden />

      {shouldRender && (
        <div ref={contentRef} aria-hidden={!open} className="worked-for-collapse">
          <div
            className="worked-for-inner"
            style={{
              opacity: open ? 1 : 0,
              transform: open ? 'translateY(0)' : 'translateY(-4px)',
              transition: 'opacity 180ms ease-out, transform 180ms ease-out',
            }}
          >
            <div className="worked-for-body">{children}</div>
          </div>
        </div>
      )}
    </div>
  )
})
