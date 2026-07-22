import React from 'react'
import {
  DEFAULT_PROMPT_SETTINGS,
  PROMPT_ROLE_ORDER,
  normalizePromptSettings,
  type PromptSettings,
  type WorkerRole,
} from '@swarmdesk-agent/shared'
import { useI18n } from '../i18n/I18nProvider'
import { roleMessageKey } from '../i18n/locales'

interface Props {
  prompts: PromptSettings
  saving: boolean
  onChange: (prompts: PromptSettings) => void
  onSave: (prompts: PromptSettings) => Promise<void>
}

export function PromptSettingsEditor({ prompts, saving, onChange, onSave }: Props) {
  const { t } = useI18n()
  const valid =
    Boolean(prompts.leader.trim()) &&
    PROMPT_ROLE_ORDER.every((role) => Boolean(prompts.roles[role].trim()))

  const updateRole = (role: WorkerRole, value: string) => {
    onChange({ ...prompts, roles: { ...prompts.roles, [role]: value } })
  }

  return (
    <div className="prompt-settings-editor">
      <section className="prompt-settings-section">
        <div className="prompt-settings-section-head">
          <div>
            <h3>{t('settings.prompts.leader')}</h3>
            <p>{t('settings.prompts.leaderHint')}</p>
          </div>
          <button
            type="button"
            className="settings-btn-soft"
            onClick={() => onChange({ ...prompts, leader: DEFAULT_PROMPT_SETTINGS.leader })}
          >
            {t('settings.prompts.reset')}
          </button>
        </div>
        <textarea
          className="settings-input prompt-settings-textarea"
          value={prompts.leader}
          aria-label={t('settings.prompts.leader')}
          onChange={(event) => onChange({ ...prompts, leader: event.target.value })}
        />
      </section>

      <section className="prompt-settings-section">
        <div className="prompt-settings-section-head prompt-settings-roles-head">
          <div>
            <h3>{t('settings.prompts.roles')}</h3>
            <p>{t('settings.prompts.rolesHint')}</p>
          </div>
        </div>
        <div className="prompt-settings-role-list">
          {PROMPT_ROLE_ORDER.map((role) => (
            <div className="prompt-settings-role" key={role}>
              <div className="prompt-settings-role-head">
                <label htmlFor={`prompt-role-${role}`}>{t(roleMessageKey(role))}</label>
                <button
                  type="button"
                  className="settings-btn-soft"
                  onClick={() => updateRole(role, DEFAULT_PROMPT_SETTINGS.roles[role])}
                >
                  {t('settings.prompts.reset')}
                </button>
              </div>
              <textarea
                id={`prompt-role-${role}`}
                className="settings-input prompt-settings-textarea"
                value={prompts.roles[role]}
                onChange={(event) => updateRole(role, event.target.value)}
              />
            </div>
          ))}
        </div>
      </section>

      <div className="prompt-settings-actions">
        <button
          type="button"
          className="settings-save-btn"
          disabled={saving || !valid}
          onClick={() => {
            const normalized = normalizePromptSettings(prompts)
            onChange(normalized)
            void onSave(normalized)
          }}
        >
          {saving ? t('app.loading') : t('settings.prompts.save')}
        </button>
      </div>
    </div>
  )
}
