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
