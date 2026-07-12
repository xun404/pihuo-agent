import { useEffect, useRef, useState } from 'react'

interface Props {
  open: boolean
  title: string
  defaultValue?: string
  placeholder?: string
  confirmLabel: string
  cancelLabel: string
  onCancel: () => void
  onConfirm: (value: string) => void
}

/** In-app text prompt — used when native browser prompt dialogs are unavailable. */
export function TextPromptModal({
  open,
  title,
  defaultValue = '',
  placeholder,
  confirmLabel,
  cancelLabel,
  onCancel,
  onConfirm,
}: Props) {
  const [value, setValue] = useState(defaultValue)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setValue(defaultValue)
      // focus after paint
      requestAnimationFrame(() => inputRef.current?.focus())
      inputRef.current?.select()
    }
  }, [open, defaultValue])

  if (!open) return null

  const submit = () => {
    const v = value.trim()
    if (!v) return
    onConfirm(v)
  }

  return (
    <div
      className="settings-overlay text-prompt-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div className="text-prompt-modal">
        <h3 className="text-prompt-title">{title}</h3>
        <input
          ref={inputRef}
          className="settings-input"
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              submit()
            }
            if (e.key === 'Escape') {
              e.preventDefault()
              onCancel()
            }
          }}
        />
        <div className="text-prompt-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!value.trim()}
            onClick={submit}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
