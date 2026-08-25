import type { ReactNode } from 'react'
import type { UserQuoteChrome } from '../../lib/user-message-display'
import type { MentionCandidate } from '../../lib/im-mentions'

export function ImQuoteDock({
  quote,
  onClear,
  closeLabel,
}: {
  quote: UserQuoteChrome | null
  onClear: () => void
  closeLabel: string
}) {
  if (!quote) return null
  const who = quote.speakerName || quote.speaker
  return (
    <div className="im-quote-dock">
      <div className="im-quote">
        <span className="im-quote-bar" aria-hidden />
        <span className="im-quote-text">
          <span className="im-quote-who">{who}</span> {quote.text}
        </span>
      </div>
      <button type="button" className="im-quote-dock-close" onClick={onClear} aria-label={closeLabel}>
        ×
      </button>
    </div>
  )
}

export function ImMentionPicker({
  open,
  candidates,
  activeIndex,
  onPick,
  title,
}: {
  open: boolean
  candidates: readonly MentionCandidate[]
  activeIndex: number
  onPick: (candidate: MentionCandidate) => void
  title: string
}) {
  if (!open || candidates.length === 0) return null
  return (
    <div className="im-mention-picker" role="listbox" aria-label={title}>
      <div className="im-mention-picker-cap">{title}</div>
      {candidates.map((candidate, index) => (
        <button
          key={candidate.id}
          type="button"
          role="option"
          aria-selected={index === activeIndex}
          className={`im-mention-picker-row${index === activeIndex ? ' is-on' : ''}`}
          onMouseDown={(event) => {
            event.preventDefault()
            onPick(candidate)
          }}
        >
          <span className="im-mention-picker-name">{candidate.name}</span>
          {candidate.subtitle ? (
            <span className="im-mention-picker-sub">{candidate.subtitle}</span>
          ) : null}
        </button>
      ))}
    </div>
  )
}

export function ImComposerChrome({
  mentionPicker,
  children,
}: {
  mentionPicker: ReactNode
  children: ReactNode
}) {
  return (
    <div className="im-composer-field">
      {mentionPicker}
      {children}
    </div>
  )
}
