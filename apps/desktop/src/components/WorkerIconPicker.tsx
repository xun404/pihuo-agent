import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { matchRegistryAgentForIcon } from '@swarmdesk-agent/shared'
import { useI18n } from '../i18n/I18nProvider'
import { RegistryAgentIcon, WorkerBrandLogo } from './Icons'

export type WorkerIconOption = {
  id: string
  name: string
}

type Props = {
  /** Registry agents available as icon sources (usually the local catalog). */
  options: WorkerIconOption[]
  name: string
  command: string
  /**
   * Selected agent id, or '' for none, or undefined while still auto-matching.
   * Parent owns the value so registration can send `iconAgentId` as-is.
   */
  value: string | undefined
  /**
   * True once the user has explicitly picked an option (including "none").
   * While false, value tracks auto-match as name/command change.
   */
  userPicked: boolean
  disabled?: boolean
  onChange: (next: { iconAgentId: string | undefined; userPicked: boolean }) => void
}

/**
 * Manual-registration icon chooser: defaults from name+command match against
 * the registry catalog; user can switch to another agent icon or clear.
 */
export function WorkerIconPicker({
  options,
  name,
  command,
  value,
  userPicked,
  disabled,
  onChange,
}: Props) {
  const { t } = useI18n()
  const listId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)

  const autoId = useMemo(
    () => matchRegistryAgentForIcon(name, command, options),
    [name, command, options],
  )

  // Keep selection in sync with auto-match until the user overrides.
  useEffect(() => {
    if (userPicked) return
    if (value === autoId) return
    onChange({ iconAgentId: autoId, userPicked: false })
  }, [autoId, onChange, userPicked, value])

  const effectiveId = userPicked ? value : (value ?? autoId)
  const selectedOption = options.find((o) => o.id === effectiveId)

  useEffect(() => {
    if (!open) return
    const onDoc = (ev: MouseEvent) => {
      if (!rootRef.current?.contains(ev.target as Node)) setOpen(false)
    }
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const pick = (id: string | undefined, picked: boolean) => {
    onChange({ iconAgentId: id, userPicked: picked })
    setOpen(false)
  }

  const label = !effectiveId
    ? t('workers.iconNone')
    : selectedOption
      ? selectedOption.name
      : effectiveId

  return (
    <div className="settings-field worker-icon-picker" ref={rootRef}>
      <label className="field-label" htmlFor={listId}>
        {t('workers.formIcon')}
      </label>
      <button
        type="button"
        id={listId}
        className="worker-icon-picker-trigger settings-input"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="worker-icon-picker-preview" aria-hidden>
          {effectiveId ? (
            <RegistryAgentIcon agentId={effectiveId} size={20} />
          ) : (
            <WorkerBrandLogo name={name || command} size={20} />
          )}
        </span>
        <span className="worker-icon-picker-label">
          {label}
          {!userPicked && effectiveId ? (
            <span className="worker-icon-picker-hint"> · {t('workers.iconAutoMatched')}</span>
          ) : null}
        </span>
        <span className="worker-icon-picker-caret" aria-hidden>
          ▾
        </span>
      </button>
      <p className="settings-field-hint">{t('workers.formIconHint')}</p>
      {open && (
        <ul className="worker-icon-picker-list" role="listbox" aria-labelledby={listId}>
          <li role="option" aria-selected={!effectiveId}>
            <button
              type="button"
              className={`worker-icon-picker-option${!effectiveId ? ' is-selected' : ''}`}
              onClick={() => pick('', true)}
            >
              <span className="worker-icon-picker-preview" aria-hidden>
                <WorkerBrandLogo name={name || command} size={18} />
              </span>
              <span>{t('workers.iconNone')}</span>
            </button>
          </li>
          {autoId && (
            <li role="option" aria-selected={effectiveId === autoId && !userPicked}>
              <button
                type="button"
                className={`worker-icon-picker-option${
                  effectiveId === autoId && !userPicked ? ' is-selected' : ''
                }`}
                onClick={() => pick(autoId, false)}
              >
                <span className="worker-icon-picker-preview" aria-hidden>
                  <RegistryAgentIcon agentId={autoId} size={18} />
                </span>
                <span>
                  {options.find((o) => o.id === autoId)?.name ?? autoId}
                  <span className="worker-icon-picker-hint"> · {t('workers.iconAutoMatched')}</span>
                </span>
              </button>
            </li>
          )}
          {options.map((option) => (
            <li key={option.id} role="option" aria-selected={effectiveId === option.id && userPicked}>
              <button
                type="button"
                className={`worker-icon-picker-option${
                  effectiveId === option.id && userPicked ? ' is-selected' : ''
                }`}
                onClick={() => pick(option.id, true)}
              >
                <span className="worker-icon-picker-preview" aria-hidden>
                  <RegistryAgentIcon agentId={option.id} size={18} />
                </span>
                <span>{option.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
