import React, { useEffect, useState, type FormEvent } from 'react'
import {
  normalizeWorkerDefaultRole,
  WORKER_ROLES,
  type WorkerDefaultRole,
  type WorkerRegistration,
  type WorkerRole,
} from '@swarmdesk-agent/shared'
import { useI18n } from '../i18n/I18nProvider'

interface Props {
  worker: WorkerRegistration
  onSave: (role: WorkerDefaultRole) => Promise<void>
}

export function WorkerDefaultRoleEditor({ worker, onSave }: Props) {
  const { t } = useI18n()
  const normalized = normalizeWorkerDefaultRole(worker)
  const [name, setName] = useState(normalized.name)
  const [roleType, setRoleType] = useState<WorkerRole>(normalized.roleType)
  const [instructions, setInstructions] = useState(normalized.instructions)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const next = normalizeWorkerDefaultRole(worker)
    setName(next.name)
    setRoleType(next.roleType)
    setInstructions(next.instructions)
  }, [worker.id, worker.defaultRole])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    try {
      await onSave({ name: name.trim(), roleType, instructions: instructions.trim() })
    } finally {
      setSaving(false)
    }
  }

  return (
    <details className="worker-default-role-editor">
      <summary>{t('workers.defaultRole')}</summary>
      <form onSubmit={(event) => void submit(event)}>
        <label className="settings-field">
          <span>{t('roles.name')}</span>
          <input
            className="settings-input"
            value={name}
            required
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="settings-field">
          <span>{t('roles.type')}</span>
          <select
            className="settings-input"
            value={roleType}
            onChange={(event) => setRoleType(event.target.value as WorkerRole)}
          >
            {WORKER_ROLES.map((role) => (
              <option key={role} value={role}>
                {t(`role.${role}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="settings-field">
          <span>{t('roles.instructions')}</span>
          <textarea
            className="settings-input worker-default-role-instructions"
            value={instructions}
            required
            onChange={(event) => setInstructions(event.target.value)}
          />
        </label>
        <p className="settings-field-hint">{t('workers.defaultRoleInheritsModel')}</p>
        <div className="worker-default-role-actions">
          <button type="submit" className="settings-save-btn" disabled={saving}>
            {saving ? t('app.loading') : t('roles.save')}
          </button>
        </div>
      </form>
    </details>
  )
}
