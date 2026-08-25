import { useCallback, useState, type ReactNode } from 'react'

export function ImActivityQuote({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const toggle = useCallback(() => setOpen((value) => !value), [])

  return (
    <div className={`im-activity${open ? ' is-open' : ''}`}>
      <button type="button" className="im-quote im-activity-quote" onClick={toggle}>
        <span className="im-quote-bar" aria-hidden />
        <span className="im-quote-text">{label}</span>
      </button>
      {open ? <div className="im-activity-detail">{children}</div> : null}
    </div>
  )
}
