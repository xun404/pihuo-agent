import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { LeaderViewPart } from '../lib/leader-chat-view.js'
import { I18nProvider } from '../i18n/I18nProvider.js'
import { formatMessage } from '../i18n/locales.js'
import {
  latestTaskListSignalIndex,
  MessageItem,
  RANGE_BOUNDARY_END_TO_END,
  RANGE_BOUNDARY_START_TO_START,
  selectionCoversFullRange,
  type MessageItemProps,
} from './MessageItem.js'

;(globalThis as typeof globalThis & { React: typeof React }).React = React

const STRINGS: Partial<Record<string, string>> = {
  'chat.thinking': '思考',
  'chat.thinkingLive': '思考中',
  'chat.thinkingDone': '已思考',
  'chat.thinkingDoneFor': '已思考 {time}',
  'chat.worked.done': '已处理',
  'chat.worked.for': '已处理 {time}',
  'chat.activity.command': 'Command',
  'chat.activity.thinking': '思考中',
  'chat.runPlaceholder': '运行中',
  'chat.toolError': '工具错误',
  'chat.runTzCst': 'CST',
  'chat.think.high': '高',
  'chat.think.medium': '中',
  'chat.errorCopy': '复制',
  'chat.errorCopied': '已复制',
  'chat.discussionYou': '你',
  'chat.discussionLeader': 'Leader',
  'chat.quote': '引用',
  'chat.activityThought': '已思考',
  'chat.activityThoughtLive': '思考中',
  'chat.activityTool': '调用了 {name}',
  'chat.activityTools': '{count} 个工具',
  'chat.activityDispatched': '派给 {name}',
}

const t: MessageItemProps['t'] = (key, vars) => formatMessage(STRINGS[key] ?? key, vars)

function renderLeader(options: {
  live: boolean
  parts: LeaderViewPart[]
  discussionMode?: boolean
}): string {
  const messages = [
    {
      id: 'u1',
      role: 'user',
      metadata: { createdAt: '2026-07-30T02:08:17.000Z' },
      parts: [
        {
          type: 'text',
          text: 'hello\n\n[context] model=opencode-go/deepseek-v4-flash thinking=high',
        },
      ],
    },
    { id: 'a1', role: 'assistant', parts: options.parts },
  ] as never
  const turnTiming = new Map([
    [
      'a1',
      {
        startedAt: Date.parse('2026-07-30T02:08:17.000Z'),
        ...(options.live ? {} : { endedAt: Date.parse('2026-07-30T02:09:30.000Z') }),
        model: 'opencode-go/deepseek-v4-flash',
        thinking: 'high',
      },
    ],
  ])

  return renderToStaticMarkup(
    <I18nProvider serverLocale="zh">
      <MessageItem
        message={messages[1]!}
        msgIdx={1}
        messages={messages}
        busy={options.live}
        lastAssistantId="a1"
        showErrorInThisBubble={false}
        t={t}
        locale="zh"
        models={[]}
        selectedModel="opencode-go/deepseek-v4-flash"
        thinkingIntensity="high"
        modelShort="deepseek-v4-flash"
        thinkShort="高"
        metaOpen={{}}
        setMetaOpen={() => undefined}
        isMetaOpen={(_key, autoOpen) => autoOpen}
        errorBlock={null}
        timingEpoch={0}
        turnTimingRef={{ current: turnTiming }}
        toolStartTimes={{ current: new Map() }}
        toolDurations={{ current: new Map() }}
        discussionMode={options.discussionMode}
      />
    </I18nProvider>,
  )
}

function renderUser(
  message: { id: string; role: string; parts?: unknown[] },
  messages: Array<{ id: string; role: string; parts?: unknown[] }>,
): string {
  return renderToStaticMarkup(
    <MessageItem
      message={message}
      msgIdx={messages.length - 1}
      messages={messages}
      busy={false}
      lastAssistantId={undefined}
      showErrorInThisBubble={false}
      t={t}
      locale="zh"
      models={[]}
      selectedModel=""
      thinkingIntensity="off"
      modelShort=""
      thinkShort=""
      metaOpen={{}}
      setMetaOpen={() => undefined}
      isMetaOpen={() => false}
      errorBlock={null}
      timingEpoch={0}
      turnTimingRef={{ current: new Map() }}
      toolStartTimes={{ current: new Map() }}
      toolDurations={{ current: new Map() }}
    />,
  )
}

function footer(markup: string): string {
  return markup.match(/<div class="msg-caption[^"]*">([\s\S]*?)<\/div>/)?.[1] ?? ''
}

describe('MessageItem Leader footer', () => {
  it('shows only model and current activity while the turn is running', () => {
    const markup = renderLeader({
      live: true,
      parts: [{ type: 'tool-bash', toolCallId: 'tool-1', state: 'input-streaming' } as never],
    })
    const value = footer(markup)
    assert.match(value, /deepseek-v4-flash/)
    assert.match(value, /lead-footer-provider/)
    assert.match(value, /opencode-go/)
    assert.match(value, /Command/)
    assert.match(value, /lead-footer-separator/)
    assert.doesNotMatch(value, /lucide-origami/u)
    assert.doesNotMatch(value, />高</)
    assert.doesNotMatch(value, /CST/)
  })

  it('shows model, thinking, duration and start time with separators after completion', () => {
    const markup = renderLeader({ live: false, parts: [{ type: 'text', text: 'done' }] })
    const value = footer(markup)
    assert.match(value, /deepseek-v4-flash/)
    assert.match(value, />高</)
    assert.match(value, /1分13秒/)
    assert.doesNotMatch(value, /CST/)
    assert.match(value, /2026/)
    assert.equal((value.match(/lead-footer-separator/g) ?? []).length, 3)
  })

  it('keeps durable timing when a stale client timing entry conflicts after reload', () => {
    const markup = renderLeader({
      live: false,
      parts: [
        { type: 'text', text: 'done' },
        {
          type: 'data-leader-run-meta',
          data: {
            startedAt: '2026-07-30T02:00:00.000Z',
            completedAt: '2026-07-30T02:02:00.000Z',
            model: 'opencode-go/deepseek-v4-flash',
            thinking: 'high',
          },
        } as never,
      ],
    })
    const value = footer(markup)
    assert.match(value, /2分/)
    assert.doesNotMatch(value, /1分13秒/)
  })
})

describe('MessageItem process quote', () => {
  it('puts completed process in an in-bubble quote and keeps the body text', () => {
    const markup = renderLeader({
      live: false,
      parts: [
        { type: 'reasoning', text: 'secret reasoning chain', state: 'done' } as never,
        {
          type: 'tool-bash',
          toolCallId: 't1',
          state: 'output-available',
          input: { command: 'pwd' },
          output: { stdout: '/tmp' },
        } as never,
        { type: 'text', text: '最终结果正文' },
      ],
    })
    assert.match(markup, /im-activity-quote/u)
    assert.match(markup, /已思考/u)
    assert.match(markup, /调用了 bash/u)
    assert.match(markup, /最终结果正文/u)
    assert.doesNotMatch(markup, /secret reasoning chain/u)
    assert.doesNotMatch(markup, /thinking-block is-open/u)
    assert.doesNotMatch(markup, /class="worked-for"/u)
  })

  it('does not show 已处理 on a completed text-only assistant turn', () => {
    const markup = renderLeader({
      live: false,
      parts: [{ type: 'text', text: '只有最终正文' }],
    })
    assert.doesNotMatch(markup, /class="worked-for"/u)
    assert.doesNotMatch(markup, /已处理 1m 13s/u)
    assert.match(markup, /只有最终正文/u)
  })

  it('keeps live reasoning behind a 思考中 quote instead of showing the chain', () => {
    const markup = renderLeader({
      live: true,
      parts: [
        { type: 'reasoning', text: 'live reasoning', state: 'streaming' } as never,
        { type: 'text', text: 'partial' },
      ],
    })
    assert.doesNotMatch(markup, /class="worked-for"/u)
    assert.match(markup, /思考中/u)
    assert.match(markup, /partial/u)
    assert.doesNotMatch(markup, /live reasoning/u)
  })

  it('keeps Leader text in one bubble and process as an in-bubble quote', () => {
    const markup = renderLeader({
      live: false,
      discussionMode: true,
      parts: [
        { type: 'text', text: '先确认任务边界。' },
        {
          type: 'tool-bash',
          toolCallId: 't1',
          state: 'output-available',
          input: { command: 'pwd' },
          output: { stdout: '/tmp' },
        } as never,
        { type: 'text', text: '接着等待 Worker 返回。' },
      ],
    })

    assert.equal((markup.match(/class="bubble"/g) ?? []).length, 1)
    assert.match(markup, /im-activity-quote/u)
    assert.match(markup, /调用了 bash|1 个工具/u)
    assert.match(markup, /先确认任务边界。/u)
    assert.match(markup, /接着等待 Worker 返回。/u)
    assert.doesNotMatch(markup, /chat-tool-worker-stack/u)
    assert.match(markup, /class="msg-row is-lead-start"/u)
    assert.doesNotMatch(markup, /discussion-leader-card/u)
    assert.doesNotMatch(markup, /class="sup-body"/u)
    assert.doesNotMatch(markup, /discussion-process-divider/u)
    assert.doesNotMatch(markup, /class="worked-for/u)
    assert.doesNotMatch(markup, /class="lead-footer"/u)
    assert.doesNotMatch(markup, /class="msg-caption"/u)
    assert.equal((markup.match(/class="msg-meta"/g) ?? []).length, 1)
  })

  it('shows dispatch as a quote without an @ chip and does not nest a Worker card', () => {
    const markup = renderLeader({
      live: false,
      discussionMode: true,
      parts: [
        {
          type: 'tool-dispatch-team-member',
          toolCallId: 'dispatch-1',
          state: 'output-available',
          input: { task: '实现群组讨论', teamMemberName: 'OpenCode' },
          output: { jobId: 'job-1' },
        } as never,
        { type: 'text', text: '已派 OpenCode 去打招呼。' },
      ],
    })

    assert.match(markup, /im-activity-quote/u)
    assert.match(markup, /派给 OpenCode/u)
    assert.doesNotMatch(markup, /@OpenCode/u)
    assert.doesNotMatch(markup, /tool-row/u)
    assert.match(markup, /class="msg leader"/u)
    assert.doesNotMatch(markup, /worker-run/u)
    assert.doesNotMatch(markup, /discussion-worker-flow-item/u)
  })

  it('does not render an empty Leader bubble when the fragment is only process', () => {
    const markup = renderLeader({
      live: false,
      discussionMode: true,
      parts: [
        {
          type: 'tool-dispatch-team-member',
          toolCallId: 'dispatch-1',
          state: 'output-available',
          input: { task: '打招呼', teamMemberName: 'OpenCode' },
          output: { jobId: 'job-1' },
        } as never,
      ],
    })
    assert.equal(markup, '')
    assert.doesNotMatch(markup, /class="bubble"/u)
    assert.doesNotMatch(markup, /im-activity-quote/u)
  })
})

describe('MessageItem task-list snapshots', () => {
  it('uses only the latest valid task snapshot in a Leader turn, including an empty one', () => {
    const parts = [
      {
        type: 'data-signal',
        data: {
          tagName: 'current-task-list',
          metadata: {
            value: {
              tasks: [{ id: 'task-1', content: '旧任务', status: 'in_progress' }],
            },
          },
        },
      },
      { type: 'data-signal', data: { tagName: 'other-signal' } },
      {
        type: 'data-signal',
        data: { tagName: 'task-list-update', metadata: { value: { tasks: [] } } },
      },
    ]

    assert.equal(latestTaskListSignalIndex(parts), 2)
  })

  it('ignores malformed task signals instead of replacing the current valid snapshot', () => {
    const parts = [
      {
        type: 'data-signal',
        data: {
          tagName: 'current-task-list',
          metadata: {
            value: {
              tasks: [{ id: 'task-1', content: '当前任务', status: 'in_progress' }],
            },
          },
        },
      },
      { type: 'data-signal', data: { tagName: 'task-list-update', metadata: { value: {} } } },
    ]

    assert.equal(latestTaskListSignalIndex(parts), 0)
  })
})

describe('MessageItem message actions', () => {
  it('renders @mentions as chips in the user bubble body', () => {
    const message = {
      id: 'u-mention',
      role: 'user',
      parts: [{ type: 'text', text: '请 @OpenCode 看一下登录页。' }],
    } as never
    const markup = renderToStaticMarkup(
      <MessageItem
        message={message}
        msgIdx={0}
        messages={[message]}
        busy={false}
        lastAssistantId={undefined}
        showErrorInThisBubble={false}
        t={t}
        locale="zh"
        models={[]}
        selectedModel=""
        thinkingIntensity="off"
        modelShort=""
        thinkShort=""
        metaOpen={{}}
        setMetaOpen={() => undefined}
        isMetaOpen={() => false}
        errorBlock={null}
        timingEpoch={0}
        turnTimingRef={{ current: new Map() }}
        toolStartTimes={{ current: new Map() }}
        toolDurations={{ current: new Map() }}
        mentionNames={['OpenCode']}
      />,
    )
    assert.match(markup, /class="im-mention"/u)
    assert.match(markup, /@OpenCode/u)
    assert.match(markup, /请 /u)
  })

  it('renders user bubble with send time and a hover copy button', () => {
    const message = {
      id: 'u2',
      role: 'user',
      parts: [{ type: 'text', text: 'hello **world**' }],
      metadata: { createdAt: '2026-08-07T04:00:00.000Z' },
    } as never
    const markup = renderUser(message, [message])

    assert.match(markup, /class="msg user"/u)
    assert.match(markup, /aria-label="你"/u)
    assert.match(markup, /class="bubble"[^>]*>hello \*\*world\*\*</u)
    assert.match(markup, /class="msg-meta"/u)
    assert.match(markup, /class="msg-user-time">[^<]*2026/u)
    assert.match(markup, /class="msg-copy"/u)
    assert.match(markup, /lucide-copy/u)
    assert.match(markup, /aria-label="复制"/u)
    assert.doesNotMatch(markup, /discussion-speaker-avatar/u)
    assert.doesNotMatch(markup, /discussion-message-name/u)
    assert.doesNotMatch(markup, /class="msg-row"/u)
  })

  it('hides the send time when the message has no timestamp but keeps the copy button', () => {
    const message = { id: 'u3', role: 'user', parts: [{ type: 'text', text: 'hi' }] } as never
    const markup = renderUser(message, [message])

    assert.match(markup, /class="msg-meta"/u)
    assert.doesNotMatch(markup, /class="msg-user-time"/u)
    assert.match(markup, /class="msg-copy"/u)
  })

  it('puts the leader copy button in msg-meta rather than the footer', () => {
    const markup = renderLeader({
      live: false,
      parts: [{ type: 'text', text: 'reply **bold**' }],
    })
    const value = footer(markup)
    assert.doesNotMatch(value, /class="msg-copy"/u)
    assert.doesNotMatch(value, /lead-footer-copy/u)
    assert.match(markup, /class="msg-bubble-row"[\s\S]*class="msg-meta"[\s\S]*class="msg-copy"/u)
    assert.match(markup, /class="msg-caption/u)
    assert.doesNotMatch(markup, /class="lead-footer"/u)
    assert.doesNotMatch(markup, /class="worked-for"/u)
    assert.match(markup, /lucide-copy/u)
    assert.match(markup, /<strong>bold<\/strong>/u)
    assert.match(markup, /class="bubble"/u)
    assert.doesNotMatch(markup, /class="sup-body"/u)
    assert.match(markup, /data-discussion-speaker="leader"/u)
  })
})

describe('MessageItem IM chrome', () => {
  it('wraps completed Leader text in a bubble and keeps process outside', () => {
    const markup = renderLeader({
      live: false,
      parts: [
        { type: 'reasoning', text: 'secret reasoning chain', state: 'done' } as never,
        { type: 'text', text: '最终结果正文' },
      ],
    })
    assert.doesNotMatch(markup, /class="worked-for"/u)
    assert.match(markup, /class="bubble"[^>]*>[\s\S]*最终结果正文/u)
    assert.doesNotMatch(markup, /class="bubble"[^>]*>[\s\S]*secret reasoning chain/u)
    assert.match(markup, /class="msg-row is-lead-start"/u)
  })

  it('keeps live thinking outside the text bubble', () => {
    const markup = renderLeader({
      live: true,
      parts: [
        { type: 'reasoning', text: 'live reasoning', state: 'streaming' } as never,
        { type: 'text', text: 'partial' },
      ],
    })
    assert.match(markup, /class="bubble"[^>]*>[\s\S]*partial/u)
    assert.doesNotMatch(markup, /class="bubble"[^>]*>[\s\S]*live reasoning/u)
  })

  it('marks consecutive same-role messages and never the first', () => {
    const first = { id: 'u-a', role: 'user', parts: [{ type: 'text', text: 'one' }] }
    const second = { id: 'u-b', role: 'user', parts: [{ type: 'text', text: 'two' }] }
    const firstMarkup = renderUser(first as never, [first] as never)
    const secondMarkup = renderUser(second as never, [first, second] as never)
    assert.doesNotMatch(firstMarkup, /is-consecutive/u)
    assert.match(secondMarkup, /class="msg user is-consecutive"/u)
  })

  it('does not mark a leader consecutive after a user message', () => {
    const markup = renderLeader({ live: false, parts: [{ type: 'text', text: 'reply' }] })
    assert.doesNotMatch(markup, /is-consecutive/u)
  })
})

describe('selectionCoversFullRange', () => {
  // compareBoundaryPoints returns: negative when the selection starts before
  // fullRange (START_TO_START), positive when it ends after (END_TO_END).
  function fakeRange(
    startCompare: number,
    endCompare: number,
  ): Pick<Range, 'compareBoundaryPoints'> {
    return {
      compareBoundaryPoints(how: number): number {
        if (how === RANGE_BOUNDARY_START_TO_START) return startCompare
        return endCompare
      },
    } as unknown as Pick<Range, 'compareBoundaryPoints'>
  }

  it('returns true when the selection spans the full range on both ends', () => {
    assert.equal(selectionCoversFullRange(fakeRange(0, 0), fakeRange(0, 0)), true)
  })

  it('returns true when the selection extends beyond the full range', () => {
    assert.equal(selectionCoversFullRange(fakeRange(-1, 1), fakeRange(0, 0)), true)
  })

  it('returns false when the selection starts after the full range', () => {
    assert.equal(selectionCoversFullRange(fakeRange(1, 1), fakeRange(0, 0)), false)
  })

  it('returns false when the selection ends before the full range', () => {
    assert.equal(selectionCoversFullRange(fakeRange(0, -1), fakeRange(0, 0)), false)
  })

  it('returns false when both boundaries fall inside the full range', () => {
    assert.equal(selectionCoversFullRange(fakeRange(1, -1), fakeRange(0, 0)), false)
  })
})
