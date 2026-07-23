import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DEFAULT_PROMPT_SETTINGS,
  PROMPT_ROLE_ORDER,
  WORKER_ROLES,
  defaultPromptSettings,
  isValidPromptSettings,
  normalizePromptSettings,
  promptsMatchLocaleDefaults,
} from './index.js'

describe('prompt settings', () => {
  it('ships non-empty zh and en defaults for Leader and every Worker role', () => {
    for (const locale of ['zh', 'en'] as const) {
      const defaults = defaultPromptSettings(locale)
      assert.ok(defaults.leader.trim(), locale)
      assert.deepEqual(Object.keys(defaults.roles).sort(), [...WORKER_ROLES].sort())
      for (const role of WORKER_ROLES) {
        assert.ok(defaults.roles[role].trim(), `${locale}:${role}`)
      }
    }
    assert.deepEqual([...PROMPT_ROLE_ORDER].sort(), [...WORKER_ROLES].sort())
    assert.equal(DEFAULT_PROMPT_SETTINGS.leader, defaultPromptSettings('zh').leader)
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

  it('falls back missing fields using the requested locale defaults', () => {
    const en = normalizePromptSettings({ leader: 'Custom leader' }, 'en')
    assert.equal(en.leader, 'Custom leader')
    assert.equal(en.roles.coder, defaultPromptSettings('en').roles.coder)
    assert.notEqual(en.roles.coder, defaultPromptSettings('zh').roles.coder)
  })

  it('returns fresh objects rather than mutable references to built-in defaults', () => {
    const first = normalizePromptSettings(undefined)
    const second = normalizePromptSettings(undefined)

    first.leader = 'changed'
    first.roles.coder = 'changed'

    assert.equal(second.leader, DEFAULT_PROMPT_SETTINGS.leader)
    assert.equal(second.roles.coder, DEFAULT_PROMPT_SETTINGS.roles.coder)
  })

  it('detects locale-built-in defaults for reset UX', () => {
    assert.equal(promptsMatchLocaleDefaults(defaultPromptSettings('zh'), 'zh'), true)
    assert.equal(promptsMatchLocaleDefaults(defaultPromptSettings('en'), 'en'), true)
    assert.equal(promptsMatchLocaleDefaults(defaultPromptSettings('zh'), 'en'), false)
  })

  it('validates only complete non-empty prompt settings for explicit saves', () => {
    assert.equal(isValidPromptSettings(normalizePromptSettings(undefined)), true)
    assert.equal(isValidPromptSettings({ leader: '', roles: DEFAULT_PROMPT_SETTINGS.roles }), false)
    assert.equal(isValidPromptSettings({ leader: 'ok', roles: { general: 'only one' } }), false)
  })
})
