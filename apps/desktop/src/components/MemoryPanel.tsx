import React, { useEffect, useState } from 'react'
import type { ProjectMemorySnapshot } from '../lib/api'
import { useI18n } from '../i18n/I18nProvider'
import { MarkdownContent } from './MarkdownContent'

export type MemoryPanelError = 'load' | 'toggle' | 'save'

interface Props {
  projectName: string
  enabled: boolean
  memory: ProjectMemorySnapshot | null
  loading: boolean
  saving: boolean
  error: MemoryPanelError | null
  onToggle: (enabled: boolean) => void | Promise<void>
  onSave: (content: string) => boolean | void | Promise<boolean | void>
}

function errorMessage(error: MemoryPanelError | null, t: ReturnType<typeof useI18n>['t']) {
  if (error === 'load') return t('memory.loadFailed')
  if (error === 'toggle') return t('memory.toggleFailed')
  if (error === 'save') return t('memory.saveFailed')
  return null
}

export function MemoryPanel({
  projectName,
  enabled,
  memory,
  loading,
  saving,
  error,
  onToggle,
  onSave,
}: Props) {
  const { t } = useI18n()
  const [draft, setDraft] = useState(memory?.content ?? '')
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    setDraft(memory?.content ?? '')
    setEditing(false)
  }, [memory?.content])

  const canSave = Boolean(memory) && !loading && !saving
  const statusError = errorMessage(error, t)

  const handleSave = async () => {
    try {
      const result = await onSave(draft)
      if (result !== false) setEditing(false)
    } catch {
      // Parent callbacks surface the translated error state; keep the editor open
      // when a caller rejects so the draft remains recoverable.
    }
  }

  return (
    <div className="drawer-body tab-panel active memory-panel">
      <div className="memory-panel-toolbar">
        <div className="memory-panel-heading">
          <div className="inspector-panel-title">{t('memory.title')}</div>
          <p className="memory-panel-hint">
            {projectName} · {t('memory.scopeHint')}
          </p>
        </div>
        <button
          className={`memory-panel-switch${enabled ? ' is-on' : ''}`}
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={t('memory.toggleLabel')}
          aria-busy={saving}
          disabled={loading || saving}
          onClick={() => void onToggle(!enabled)}
        >
          <span className="memory-panel-switch-track" aria-hidden>
            <span className="memory-panel-switch-thumb" />
          </span>
          <span>{enabled ? t('memory.enabled') : t('memory.disabled')}</span>
        </button>
      </div>

      {loading ? (
        <p className="section-hint memory-panel-loading" role="status">
          {t('common.loading')}
        </p>
      ) : (
        <>
          <div className="memory-panel-field">
            <div className="memory-panel-field-heading">
              <label htmlFor="project-memory-content">{t('memory.contentLabel')}</label>
              {editing ? (
                <button
                  className="settings-link-inline memory-panel-save-link"
                  type="button"
                  disabled={!canSave}
                  onClick={() => void handleSave()}
                >
                  {saving ? t('memory.saving') : t('memory.save')}
                </button>
              ) : (
                <button
                  className="settings-link-inline memory-panel-edit-link"
                  type="button"
                  disabled={!memory || loading}
                  onClick={() => setEditing(true)}
                >
                  {t('memory.edit')}
                </button>
              )}
            </div>
            {editing ? (
              <textarea
                id="project-memory-content"
                className="settings-input ui-font memory-panel-textarea"
                value={draft}
                placeholder={t('memory.contentPlaceholder')}
                aria-label={t('memory.contentLabel')}
                disabled={!canSave}
                onChange={(event) => setDraft(event.target.value)}
              />
            ) : (
              <div className="memory-panel-markdown" aria-label={t('memory.contentLabel')}>
                {draft.trim() ? (
                  <MarkdownContent className="memory-panel-markdown-content">
                    {draft}
                  </MarkdownContent>
                ) : (
                  <p className="memory-panel-empty">{t('memory.empty')}</p>
                )}
              </div>
            )}
            {editing && !draft.trim() && <p className="memory-panel-empty">{t('memory.empty')}</p>}
          </div>

          <dl className="memory-panel-status" aria-label={t('memory.statusLabel')}>
            <div>
              <dt>{t('memory.lastMessages')}</dt>
              <dd>{memory?.lastMessages ?? '—'}</dd>
            </div>
            <div>
              <dt>{t('memory.workingMemory')}</dt>
              <dd>{memory?.workingMemory ? t('memory.enabled') : t('memory.disabled')}</dd>
            </div>
            <div>
              <dt>{t('memory.semanticRecall')}</dt>
              <dd>{memory?.semanticRecall ? t('memory.enabled') : t('memory.disabled')}</dd>
            </div>
            <div>
              <dt>{t('memory.observationalMemory')}</dt>
              <dd>{memory?.observationalMemory ? t('memory.enabled') : t('memory.disabled')}</dd>
            </div>
          </dl>
        </>
      )}

      {statusError && (
        <p className="section-hint is-warn memory-panel-error" role="alert">
          {statusError}
        </p>
      )}
    </div>
  )
}
