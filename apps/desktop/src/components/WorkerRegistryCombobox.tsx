import {
  default as React,
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
  filterWorkerRegistryOptions,
  moveWorkerRegistryHighlight,
  type WorkerRegistryOption,
} from '../lib/worker-registry'
import { useI18n } from '../i18n/I18nProvider'
import { RegistryAgentIcon } from './Icons'

interface Props {
  options: WorkerRegistryOption[]
  selectedId: string | null
  loading: boolean
  error: string | null
  placeholder: string
  loadingLabel: string
  emptyLabel: string
  localInstallLabel: string
  /** Test/controlled rendering aid; production remains closed by default. */
  defaultOpen?: boolean
  onSelect: (option: WorkerRegistryOption | null) => void
  /** Fires when the search query changes (user type, clear, or select sync). */
  onQueryChange?: (query: string) => void
}

function relatedReadiness(option: WorkerRegistryOption): string | undefined {
  for (const related of option.relatedWorkers ?? []) {
    const readiness = related.readiness
    if (readiness && typeof readiness === 'object') {
      const status = (readiness as { status?: unknown }).status
      if (typeof status === 'string') return status
    }
  }
  return undefined
}

const listMotion = {
  initial: { opacity: 0, y: -6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
  transition: { duration: 0.15, ease: [0.32, 0.72, 0, 1] as const },
}

type ListCoords = { top: number; left: number; width: number }

export function WorkerRegistryCombobox({
  options,
  selectedId,
  loading,
  error,
  placeholder,
  loadingLabel,
  emptyLabel,
  localInstallLabel,
  defaultOpen = false,
  onSelect,
  onQueryChange,
}: Props) {
  const { t } = useI18n()
  const listboxId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const selected = options.find((option) => option.id === selectedId)
  const [query, setQuery] = useState(() => selected?.name ?? '')
  const [open, setOpen] = useState(defaultOpen)
  const [highlighted, setHighlighted] = useState(-1)
  const [coords, setCoords] = useState<ListCoords>({ top: 0, left: 0, width: 0 })
  const filtered = useMemo(() => filterWorkerRegistryOptions(options, query), [options, query])
  const canPortal = typeof document !== 'undefined'
  const onQueryChangeRef = useRef(onQueryChange)
  onQueryChangeRef.current = onQueryChange

  const updateQuery = (next: string) => {
    setQuery(next)
    onQueryChangeRef.current?.(next)
  }

  useEffect(() => {
    if (!selected) return
    setQuery(selected.name)
    onQueryChangeRef.current?.(selected.name)
  }, [selected])

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
    // capture scroll from settings page / any parent
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open, query, filtered.length])

  const selectOption = (option: WorkerRegistryOption) => {
    updateQuery(option.name)
    setOpen(false)
    setHighlighted(-1)
    onSelect(option)
  }

  const clearQuery = () => {
    updateQuery('')
    setHighlighted(-1)
    setOpen(true)
    if (selectedId) onSelect(null)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
      setHighlighted((current) => moveWorkerRegistryHighlight(current, event.key, filtered.length))
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
  }

  const listBody = (
    <>
      {loading && (
        <div className="worker-registry-status" role="status">
          {loadingLabel}
        </div>
      )}
      {!loading && error && (
        <div className="worker-registry-status error" role="status">
          {error}
        </div>
      )}
      {!loading && !error && filtered.length === 0 && (
        <div className="worker-registry-status">{emptyLabel}</div>
      )}
      {!loading &&
        !error &&
        filtered.map((option, index) => {
          const readiness = relatedReadiness(option)
          const readinessLabel =
            readiness === 'auth_required'
              ? t('workers.registryAuthRequired')
              : readiness === 'ready' || readiness === 'degraded'
                ? t('workers.registryReady')
                : readiness
                  ? t('workers.registryUnavailable')
                  : null
          const dist = (
            option.distributions?.length ? option.distributions : [option.distribution]
          ).join(' / ')
          const installLabel = option.relatedWorkers?.length
            ? t('workers.registryInstalled')
            : option.requiresLocalInstall
              ? localInstallLabel
              : t('workers.registryNotInstalled')
          const metaParts = [option.version, dist, installLabel, readinessLabel].filter(Boolean)
          return (
            <button
              id={`${listboxId}-option-${index}`}
              key={option.id}
              type="button"
              role="option"
              aria-selected={option.id === selectedId}
              className={`worker-registry-option${index === highlighted ? ' highlighted' : ''}${
                option.id === selectedId ? ' selected' : ''
              }`}
              onMouseEnter={() => setHighlighted(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectOption(option)}
            >
              <span className="worker-registry-option-icon">
                <RegistryAgentIcon agentId={option.id} size={16} />
              </span>
              <span className="worker-registry-option-name">{option.name}</span>
              <span className="worker-registry-option-id mono">{option.id}</span>
              <span className="worker-registry-option-meta">{metaParts.join(' · ')}</span>
            </button>
          )
        })}
    </>
  )

  return (
    <div
      ref={rootRef}
      className={`worker-registry-combobox${open ? ' is-open' : ''}`}
      onBlur={onBlur}
    >
      <div className={`worker-registry-input-wrap${open ? ' open' : ''}${query.trim() ? ' has-value' : ''}`}>
        <input
          className="settings-input ui-font worker-registry-input"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={
            open && highlighted >= 0 ? `${listboxId}-option-${highlighted}` : undefined
          }
          value={query}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onKeyDown={onKeyDown}
          onChange={(event) => {
            updateQuery(event.target.value)
            setOpen(true)
            if (selectedId) onSelect(null)
          }}
        />
        {query.trim().length > 0 && (
          <button
            type="button"
            className="worker-registry-clear"
            aria-label={t('settings.clear')}
            tabIndex={-1}
            onMouseDown={(event) => event.preventDefault()}
            onClick={clearQuery}
          >
            ×
          </button>
        )}
      </div>

      {canPortal
        ? createPortal(
            <AnimatePresence>
              {open && (
                <motion.div
                  ref={listRef}
                  id={listboxId}
                  className="worker-registry-list worker-registry-list-portal"
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
        : open && (
            <div id={listboxId} className="worker-registry-list" role="listbox" ref={listRef}>
              {listBody}
            </div>
          )}
    </div>
  )
}
