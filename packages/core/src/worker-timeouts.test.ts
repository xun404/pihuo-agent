import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DEFAULT_WORKER_TIMEOUT_SETTINGS,
  parseWorkerTimeoutSettings,
  resolveWorkerTimeoutSettings,
} from './worker-timeouts.js'

describe('worker timeout settings', () => {
  it('uses saved values before environment fallbacks', () => {
    assert.deepEqual(
      resolveWorkerTimeoutSettings(
        {
          jobTimeoutMs: 120_000,
          approvalTimeoutMs: 60_000,
          queueTimeoutMs: 180_000,
        },
        {
          WORKER_JOB_TIMEOUT_MS: '240000',
          APPROVAL_TIMEOUT_MS: '120000',
          WORKER_QUEUE_TIMEOUT_MS: '300000',
        },
      ),
      {
        jobTimeoutMs: 120_000,
        approvalTimeoutMs: 60_000,
        queueTimeoutMs: 180_000,
      },
    )
  })

  it('falls back per field from environment and then defaults', () => {
    assert.deepEqual(
      resolveWorkerTimeoutSettings(
        { approvalTimeoutMs: 'invalid' },
        {
          WORKER_JOB_TIMEOUT_MS: '180000',
          APPROVAL_TIMEOUT_MS: '60000',
        },
      ),
      {
        jobTimeoutMs: 180_000,
        approvalTimeoutMs: 60_000,
        queueTimeoutMs: DEFAULT_WORKER_TIMEOUT_SETTINGS.queueTimeoutMs,
      },
    )
  })

  it('strictly accepts inclusive bounds', () => {
    assert.deepEqual(
      parseWorkerTimeoutSettings({
        jobTimeoutMs: 60_000,
        approvalTimeoutMs: 3_600_000,
        queueTimeoutMs: 7_200_000,
      }),
      {
        jobTimeoutMs: 60_000,
        approvalTimeoutMs: 3_600_000,
        queueTimeoutMs: 7_200_000,
      },
    )
  })

  it('strictly rejects missing, fractional, and out-of-range values', () => {
    assert.throws(
      () =>
        parseWorkerTimeoutSettings({
          jobTimeoutMs: 59_999,
          approvalTimeoutMs: 60_000,
          queueTimeoutMs: 600_000,
        }),
      /jobTimeoutMs/u,
    )
    assert.throws(
      () =>
        parseWorkerTimeoutSettings({
          jobTimeoutMs: 60_000,
          approvalTimeoutMs: 60_000.5,
          queueTimeoutMs: 600_000,
        }),
      /approvalTimeoutMs/u,
    )
    assert.throws(
      () =>
        parseWorkerTimeoutSettings({
          jobTimeoutMs: 60_000,
          approvalTimeoutMs: 60_000,
        }),
      /queueTimeoutMs/u,
    )
  })
})
