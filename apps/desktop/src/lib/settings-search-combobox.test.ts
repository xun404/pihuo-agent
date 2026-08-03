import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  filterSettingsSearchOptions,
  isRedundantModelDisplayName,
  labelForSettingsSearchValue,
  moveSettingsSearchHighlight,
  toReasoningSearchOption,
  toWorkerModelSearchOption,
  type SettingsSearchOption,
} from './settings-search-combobox.js'

const options: SettingsSearchOption[] = [
  { value: 'sonnet', label: 'Sonnet', description: 'Efficient', secondary: 'sonnet' },
  { value: 'opus[1m]', label: 'Opus (1M context)', secondary: 'opus[1m]' },
  {
    value: 'zhipuai-coding-plan/glm-4.7',
    label: 'Zhipu AI Coding Plan/GLM-4.7',
    secondary: 'zhipuai-coding-plan/glm-4.7',
  },
]

describe('isRedundantModelDisplayName / toWorkerModelSearchOption', () => {
  it('always surfaces modelId as the sole visible label', () => {
    assert.deepEqual(
      toWorkerModelSearchOption({
        modelId: 'opencode-go/deepseek-v4-flash',
        name: 'OpenCode Go/DeepSeek V4 Flash (...)',
      }),
      {
        value: 'opencode-go/deepseek-v4-flash',
        label: 'opencode-go/deepseek-v4-flash',
        description: undefined,
        keywords: undefined,
      },
    )
    assert.deepEqual(
      toWorkerModelSearchOption({
        modelId: 'opencode/deepseek-v4-flash',
        name: 'OpenCode Zen/DeepSeek V4 Flash',
      }),
      {
        value: 'opencode/deepseek-v4-flash',
        label: 'opencode/deepseek-v4-flash',
        description: undefined,
        keywords: 'OpenCode Zen/DeepSeek V4 Flash',
      },
    )
  })

  it('keeps non-redundant names as search keywords only', () => {
    assert.equal(
      isRedundantModelDisplayName('Claude Sonnet 4', 'anthropic/claude-sonnet-4-20250514'),
      false,
    )
    assert.deepEqual(
      toWorkerModelSearchOption({
        modelId: 'anthropic/claude-sonnet-4-20250514',
        name: 'Claude Sonnet 4',
        description: 'Balanced',
      }),
      {
        value: 'anthropic/claude-sonnet-4-20250514',
        label: 'anthropic/claude-sonnet-4-20250514',
        description: 'Balanced',
        keywords: 'Claude Sonnet 4',
      },
    )
    assert.deepEqual(
      filterSettingsSearchOptions(
        [
          toWorkerModelSearchOption({
            modelId: 'anthropic/claude-sonnet-4-20250514',
            name: 'Claude Sonnet 4',
          }),
        ],
        'sonnet',
      ).map((o) => o.value),
      ['anthropic/claude-sonnet-4-20250514'],
    )
  })
})

describe('toReasoningSearchOption', () => {
  it('shows a single label and does not dual-render name + value', () => {
    assert.deepEqual(toReasoningSearchOption({ value: 'high', name: 'High' }), {
      value: 'high',
      label: 'High',
      description: undefined,
      keywords: undefined,
    })
    assert.deepEqual(toReasoningSearchOption({ value: 'max', name: 'Max' }), {
      value: 'max',
      label: 'Max',
      description: undefined,
      keywords: undefined,
    })
    assert.equal(toReasoningSearchOption({ value: 'high', name: 'High' }).secondary, undefined)
  })

  it('keeps raw value searchable when the label is more than a case change', () => {
    const option = toReasoningSearchOption({
      value: 'xhigh',
      name: 'Extra high',
    })
    assert.equal(option.label, 'Extra high')
    assert.equal(option.keywords, 'xhigh')
    assert.deepEqual(
      filterSettingsSearchOptions([option], 'xhigh').map((o) => o.value),
      ['xhigh'],
    )
  })
})

describe('filterSettingsSearchOptions', () => {
  it('matches label, value, description, and secondary', () => {
    assert.deepEqual(
      filterSettingsSearchOptions(options, 'son').map((o) => o.value),
      ['sonnet'],
    )
    assert.deepEqual(
      filterSettingsSearchOptions(options, '1m').map((o) => o.value),
      ['opus[1m]'],
    )
    assert.deepEqual(
      filterSettingsSearchOptions(options, 'efficient').map((o) => o.value),
      ['sonnet'],
    )
    assert.deepEqual(
      filterSettingsSearchOptions(options, 'glm-4.7').map((o) => o.value),
      ['zhipuai-coding-plan/glm-4.7'],
    )
  })

  it('returns all options for empty query', () => {
    assert.equal(filterSettingsSearchOptions(options, '').length, 3)
    assert.equal(filterSettingsSearchOptions(options, '   ').length, 3)
  })
})

describe('moveSettingsSearchHighlight', () => {
  it('wraps arrows and handles empty list', () => {
    assert.equal(moveSettingsSearchHighlight(-1, 'ArrowDown', 3), 0)
    assert.equal(moveSettingsSearchHighlight(2, 'ArrowDown', 3), 0)
    assert.equal(moveSettingsSearchHighlight(0, 'ArrowUp', 3), 2)
    assert.equal(moveSettingsSearchHighlight(0, 'ArrowDown', 0), -1)
  })
})

describe('labelForSettingsSearchValue', () => {
  it('resolves labels and falls back to raw value', () => {
    assert.equal(labelForSettingsSearchValue(options, '', 'Agent default'), 'Agent default')
    assert.equal(labelForSettingsSearchValue(options, 'sonnet'), 'Sonnet')
    assert.equal(labelForSettingsSearchValue(options, 'missing'), 'missing')
  })
})
