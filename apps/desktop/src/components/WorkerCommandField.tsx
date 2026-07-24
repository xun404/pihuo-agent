import { useEffect, useRef, useState } from 'react'

interface Props {
  /** Full command string (path + args). */
  command: string
}

/**
 * Renders a command value kept on a single line.
 *
 * - When the text fits, it is shown right-aligned in full.
 * - When it overflows, the default state shows the **tail** of the command
 *   (the start is scrolled out to the left with a fade). Hovering scrolls the
 *   **head** into view from right to left.
 *
 * The overflow amount is measured with a ResizeObserver so the behaviour only
 * kicks in for genuinely overflowing commands.
 */
export function WorkerCommandField({ command }: Props) {
  const containerRef = useRef<HTMLSpanElement>(null)
  const textRef = useRef<HTMLSpanElement>(null)
  const [overflowPx, setOverflowPx] = useState(0)
  const [hovered, setHovered] = useState(false)

  useEffect(() => {
    const measure = () => {
      const container = containerRef.current
      const text = textRef.current
      if (!container || !text) return
      const over = text.scrollWidth - container.clientWidth
      setOverflowPx(over > 1 ? over : 0)
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (containerRef.current) ro.observe(containerRef.current)
    if (textRef.current) ro.observe(textRef.current)
    return () => ro.disconnect()
  }, [command])

  const isOverflow = overflowPx > 0
  // Default (not hovering): translate the head out to the left so the tail
  // stays visible at the right edge. Hovering: bring it back to 0 (head visible).
  const translateX = isOverflow && !hovered ? -overflowPx : 0

  return (
    <span
      ref={containerRef}
      className={`worker-info-value mono is-emphasized worker-command-marquee${isOverflow ? ' is-overflow' : ''}`}
      title={isOverflow ? command : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span
        ref={textRef}
        className="worker-command-text"
        style={isOverflow ? { transform: `translateX(${translateX}px)` } : undefined}
      >
        {command}
      </span>
    </span>
  )
}
