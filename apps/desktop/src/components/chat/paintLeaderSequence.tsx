import { isValidElement, type ReactElement, type ReactNode } from 'react'

export function isLeaderTextNode(node: ReactNode): node is ReactElement<{ className?: string }> {
  if (!isValidElement(node)) return false
  const className = (node.props as { className?: unknown }).className
  return typeof className === 'string' && /(^|\s)sup-text(\s|$)/.test(className)
}

/**
 * Wrap adjacent Leader text nodes in `.bubble` without concatenating markdown.
 * Thinking, tools, Todo, errors, and 1:1 Worker cards stay siblings.
 */
export function paintLeaderSequence(
  items: readonly ReactNode[],
  pending?: ReactNode | null,
): ReactNode[] {
  const out: ReactNode[] = []
  let buffer: ReactNode[] = []
  const flush = () => {
    if (buffer.length === 0) return
    out.push(
      <div className="bubble" key={`im-bubble-${out.length}`}>
        {buffer}
      </div>,
    )
    buffer = []
  }
  for (const item of items) {
    if (item == null || item === false || item === true) continue
    if (isLeaderTextNode(item)) buffer.push(item)
    else {
      flush()
      out.push(item)
    }
  }
  flush()
  if (pending) {
    out.push(
      <div className="bubble" key="im-pending-bubble">
        {pending}
      </div>,
    )
  }
  return out
}

function isBubbleElement(node: ReactNode): boolean {
  if (!isValidElement(node)) return false
  const className = (node.props as { className?: unknown }).className
  return typeof className === 'string' && /(^|\s)bubble(\s|$)/.test(className)
}

/** Peel trailing `.bubble` nodes so copy/meta can sit beside them, not below. */
export function partitionTrailingBubbles(nodes: readonly ReactNode[]): {
  head: ReactNode[]
  bubbles: ReactNode[]
} {
  const list = nodes.filter((node) => node != null && node !== false && node !== true)
  let split = list.length
  while (split > 0 && isBubbleElement(list[split - 1])) split -= 1
  return { head: list.slice(0, split), bubbles: list.slice(split) }
}
