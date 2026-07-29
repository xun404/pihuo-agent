import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { extractReasoningSelector } from './acp-reasoning-options.js'
import type { SessionConfigOption } from '@agentclientprotocol/sdk'

describe('extractReasoningSelector', () => {
  it('returns undefined for empty/null configOptions', () => {
    assert.equal(extractReasoningSelector(null), undefined)
    assert.equal(extractReasoningSelector(undefined), undefined)
    assert.equal(extractReasoningSelector([]), undefined)
  })

  it('selects thought_level category first', () => {
    const opts: SessionConfigOption[] = [
      {
        id: 'reasoning_effort',
        name: 'Reasoning',
        type: 'select',
        currentValue: 'low',
        options: [
          { value: 'low', name: 'Low' },
          { value: 'high', name: 'High' },
        ],
      },
      {
        id: 'effort',
        name: 'Effort',
        category: 'thought_level',
        type: 'select',
        currentValue: 'high',
        options: [
          { value: 'low', name: 'Low' },
          { value: 'high', name: 'High' },
        ],
      },
    ]
    const r = extractReasoningSelector(opts)
    assert.ok(r)
    assert.equal(r.configId, 'effort')
  })

  it('falls back to known reasoning IDs without category', () => {
    const opts: SessionConfigOption[] = [
      {
        id: 'reasoning_effort',
        name: 'Reasoning Effort',
        type: 'select',
        currentValue: 'medium',
        options: [
          { value: 'low', name: 'Low' },
          { value: 'medium', name: 'Medium' },
        ],
      },
    ]
    const r = extractReasoningSelector(opts)
    assert.ok(r)
    assert.equal(r.configId, 'reasoning_effort')
  })

  it('uses first candidate by array order', () => {
    const opts: SessionConfigOption[] = [
      {
        id: 'reasoning_effort',
        name: 'First',
        category: 'thought_level',
        type: 'select',
        currentValue: 'low',
        options: [{ value: 'low', name: 'Low' }],
      },
      {
        id: 'effort',
        name: 'Second',
        category: 'thought_level',
        type: 'select',
        currentValue: 'high',
        options: [{ value: 'high', name: 'High' }],
      },
    ]
    const r = extractReasoningSelector(opts)
    assert.ok(r)
    assert.equal(r.configId, 'reasoning_effort')
  })

  it('supports grouped select options', () => {
    const opts: SessionConfigOption[] = [
      {
        id: 'effort',
        name: 'Effort',
        category: 'thought_level',
        type: 'select',
        currentValue: 'medium',
        options: [
          {
            group: 'basic',
            name: 'Basic',
            options: [
              { value: 'low', name: 'Low' },
              { value: 'medium', name: 'Medium' },
            ],
          },
          {
            group: 'advanced',
            name: 'Advanced',
            options: [{ value: 'high', name: 'High', description: 'Best quality' }],
          },
        ],
      },
    ]
    const r = extractReasoningSelector(opts)
    assert.ok(r)
    assert.equal(r.options.length, 3)
    assert.equal(r.configId, 'effort')
    assert.equal(r.currentValue, 'medium')
    assert.equal(r.options[2]?.value, 'high')
    assert.equal(r.options[2]?.description, 'Best quality')
  })

  it('preserves currentValue when set', () => {
    const opts: SessionConfigOption[] = [
      {
        id: 'effort',
        name: 'Effort',
        category: 'thought_level',
        type: 'select',
        currentValue: 'high',
        options: [
          { value: 'low', name: 'Low' },
          { value: 'high', name: 'High' },
        ],
      },
    ]
    const r = extractReasoningSelector(opts)
    assert.ok(r)
    assert.equal(r.currentValue, 'high')
  })

  it('preserves description when present', () => {
    const opts: SessionConfigOption[] = [
      {
        id: 'reasoning_effort',
        name: 'Reasoning',
        category: 'thought_level',
        type: 'select',
        currentValue: 'low',
        options: [{ value: 'low', name: 'Low', description: 'Minimum reasoning' }],
      },
    ]
    const r = extractReasoningSelector(opts)
    assert.ok(r)
    assert.equal(r.options[0]?.description, 'Minimum reasoning')
  })

  it('excludes boolean type options', () => {
    const opts: SessionConfigOption[] = [
      {
        id: 'thinking',
        name: 'Thinking',
        category: 'thought_level',
        type: 'boolean',
        currentValue: true,
      },
    ]
    const r = extractReasoningSelector(opts)
    assert.equal(r, undefined)
  })

  it('excludes options with no valid values', () => {
    const opts: SessionConfigOption[] = [
      {
        id: 'reasoning_effort',
        name: 'Reasoning',
        category: 'thought_level',
        type: 'select',
        currentValue: '',
        options: [],
      },
    ]
    const r = extractReasoningSelector(opts)
    assert.equal(r, undefined)
  })

  it('excludes plain model_config options', () => {
    const opts: SessionConfigOption[] = [
      {
        id: 'model',
        name: 'Model',
        category: 'model',
        type: 'select',
        currentValue: 'gpt-4',
        options: [{ value: 'gpt-4', name: 'GPT-4' }],
      },
    ]
    const r = extractReasoningSelector(opts)
    assert.equal(r, undefined)
  })

  it('handles unknown categories that match known ID', () => {
    const opts: SessionConfigOption[] = [
      {
        id: 'effort',
        name: 'Effort',
        type: 'select',
        currentValue: 'low',
        options: [{ value: 'low', name: 'Low' }],
      },
    ]
    const r = extractReasoningSelector(opts)
    assert.ok(r)
    assert.equal(r.configId, 'effort')
  })

  it('skips non-select types even with thought_level category', () => {
    const opts: SessionConfigOption[] = [
      {
        id: 'thinking',
        name: 'Thinking',
        category: 'thought_level',
        type: 'boolean' as const,
        currentValue: false,
      },
    ]
    const r = extractReasoningSelector(opts)
    assert.equal(r, undefined)
  })
})
