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
  rolePrompts?: Readonly<PromptSettings['roles']>
}

export function WorkerDefaultRoleTypeEditor({
  worker,
  onSave,
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

  return (
    <div className={`worker-card-role${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="worker-card-role-summary"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
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
            <p className="settings-field-hint">{t('workers.defaultRoleInheritsModel')}</p>
            <button type="submit" className="settings-save-btn" disabled={saving}>
              {saving ? t('app.loading') : t('settings.save')}
            </button>
          </div>
        </form>
      </Expandable>
    </div>
  )
}
