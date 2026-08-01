import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  filterSettingsSearchOptions,
  labelForSettingsSearchValue,
  moveSettingsSearchHighlight,
  type SettingsSearchOption,
} from '../lib/settings-search-combobox'
import { useI18n } from '../i18n/I18nProvider'

export type { SettingsSearchOption }

interface Props {
  id?: string
  options: SettingsSearchOption[]
  value: string
  disabled?: boolean
  placeholder?: string
  emptyLabel?: string
  /** Always-available empty selection (e.g. Agent default). value must be ''. */
  clearOption?: { label: string }
  onChange: (value: string) => void
}

const listMotion = {
  initial: { opacity: 0, y: -6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
  transition: { duration: 0.15, ease: [0.32, 0.72, 0, 1] as const },
}

type ListCoords = { top: number; left: number; width: number }

export function SettingsSearchCombobox({
  id,
  options,
  value,
  disabled,
  placeholder,
  emptyLabel,
  clearOption,
  onChange,
}: Props) {
  const { t } = useI18n()
  const listboxId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const clearLabel = clearOption?.label
  const displayForValue = labelForSettingsSearchValue(options, value, clearLabel)
  // Closed: show committed selection. Open: empty so the user can type a filter immediately.
  const [query, setQuery] = useState(displayForValue)
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(-1)
  const [coords, setCoords] = useState<ListCoords>({ top: 0, left: 0, width: 0 })
  const canPortal = typeof document !== 'undefined'

  // When closed, keep the input text in sync with the committed value.
  useEffect(() => {
    if (open) return
    setQuery(displayForValue)
  }, [displayForValue, open, value])

  const openMenu = () => {
    if (disabled || open) return
    setQuery('')
    setOpen(true)
  }

  const filtered = useMemo(() => {
    if (!open) return options
    const rows = filterSettingsSearchOptions(options, query)
    if (!clearOption) return rows
    const clearRow: SettingsSearchOption = { value: '', label: clearOption.label }
    const matchesClear =
      !query.trim() ||
      clearOption.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
    if (!matchesClear) return rows
    // Avoid duplicating an option that also uses empty value.
    if (rows.some((row) => row.value === '')) return rows
    return [clearRow, ...rows]
  }, [clearOption, open, options, query])

  useEffect(() => {
    setHighlighted(filtered.length > 0 ? 0 : -1)
  }, [filtered])

  useLayoutEffect(() => {
    if (!open || !rootRef.current) return
    const update = () => {
      const rect = rootRef.current?.getBoundingClientRect()
      if (!rect) return
      setCoords({
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
      })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open, query, filtered.length])

  const selectOption = (option: SettingsSearchOption) => {
    onChange(option.value)
    setQuery(option.label)
    setOpen(false)
    setHighlighted(-1)
  }

  const clearSelection = () => {
    onChange('')
    setQuery('')
    setHighlighted(-1)
    if (!open) setOpen(true)
    inputRef.current?.focus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) {
        setQuery('')
        setOpen(true)
      }
      setHighlighted((current) => moveSettingsSearchHighlight(current, event.key, filtered.length))
      return
    }
    if (event.key === 'Enter' && open && highlighted >= 0) {
      event.preventDefault()
      const option = filtered[highlighted]
      if (option) selectOption(option)
      return
    }
    if (event.key === 'Escape') {
      setOpen(false)
      setHighlighted(-1)
      setQuery(displayForValue)
    }
  }

  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget
    if (nextTarget instanceof Node) {
      if (rootRef.current?.contains(nextTarget)) return
      if (listRef.current?.contains(nextTarget)) return
    }
    setOpen(false)
    setHighlighted(-1)
    setQuery(displayForValue)
  }

  const statusEmpty = emptyLabel ?? t('reasoning.noMatches')

  const listBody = (
    <>
      {filtered.length === 0 ? (
        <div className="worker-registry-status" role="status">
          {statusEmpty}
        </div>
      ) : (
        filtered.map((option, index) => {
          const selected = option.value === value
          const desc = option.description?.trim() || ''
          const tipParts = [option.label, option.secondary, desc].filter(Boolean)
          // Full text for hover when description may clamp to two lines.
          const title =
            desc.length > 0 || (option.secondary && option.secondary !== option.label)
              ? tipParts.join('\n')
              : undefined
          return (
            <button
              id={`${listboxId}-option-${index}`}
              key={`${option.value || '__clear__'}-${option.label}`}
              type="button"
              role="option"
              aria-selected={selected}
              title={title}
              className={`worker-registry-option settings-search-option${
                desc ? ' has-desc' : ''
              }${index === highlighted ? ' highlighted' : ''}${selected ? ' selected' : ''}`}
              onMouseEnter={() => setHighlighted(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectOption(option)}
            >
              <span className="settings-search-option-main">
                <span className="worker-registry-option-name">{option.label}</span>
                {option.secondary && option.secondary !== option.label ? (
                  <span className="worker-registry-option-id mono">{option.secondary}</span>
                ) : null}
              </span>
              {desc ? <span className="settings-search-option-desc">{desc}</span> : null}
            </button>
          )
        })
      )}
    </>
  )

  return (
    <div
      ref={rootRef}
      className={`worker-registry-combobox settings-search-combobox${open ? ' is-open' : ''}${
        disabled ? ' is-disabled' : ''
      }`}
      onBlur={onBlur}
    >
      <div
        className={`worker-registry-input-wrap${open ? ' open' : ''}${
          (!open && (query.trim() || value)) || (open && query.trim()) ? ' has-value' : ''
        }`}
      >
        <input
          ref={inputRef}
          id={id}
          className="settings-input ui-font worker-registry-input"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={
            open && highlighted >= 0 ? `${listboxId}-option-${highlighted}` : undefined
          }
          value={query}
          placeholder={open ? placeholder : displayForValue || placeholder}
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
          onFocus={() => openMenu()}
          onClick={() => openMenu()}
          onKeyDown={onKeyDown}
          onChange={(event) => {
            setQuery(event.target.value)
            if (!open) setOpen(true)
          }}
        />
        {((!open && (query.trim().length > 0 || Boolean(value))) ||
          (open && query.trim().length > 0)) &&
          !disabled && (
            <button
              type="button"
              className="worker-registry-clear"
              aria-label={t('settings.clear')}
              tabIndex={-1}
              onMouseDown={(event) => event.preventDefault()}
              onClick={clearSelection}
            >
              ×
            </button>
          )}
      </div>

      {canPortal
        ? createPortal(
            <AnimatePresence>
              {open && !disabled && (
                <motion.div
                  ref={listRef}
                  id={listboxId}
                  className="worker-registry-list worker-registry-list-portal settings-search-list"
                  role="listbox"
                  initial={listMotion.initial}
                  animate={listMotion.animate}
                  exit={listMotion.exit}
                  transition={listMotion.transition}
                  style={{
                    top: coords.top,
                    left: coords.left,
                    width: coords.width,
                  }}
                >
                  {listBody}
                </motion.div>
              )}
            </AnimatePresence>,
            document.body,
          )
        : open &&
          !disabled && (
            <div
              id={listboxId}
              className="worker-registry-list settings-search-list"
              role="listbox"
              ref={listRef}
            >
              {listBody}
            </div>
          )}
    </div>
  )
}
