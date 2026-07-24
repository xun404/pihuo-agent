import React, { useEffect, useState, type FormEvent } from 'react'
import {
  DEFAULT_PROMPT_SETTINGS,
  WORKER_ROLES,
  normalizeWorkerDefaultRoleType,
  type PromptSettings,
  type WorkerRegistration,
  type WorkerRole,
} from '@swarmdesk-agent/shared'
import { useI18n } from '../i18n/I18nProvider'
import { roleMessageKey } from '../i18n/locales'
import { Expandable } from './ui/Expandable'

interface Props {
  worker: WorkerRegistration
  onSave: (roleType: WorkerRole) => Promise<void>
  /** Delete (archive) this worker. Shown as a link left of Save; disabled while the worker is enabled. */
  onDelete?: () => void
  rolePrompts?: Readonly<PromptSettings['roles']>
}

export function WorkerDefaultRoleTypeEditor({
  worker,
  onSave,
  onDelete,
  rolePrompts = DEFAULT_PROMPT_SETTINGS.roles,
}: Props) {
  const { t } = useI18n()
  const [roleType, setRoleType] = useState<WorkerRole>(() =>
    normalizeWorkerDefaultRoleType(worker.defaultRoleType),
  )
  const [saving, setSaving] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    setRoleType(normalizeWorkerDefaultRoleType(worker.defaultRoleType))
  }, [worker.id, worker.defaultRoleType])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    try {
      await onSave(roleType)
    } finally {
      setSaving(false)
    }
  }

  const toggleOpen = (next: boolean) => {
    // On collapse, reset the local draft to the worker's persisted value so reopening shows
    // the truth instead of an unsaved edit.
    if (!next) setRoleType(normalizeWorkerDefaultRoleType(worker.defaultRoleType))
    setOpen(next)
  }

  // Delete is allowed only after the worker is disabled; the link stays visible but disabled,
  // with a tooltip explaining the prerequisite.
  const canDelete = onDelete && !worker.enabled

  return (
    <div className={`worker-card-role${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="worker-card-role-summary"
        aria-expanded={open}
        onClick={() => toggleOpen(!open)}
      >
        <span className="worker-card-role-kicker">{t('workers.defaultRole')}</span>
        <span className="worker-card-role-preview">{t(roleMessageKey(roleType))}</span>
        <span className="worker-card-role-chevron" aria-hidden />
      </button>
      <Expandable open={open}>
        <form className="worker-card-role-form" onSubmit={(event) => void submit(event)}>
          <label className="settings-field">
            <span>{t('roles.type')}</span>
            <select
              className="settings-input ui-font"
              value={roleType}
              onChange={(event) => setRoleType(event.target.value as WorkerRole)}
            >
              {WORKER_ROLES.map((role) => (
                <option key={role} value={role}>
                  {t(roleMessageKey(role))}
                </option>
              ))}
            </select>
          </label>
          <div className="settings-field worker-role-prompt-field">
            <span>{t('roles.instructions')}</span>
            <div className="worker-role-prompt-preview" aria-label={t('roles.instructions')}>
              {rolePrompts[roleType]}
            </div>
          </div>
          <div className="worker-card-role-footer">
            {onDelete && (
              <button
                type="button"
                className="worker-card-delete-link"
                title={canDelete ? t('workers.deleteWorker') : t('workers.deleteDisabledHint')}
                disabled={!canDelete}
                onClick={onDelete}
              >
                {t('workers.deleteWorker')}
              </button>
            )}
            <button type="submit" className="settings-save-btn" disabled={saving}>
              {saving ? t('app.loading') : t('settings.save')}
            </button>
          </div>
        </form>
      </Expandable>
    </div>
  )
}
