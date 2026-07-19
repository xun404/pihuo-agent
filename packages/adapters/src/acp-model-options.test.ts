import { describe, it } from 'node:test'
import assert from 'node:assert'
import { extractModelOptions } from './acp-model-options.js'
import type { SessionConfigOption } from '@agentclientprotocol/sdk'

describe('extractModelOptions', () => {
  it('returns error for empty configOptions', () => {
    const r = extractModelOptions(null)
    assert.equal(r.ok, false)
    assert.equal(r.models.length, 0)
    assert.ok(r.error)
  })

  it('returns error for empty array', () => {
    const r = extractModelOptions([])
    assert.equal(r.ok, false)
  })

  it('returns error when no model-like option exists', () => {
    const opts: SessionConfigOption[] = [
      {
        id: 'mode',
        name: 'Mode',
        type: 'select',
        currentValue: 'ask',
        options: [{ value: 'ask', name: 'Ask' }],
      },
    ]
    const r = extractModelOptions(opts)
    assert.equal(r.ok, false)
    assert.match(r.error!, /No model-like/i)
  })

  it('extracts model option with category "model"', () => {
    const opts: SessionConfigOption[] = [
      {
        id: 'primary-model',
        name: 'Primary Model',
        category: 'model',
        type: 'select',
        currentValue: 'gpt-4',
        options: [
          { value: 'gpt-4', name: 'GPT-4' },
          { value: 'gpt-3.5', name: 'GPT-3.5', description: 'Cheaper' },
        ],
      },
    ]
    const r = extractModelOptions(opts)
    assert.equal(r.ok, true)
    assert.equal(r.models.length, 2)
    assert.equal(r.models[0]!.modelId, 'gpt-4')
    assert.equal(r.models[0]!.currentValue, 'gpt-4')
    assert.equal(r.models[1]!.modelId, 'gpt-3.5')
    assert.equal(r.models[1]!.description, 'Cheaper')
    assert.equal(r.currentModelId, 'gpt-4')
  })

  it('removes duplicates preserving first', () => {
    const opt: SessionConfigOption = {
      id: 'model',
      name: 'Model',
      category: 'model',
      type: 'select',
      currentValue: 'm1',
      options: [
        { value: 'm1', name: 'M1' },
        { value: 'm1', name: 'M1 Dup' },
        { value: 'm2', name: 'M2' },
      ],
    }
    const r = extractModelOptions([opt])
    assert.equal(r.ok, true)
    assert.equal(r.models.length, 2)
    assert.equal(r.models[0]!.modelId, 'm1')
    assert.equal(r.models[1]!.modelId, 'm2')
  })

  it('discards empty value entries', () => {
    const opt: SessionConfigOption = {
      id: 'model',
      name: 'Model',
      type: 'select',
      currentValue: '',
      options: [
        { value: '', name: 'Empty' },
        { value: 'real', name: 'Real' },
      ],
    }
    const r = extractModelOptions([opt])
    assert.equal(r.ok, true)
    assert.equal(r.models.length, 1)
    assert.equal(r.models[0]!.modelId, 'real')
  })

  it('handles grouped options', () => {
    const opt: SessionConfigOption = {
      id: 'model',
      name: 'Model',
      category: 'model',
      type: 'select',
      currentValue: 'gpt-4',
      options: [
        {
          group: 'openai',
          name: 'OpenAI',
          options: [
            { value: 'gpt-4', name: 'GPT-4' },
            { value: 'gpt-3.5', name: 'GPT-3.5' },
          ],
        },
        {
          group: 'anthropic',
          name: 'Anthropic',
          options: [{ value: 'claude-3', name: 'Claude 3' }],
        },
      ],
    }
    const r = extractModelOptions([opt])
    assert.equal(r.ok, true)
    assert.equal(r.models.length, 3)
    assert.equal(r.models[0]!.modelId, 'gpt-4')
    assert.equal(r.models[2]!.modelId, 'claude-3')
  })

  it('recognizes model by id name pattern', () => {
    const opt: SessionConfigOption = {
      id: 'model_selector',
      name: 'Pick a Model',
      type: 'select',
      currentValue: 'm1',
      options: [{ value: 'm1', name: 'M1' }],
    }
    const r = extractModelOptions([
      { id: 'settings', name: 'Settings', type: 'boolean', currentValue: true },
      opt,
    ])
    assert.equal(r.ok, true)
    assert.equal(r.models.length, 1)
  })

  it('recognizes model_config category', () => {
    const opt: SessionConfigOption = {
      id: 'primary-model',
      name: 'Model',
      category: 'model_config',
      type: 'select',
      currentValue: 'm1',
      options: [{ value: 'm1', name: 'M1' }],
    }
    const r = extractModelOptions([opt])
    assert.equal(r.ok, true)
    assert.equal(r.models.length, 1)
  })

  it('fails when select has no valid options', () => {
    const opt: SessionConfigOption = {
      id: 'model',
      name: 'Model',
      category: 'model',
      type: 'select',
      currentValue: 'missing',
      options: [],
    }
    const r = extractModelOptions([opt])
    assert.equal(r.ok, false)
    assert.match(r.error!, /no selectable values/i)
  })

  it('skips non-select model options', () => {
    const opts: SessionConfigOption[] = [
      {
        id: 'model',
        name: 'Model',
        category: 'model',
        type: 'select',
        currentValue: 'm1',
        options: [{ value: 'm1', name: 'M1' }],
      },
      {
        id: 'thinking',
        name: 'Thinking',
        category: 'thought_level',
        type: 'select',
        currentValue: 'low',
        options: [{ value: 'low', name: 'Low' }],
      },
    ]
    const r = extractModelOptions(opts)
    assert.equal(r.ok, true)
    assert.equal(r.models.length, 1)
    assert.equal(r.models[0]!.modelId, 'm1')
  })
})
