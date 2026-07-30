import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { UIMessage } from '@ai-sdk/react'
import { MessageItem, type MessageItemProps } from './MessageItem.js'

;(globalThis as typeof globalThis & { React: typeof React }).React = React

const t: MessageItemProps['t'] = (key) =>
  ({
    'chat.thinking': '思考',
    'chat.thinkingLive': '思考中',
    'chat.runPlaceholder': '运行中',
    'chat.toolError': '工具错误',
    'chat.runTzCst': 'CST',
    'chat.think.high': '高',
    'chat.think.medium': '中',
  })[key] ?? key

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
    assert.match(value, /lucide-origami/u)
    assert.match(value, /Command/)
    assert.match(value, /lead-footer-separator/)
    assert.doesNotMatch(value, />高</)
    assert.doesNotMatch(value, /CST/)
  })

  it('shows model, thinking, duration and start time with separators after completion', () => {
    const markup = renderLeader({ live: false, parts: [{ type: 'text', text: 'done' }] })
    const value = footer(markup)
    assert.match(value, /deepseek-v4-flash/)
    assert.match(value, />高</)
    assert.match(value, /1分13秒/)
    assert.match(value, /CST/)
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
