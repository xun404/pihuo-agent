import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { WorkerRunState } from '@pihuo-agent/shared'

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
      pendingApprovals: [],
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
            pendingApprovals: [],
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

  it('explains restart failures and does not render an actionable stale approval', () => {
    const html = renderToStaticMarkup(
      <I18nProvider serverLocale="en">
        <WorkerRunCard
          state={{
            jobId: 'job-restarted',
            workerId: 'worker-fixture',
            workerName: 'Fixture Agent',
            workerKind: 'custom',
            role: 'general',
            reusedSession: false,
            sequence: 0,
            output: '',
            status: 'failed',
            truncated: false,
            error: 'RUNTIME_RESTARTED: worker runtime restarted before job completed',
            errorCode: 'RUNTIME_RESTARTED',
            startedAt: 1,
            lastDeltaAt: 2,
            pendingApprovals: [],
          }}
          open
          onToggle={() => undefined}
          onResolveApproval={() => undefined}
        />
      </I18nProvider>,
    )

    assert.match(html, /RUNTIME_RESTARTED/u)
    assert.match(html, /manually rerun this task/u)
    assert.doesNotMatch(html, /approval-actions|approval-row/u)
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

  it('renders an ordered activity trail and expands only the currently active item', () => {
    const state: WorkerRunState = {
      jobId: 'job-activity',
      workerId: 'worker-codex',
      workerName: 'Codex',
      workerKind: 'codex',
      role: 'coder',
      reusedSession: false,
      sequence: 4,
      output: '',
      activityItems: [
        { id: 'thought:1', type: 'thought', sequence: 1, text: 'Inspecting the target file.' },
        {
          id: 'tool:tool-1',
          type: 'tool',
          sequence: 2,
          toolCall: {
            toolCallId: 'tool-1',
            title: 'Read file',
            kind: 'read',
            status: 'completed',
            detail: '/tmp/example.txt',
          },
        },
        { id: 'thought:3', type: 'thought', sequence: 3, text: 'Planning the edit.' },
      ],
      activeActivityItemId: 'thought:3',
      status: 'running',
      truncated: false,
      startedAt: 1_000,
      lastDeltaAt: 2_000,
      pendingApprovals: [],
    }
    const html = renderToStaticMarkup(
      <I18nProvider serverLocale="en">
        <WorkerRunCard state={state} open onToggle={() => undefined} />
      </I18nProvider>,
    )

    assert.match(html, /worker-activity-list/u)
    assert.doesNotMatch(html, /Inspecting the target file\./u)
    assert.match(html, /Read file/u)
    assert.match(html, /Planning the edit\./u)
    assert.match(html, /class="thinking-block live is-open"/u)
    assert.equal((html.match(/class="thinking-block"/gu) ?? []).length, 1)
    assert.match(html, /class="tool-row"/u)
    assert.doesNotMatch(html, /worker-action-activity|Thinking · Tools/u)

    const completedHtml = renderToStaticMarkup(
      <I18nProvider serverLocale="en">
        <WorkerRunCard
          state={{ ...state, status: 'completed', activeActivityItemId: undefined }}
          open
          onToggle={() => undefined}
        />
      </I18nProvider>,
    )
    assert.doesNotMatch(
      completedHtml,
      /thinking-block live|thinking-block is-open|tool-row is-open/u,
    )
  })

  it('renders every pending approval in stable order with an explicit cancel action', () => {
    const approval = (id: string, createdAt: string, title: string) => ({
      id,
      status: 'pending' as const,
      title,
      options: [
        { optionId: `${id}-allow`, name: 'Allow once', kind: 'allow_once' as const },
      ],
      source: 'acp' as const,
      createdAt,
      jobId: 'job-multi',
    })
    const html = renderToStaticMarkup(
      <I18nProvider serverLocale="en">
        <WorkerRunCard
          state={{
            jobId: 'job-multi',
            workerName: 'Codex',
            workerKind: 'codex',
            reusedSession: false,
            sequence: 0,
            output: '',
            status: 'pending_approval',
            truncated: false,
            startedAt: 1,
            lastDeltaAt: 2,
            pendingApprovals: [
              approval('a2', '2026-07-14T02:00:00.000Z', 'Second approval'),
              approval('a1', '2026-07-14T01:00:00.000Z', 'First approval'),
            ],
          }}
          open
          onToggle={() => undefined}
          resolving={{}}
          onResolveApproval={() => undefined}
        />
      </I18nProvider>,
    )

    assert.ok(html.indexOf('First approval') < html.indexOf('Second approval'))
    assert.equal((html.match(/>\[Cancel\]</gu) ?? []).length, 2)
  })
})
