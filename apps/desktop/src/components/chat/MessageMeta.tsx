import { Check, Copy } from 'lucide-react'

export function MessageMeta({
  timeLabel,
  copyText,
  copied,
  copyAriaLabel,
  onCopy,
  quoteLabel,
  onQuote,
}: {
  timeLabel?: string
  copyText?: string
  copied: boolean
  copyAriaLabel: string
  onCopy: () => void
  quoteLabel?: string
  onQuote?: () => void
}) {
  if (!timeLabel && !copyText && !onQuote) return null
  return (
    <div className="msg-meta">
      {timeLabel ? <span className="msg-user-time">{timeLabel}</span> : null}
      {copyText ? (
        <button
          type="button"
          className="msg-copy"
          onClick={onCopy}
          aria-label={copyAriaLabel}
          title={copyAriaLabel}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
      ) : null}
      {onQuote && quoteLabel ? (
        <button type="button" className="msg-quote" onClick={onQuote}>
          {quoteLabel}
        </button>
      ) : null}
    </div>
  )
}
