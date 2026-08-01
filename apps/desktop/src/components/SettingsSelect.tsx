/**
 * Custom settings dropdown — replaces native <select> on General and similar pages.
 * Fixed short option lists (appearance / language / motion / send shortcut).
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { createPortal } from 'react-dom'

export type SettingsSelectOption = {
  value: string
  label: string
}

type Props = {
  value: string
  options: SettingsSelectOption[]
  onChange: (value: string) => void
  /** Accessible name for the trigger. */
  'aria-label'?: string
  className?: string
  disabled?: boolean
  /** Min width of the trigger (CSS length). */
  minWidth?: number | string
}

type MenuCoords = { top: number; left: number; width: number }

export function SettingsSelect({
  value,
  options,
  onChange,
  'aria-label': ariaLabel,
  className,
  disabled,
  minWidth = 140,
}: Props) {
  const listId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(-1)
  const [coords, setCoords] = useState<MenuCoords>({ top: 0, left: 0, width: 0 })
  const canPortal = typeof document !== 'undefined'

  const selected = options.find((o) => o.value === value) ?? options[0]
  const label = selected?.label ?? value

  const placeMenu = () => {
    const el = rootRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setCoords({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 140) })
  }

  useEffect(() => {
    if (!open) return
    placeMenu()
    const onScroll = () => placeMenu()
    const onResize = () => placeMenu()
    window.addEventListener('resize', onResize)
    // Capture scroll from any ancestor (settings-general)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (rootRef.current?.contains(t)) return
      if (menuRef.current?.contains(t)) return
      setOpen(false)
      setHighlighted(-1)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const pick = (next: string) => {
    onChange(next)
    setOpen(false)
    setHighlighted(-1)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (disabled) return
    if (e.key === 'Escape') {
      if (open) {
        e.preventDefault()
        setOpen(false)
        setHighlighted(-1)
      }
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) {
        setOpen(true)
        placeMenu()
        const idx = Math.max(
          0,
          options.findIndex((o) => o.value === value),
        )
        setHighlighted(idx)
        return
      }
      setHighlighted((h) => {
        if (options.length === 0) return -1
        if (h < 0) return e.key === 'ArrowDown' ? 0 : options.length - 1
        const delta = e.key === 'ArrowDown' ? 1 : -1
        return (h + delta + options.length) % options.length
      })
      return
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (!open) {
        setOpen(true)
        placeMenu()
        const idx = Math.max(
          0,
          options.findIndex((o) => o.value === value),
        )
        setHighlighted(idx)
        return
      }
      const opt = options[highlighted] ?? options.find((o) => o.value === value)
      if (opt) pick(opt.value)
    }
  }

  const menu = (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={menuRef}
          id={listId}
          role="listbox"
          className="settings-select-menu"
          style={{
            position: 'fixed',
            top: coords.top,
            left: coords.left,
            minWidth: coords.width,
            zIndex: 10050,
          }}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -2 }}
          transition={{ duration: 0.14, ease: [0.32, 0.72, 0, 1] }}
        >
          {options.map((opt, index) => {
            const isSelected = opt.value === value
            const isHi = index === highlighted
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={`settings-select-option${isSelected ? ' is-selected' : ''}${
                  isHi ? ' is-highlighted' : ''
                }`}
                onMouseEnter={() => setHighlighted(index)}
                onMouseDown={(ev) => ev.preventDefault()}
                onClick={() => pick(opt.value)}
              >
                <span className="settings-select-option-label">{opt.label}</span>
              </button>
            )
          })}
        </motion.div>
      )}
    </AnimatePresence>
  )

  return (
    <div
      ref={rootRef}
      className={`settings-select-wrap${open ? ' is-open' : ''}${disabled ? ' is-disabled' : ''}${
        className ? ` ${className}` : ''
      }`}
    >
      <button
        type="button"
        className="field-select settings-select settings-select-trigger"
        style={{ minWidth }}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => {
          if (disabled) return
          setOpen((v) => {
            const next = !v
            if (next) {
              placeMenu()
              setHighlighted(
                Math.max(
                  0,
                  options.findIndex((o) => o.value === value),
                ),
              )
            } else {
              setHighlighted(-1)
            }
            return next
          })
        }}
        onKeyDown={onKeyDown}
      >
        <span className="settings-select-value">{label}</span>
        <span className="caret" aria-hidden>
          ▾
        </span>
      </button>
      {canPortal ? createPortal(menu, document.body) : menu}
    </div>
  )
}
