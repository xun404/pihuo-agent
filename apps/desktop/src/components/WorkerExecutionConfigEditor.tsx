import { useEffect, useMemo, useState } from 'react'
import type { WorkerRegistration } from '@swarmdesk-agent/shared'
import { api } from '../lib/api'
import { useI18n } from '../i18n/I18nProvider'
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

  const models = useMemo(() => {
    const values = [...(worker.availableModels ?? [])]
    if (model && !values.some((candidate) => candidate.modelId === model)) {
      values.unshift({ modelId: model, name: model })
    }
    return values
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
        <select
          id={`worker-model-${worker.id}`}
          className="settings-select"
          value={model}
          disabled={saving}
          onChange={(event) => setModel(event.target.value)}
        >
          <option value="">{t('reasoning.agentDefault')}</option>
          {models.map((option) => (
            <option key={option.modelId} value={option.modelId}>
              {option.name || option.modelId}
            </option>
          ))}
        </select>
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
