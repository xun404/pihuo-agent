import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  extractPrecedingUserMeta,
  formatClockTime,
  parseMessageTimestamp,
  resolveLeaderRunMeta,
  shortModelId,
} from './leader-run-meta.js'
import * as leaderRunMetaModule from './leader-run-meta.js'

describe('leader-run-meta', () => {
  it('findCurrentTurnAssistant never reuses the previous turn before a new reply exists', () => {
    const findCurrentTurnAssistant = (
      leaderRunMetaModule as typeof leaderRunMetaModule & {
        findCurrentTurnAssistant?: <T extends { role: string }>(messages: T[]) => T | undefined
      }
    ).findCurrentTurnAssistant
    assert.equal(typeof findCurrentTurnAssistant, 'function')

    const previous = { id: 'assistant-old', role: 'assistant' }
    const currentUser = { id: 'user-new', role: 'user' }
    assert.equal(findCurrentTurnAssistant!([previous, currentUser]), undefined)

    const current = { id: 'assistant-new', role: 'assistant' }
    assert.equal(findCurrentTurnAssistant!([previous, currentUser, current]), current)
  })

  it('shortModelId strips provider prefix', () => {
    assert.equal(shortModelId('opencode-go/deepseek-v4-flash'), 'deepseek-v4-flash')
    assert.equal(shortModelId('gpt-4o'), 'gpt-4o')
  })

  it('extractPrecedingUserMeta reads model/thinking from prior user context', () => {
    const messages = [
      {
        role: 'user',
        parts: [
          {
            type: 'text',
            text: 'Respond in Chinese. [mode=build] hello\n\n[context] project=p path=/x session=s locale=zh mode=build model=opencode-go/deepseek-v4-flash thinking=max',
          },
        ],
      },
      { role: 'assistant', parts: [{ type: 'text', text: 'ok' }] },
    ]
    const meta = extractPrecedingUserMeta(messages, 1)
    assert.equal(meta.model, 'opencode-go/deepseek-v4-flash')
    assert.equal(meta.thinking, 'max')
  })

  it('parseMessageTimestamp accepts ISO and epoch', () => {
    const iso = parseMessageTimestamp({ createdAt: '2026-07-16T08:30:00.000Z' })
    assert.ok(iso && iso > 0)
    const ms = parseMessageTimestamp({ createdAt: 1_700_000_000_000 })
    assert.equal(ms, 1_700_000_000_000)
  })

  it('resolveLeaderRunMeta uses client timings when live', () => {
    const messages = [
      {
        id: 'u1',
        role: 'user',
        parts: [
          {
            type: 'text',
            text: 'hi\n\n[context] locale=zh mode=build model=a/b thinking=high',
          },
        ],
      },
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'ans' }] },
    ]
    const map = new Map([['a1', { startedAt: 1_000, endedAt: undefined as number | undefined }]])
    const meta = resolveLeaderRunMeta(messages, 1, map, { live: true, now: 4_500 })
    assert.equal(meta.model, 'a/b')
    assert.equal(meta.thinking, 'high')
    assert.equal(meta.startedAt, 1_000)
    assert.equal(meta.endedAt, 4_500)
  })

  it('resolveLeaderRunMeta prefers client model when user text has no wire context', () => {
    const messages = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hello' }] },
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'ans' }] },
    ]
    const map = new Map([
      [
        'a1',
        {
          startedAt: 1_000,
          endedAt: 2_000,
          model: 'opencode-go/deepseek-v4-flash',
          thinking: 'max',
        },
      ],
    ])
    const meta = resolveLeaderRunMeta(messages, 1, map, { live: false, now: 3_000 })
    assert.equal(meta.model, 'opencode-go/deepseek-v4-flash')
    assert.equal(meta.thinking, 'max')
  })

  it('resolveLeaderRunMeta uses fallbackModel when nothing else available', () => {
    const messages = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hello' }] },
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'ans' }] },
    ]
    const meta = resolveLeaderRunMeta(messages, 1, new Map(), {
      live: false,
      now: 3_000,
      fallbackModel: 'x/y',
      fallbackThinking: 'medium',
    })
    assert.equal(meta.model, 'x/y')
    assert.equal(meta.thinking, 'medium')
  })

  it('resolveLeaderRunMeta restores durable run metadata after history reload', () => {
    const messages = [
      {
        id: 'u1',
        role: 'user',
        metadata: { createdAt: '2026-07-30T02:08:17.000Z' },
        parts: [{ type: 'text', text: 'hello' }],
      },
      {
        id: 'a1',
        role: 'assistant',
        metadata: {
          createdAt: '2026-07-30T02:08:21.000Z',
          provider: 'opencode-go',
          modelId: 'deepseek-v4-flash',
        },
        parts: [
          { type: 'text', text: 'done' },
          {
            type: 'data-leader-run-meta',
            data: {
              startedAt: '2026-07-30T02:08:17.000Z',
              completedAt: '2026-07-30T02:09:30.000Z',
              model: 'opencode-go/deepseek-v4-flash',
              thinking: 'max',
            },
          },
        ],
      },
    ]

    const meta = resolveLeaderRunMeta(messages, 1, new Map(), { live: false, now: 0 })
    assert.equal(meta.model, 'opencode-go/deepseek-v4-flash')
    assert.equal(meta.thinking, 'max')
    assert.equal(meta.startedAt, Date.parse('2026-07-30T02:08:17.000Z'))
    assert.equal(meta.endedAt, Date.parse('2026-07-30T02:09:30.000Z'))
  })

  it('uses the persisted assistant timestamp as legacy completion time, including the last turn', () => {
    const messages = [
      {
        id: 'u1',
        role: 'user',
        metadata: { createdAt: '2026-07-29T13:07:04.392Z' },
        parts: [{ type: 'text', text: 'run it' }],
      },
      {
        id: 'a1',
        role: 'assistant',
        metadata: { createdAt: '2026-07-29T13:07:07.560Z' },
        parts: [{ type: 'text', text: 'done' }],
      },
      {
        id: 'u2',
        role: 'user',
        metadata: { createdAt: '2026-07-29T13:20:00.000Z' },
        parts: [{ type: 'text', text: 'next task' }],
      },
    ]

    const withFollowingTurn = resolveLeaderRunMeta(messages, 1, new Map(), {
      live: false,
      now: 0,
    })
    assert.equal(withFollowingTurn.startedAt, Date.parse('2026-07-29T13:07:04.392Z'))
    assert.equal(withFollowingTurn.endedAt, Date.parse('2026-07-29T13:07:07.560Z'))

    const asLastTurn = resolveLeaderRunMeta(messages.slice(0, 2), 1, new Map(), {
      live: false,
      now: 0,
    })
    assert.equal(asLastTurn.endedAt, Date.parse('2026-07-29T13:07:07.560Z'))
  })

  it('resolveLeaderActivity maps tools to activity keys and falls back to thinking', () => {
    const {
      resolveLeaderActivity,
      mapToolNameToLeaderActivity,
      normalizeLeaderToolName,
    } = leaderRunMetaModule as typeof leaderRunMetaModule & {
      resolveLeaderActivity: (parts: Array<Record<string, unknown>>) => string
      mapToolNameToLeaderActivity: (name: string) => string
      normalizeLeaderToolName: (name: string) => string
    }

    assert.equal(normalizeLeaderToolName('tool-dispatchTeamMemberTool'), 'dispatch-team-member')
    assert.equal(mapToolNameToLeaderActivity('dispatch-team-member'), 'chat.activity.delegating')
    assert.equal(mapToolNameToLeaderActivity('task_write'), 'chat.activity.updatingTodos')
    assert.equal(mapToolNameToLeaderActivity('bash'), 'chat.activity.command')
    assert.equal(mapToolNameToLeaderActivity('grep'), 'chat.activity.searching')
    assert.equal(mapToolNameToLeaderActivity('list-workers'), 'chat.activity.listingWorkers')
    assert.equal(mapToolNameToLeaderActivity('unknown-xyz'), 'chat.activity.thinking')

    assert.equal(
      resolveLeaderActivity([{ type: 'tool-bash', state: 'input-streaming' }]),
      'chat.activity.command',
    )
    assert.equal(
      resolveLeaderActivity([{ type: 'tool-task_write', state: 'input-streaming' }]),
      'chat.activity.updatingTodos',
    )
    assert.equal(
      resolveLeaderActivity([
        { type: 'tool-dispatch-team-member', state: 'input-streaming', toolName: 'dispatch-team-member' },
      ]),
      'chat.activity.delegating',
    )
    assert.equal(
      resolveLeaderActivity([{ type: 'reasoning', state: 'streaming', text: 'working' }]),
      'chat.activity.thinking',
    )
    assert.equal(
      resolveLeaderActivity([{ type: 'text', state: 'streaming', text: 'Hello' }]),
      'chat.activity.composing',
    )
    assert.equal(resolveLeaderActivity([{ type: 'text', text: '' }]), 'chat.activity.thinking')
    // Newest active part wins: text after a finished tool → composing
    assert.equal(
      resolveLeaderActivity([
        { type: 'tool-bash', state: 'output-available', output: 'ok' },
        { type: 'text', state: 'streaming', text: 'done' },
      ]),
      'chat.activity.composing',
    )
  })

  it('formatClockTime uses system local zone without a CST suffix', () => {
    const s = formatClockTime(Date.UTC(2026, 6, 16, 8, 30, 5), 'zh')
    assert.match(s, /2026/)
    assert.doesNotMatch(s, /CST/)
  })

  it('formatClockTime can pin an explicit IANA zone without a label', () => {
    const s = formatClockTime(Date.UTC(2026, 6, 16, 8, 30, 5), 'zh', {
      timeZone: 'Asia/Shanghai',
    })
    assert.match(s, /16:30:05/)
    assert.doesNotMatch(s, /CST/)
  })
})
