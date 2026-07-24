import React, { type ReactNode } from 'react'
import { useCollapsible } from '../chat/useCollapsible'

type ExpandableProps = {
  /** Controlled open state. */
  open: boolean
  children: ReactNode
  /** Applied to the height-animated shell. */
  className?: string
  /** Applied to the inner content box (padding / layout). */
  contentClassName?: string
  /** Keep children mounted while closed (e.g. streaming). */
  keepMounted?: boolean
}

/**
 * Height expand/collapse with delayed unmount.
 * Uses the shared useCollapsible animation (0 ↔ scrollHeight, 200ms).
 */
export function Expandable({
  open,
  children,
  className,
  contentClassName,
  keepMounted = false,
}: ExpandableProps) {
  const { shouldRender, contentRef } = useCollapsible({ open, keepMounted })
  if (!shouldRender) return null
  return (
    <div
      ref={contentRef}
      className={className ? `expandable ${className}` : 'expandable'}
      data-open={open ? 'true' : 'false'}
      aria-hidden={!open}
    >
      {contentClassName ? <div className={contentClassName}>{children}</div> : children}
    </div>
  )
}
