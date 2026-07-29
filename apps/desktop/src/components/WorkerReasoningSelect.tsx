import { useEffect, useMemo, useRef, useState } from 'react'
import { api, type WorkerReasoningOptionsResponse } from '../lib/api'
import { useI18n } from '../i18n/I18nProvider'

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

  const options = result?.selector?.options ?? []
  const selectedUnavailable = useMemo(
    () => Boolean(value && !options.some((option) => option.value === value)),
    [options, value],
  )
  const fallbackLabel = inheritLabel ?? t('reasoning.agentDefault')
  const valid = isWorkerReasoningSelectionValid(value, result, loading)

  useEffect(() => {
    onValidityChange?.(valid)
  }, [onValidityChange, valid])

  return (
    <>
      <select
        id={id}
        className="settings-select"
        value={value}
        disabled={disabled || loading || !workerId}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{fallbackLabel}</option>
        {selectedUnavailable && (
          <option value={value}>{t('reasoning.unavailable', { value })}</option>
        )}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.name || option.value}
          </option>
        ))}
      </select>
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
