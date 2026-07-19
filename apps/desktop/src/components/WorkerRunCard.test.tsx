import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { WorkerRunState } from '@swarmdesk-agent/shared'

import { I18nProvider } from '../i18n/I18nProvider.js'
import { WorkerRunCard } from './WorkerRunCard.js'

describe('WorkerRunCard Registry auth_required', () => {
  it('keeps one Worker card and shows localized real agent/Registry identity auth CTA', () => {
    const state: WorkerRunState = {
      jobId: 'job-fixture',
      workerId: 'worker-fixture',
      workerName: 'Fixture Agent',
      workerKind: 'custom',
      role: 'general',
      reusedSession: false,
      sequence: 0,
      output: '',
      status: 'failed',
      truncated: false,
      error: 'Authentication required',
      errorCode: 'WORKER_AUTH_REQUIRED',
      startedAt: 1,
      lastDeltaAt: 2,
    }
    const html = renderToStaticMarkup(
      <I18nProvider serverLocale="en">
        <WorkerRunCard state={state} registryIdentity="fixture-agent@1.2.3" />
      </I18nProvider>,
    )

    assert.equal((html.match(/worker-card worker-card-failed/gu) ?? []).length, 1)
    assert.match(html, /Fixture Agent/u)
    assert.match(html, /fixture-agent@1\.2\.3/u)
    assert.match(html, />Go authenticate</u)
    assert.doesNotMatch(html, /approval-row/u)
  })

  it('localizes recovery, empty-output, and truncation actions', () => {
    const html = renderToStaticMarkup(
      <I18nProvider serverLocale="en">
        <WorkerRunCard
          state={{
            jobId: 'job-recovery',
            workerId: 'worker-fixture',
            workerName: 'Fixture Agent',
            workerKind: 'custom',
            role: 'general',
            reusedSession: false,
            sequence: 0,
            output: '',
            status: 'completed',
            truncated: true,
            recoveryError: 'Context could not be restored',
            canResetAcpContext: true,
            startedAt: 1,
            lastDeltaAt: 2,
          }}
          onResetContext={() => {}}
        />
      </I18nProvider>,
    )

    assert.match(html, />Restart this agent context</u)
    assert.match(html, />Completed \(no output\)</u)
    assert.match(html, />Output truncated</u)
    assert.doesNotMatch(html, /重新开始|输出已截断/u)
  })
})
