import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  applyLeaderChatEvent,
  mergeLeaderSnapshot,
  toLeaderViewMessages,
} from './leader-chat-view.js'
import type { LeaderChatMessage } from '@pihuo-agent/shared'

describe('leader chat view', () => {
  it('dedupes identical consecutive user messages', () => {
    const messages: LeaderChatMessage[] = [
      { id: 'a', role: 'user', timestamp: 1, content: 'hello' },
      { id: 'b', role: 'user', timestamp: 2, content: 'hello' },
      { id: 'c', role: 'assistant', timestamp: 3, content: [{ type: 'text', text: 'hi' }] },
    ]
    const views = toLeaderViewMessages(messages)
    assert.equal(views.filter((item) => item.role === 'user').length, 1)
    assert.equal(views.filter((item) => item.role === 'assistant').length, 1)
  })

  it('replaces the live assistant instead of appending empties', () => {
    let messages: LeaderChatMessage[] = []
    messages = applyLeaderChatEvent(messages, {
      type: 'message_start',
      message: { id: 'assistant-live', role: 'assistant', timestamp: 1, content: [] },
    })
    messages = applyLeaderChatEvent(messages, {
      type: 'message_update',
      message: {
        id: 'assistant-live',
        role: 'assistant',
        timestamp: 2,
        content: [{ type: 'text', text: 'hello' }],
      },
    })
    assert.equal(messages.length, 1)
    assert.equal(toLeaderViewMessages(messages).length, 1)
  })

  it('keeps a second turn instead of overwriting the first assistant', () => {
    let messages: LeaderChatMessage[] = [
      { id: 'u1', role: 'user', timestamp: 1, content: 'hey' },
      { id: 'a1', role: 'assistant', timestamp: 2, content: [{ type: 'text', text: 'hi' }] },
      { id: 'u2', role: 'user', timestamp: 3, content: '写象棋脚本' },
    ]
    messages = applyLeaderChatEvent(messages, {
      type: 'message_update',
      message: {
        id: 'a2',
        role: 'assistant',
        timestamp: 4,
        content: [{ type: 'text', text: 'Team 为空' }],
      },
    })
    const views = toLeaderViewMessages(messages)
    assert.equal(views.map((item) => item.role).join(','), 'user,assistant,user,assistant')
    assert.match(views[1]!.parts.map((part) => ('text' in part ? part.text : '')).join(''), /hi/u)
    assert.match(
      views[3]!.parts.map((part) => ('text' in part ? part.text : '')).join(''),
      /Team 为空/u,
    )
  })

  it('attaches parsed JSON from Leader text-block tool results', () => {
    const views = toLeaderViewMessages([
      { id: 'u1', role: 'user', timestamp: 1, content: 'hey' },
      {
        id: 'a1',
        role: 'assistant',
        timestamp: 2,
        content: [{ type: 'toolCall', id: 't1', name: 'list-team', arguments: {} }],
      },
      {
        id: 't1',
        role: 'toolResult',
        timestamp: 3,
        content: [{ type: 'text', text: '{"teamRevision":1,"teamMembers":[]}' }],
      },
    ])
    const tool = views[1]!.parts.find((part) => part.type === 'tool-list-team') as {
      state?: string
      output?: { teamRevision?: number }
    }
    assert.equal(tool?.state, 'output-available')
    assert.equal(tool?.output?.teamRevision, 1)
  })

  it('folds one turn of assistant + tool rows into a single bubble', () => {
    const views = toLeaderViewMessages([
      { id: 'u1', role: 'user', timestamp: 1, content: 'hey' },
      {
        id: 'a1',
        role: 'assistant',
        timestamp: 2,
        content: [{ type: 'toolCall', id: 't1', name: 'set-session-title', arguments: {} }],
      },
      { id: 't1', role: 'toolResult', timestamp: 3, content: '{"ok":true}' },
      { id: 'a2', role: 'assistant', timestamp: 4, content: [{ type: 'text', text: '你好' }] },
    ])
    assert.equal(views.length, 2)
    assert.equal(views[1]!.role, 'assistant')
    assert.equal(
      views[1]!.parts.some((part) => part.type === 'text' && part.text === '你好'),
      true,
    )
    assert.equal(
      views[1]!.parts.some(
        (part) => part.type === 'tool-set-session-title' && part.state === 'output-available',
      ),
      true,
    )
  })

  it('marks persisted task-list snapshots with the TaskListCard signal tag', () => {
    const views = toLeaderViewMessages([
      {
        id: 'a1',
        role: 'assistant',
        timestamp: 1,
        content: [{ type: 'text', text: '正在拆解任务' }],
      },
      {
        id: 'tasks-1',
        role: 'custom',
        timestamp: 2,
        custom: {
          kind: 'task-list',
          data: [{ id: 'task-1', content: '实现群组讨论', status: 'in_progress' }],
        },
      },
    ])
    const signal = views[0]!.parts.find((part) => part.type === 'data-signal')
    assert.equal(signal?.type, 'data-signal')
    if (signal?.type !== 'data-signal') return
    assert.equal(signal.data.tagName, 'current-task-list')
  })

  it('does not replay snapshot users already shown as optimistic bubbles', () => {
    const existing: LeaderChatMessage[] = [
      { id: 'delivery-1', role: 'user', timestamp: 1, content: 'hey' },
      {
        id: 'assistant-live',
        role: 'assistant',
        timestamp: 2,
        content: [{ type: 'text', text: '你好' }],
      },
      { id: 'delivery-2', role: 'user', timestamp: 3, content: '写象棋脚本' },
    ]
    const snapshot: LeaderChatMessage[] = [
      { id: 'msg-0', role: 'user', timestamp: 1, content: [{ type: 'text', text: 'hey' }] },
      { id: 'msg-1', role: 'assistant', timestamp: 2, content: [{ type: 'text', text: '你好' }] },
      { id: 'msg-4', role: 'user', timestamp: 3, content: [{ type: 'text', text: '写象棋脚本' }] },
    ]
    const merged = mergeLeaderSnapshot(existing, snapshot)
    const views = toLeaderViewMessages(merged)
    assert.deepEqual(
      views.map((item) => [
        item.role,
        item.parts
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .join(''),
      ]),
      [
        ['user', 'hey'],
        ['assistant', '你好'],
        ['user', '写象棋脚本'],
      ],
    )
  })

  it('replaces a snapshot of the current turn with the live assistant while streaming', () => {
    const existing: LeaderChatMessage[] = [
      { id: 'msg-0', role: 'user', timestamp: 1, content: 'hey' },
      {
        id: 'assistant-live',
        role: 'assistant',
        timestamp: 2,
        content: [{ type: 'text', text: '你好，正在想' }],
      },
    ]
    const snapshot: LeaderChatMessage[] = [
      { id: 'msg-0', role: 'user', timestamp: 1, content: [{ type: 'text', text: 'hey' }] },
    ]
    const merged = applyLeaderChatEvent(existing, { type: 'snapshot', messages: snapshot })
    const views = toLeaderViewMessages(merged)
    assert.equal(views.length, 2)
    assert.match(
      views[1]!.parts.map((part) => ('text' in part ? part.text : '')).join(''),
      /你好，正在想/u,
    )
  })
})
