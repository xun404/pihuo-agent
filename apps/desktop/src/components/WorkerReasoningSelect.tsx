import { useEffect, useMemo, useRef, useState } from 'react'
import { api, type WorkerReasoningOptionsResponse } from '../lib/api'
import { useI18n } from '../i18n/I18nProvider'
import { toReasoningSearchOption } from '../lib/settings-search-combobox'
import { SettingsSearchCombobox, type SettingsSearchOption } from './SettingsSearchCombobox'

interface Props {
  id: string
  workerId?: string
  model?: string
  projectId?: string | null
  value: string
  inheritLabel?: string
  disabled?: boolean
  onChange: (value: string) => void
  onValidityChange?: (valid: boolean) => void
}

export function isWorkerReasoningSelectionValid(
  value: string,
  result: WorkerReasoningOptionsResponse | null,
  loading: boolean,
): boolean {
  if (!value) return true
  if (loading || !result?.ok || !result.supported) return false
  return Boolean(result.selector?.options.some((option) => option.value === value))
}

export function WorkerReasoningSelect({
  id,
  workerId,
  model,
  projectId,
  value,
  inheritLabel,
  disabled,
  onChange,
  onValidityChange,
}: Props) {
  const { t } = useI18n()
  const [result, setResult] = useState<WorkerReasoningOptionsResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const requestRevision = useRef(0)

  useEffect(() => {
    const revision = ++requestRevision.current
    if (!workerId) {
      setResult(null)
      setLoading(false)
      return
    }
    setLoading(true)
    void api
      .fetchWorkerReasoningOptions(workerId, {
        model: model?.trim() || undefined,
        projectId,
      })
      .then((next) => {
        if (requestRevision.current === revision) setResult(next)
      })
      .catch((error) => {
        if (requestRevision.current !== revision) return
        setResult({
          ok: false,
          supported: false,
          cached: false,
          stale: false,
          error: error instanceof Error ? error.message : String(error),
        })
      })
      .finally(() => {
        if (requestRevision.current === revision) setLoading(false)
      })
  }, [model, projectId, workerId])

  const fallbackLabel = inheritLabel ?? t('reasoning.agentDefault')
  const options = useMemo((): SettingsSearchOption[] => {
    const rows: SettingsSearchOption[] = (result?.selector?.options ?? []).map((option) =>
      toReasoningSearchOption(option),
    )
    if (value && !rows.some((option) => option.value === value)) {
      rows.unshift({
        value,
        label: t('reasoning.unavailable', { value }),
        keywords: value,
      })
    }
    return rows
  }, [result?.selector?.options, t, value])

  const valid = isWorkerReasoningSelectionValid(value, result, loading)

  useEffect(() => {
    onValidityChange?.(valid)
  }, [onValidityChange, valid])

  return (
    <>
      <SettingsSearchCombobox
        id={id}
        options={options}
        value={value}
        disabled={disabled || loading || !workerId}
        placeholder={t('reasoning.searchIntensity')}
        emptyLabel={t('reasoning.noMatches')}
        clearOption={{ label: fallbackLabel }}
        onChange={onChange}
      />
      <span className={`settings-field-hint${result?.stale ? ' is-warn' : ''}`}>
        {loading
          ? t('reasoning.loading')
          : result?.stale
            ? t('reasoning.stale')
            : result && !result.supported
              ? result.error || t('reasoning.unsupported')
              : result?.error || ''}
      </span>
    </>
  )
}
