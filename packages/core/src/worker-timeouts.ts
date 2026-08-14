import type { WorkerTimeoutSettings } from '@pihuo-agent/shared'

export type { WorkerTimeoutSettings } from '@pihuo-agent/shared'

export const DEFAULT_WORKER_TIMEOUT_SETTINGS: WorkerTimeoutSettings = Object.freeze({
  jobTimeoutMs: 600_000,
  queueTimeoutMs: 600_000,
})

const WORKER_TIMEOUT_BOUNDS = {
  jobTimeoutMs: { min: 60_000, max: 7_200_000, env: 'WORKER_JOB_TIMEOUT_MS' },
  queueTimeoutMs: { min: 60_000, max: 7_200_000, env: 'WORKER_QUEUE_TIMEOUT_MS' },
} as const

type TimeoutField = keyof WorkerTimeoutSettings

function isValidTimeout(field: TimeoutField, value: unknown): value is number {
  const bounds = WORKER_TIMEOUT_BOUNDS[field]
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= bounds.min &&
    value <= bounds.max
  )
}

function envTimeout(
  field: TimeoutField,
  env: Readonly<Record<string, string | undefined>>,
): number | undefined {
  const parsed = Number(env[WORKER_TIMEOUT_BOUNDS[field].env])
  return isValidTimeout(field, parsed) ? parsed : undefined
}

export function resolveWorkerTimeoutSettings(
  input: unknown,
  env: Readonly<Record<string, string | undefined>> = process.env,
): WorkerTimeoutSettings {
  const value = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  const record = value as Record<string, unknown>
  const resolveField = (field: TimeoutField): number =>
    isValidTimeout(field, record[field])
      ? record[field]
      : (envTimeout(field, env) ?? DEFAULT_WORKER_TIMEOUT_SETTINGS[field])

  return {
    jobTimeoutMs: resolveField('jobTimeoutMs'),
    queueTimeoutMs: resolveField('queueTimeoutMs'),
  }
}

export function parseWorkerTimeoutSettings(input: unknown): WorkerTimeoutSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('workerTimeouts must be an object')
  }
  const record = input as Record<string, unknown>
  for (const field of Object.keys(WORKER_TIMEOUT_BOUNDS) as TimeoutField[]) {
    if (!isValidTimeout(field, record[field])) {
      const { min, max } = WORKER_TIMEOUT_BOUNDS[field]
      throw new RangeError(`${field} must be an integer between ${min} and ${max}`)
    }
  }
  return {
    jobTimeoutMs: record.jobTimeoutMs as number,
    queueTimeoutMs: record.queueTimeoutMs as number,
  }
}
