import {
  default as React,
  useEffect,
  useId,
  useMemo,
  useState,
  type FocusEvent,
  type KeyboardEvent,
} from 'react'
import {
  filterWorkerRegistryOptions,
  moveWorkerRegistryHighlight,
  type WorkerRegistryOption,
} from '../lib/worker-registry'
import { useI18n } from '../i18n/I18nProvider'
import { IconChevronDown } from './Icons'

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
}: Props) {
  const { t } = useI18n()
  const listboxId = useId()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(defaultOpen)
  const [highlighted, setHighlighted] = useState(-1)
  const selected = options.find((option) => option.id === selectedId)
  const filtered = useMemo(() => filterWorkerRegistryOptions(options, query), [options, query])

  useEffect(() => {
    if (selected) setQuery(selected.name)
  }, [selected])

  useEffect(() => {
    setHighlighted(filtered.length > 0 ? 0 : -1)
  }, [filtered])

  const selectOption = (option: WorkerRegistryOption) => {
    setQuery(option.name)
    setOpen(false)
    setHighlighted(-1)
    onSelect(option)
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
    if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
      setOpen(false)
      setHighlighted(-1)
    }
  }

  return (
    <div className="worker-registry-combobox" onBlur={onBlur}>
      <div className={`worker-registry-input-wrap${open ? ' open' : ''}`}>
        <input
          className="settings-input worker-registry-input"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={
            open && highlighted >= 0 ? `${listboxId}-option-${highlighted}` : undefined
          }
          value={query}
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onKeyDown={onKeyDown}
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
            if (selectedId) onSelect(null)
          }}
        />
        <button
          type="button"
          className="worker-registry-toggle"
          tabIndex={-1}
          aria-label={placeholder}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setOpen((value) => !value)}
        >
          <IconChevronDown size={13} />
        </button>
      </div>

      {open && (
        <div id={listboxId} className="worker-registry-list" role="listbox">
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
              return (
                <button
                  id={`${listboxId}-option-${index}`}
                  key={option.id}
                  type="button"
                  role="option"
                  aria-selected={option.id === selectedId}
                  className={`worker-registry-option${
                    index === highlighted ? ' highlighted' : ''
                  }${option.id === selectedId ? ' selected' : ''}`}
                  onMouseEnter={() => setHighlighted(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectOption(option)}
                >
                  <span className="worker-registry-option-main">
                    <span className="worker-registry-option-name">{option.name}</span>
                    <span className="worker-registry-option-id mono">{option.id}</span>
                  </span>
                  <span className="worker-registry-option-meta">
                    <span>{option.version}</span>
                    <span>
                      {option.platformTarget ??
                        option.availability ??
                        t('workers.registryUnavailable')}
                    </span>
                    <span>
                      {(option.distributions?.length
                        ? option.distributions
                        : [option.distribution]
                      ).join(' / ')}
                    </span>
                    <span>
                      {option.relatedWorkers?.length
                        ? t('workers.registryInstalled')
                        : option.requiresLocalInstall
                          ? localInstallLabel
                          : t('workers.registryNotInstalled')}
                    </span>
                    {readinessLabel && <span>{readinessLabel}</span>}
                  </span>
                </button>
              )
            })}
        </div>
      )}
    </div>
  )
}
