import React, { useEffect, useRef, useState } from 'react'
import type { WorkerTimeoutSettings } from '@swarmdesk-agent/shared'
import { useI18n } from '../i18n/I18nProvider'

type TimeoutDraft = {
  job: string
  approval: string
  queue: string
}

type TimeoutField = keyof TimeoutDraft

export type WorkerTimeoutMinutesParseResult =
  { ok: true; value: WorkerTimeoutSettings } | { ok: false; field: TimeoutField }

const MINUTES_TO_MS = 60_000
const AUTO_SAVE_MS = 400
const LEADER_STEPS_MIN = 10
const LEADER_STEPS_MAX = 1000

function parseMinutes(value: string, min: number, max: number): number | null {
  const trimmed = value.trim()
  const parsed = Number(trimmed)
  if (!trimmed || !Number.isInteger(parsed) || String(parsed) !== trimmed) return null
  return parsed >= min && parsed <= max ? parsed : null
}

export function parseWorkerTimeoutMinutes(draft: TimeoutDraft): WorkerTimeoutMinutesParseResult {
  const job = parseMinutes(draft.job, 1, 120)
  if (job === null) return { ok: false, field: 'job' }
  const approval = parseMinutes(draft.approval, 1, 60)
  if (approval === null) return { ok: false, field: 'approval' }
  const queue = parseMinutes(draft.queue, 1, 120)
  if (queue === null) return { ok: false, field: 'queue' }
  return {
    ok: true,
    value: {
      jobTimeoutMs: job * MINUTES_TO_MS,
      approvalTimeoutMs: approval * MINUTES_TO_MS,
      queueTimeoutMs: queue * MINUTES_TO_MS,
    },
  }
}

function draftFromSettings(value: WorkerTimeoutSettings): TimeoutDraft {
  return {
    job: String(value.jobTimeoutMs / MINUTES_TO_MS),
    approval: String(value.approvalTimeoutMs / MINUTES_TO_MS),
    queue: String(value.queueTimeoutMs / MINUTES_TO_MS),
  }
}

function sameTimeouts(a: WorkerTimeoutSettings, b: WorkerTimeoutSettings): boolean {
  return (
    a.jobTimeoutMs === b.jobTimeoutMs &&
    a.approvalTimeoutMs === b.approvalTimeoutMs &&
    a.queueTimeoutMs === b.queueTimeoutMs
  )
}

function parseLeaderSteps(value: string): number | null {
  const trimmed = value.trim()
  const parsed = Number(trimmed)
  if (!trimmed || !Number.isInteger(parsed) || String(parsed) !== trimmed) return null
  if (parsed < LEADER_STEPS_MIN || parsed > LEADER_STEPS_MAX) return null
  return parsed
}

export function WorkerTimeoutSettingsEditor({
  value,
  saving,
  onSave,
  leaderMaxSteps,
  leaderMaxStepsSaving,
  onSaveLeaderMaxSteps,
}: {
  value: WorkerTimeoutSettings
  saving: boolean
  onSave: (value: WorkerTimeoutSettings) => Promise<void>
  leaderMaxSteps: number
  leaderMaxStepsSaving?: boolean
  onSaveLeaderMaxSteps: (value: number) => Promise<void>
}) {
  const { t } = useI18n()
  const [draft, setDraft] = useState<TimeoutDraft>(() => draftFromSettings(value))
  const [errorField, setErrorField] = useState<TimeoutField | null>(null)
  const [stepsDraft, setStepsDraft] = useState(() => String(leaderMaxSteps))
  const [stepsError, setStepsError] = useState(false)
  const valueRef = useRef(value)
  const draftRef = useRef(draft)
  const stepsValueRef = useRef(leaderMaxSteps)
  const stepsDraftRef = useRef(stepsDraft)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stepsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  valueRef.current = value
  draftRef.current = draft
  stepsValueRef.current = leaderMaxSteps
  stepsDraftRef.current = stepsDraft

  useEffect(() => {
    const next = draftFromSettings(value)
    setDraft(next)
    draftRef.current = next
    setErrorField(null)
  }, [value])

  useEffect(() => {
    const next = String(leaderMaxSteps)
    setStepsDraft(next)
    stepsDraftRef.current = next
    setStepsError(false)
  }, [leaderMaxSteps])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      if (stepsTimerRef.current) clearTimeout(stepsTimerRef.current)
    }
  }, [])

  const trySave = (nextDraft: TimeoutDraft) => {
    const parsed = parseWorkerTimeoutMinutes(nextDraft)
    if (!parsed.ok) {
      setErrorField(parsed.field)
      return
    }
    setErrorField(null)
    if (sameTimeouts(parsed.value, valueRef.current)) return
    void onSave(parsed.value)
  }

  const trySaveSteps = (raw: string) => {
    const parsed = parseLeaderSteps(raw)
    if (parsed === null) {
      setStepsError(true)
      return
    }
    setStepsError(false)
    if (parsed === stepsValueRef.current) return
    void onSaveLeaderMaxSteps(parsed)
  }

  const update = (field: TimeoutField, next: string) => {
    setDraft((current) => {
      const nextDraft = { ...current, [field]: next }
      draftRef.current = nextDraft
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => trySave(nextDraft), AUTO_SAVE_MS)
      return nextDraft
    })
    if (errorField === field) setErrorField(null)
  }

  const updateSteps = (next: string) => {
    setStepsDraft(next)
    stepsDraftRef.current = next
    if (stepsError) setStepsError(false)
    if (stepsTimerRef.current) clearTimeout(stepsTimerRef.current)
    stepsTimerRef.current = setTimeout(() => trySaveSteps(next), AUTO_SAVE_MS)
  }

  const fields: Array<{
    field: TimeoutField
    label: Parameters<typeof t>[0]
    description: Parameters<typeof t>[0]
    error: Parameters<typeof t>[0]
    max: number
  }> = [
    {
      field: 'job',
      label: 'settings.runtime.workerJobTimeout',
      description: 'settings.runtime.workerJobTimeoutDesc',
      error: 'settings.runtime.workerJobTimeoutError',
      max: 120,
    },
    {
      field: 'approval',
      label: 'settings.runtime.workerApprovalTimeout',
      description: 'settings.runtime.workerApprovalTimeoutDesc',
      error: 'settings.runtime.workerApprovalTimeoutError',
      max: 60,
    },
    {
      field: 'queue',
      label: 'settings.runtime.workerQueueTimeout',
      description: 'settings.runtime.workerQueueTimeoutDesc',
      error: 'settings.runtime.workerQueueTimeoutError',
      max: 120,
    },
  ]

  const busy = saving || Boolean(leaderMaxStepsSaving)

  return (
    <div className="settings-form-card settings-runtime-card">
      <header className="settings-card-head">
        <div className="settings-card-titles">
          <h3 className="settings-card-title">{t('settings.runtime.workerTimeouts')}</h3>
          <p className="settings-card-desc">{t('settings.runtime.workerTimeoutsDesc')}</p>
        </div>
      </header>

      <div className="settings-runtime-rows">
        <div className="settings-row-block">
          <div className="settings-row card-row">
            <div className="lbl-block">
              <div className="lbl">{t('settings.runtime.leaderMaxSteps')}</div>
              <div className="sub">{t('settings.runtime.leaderMaxStepsDesc')}</div>
            </div>
            <label className="timeout-duration-field">
              <input
                type="number"
                className="timeout-duration-input"
                min={LEADER_STEPS_MIN}
                max={LEADER_STEPS_MAX}
                step={1}
                value={stepsDraft}
                disabled={busy}
                aria-label={t('settings.runtime.leaderMaxSteps')}
                onChange={(event) => updateSteps(event.target.value)}
                onBlur={() => {
                  if (stepsTimerRef.current) {
                    clearTimeout(stepsTimerRef.current)
                    stepsTimerRef.current = null
                  }
                  trySaveSteps(stepsDraftRef.current)
                }}
              />
              <span className="timeout-duration-unit" aria-hidden>
                {t('settings.runtime.stepsUnit')}
              </span>
            </label>
          </div>
          {stepsError && (
            <p className="settings-error">{t('settings.runtime.leaderMaxStepsError')}</p>
          )}
        </div>

        {fields.map(({ field, label, description, error, max }) => (
          <div key={field} className="settings-row-block">
            <div className="settings-row card-row">
              <div className="lbl-block">
                <div className="lbl">{t(label)}</div>
                <div className="sub">{t(description)}</div>
              </div>
              <label className="timeout-duration-field">
                <input
                  type="number"
                  aria-label={t(label)}
                  className="timeout-duration-input"
                  min={1}
                  max={max}
                  step={1}
                  value={draft[field]}
                  disabled={busy}
                  onChange={(event) => update(field, event.target.value)}
                  onBlur={() => {
                    if (timerRef.current) {
                      clearTimeout(timerRef.current)
                      timerRef.current = null
                    }
                    trySave(draftRef.current)
                  }}
                />
                <span className="timeout-duration-unit" aria-hidden>
                  {t('settings.runtime.minutesUnit')}
                </span>
              </label>
            </div>
            {errorField === field && <p className="settings-error">{t(error)}</p>}
          </div>
        ))}
      </div>
    </div>
  )
}
