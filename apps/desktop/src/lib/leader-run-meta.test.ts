import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  extractPrecedingUserMeta,
  formatClockTime,
  parseMessageTimestamp,
  resolveLeaderRunMeta,
  shortModelId,
} from './leader-run-meta.js'

describe('leader-run-meta', () => {
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

  it('formatClockTime uses CST (Asia/Shanghai) and i18n label', () => {
    // 2026-07-16 08:30:05 UTC → 16:30:05 CST
    const s = formatClockTime(Date.UTC(2026, 6, 16, 8, 30, 5), 'zh', {
      timeZoneLabel: 'CST',
    })
    assert.match(s, /2026/)
    assert.match(s, /CST/)
    assert.match(s, /16:30:05/)
  })

  it('formatClockTime en locale still labels CST', () => {
    const s = formatClockTime(Date.UTC(2026, 6, 16, 8, 30, 5), 'en', {
      timeZoneLabel: 'CST',
    })
    assert.match(s, /CST/)
  })
})
