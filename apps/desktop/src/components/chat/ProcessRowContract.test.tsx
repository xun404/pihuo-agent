import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { WorkerRunState } from '@swarmdesk-agent/shared'

import { I18nProvider } from '../../i18n/I18nProvider.js'
import { WorkerRunCard } from '../WorkerRunCard.js'
import { ThinkingBlock } from './ThinkingBlock.js'
import { TaskProcessRow } from './TaskListCard.js'
import { ToolCallRow } from './ToolCallRow.js'

;(globalThis as typeof globalThis & { React: typeof React }).React = React

function sharedHooks(html: string) {
  assert.match(html, /process-row-summary/u)
  assert.match(html, /process-icon-slot/u)
  assert.match(html, /process-icon-type/u)
  assert.match(html, /process-icon-chevron/u)
  assert.match(html, /process-collapse-body/u)
}

describe('collapsible process-row visual contract', () => {
  it('uses the same summary, icon, chevron, and expanded-body hooks for thinking and tools', () => {
    const thinking = renderToStaticMarkup(
      <ThinkingBlock
        text="reasoning"
        streaming={false}
        open
        onToggle={() => undefined}
        streamingLabel="思考中"
        doneLabel="已思考"
        doneLabelFor={(time) => `已思考 ${time}`}
        locale="zh"
      />,
    )
    const tool = renderToStaticMarkup(
      <ToolCallRow
        name="bash"
        input={{ command: 'pwd' }}
        output={{ stdout: '/tmp' }}
        durationSec={0.4}
        running={false}
        open
        onToggle={() => undefined}
        errorLabel="Error"
      />,
    )

    sharedHooks(thinking)
    sharedHooks(tool)
    assert.match(thinking, /lucide-brain/u)
  })

  it('uses the shared hooks for Task with a plain-text role heading', () => {
    const html = renderToStaticMarkup(
      <I18nProvider serverLocale="zh">
        <TaskProcessRow
          task={{
            id: 'task-process-row',
            content: '[plan] 设计完整方案',
            status: 'in_progress',
            activeForm: '分析代码结构',
          }}
          open
          onToggle={() => undefined}
        />
      </I18nProvider>,
    )

    sharedHooks(html)
    assert.match(html, /class="task-row-heading"/u)
    assert.match(html, /class="task-row-role-text"[^>]*>plan</u)
    assert.doesNotMatch(html, /class="task-row-role(?:\s|"| role-)/u)
  })

  it('uses the shared hooks for Worker while retaining model and reasoning metadata', () => {
    const state: WorkerRunState = {
      jobId: 'job-process-row',
      workerId: 'worker-codex',
      workerName: 'Codex',
      workerKind: 'codex',
      role: 'coder',
      model: 'openai/gpt-5.6-codex',
      reasoning: 'high',
      reusedSession: false,
      sequence: 1,
      output: 'done',
      status: 'completed',
      truncated: false,
      startedAt: 1_000,
      lastDeltaAt: 2_000,
    }
    const html = renderToStaticMarkup(
      <I18nProvider serverLocale="en">
        <WorkerRunCard state={state} open onToggle={() => undefined} />
      </I18nProvider>,
    )

    sharedHooks(html)
    assert.doesNotMatch(html, /class="worker-card(?:\s|")/u)
    assert.match(html, /gpt-5\.6-codex/u)
    assert.match(html, />high</u)
  })
})
