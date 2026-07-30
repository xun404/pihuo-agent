import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { WorkerRunState } from '@swarmdesk-agent/shared'

import { I18nProvider } from '../i18n/I18nProvider.js'
import { WorkerRunCard } from './WorkerRunCard.js'

;(globalThis as typeof globalThis & { React: typeof React }).React = React

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

    assert.equal((html.match(/worker-run worker-run-failed/gu) ?? []).length, 1)
    assert.match(html, /Fixture Agent/u)
    assert.match(html, /fixture-agent@1\.2\.3/u)
    assert.match(html, />Go authenticate</u)
    assert.match(html, /worker-action-section worker-action-error/u)
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

  it('shows the Team member name with a role tag and divides only real worker actions', () => {
    const state = {
      jobId: 'job-actions',
      workerId: 'worker-codex',
      workerName: 'Configured Codex Worker',
      teamMemberName: 'Implementation Member',
      workerKind: 'codex',
      role: 'coder',
      model: 'openai/gpt-5.6-codex',
      reasoning: 'high',
      reusedSession: false,
      sequence: 2,
      output: 'Implementation completed.',
      status: 'completed',
      truncated: false,
      startedAt: 1_000,
      lastDeltaAt: 2_500,
    } as WorkerRunState & { teamMemberName: string }
    const html = renderToStaticMarkup(
      <I18nProvider serverLocale="en">
        <WorkerRunCard
          state={state}
          taskPrompt="Implement the requested change."
          open
          onToggle={() => undefined}
        />
      </I18nProvider>,
    )

    assert.match(html, /<span class="name">Implementation Member<\/span>/u)
    assert.match(html, /class="node-cap role-cap" data-role="coder">coder/u)
    assert.match(html, /worker-action-section worker-action-input/u)
    assert.match(html, /worker-action-label">Input</u)
    assert.match(html, /worker-action-section worker-action-output/u)
    assert.match(html, /worker-action-label">Output</u)
    assert.doesNotMatch(html, /worker-action-(?:approval|error|thinking)/u)
  })
})
