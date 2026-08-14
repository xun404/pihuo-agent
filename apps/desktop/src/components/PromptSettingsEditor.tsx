import React, { useEffect, useRef, useState } from 'react'
import {
  PROMPT_ROLE_ORDER,
  defaultPromptSettings,
  normalizePromptSettings,
  promptsMatchLocaleDefaults,
  type PromptLocale,
  type PromptSettings,
  type WorkerRole,
} from '@pihuo-agent/shared'
import { useI18n } from '../i18n/I18nProvider'
import { roleMessageKey, type Locale } from '../i18n/locales'
import { Expandable } from './ui/Expandable'

interface Props {
  prompts: PromptSettings
  saving: boolean
  onChange: (prompts: PromptSettings) => void
  onSave: (prompts: PromptSettings) => Promise<void>
}

const AUTO_SAVE_MS = 500

function toPromptLocale(locale: Locale): PromptLocale {
  return locale === 'en' ? 'en' : 'zh'
}

function previewLine(text: string, max = 56): string {
  const one = text.replace(/\s+/g, ' ').trim()
  if (!one) return '—'
  return one.length > max ? `${one.slice(0, max)}…` : one
}

function isDirty(current: string, fallback: string): boolean {
  return current.trim() !== fallback.trim()
}

function isValidPrompts(prompts: PromptSettings): boolean {
  return (
    Boolean(prompts.leader.trim()) &&
    PROMPT_ROLE_ORDER.every((role) => Boolean(prompts.roles[role].trim()))
  )
}

function promptsEqual(a: PromptSettings, b: PromptSettings): boolean {
  if (a.leader !== b.leader) return false
  return PROMPT_ROLE_ORDER.every((role) => a.roles[role] === b.roles[role])
}

export function PromptSettingsEditor({ prompts, saving, onChange, onSave }: Props) {
  const { t, locale } = useI18n()
  const [openRoles, setOpenRoles] = useState<Set<WorkerRole>>(() => new Set())
  const toggleRole = (role: WorkerRole) => {
    setOpenRoles((current) => {
      const next = new Set(current)
      if (next.has(role)) next.delete(role)
      else next.add(role)
      return next
    })
  }
  const promptLocale = toPromptLocale(locale)
  const defaults = defaultPromptSettings(promptLocale)
  const promptsRef = useRef(prompts)
  const lastSavedRef = useRef(prompts)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const localeRef = useRef(promptLocale)
  promptsRef.current = prompts

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  // If user has not customized prompts (still built-in for previous locale),
  // switch built-in text when UI language changes.
  useEffect(() => {
    if (localeRef.current === promptLocale) return
    const previousLocale = localeRef.current
    localeRef.current = promptLocale
    if (promptsMatchLocaleDefaults(promptsRef.current, previousLocale)) {
      const next = defaultPromptSettings(promptLocale)
      onChange(next)
      promptsRef.current = next
      lastSavedRef.current = next
      void onSave(next)
    }
  }, [promptLocale, onChange, onSave])

  const scheduleSave = (next: PromptSettings) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      if (!isValidPrompts(next)) return
      const normalized = normalizePromptSettings(next, promptLocale)
      if (promptsEqual(normalized, lastSavedRef.current)) return
      lastSavedRef.current = normalized
      void onSave(normalized)
    }, AUTO_SAVE_MS)
  }

  const commit = (next: PromptSettings) => {
    onChange(next)
    promptsRef.current = next
    scheduleSave(next)
  }

  const updateRole = (role: WorkerRole, value: string) => {
    commit({ ...prompts, roles: { ...prompts.roles, [role]: value } })
  }

  const flushSave = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    const next = promptsRef.current
    if (!isValidPrompts(next)) return
    const normalized = normalizePromptSettings(next, promptLocale)
    if (promptsEqual(normalized, lastSavedRef.current)) return
    lastSavedRef.current = normalized
    void onSave(normalized)
  }

  const leaderDirty = isDirty(prompts.leader, defaults.leader)

  return (
    <div className="prompt-settings-editor">
      <section className="prompt-card">
        <header className="prompt-card-head prompt-card-head-static">
          <div className="prompt-card-titles">
            <h3>{t('settings.prompts.leader')}</h3>
            <p>{t('settings.prompts.leaderHint')}</p>
          </div>
        </header>
        <div className="prompt-card-body">
          <div className="prompt-field">
            <textarea
              className="settings-input ui-font prompt-settings-textarea"
              value={prompts.leader}
              aria-label={t('settings.prompts.leader')}
              disabled={saving}
              onChange={(event) => commit({ ...prompts, leader: event.target.value })}
              onBlur={flushSave}
            />
            {leaderDirty && (
              <div className="prompt-field-footer">
                <button
                  type="button"
                  className="prompt-reset-link"
                  onClick={() => commit({ ...prompts, leader: defaults.leader })}
                >
                  {t('settings.prompts.reset')}
                </button>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="prompt-card">
        <header className="prompt-card-head prompt-card-head-static">
          <div className="prompt-card-titles">
            <h3>{t('settings.prompts.roles')}</h3>
            <p>{t('settings.prompts.rolesHint')}</p>
          </div>
        </header>
        <div className="prompt-role-list">
          {PROMPT_ROLE_ORDER.map((role) => {
            const roleDirty = isDirty(prompts.roles[role], defaults.roles[role])
            const open = openRoles.has(role)
            return (
              <div className={`prompt-role-item${open ? ' is-open' : ''}`} key={role}>
                <button
                  type="button"
                  className="prompt-role-summary"
                  aria-expanded={open}
                  onClick={() => toggleRole(role)}
                >
                  <span className="prompt-role-label">{t(roleMessageKey(role))}</span>
                  <span className="prompt-role-preview" title={prompts.roles[role]}>
                    {previewLine(prompts.roles[role])}
                  </span>
                  {roleDirty && <span className="prompt-role-dirty" aria-hidden />}
                  <span className="prompt-role-chevron" aria-hidden />
                </button>
                <Expandable open={open}>
                  <div className="prompt-role-body">
                    <div className="prompt-field">
                      <textarea
                        id={`prompt-role-${role}`}
                        className="settings-input ui-font prompt-settings-textarea"
                        value={prompts.roles[role]}
                        aria-label={t(roleMessageKey(role))}
                        disabled={saving}
                        onChange={(event) => updateRole(role, event.target.value)}
                        onBlur={flushSave}
                      />
                      {roleDirty && (
                        <div className="prompt-field-footer">
                          <button
                            type="button"
                            className="prompt-reset-link"
                            onClick={() => updateRole(role, defaults.roles[role])}
                          >
                            {t('settings.prompts.reset')}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </Expandable>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}
