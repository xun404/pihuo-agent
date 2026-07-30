import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  filterSettingsSearchOptions,
  labelForSettingsSearchValue,
  moveSettingsSearchHighlight,
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
