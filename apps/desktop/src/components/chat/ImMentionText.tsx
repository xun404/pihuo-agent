import { cloneElement, Fragment, isValidElement, type ReactNode } from 'react'
import { splitMentions } from '../../lib/im-mentions'

export function ImMentionText({
  text,
  names,
  onMentionClick,
}: {
  text: string
  names: readonly string[]
  onMentionClick?: (name: string) => void
}) {
  const segments = splitMentions(text, names)
  if (segments.length === 1 && segments[0]?.type === 'text') return <>{segments[0].value}</>
  return (
    <>
      {segments.map((segment, index) =>
        segment.type === 'mention' ? (
          <button
            key={`${segment.value}-${index}`}
            type="button"
            className="im-mention"
            onClick={() => onMentionClick?.(segment.value)}
          >
            @{segment.value}
          </button>
        ) : (
          <span key={`t-${index}`}>{segment.value}</span>
        ),
      )}
    </>
  )
}

/** Chip @Name tokens in markdown children; leave code / custom nodes alone. */
export function mentionifyChildren(
  node: ReactNode,
  names: readonly string[],
  onMentionClick?: (name: string) => void,
): ReactNode {
  if (node == null || typeof node === 'boolean') return node
  if (typeof node === 'string' || typeof node === 'number') {
    return <ImMentionText text={String(node)} names={names} onMentionClick={onMentionClick} />
  }
  if (Array.isArray(node)) {
    return node.map((child, index) => (
      <Fragment key={index}>{mentionifyChildren(child, names, onMentionClick)}</Fragment>
    ))
  }
  if (!isValidElement(node)) return node
  if (typeof node.type !== 'string') return node
  if (node.type === 'code' || node.type === 'pre') return node
  const children = (node.props as { children?: ReactNode }).children
  if (children == null) return node
  return cloneElement(node, undefined, mentionifyChildren(children, names, onMentionClick))
}
