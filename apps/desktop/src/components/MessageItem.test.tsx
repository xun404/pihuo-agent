import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { UIMessage } from '@ai-sdk/react'
import { formatMessage } from '../i18n/locales.js'
import { MessageItem, type MessageItemProps } from './MessageItem.js'

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
}

const t: MessageItemProps['t'] = (key, vars) => formatMessage(STRINGS[key] ?? key, vars)

function renderLeader(options: { live: boolean; parts: UIMessage['parts'] }): string {
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
  ] as UIMessage[]
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
    <MessageItem
      message={messages[1]!}
      msgIdx={1}
      messages={messages}
      busy={options.live}
      lastAssistantId="a1"
      isTailMessage
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
      tick={0}
      placementByJobId={new Map()}
      toolCallJobIds={new Map()}
      hasRunningWorker={false}
      resolving={{}}
      registryIdentityFor={() => undefined}
      isMetaOpen={() => false}
      errorBlock={null}
      timingEpoch={0}
      turnTimingRef={{ current: turnTiming }}
      toolStartTimes={{ current: new Map() }}
      toolDurations={{ current: new Map() }}
    />,
  )
}

function footer(markup: string): string {
  return markup.match(/<div class="lead-footer">([\s\S]*?)<\/div>/)?.[1] ?? ''
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

describe('MessageItem Worked-for collapse', () => {
  it('folds process trail under 已处理 and keeps final text outside when turn is done', () => {
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
    assert.match(markup, /class="worked-for"/u)
    assert.match(markup, /已处理 1m 13s/u)
    assert.match(markup, /最终结果正文/u)
    // Default collapsed: process body unmounted
    assert.doesNotMatch(markup, /secret reasoning chain/u)
    assert.doesNotMatch(markup, /worked-for is-open/u)
  })

  it('keeps process rows visible in document order while the turn is live', () => {
    const markup = renderLeader({
      live: true,
      parts: [
        { type: 'reasoning', text: 'live reasoning', state: 'streaming' } as never,
        { type: 'text', text: 'partial' },
      ],
    })
    assert.doesNotMatch(markup, /class="worked-for"/u)
    assert.match(markup, /live reasoning/u)
    assert.match(markup, /partial/u)
  })
})
