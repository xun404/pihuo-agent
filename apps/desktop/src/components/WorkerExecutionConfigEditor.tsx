import { useEffect, useMemo, useState } from 'react'
import type { WorkerRegistration } from '@swarmdesk-agent/shared'
import { api } from '../lib/api'
import { useI18n } from '../i18n/I18nProvider'
import { SettingsSearchCombobox, type SettingsSearchOption } from './SettingsSearchCombobox'
import { WorkerReasoningSelect } from './WorkerReasoningSelect'

interface Props {
  worker: WorkerRegistration
  projectId?: string | null
  onSaved: () => void
  onError: (message: string) => void
  onSuccess: (message: string) => void
}

export function WorkerExecutionConfigEditor({
  worker,
  projectId,
  onSaved,
  onError,
  onSuccess,
}: Props) {
  const { t } = useI18n()
  const [model, setModel] = useState(worker.model ?? '')
  const [reasoning, setReasoning] = useState(worker.reasoning ?? '')
  const [reasoningValid, setReasoningValid] = useState(!worker.reasoning)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setModel(worker.model ?? '')
    setReasoning(worker.reasoning ?? '')
    setReasoningValid(!worker.reasoning)
  }, [worker.id, worker.model, worker.reasoning])

  const modelOptions = useMemo((): SettingsSearchOption[] => {
    const values = [...(worker.availableModels ?? [])]
    if (model && !values.some((candidate) => candidate.modelId === model)) {
      values.unshift({ modelId: model, name: model })
    }
    return values.map((option) => ({
      value: option.modelId,
      label: option.name || option.modelId,
      description: option.description,
      secondary:
        option.name && option.name !== option.modelId ? option.modelId : undefined,
    }))
  }, [model, worker.availableModels])
  const dirty =
    model.trim() !== (worker.model ?? '') || reasoning.trim() !== (worker.reasoning ?? '')

  const save = async () => {
    if (!reasoningValid) return
    setSaving(true)
    try {
      await api.setWorkerExecutionConfig(worker.id, {
        model: model.trim() || null,
        reasoning: reasoning.trim() || null,
        projectId,
      })
      onSaved()
      onSuccess(t('reasoning.saved'))
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="worker-detail-card">
      <div className="worker-detail-card-head">
        <h4 className="worker-detail-card-title">{t('reasoning.executionConfig')}</h4>
        <button
          type="button"
          className="settings-save-btn"
          disabled={saving || !dirty || !reasoningValid}
          onClick={() => void save()}
        >
          {saving ? t('app.loading') : t('settings.save')}
        </button>
      </div>
      <div className="settings-field">
        <label className="field-label" htmlFor={`worker-model-${worker.id}`}>
          {t('reasoning.model')}
        </label>
        <SettingsSearchCombobox
          id={`worker-model-${worker.id}`}
          options={modelOptions}
          value={model}
          disabled={saving}
          placeholder={t('reasoning.searchModel')}
          emptyLabel={t('reasoning.noMatches')}
          clearOption={{ label: t('reasoning.agentDefault') }}
          onChange={setModel}
        />
      </div>
      <div className="settings-field">
        <label className="field-label" htmlFor={`worker-reasoning-${worker.id}`}>
          {t('reasoning.intensity')}
        </label>
        <WorkerReasoningSelect
          id={`worker-reasoning-${worker.id}`}
          workerId={worker.id}
          model={model}
          projectId={projectId}
          value={reasoning}
          disabled={saving}
          onChange={setReasoning}
          onValidityChange={setReasoningValid}
        />
      </div>
    </div>
  )
}
