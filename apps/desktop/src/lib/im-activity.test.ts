import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  formatImActivityLabel,
  hasImActivity,
  summarizeLeaderActivity,
  thinkMetaKey,
  toolMetaKey,
} from './im-activity.js'
import type { LeaderViewPart } from './leader-chat-view.js'

describe('im-activity', () => {
  it('summarizes thought and tools without turning dispatch into an @ chip', () => {
    const parts = [
      { type: 'reasoning', text: 'plan', state: 'done' },
      {
        type: 'tool-get-active-context',
        toolName: 'get-active-context',
        state: 'output-available',
      },
      {
        type: 'tool-dispatch-team-member',
        toolName: 'dispatch-team-member',
        input: { teamMemberName: 'OpenCode' },
      },
    ] as LeaderViewPart[]

    const summary = summarizeLeaderActivity(parts, [0, 1, 2])
    assert.equal(summary.thoughtDone, true)
    assert.equal(summary.toolCount, 1)
    assert.deepEqual(summary.dispatchNames, ['OpenCode'])
    assert.equal(
      formatImActivityLabel(summary, (key, vars) => {
        if (key === 'chat.activityThought') return '已思考'
        if (key === 'chat.activityTools') return `${vars?.count} 个工具`
        if (key === 'chat.activityDispatched') return `派给 ${vars?.name}`
        return key
      }),
      '已思考 · 1 个工具 · 派给 OpenCode',
    )
    assert.equal(hasImActivity(summary), true)
    assert.doesNotMatch(
      formatImActivityLabel(summary, (key, vars) =>
        key === 'chat.activityDispatched' ? `派给 ${vars?.name}` : key,
      ),
      /@OpenCode/,
    )
  })

  it('uses stable think/tool keys that do not include timeline fragments', () => {
    assert.equal(thinkMetaKey('a1', 2), 'think:a1:2')
    assert.equal(
      toolMetaKey({ type: 'tool-bash', toolCallId: 't1' } as LeaderViewPart, 'a1', 3),
      'tool:t1',
    )
    assert.equal(toolMetaKey({ type: 'tool-bash' } as LeaderViewPart, 'a1', 3), 'tool:a1:3')
  })
})
