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
  rolePrompts?: Readonly<PromptSettings['roles']>
}

/**
 * Default-role editor for a worker. Renders inline inside a worker-detail card:
 *
 *   默认角色                         [保存]
 *   角色
 *   [select ▼]
 *   角色提示词
 *   [prompt preview]
 */
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
    <form className="worker-card-role-form" onSubmit={(event) => void submit(event)}>
      <div className="worker-card-role-head">
        <h4 className="worker-detail-card-title">{t('workers.defaultRole')}</h4>
        <button type="submit" className="settings-save-btn" disabled={saving}>
          {saving ? t('app.loading') : t('settings.save')}
        </button>
      </div>
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
    </form>
  )
}
