import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_THINKING_INTENSITY,
  isThinkingIntensity,
  normalizeThinkingIntensity,
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
})
