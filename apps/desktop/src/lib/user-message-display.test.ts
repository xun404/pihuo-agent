import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  displayUserMessageText,
  enrichLastUserMessageForWire,
  enrichUserMessageForLeader,
  parseRouterUserMessage,
} from './user-message-display.js'

const sample = `Respond in Chinese. [mode=build] Prefer role=coder then role=test/review as needed. hey

[context] project=router-agents path=/Users/xun/workspace/github/router-agents session=新任务 locale=zh mode=build model=opencode-go/deepseek-v4-flash thinking=max`

describe('user-message-display', () => {
  it('strips chrome and keeps user text', () => {
    assert.equal(displayUserMessageText(sample), 'hey')
  })

  it('parses meta from context block', () => {
    const { text, meta } = parseRouterUserMessage(sample)
    assert.equal(text, 'hey')
    assert.equal(meta.mode, 'build')
    assert.equal(meta.project, 'router-agents')
    assert.equal(meta.model, 'opencode-go/deepseek-v4-flash')
    assert.equal(meta.thinking, 'max')
  })

  it('round-trips enrich → display', () => {
    const wire = enrichUserMessageForLeader('修一下登录', {
      locale: 'zh',
      mode: 'build',
      projectName: 'app',
      projectPath: '/tmp/app',
      sessionTitle: '任务',
      model: 'openai/gpt-5.5',
      thinking: 'medium',
    })
    assert.match(wire, /\[mode=build\]/)
    assert.match(wire, /\[context\]/)
    assert.equal(displayUserMessageText(wire), '修一下登录')
  })

  it('enriches last user message parts for wire without double-wrapping', () => {
    const msg = {
      role: 'user' as const,
      parts: [{ type: 'text' as const, text: 'hello' }],
    }
    const once = enrichLastUserMessageForWire(msg, {
      locale: 'en',
      mode: 'ask',
      thinking: 'off',
    })
    assert.ok(once?.parts?.[0]?.text?.includes('[mode=ask]'))
    assert.ok(once?.parts?.[0]?.text?.includes('hello'))

    const twice = enrichLastUserMessageForWire(once, {
      locale: 'en',
      mode: 'ask',
      thinking: 'off',
    })
    // still only one context block
    assert.equal((twice?.parts?.[0]?.text?.match(/\[context\]/g) ?? []).length, 1)
  })
})
