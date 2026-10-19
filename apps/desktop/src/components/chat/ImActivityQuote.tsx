import { Children, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronRight, Layers } from 'lucide-react'
import { documentPrefersReducedMotion as prefersReducedMotion } from '../../lib/motion-preference'

type Props = {
  label: string
  children: ReactNode
  running?: boolean
  open?: boolean
  onToggle?: (open: boolean) => void
  earlierLabel?: (count: number) => string
  previewRows?: number
}

const LIVE_ROWS = 3

export function ImActivityQuote({
  label,
  children,
  running = false,
  open,
  onToggle,
  earlierLabel,
  previewRows = LIVE_ROWS,
}: Props) {
  const [localOpen, setLocalOpen] = useState(false)
  const expanded = open ?? localOpen
  const visible = expanded || (running && previewRows > 0)
  const [retained, setRetained] = useState(visible)
  const contentId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const previousVisible = useRef(visible)
  const rows = Children.toArray(children)
  const displayedRows = expanded ? rows : previewRows > 0 ? rows.slice(-previewRows) : []
  const retainedRowCount = useRef(displayedRows.length)
  const hiddenCount =
    running && !expanded && previewRows > 0 ? Math.max(0, rows.length - previewRows) : 0

  useLayoutEffect(() => {
    if (visible) retainedRowCount.current = displayedRows.length
  })

  useLayoutEffect(() => {
    const element = contentRef.current
    if (!element) return
    const settle = () => {
      element.style.height = visible ? 'auto' : '0px'
      element.style.overflow = visible ? 'visible' : 'hidden'
      setRetained(visible)
    }
    if (previousVisible.current === visible) {
      settle()
      return
    }
    previousVisible.current = visible
    if (!visible && element.contains(document.activeElement)) {
      buttonRef.current?.focus({ preventScroll: true })
    }

    const root = rootRef.current
    const scroller = root?.closest<HTMLElement>('.messages-scroll')
    const anchor = root?.nextElementSibling ?? root?.closest('.msg')?.nextElementSibling
    if (
      !visible &&
      root &&
      scroller &&
      anchor &&
      root.getBoundingClientRect().bottom <= scroller.getBoundingClientRect().top
    ) {
      const top = anchor.getBoundingClientRect().top
      settle()
      scroller.scrollTop += anchor.getBoundingClientRect().top - top
      return
    }
    if (document.hidden || prefersReducedMotion()) {
      settle()
      return
    }
    const expandedHeight = element.scrollHeight
    element.style.height = visible ? '0px' : `${expandedHeight}px`
    element.style.overflow = 'hidden'
    const animation = element.animate(
      [
        { height: visible ? '0px' : `${expandedHeight}px` },
        { height: visible ? `${expandedHeight}px` : '0px' },
      ],
      { duration: 180, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
    )
    let cancelled = false
    const finish = () => {
      if (!cancelled) settle()
    }
    void animation.finished.then(finish, finish)
    return () => {
      cancelled = true
      animation.cancel()
    }
  }, [visible])

  return (
    <div
      ref={rootRef}
      className={`im-activity${expanded ? ' is-open' : ''}${running ? ' is-live' : ''}`}
    >
      <button
        ref={buttonRef}
        type="button"
        className="im-activity-quote"
        onClick={() => (onToggle ? onToggle(!expanded) : setLocalOpen(!expanded))}
        aria-expanded={expanded}
        aria-controls={contentId}
      >
        <Layers size={13} aria-hidden />
        <span className="im-activity-label">{label}</span>
        <ChevronRight size={12} className="im-activity-chev" aria-hidden />
        {hiddenCount > 0 && earlierLabel ? (
          <span className="im-activity-earlier">{earlierLabel(hiddenCount)}</span>
        ) : null}
      </button>
      <div
        ref={contentRef}
        id={contentId}
        aria-hidden={!visible}
        inert={!visible}
        className="im-activity-collapse"
        style={{
          height: visible || retained ? 'auto' : 0,
          overflow: visible || retained ? 'visible' : 'hidden',
        }}
      >
        {visible || retained ? (
          <div className="im-activity-detail">
            {visible
              ? displayedRows
              : retainedRowCount.current > 0
                ? rows.slice(-retainedRowCount.current)
                : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
