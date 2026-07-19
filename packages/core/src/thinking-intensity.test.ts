import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  BUILTIN_THINKING_PRESETS,
  DEFAULT_CUSTOM_THINKING_SUPPORT,
  DEFAULT_THINKING_INTENSITY,
  clampThinkingIntensity,
  isThinkingIntensity,
  normalizeThinkingIntensity,
  normalizeThinkingIntensityList,
  resolveSupportedThinkingIntensities,
  thinkingIntensityToProviderOptions,
} from './thinking-intensity.js'

describe('thinking-intensity', () => {
  it('normalizes unknown values to default medium', () => {
    assert.equal(normalizeThinkingIntensity(undefined), DEFAULT_THINKING_INTENSITY)
    assert.equal(normalizeThinkingIntensity('nope'), 'medium')
    assert.equal(normalizeThinkingIntensity('high'), 'high')
    assert.equal(isThinkingIntensity('low'), true)
    assert.equal(isThinkingIntensity('turbo'), false)
  })

  it('maps intensity to openai reasoningEffort and anthropic budgets', () => {
    const off = thinkingIntensityToProviderOptions('off')
    assert.equal(off.openai?.reasoningEffort, 'none')
    assert.deepEqual(off.anthropic?.thinking, { type: 'disabled' })
    assert.equal((off.google?.thinkingConfig as { thinkingBudget: number }).thinkingBudget, 0)

    const high = thinkingIntensityToProviderOptions('high')
    assert.equal(high.openai?.reasoningEffort, 'high')
    assert.equal(high['opencode-go']?.reasoningEffort, 'high')
    const anth = high.anthropic?.thinking as { type: string; budgetTokens: number }
    assert.equal(anth.type, 'enabled')
    assert.equal(anth.budgetTokens, 16_000)

    const max = thinkingIntensityToProviderOptions('max')
    assert.equal(max.openai?.reasoningEffort, 'xhigh')
  })

  it('normalizes supported intensity lists for custom gateways', () => {
    assert.deepEqual(normalizeThinkingIntensityList(['max', 'off', 'max', 'nope']), ['off', 'max'])
    assert.deepEqual(normalizeThinkingIntensityList([]), ['off'])
    assert.deepEqual(normalizeThinkingIntensityList(null), ['off'])
  })

  it('clamps preferred intensity into supported set', () => {
    assert.equal(clampThinkingIntensity('high', ['off', 'medium']), 'medium')
    assert.equal(clampThinkingIntensity('high', ['off', 'high']), 'high')
    assert.equal(clampThinkingIntensity('high', ['off']), 'off')
  })

  it('resolves builtins to full preset and custom to declared list', () => {
    assert.deepEqual(resolveSupportedThinkingIntensities({ custom: false }), [
      ...BUILTIN_THINKING_PRESETS,
    ])
    assert.deepEqual(
      resolveSupportedThinkingIntensities({ custom: true, thinkingIntensities: undefined }),
      [...DEFAULT_CUSTOM_THINKING_SUPPORT],
    )
    assert.deepEqual(
      resolveSupportedThinkingIntensities({
        custom: true,
        thinkingIntensities: ['high', 'off'],
      }),
      ['off', 'high'],
    )
  })
})
