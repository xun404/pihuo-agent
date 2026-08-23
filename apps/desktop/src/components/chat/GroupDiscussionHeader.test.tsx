import React from 'react'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { TeamMember } from '@pihuo-agent/shared'
import { I18nProvider } from '../../i18n/I18nProvider.js'
import {
  GroupDiscussionCoordinationStrip,
  GroupDiscussionHeader,
  GroupDiscussionParticipantStack,
} from './GroupDiscussionHeader.js'

function member(id: number): TeamMember {
  return {
    id: `member-${id}`,
    chatSessionId: 'session-1',
    workerId: `worker-${id}`,
    name: `Member ${id}`,
    roleType: 'coder',
    instructions: 'Work on the assigned task.',
    enabled: true,
    revision: 1,
    createdAt: '2026-08-23T00:00:00.000Z',
    updatedAt: '2026-08-23T00:00:00.000Z',
  }
}

const workers = [
  {
    id: 'worker-1',
    name: 'Claude Code',
    kind: 'claude',
    command: 'claude',
    args: [],
    primaryRole: 'coder',
    roles: ['coder'],
    capabilities: ['code-edit'],
    enabled: true,
    scope: 'global',
    description: 'Implementation worker',
    defaultRoleType: 'coder',
    health: 'healthy',
  },
] as const

describe('GroupDiscussionHeader', () => {
  it('shows the compact group roster and current task count without creating a control', () => {
    const html = renderToStaticMarkup(
      <I18nProvider serverLocale="en">
        <GroupDiscussionHeader
          teamMembers={[member(1), member(2), member(3), member(4), member(5)]}
          workers={workers as never}
          activeWorkerCount={2}
          activeTaskCount={2}
        />
      </I18nProvider>,
    )

    assert.match(html, /data-group-discussion-header="true"/u)
    assert.match(html, /1 user · 1 Leader · 5 Worker · 2 active tasks/u)
    assert.match(html, /2 workers active/u)
    assert.doesNotMatch(html, /pending approvals/u)
    assert.doesNotMatch(html, /<button/u)
  })

  it('renders role avatars and an agent badge only in the title-row participant stack', () => {
    const html = renderToStaticMarkup(
      <I18nProvider serverLocale="en">
        <GroupDiscussionParticipantStack
          teamMembers={[member(1), member(2), member(3), member(4), member(5), member(6)]}
          workers={workers as never}
        />
      </I18nProvider>,
    )

    assert.match(html, /group-discussion-participants/u)
    assert.match(
      html,
      /Members: Leader, Member 1, Member 2, Member 3, Member 4, Member 5, Member 6/u,
    )
    assert.match(html, />\+1</u)
    assert.match(html, /data-group-participant="leader"/u)
    assert.match(html, /data-group-participant="member"/u)
    assert.match(html, /data-role="coder"/u)
    assert.match(html, /group-member-agent-badge/u)
    assert.match(html, /data-agent-kind="claude"/u)
    assert.doesNotMatch(html, /<button/u)
  })

  it('renders a read-only coordination strip from the existing task and approval counts', () => {
    const html = renderToStaticMarkup(
      <I18nProvider serverLocale="en">
        <GroupDiscussionCoordinationStrip activeTaskCount={2} pendingApprovalCount={1} />
      </I18nProvider>,
    )

    assert.match(html, /data-group-discussion-coordination="true"/u)
    assert.match(html, /Coordination checklist/u)
    assert.match(html, /2 active tasks are synchronized in the discussion/u)
    assert.match(html, /1 pending approvals/u)
    assert.doesNotMatch(html, /<button/u)
  })
})
