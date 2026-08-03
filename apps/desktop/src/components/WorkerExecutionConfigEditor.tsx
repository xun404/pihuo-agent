import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { WorkerRegistration } from '@swarmdesk-agent/shared'
import { api } from '../lib/api'
import { useI18n } from '../i18n/I18nProvider'
import { toWorkerModelSearchOption } from '../lib/settings-search-combobox'
import { SettingsSearchCombobox, type SettingsSearchOption } from './SettingsSearchCombobox'
import { WorkerReasoningSelect } from './WorkerReasoningSelect'

/** Agents that never expose model lists via ACP (e.g. Grok Build). Soft-fail, no toast spam. */
function isModelsNotDeclaredError(error?: string, errorCode?: string): boolean {
  if (
    errorCode === 'ACP_MODELS_NOT_DECLARED' ||
    errorCode === 'ACP_MODELS_NO_MODEL_OPTION' ||
    errorCode === 'ACP_MODELS_EMPTY_VALUES'
  ) {
    return true
  }
  return /did not declare any configOptions|No model-like configOption|no selectable values/i.test(
    error ?? '',
  )
}

interface Props {
  worker: WorkerRegistration
  projectId?: string | null
  onSaved: () => void
  onError: (message: string) => void
  onSuccess: (message: string) => void
}

type CatalogModel = NonNullable<WorkerRegistration['availableModels']>[number]

function needsModelCatalogFetch(worker: WorkerRegistration): boolean {
  if (!worker.availableModels || worker.availableModels.length === 0) return true
  const state = worker.modelCatalogState ?? worker.modelsState
  return state === 'empty' || state === 'stale'
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
  const [modelsLoading, setModelsLoading] = useState(false)
  /** Soft capability note when ACP has no model configOptions (not a hard failure). */
  const [catalogNote, setCatalogNote] = useState<string | null>(null)
  /** Local catalog while / until snapshot catches up after fetch. */
  const [localModels, setLocalModels] = useState<CatalogModel[] | null>(null)
  const fetchGenRef = useRef(0)

  // Reset draft + loading when switching workers. This component is often reused
  // without remounting (parent only swaps `worker`), so stale modelsLoading from a
  // previous ACP fetch must not stick on the next worker (e.g. Claude after OpenCode).
  useEffect(() => {
    setModel(worker.model ?? '')
    setReasoning(worker.reasoning ?? '')
    setReasoningValid(!worker.reasoning)
    setLocalModels(null)
    setModelsLoading(false)
    setSaving(false)
    // Do not pre-show catalogNote from cached modelsError — only after a refresh finishes.
    setCatalogNote(null)
    fetchGenRef.current += 1
  }, [worker.id])

  useEffect(() => {
    setModel(worker.model ?? '')
    setReasoning(worker.reasoning ?? '')
    setReasoningValid(!worker.reasoning)
  }, [worker.model, worker.reasoning])

  const catalogModels = localModels ?? worker.availableModels ?? []

  const loadModels = useCallback(
    async (opts?: { force?: boolean }) => {
      const force = opts?.force === true
      if (!force && !needsModelCatalogFetch(worker) && (worker.availableModels?.length ?? 0) > 0) {
        setModelsLoading(false)
        setCatalogNote(null)
        return
      }
      const gen = ++fetchGenRef.current
      setModelsLoading(true)
      // Hide any previous note until this refresh settles.
      setCatalogNote(null)
      try {
        const res = await api.fetchWorkerModels(worker.id, {
          force: force || needsModelCatalogFetch(worker),
          projectId: projectId ?? null,
        })
        if (gen !== fetchGenRef.current) return
        if (res.models?.length) {
          setLocalModels(res.models)
        }
        // Pull worker.availableModels / catalog state into settings snapshot.
        onSaved()
        if (!res.ok && res.error) {
          if (isModelsNotDeclaredError(res.error, res.errorCode)) {
            // Capability gap — show warn hint only after refresh completes (no toast).
            setCatalogNote(t('workers.modelNoAcpList'))
          } else {
            setCatalogNote(null)
            onError(res.error)
          }
        } else {
          setCatalogNote(null)
        }
      } catch (error) {
        if (gen !== fetchGenRef.current) return
        setCatalogNote(null)
        onError(error instanceof Error ? error.message : String(error))
      } finally {
        // Always drop the spinner for this generation; a superseded fetch must
        // not leave modelsLoading true when the next worker early-returns.
        if (gen === fetchGenRef.current) setModelsLoading(false)
      }
    },
    [onError, onSaved, projectId, t, worker],
  )

  // Auto-load catalog when opening a worker with empty/stale models.
  useEffect(() => {
    void loadModels({ force: false })
    return () => {
      // Invalidate in-flight work and clear spinner so a cancelled load cannot
      // leave the next worker stuck on "Loading from ACP…".
      fetchGenRef.current += 1
      setModelsLoading(false)
    }
    // Only re-run when the selected worker (or project scope) changes — not on every snapshot tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional mount/worker-id trigger
  }, [worker.id, projectId])

  const modelOptions = useMemo((): SettingsSearchOption[] => {
    const values = [...catalogModels]
    if (model && !values.some((candidate) => candidate.modelId === model)) {
      values.unshift({ modelId: model, name: model })
    }
    // Prefer modelId as the single line when ACP "name" is just a prettified id
    // (avoids dual truncation of name + id in the narrow worker panel).
    return values.map((option) => toWorkerModelSearchOption(option))
  }, [catalogModels, model])
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
        <div className="worker-detail-card-actions">
          <button
            type="button"
            className="btn-ghost"
            disabled={modelsLoading || saving}
            onClick={() => void loadModels({ force: true })}
            title={t('workers.modelRefresh')}
          >
            {modelsLoading ? t('workers.modelLoading') : t('workers.modelRefresh')}
          </button>
          <button
            type="button"
            className="settings-save-btn"
            disabled={saving || !dirty || !reasoningValid}
            onClick={() => void save()}
          >
            {saving ? t('app.loading') : t('settings.save')}
          </button>
        </div>
      </div>
      <div className="settings-field">
        <label className="field-label" htmlFor={`worker-model-${worker.id}`}>
          {t('reasoning.model')}
        </label>
        <SettingsSearchCombobox
          id={`worker-model-${worker.id}`}
          options={modelOptions}
          value={model}
          disabled={saving || modelsLoading}
          placeholder={
            modelsLoading
              ? t('workers.modelLoading')
              : catalogModels.length === 0
                ? t('workers.modelPlaceholder')
                : t('reasoning.searchModel')
          }
          emptyLabel={
            modelsLoading
              ? t('workers.modelLoading')
              : catalogModels.length === 0
                ? t('workers.modelCatalogEmpty')
                : t('reasoning.noMatches')
          }
          clearOption={{ label: t('reasoning.agentDefault') }}
          allowCustomValue={Boolean(catalogNote) || (!modelsLoading && catalogModels.length === 0)}
          onChange={setModel}
        />
        {catalogNote ? (
          <p className="settings-field-hint is-warn" role="status">
            {catalogNote}
          </p>
        ) : (
          <p className="settings-field-hint">{t('workers.modelComboHint')}</p>
        )}
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
          disabled={saving || modelsLoading}
          onChange={setReasoning}
          onValidityChange={setReasoningValid}
        />
      </div>
    </div>
  )
}
