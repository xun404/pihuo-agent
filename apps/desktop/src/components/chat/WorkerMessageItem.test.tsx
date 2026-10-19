import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { WorkerRunState } from '@pihuo-agent/shared'
import { I18nProvider } from '../../i18n/I18nProvider.js'
import { WorkerMessageItem } from './WorkerMessageItem.js'

;(globalThis as typeof globalThis & { React: typeof React }).React = React

function state(overrides: Partial<WorkerRunState> = {}): WorkerRunState {
  return {
    jobId: 'job-1',
    workerName: 'OpenCode',
    teamMemberName: 'OpenCode',
    workerKind: 'opencode',
    reusedSession: false,
    sequence: 0,
    output: '你好！我是 OpenCode',
    status: 'completed',
    truncated: false,
    startedAt: Date.parse('2026-08-25T00:54:38.000Z'),
    lastDeltaAt: Date.parse('2026-08-25T00:54:45.000Z'),
    pendingApprovals: [],
    ...overrides,
  }
}

function render(overrides: Partial<WorkerRunState> = {}, taskPrompt?: string) {
  return renderToStaticMarkup(
    <I18nProvider serverLocale="zh">
      <WorkerMessageItem state={state(overrides)} taskPrompt={taskPrompt} />
    </I18nProvider>,
  )
}

describe('WorkerMessageItem', () => {
  const activities: WorkerRunState['activityItems'] = [1, 2, 3, 4, 5].map((index) => ({
    id: `tool:${index}`,
    type: 'tool',
    sequence: index,
    toolCall: {
      toolCallId: String(index),
      title: `Read fixture ${index}`,
      kind: 'read',
      status: 'completed',
    },
  }))

  it('folds completed activity while keeping the Worker reply visible', () => {
    const html = render({ activityItems: activities })
    assert.match(html, /活动记录 · 5 条/u)
    assert.match(html, /你好！我是 OpenCode/u)
    assert.doesNotMatch(html, /Read fixture/u)
    assert.match(html, /im-activity-quote" aria-expanded="false"/u)
  })

  it('previews the newest three running records without opening tool details', () => {
    const html = render({ status: 'running', activityItems: activities })
    assert.doesNotMatch(html, /Read fixture [12]/u)
    assert.match(html, /Read fixture 3[\s\S]*Read fixture 4[\s\S]*Read fixture 5/u)
    assert.doesNotMatch(html, /tool-row is-open/u)
  })

  it('keeps authentication and recovery actions outside a folded failed trail', () => {
    const html = render({
      status: 'failed',
      output: '',
      activityItems: activities,
      error: 'Authentication required',
      errorCode: 'WORKER_AUTH_REQUIRED',
    })
    assert.doesNotMatch(html, /Read fixture/u)
    assert.match(html, /Authentication required/u)
    assert.match(html, /worker-card-auth-btn/u)
    assert.match(html, /worker-card-collapse/u)
  })

  it('renders Worker speech as its own message bubble, not a Leader child', () => {
    const html = render({}, '用户想跟你（OpenCode）打个招呼。')

    assert.match(html, /class="msg worker-speaker"/u)
    assert.match(html, /data-msg-role="worker"/u)
    assert.match(html, /data-job-id="job-1"/u)
    assert.match(html, /class="bubble"[\s\S]*你好！我是 OpenCode/u)
    assert.match(html, /im-quote[\s\S]*用户想跟你/u)
    assert.match(html, /class="bubble"[\s\S]*用户想跟你（OpenCode）打个招呼/u)
    assert.doesNotMatch(html, /discussion-worker-context/u)
    assert.match(html, /data-discussion-speaker="worker"/u)
    assert.match(html, /is-worker-process/u)
    assert.doesNotMatch(html, /worker-action-output/u)
  })

  it('shows a pending bubble while running without output', () => {
    const html = render({ output: '', status: 'running' }, '用户想跟你（OpenCode）打个招呼。')
    assert.match(html, /class="msg-pending"/u)
    assert.match(html, /im-quote[\s\S]*用户想跟你/u)
    assert.doesNotMatch(html, /class="bubble"[\s\S]*你好/u)
  })

  it('does not treat a failed assignment as Worker speech', () => {
    const html = render(
      { output: '', status: 'failed', error: 'Insufficient balance' },
      '用户想跟你（OpenCode）打个招呼。',
    )
    assert.doesNotMatch(html, /class="bubble"/u)
    assert.doesNotMatch(html, /im-quote/u)
    assert.match(html, /worker-run-failed/u)
  })

  it('keeps approval actions inside the Worker process card', () => {
    const html = render({
      output: 'waiting',
      status: 'pending_approval',
      pendingApprovals: [
        {
          id: 'appr-1',
          status: 'pending',
          sessionId: 's1',
          jobId: 'job-1',
          workerId: 'w1',
          workerName: 'OpenCode',
          createdAt: '2026-08-25T00:00:00.000Z',
          title: 'Edit file',
          options: [],
          source: 'acp',
        } as never,
      ],
    })
    assert.match(html, /worker-action-approval/u)
    assert.match(html, /class="msg worker-speaker"[\s\S]*worker-run/u)
  })
})
