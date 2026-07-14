import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  formatWorkerModelError,
  isModelDisabledError,
  summarizeWorkerModels,
} from './acp-errors.js'

describe('acp-errors', () => {
  it('detects Model is disabled', () => {
    assert.equal(isModelDisabledError('Model is disabled'), true)
    assert.equal(isModelDisabledError('Error: model not found: foo'), true)
    assert.equal(isModelDisabledError('ServeError: port in use'), false)
  })

  it('formats disabled default model with action', () => {
    const msg = formatWorkerModelError({
      workerName: 'OpenCode',
      kind: 'opencode',
      model: null,
      rawError: 'Model is disabled',
    })
    assert.match(msg, /模型不可用/)
    assert.match(msg, /Workers/)
    assert.match(msg, /选择可用模型|默认模型/)
  })

  it('formats disabled pinned model', () => {
    const msg = formatWorkerModelError({
      workerName: 'OpenCode',
      kind: 'opencode',
      model: 'opencode-go/foo',
      rawError: 'Model is disabled',
    })
    assert.match(msg, /opencode-go\/foo/)
    assert.match(msg, /更换/)
  })

  it('summarizeWorkerModels flags OpenCode without pin', () => {
    const s = summarizeWorkerModels([
      {
        name: 'OpenCode',
        kind: 'opencode',
        enabled: true,
        model: null,
        availableModels: [{ modelId: 'opencode/big-pickle', name: 'Big Pickle' }],
      },
    ])
    assert.match(s, /needs model selection/)
    assert.match(s, /opencode\/big-pickle/)
  })
})
