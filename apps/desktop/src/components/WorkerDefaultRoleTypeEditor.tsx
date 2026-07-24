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

interface Props {
  worker: WorkerRegistration
  onSave: (roleType: WorkerRole) => Promise<void>
  /** Delete (archive) this worker. Shown as a link in the role card header; disabled while enabled. */
  onDelete?: () => void
  rolePrompts?: Readonly<PromptSettings['roles']>
}

/**
 * Default-role editor for a worker. Renders inline (no collapse) inside a worker-detail card:
 * a role select + the role's prompt preview + a save button. The delete-worker link lives in
 * the card header, not the form footer.
 */
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

  // Delete is allowed only after the worker is disabled; the link stays visible but disabled,
  // with a tooltip explaining the prerequisite.
  const canDelete = onDelete && !worker.enabled

  return (
    <div className="worker-card-role">
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
          <button type="submit" className="settings-save-btn" disabled={saving}>
            {saving ? t('app.loading') : t('settings.save')}
          </button>
        </div>
      </form>
    </div>
  )
}
