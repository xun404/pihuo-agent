import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DEFAULT_PROMPT_SETTINGS,
  PROMPT_ROLE_ORDER,
  WORKER_ROLES,
  normalizePromptSettings,
} from './index.js'

describe('prompt settings', () => {
  it('ships a non-empty default for Leader and every Worker role', () => {
    assert.ok(DEFAULT_PROMPT_SETTINGS.leader.trim())
    assert.deepEqual([...PROMPT_ROLE_ORDER].sort(), [...WORKER_ROLES].sort())
    assert.deepEqual(Object.keys(DEFAULT_PROMPT_SETTINGS.roles).sort(), [...WORKER_ROLES].sort())
    for (const role of WORKER_ROLES) {
      assert.ok(DEFAULT_PROMPT_SETTINGS.roles[role].trim(), role)
    }
  })

  it('normalizes valid fields and falls back invalid fields independently', () => {
    const prompts = normalizePromptSettings({
      leader: '  自定义 Leader  ',
      roles: {
        coder: '  自定义编码  ',
        review: '   ',
      },
    })

    assert.equal(prompts.leader, '自定义 Leader')
    assert.equal(prompts.roles.coder, '自定义编码')
    assert.equal(prompts.roles.review, DEFAULT_PROMPT_SETTINGS.roles.review)
    assert.equal(prompts.roles.general, DEFAULT_PROMPT_SETTINGS.roles.general)
  })

  it('returns fresh objects rather than mutable references to built-in defaults', () => {
    const first = normalizePromptSettings(undefined)
    const second = normalizePromptSettings(undefined)

    first.leader = 'changed'
    first.roles.coder = 'changed'

    assert.equal(second.leader, DEFAULT_PROMPT_SETTINGS.leader)
    assert.equal(second.roles.coder, DEFAULT_PROMPT_SETTINGS.roles.coder)
  })
})
