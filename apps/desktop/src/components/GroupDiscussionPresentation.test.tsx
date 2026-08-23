import React from 'react'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from '../i18n/I18nProvider.js'
import { MessageItem } from './MessageItem.js'
import { WorkerRunCard } from './WorkerRunCard.js'

const discussionLabels: Record<string, string> = {
  'chat.discussionYou': 'You',
  'chat.discussionLeader': 'Leader',
  'chat.discussionWorker': 'Worker',
}

const t = (key: string) => discussionLabels[key] ?? key

describe('Group discussion presentation', () => {
  it('adds a participant identity to user messages without changing the message bubble', () => {
    const html = renderToStaticMarkup(
      <MessageItem
        message={
          { id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'Hello team' }] } as never
        }
        msgIdx={0}
        messages={[]}
        busy={false}
        lastAssistantId={undefined}
        isTailMessage
        showErrorInThisBubble={false}
        t={t as never}
        locale="en"
        models={[]}
        selectedModel=""
        thinkingIntensity="off"
        modelShort=""
        thinkShort=""
        metaOpen={{}}
        setMetaOpen={() => undefined}
        tick={0}
        placementByJobId={new Map()}
        toolCallJobIds={new Map()}
        hasRunningWorker={false}
        resolving={{}}
        registryIdentityFor={() => undefined}
        isMetaOpen={() => false}
        errorBlock={null}
        timingEpoch={0}
        turnTimingRef={{ current: new Map() }}
        toolStartTimes={{ current: new Map() }}
        toolDurations={{ current: new Map() }}
        discussionMode
      />,
    )

    assert.match(html, /class="discussion-message-author">/u)
    assert.match(html, /data-discussion-speaker="user"/u)
    assert.match(html, /class="bubble"[^>]*>Hello team</u)
  })

  it('keeps the existing Worker card and adds its participant identity', () => {
    const html = renderToStaticMarkup(
      <I18nProvider serverLocale="en">
        <WorkerRunCard
          discussionMode
          state={{
            jobId: 'job-1',
            workerName: 'Codex Worker',
            teamMemberName: 'Implementation',
            workerKind: 'codex',
            reusedSession: false,
            sequence: 0,
            output: '',
            status: 'running',
            truncated: false,
            startedAt: 0,
            lastDeltaAt: 0,
            pendingApprovals: [],
          }}
        />
      </I18nProvider>,
    )

    assert.match(html, /data-discussion-worker="true"/u)
    assert.match(html, /Implementation/u)
    assert.match(html, /Worker/u)
    assert.match(html, /data-discussion-speaker="worker"/u)
    assert.match(html, /discussion-message-agent-badge/u)
    assert.match(html, /data-agent-kind="codex"/u)
    assert.match(html, /worker-card-head/u)
    assert.equal((html.match(/>Implementation</gu) ?? []).length, 1)
    assert.doesNotMatch(html, /worker-card-head[\s\S]*?class="name"/u)
  })
})
