import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildModelId,
  defaultApiKeyEnv,
  shortModelName,
  slugProviderId,
} from './custom-provider-form.js'

describe('custom-provider-form helpers', () => {
  it('slugProviderId from display name', () => {
    assert.equal(slugProviderId('硅基流动 SiliconFlow'), 'siliconflow')
    assert.equal(slugProviderId('My Company!!'), 'my-company')
    assert.equal(slugProviderId('  '), 'custom')
  })

  it('slugProviderId maps OpenCode GO names/URLs to Mastra opencode-go', () => {
    assert.equal(slugProviderId('OpenCodeGO'), 'opencode-go')
    assert.equal(slugProviderId('OpenCode Go'), 'opencode-go')
    assert.equal(slugProviderId('My Gateway', 'https://opencode.ai/zen/go/v1'), 'opencode-go')
  })

  it('defaultApiKeyEnv is auto and never user-facing', () => {
    assert.equal(defaultApiKeyEnv('myco'), 'CUSTOM_MYCO_API_KEY')
    assert.equal(defaultApiKeyEnv('my-co'), 'CUSTOM_MY_CO_API_KEY')
  })

  it('defaultApiKeyEnv uses Mastra env for known models.dev provider ids', () => {
    assert.equal(defaultApiKeyEnv('opencode-go'), 'OPENCODE_API_KEY')
    assert.equal(defaultApiKeyEnv('opencode'), 'OPENCODE_API_KEY')
    assert.equal(defaultApiKeyEnv('openai'), 'OPENAI_API_KEY')
  })

  it('buildModelId accepts short or full model names', () => {
    assert.equal(buildModelId('myco', 'deepseek-chat'), 'myco/deepseek-chat')
    assert.equal(buildModelId('myco', 'myco/deepseek-chat'), 'myco/deepseek-chat')
  })

  it('shortModelName strips provider prefix', () => {
    assert.equal(shortModelName('myco/deepseek-chat', 'myco'), 'deepseek-chat')
    assert.equal(shortModelName('deepseek-chat', 'myco'), 'deepseek-chat')
  })
})
