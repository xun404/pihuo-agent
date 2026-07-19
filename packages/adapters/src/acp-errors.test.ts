import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  formatPublicError,
  formatWorkerModelError,
  isModelDisabledError,
  publicErrorMessage,
  summarizeWorkerModels,
} from './acp-errors.js'

describe('acp-errors', () => {
  it('detects Model is disabled', () => {
    assert.equal(isModelDisabledError('Model is disabled'), true)
    assert.equal(isModelDisabledError('Error: model not found: foo'), true)
    assert.equal(isModelDisabledError('ServeError: port in use'), false)
  })

  it('maps stable public error codes (zh/en)', () => {
    assert.match(publicErrorMessage('MODEL_CATALOG_STALE', 'zh')!, /过期|刷新/)
    assert.match(publicErrorMessage('MODEL_PROVIDER_UNAVAILABLE', 'en')!, /unavailable/i)
    assert.match(publicErrorMessage('MODEL_SELECTION_UNVERIFIED', 'zh')!, /验证|列表/)
    assert.match(publicErrorMessage('MODEL_REFRESH_FAILED', 'en')!, /refresh/i)
    assert.match(publicErrorMessage('RUNTIME_OWNER_EXISTS', 'zh')!, /占用/)
    assert.match(publicErrorMessage('ROUTER_RUNTIME_UNAVAILABLE', 'en')!, /unavailable/i)
    assert.match(publicErrorMessage('ROUTER_SESSION_BINDING_REQUIRED', 'zh')!, /会话/)
    assert.match(publicErrorMessage('RUNTIME_AUTH_FAILED', 'en')!, /auth/i)
    assert.equal(publicErrorMessage('NOT_A_REAL_CODE'), undefined)
    assert.match(formatPublicError('MODEL_REFRESH_FAILED', 'fallback', 'zh'), /刷新/)
    assert.equal(formatPublicError('UNKNOWN', 'keep me'), 'keep me')
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

  it('prefers errorCode public copy over raw disabled text', () => {
    const msg = formatWorkerModelError({
      workerName: 'OpenCode',
      kind: 'opencode',
      model: 'opencode/x',
      rawError: 'Model is disabled',
      errorCode: 'MODEL_PROVIDER_UNAVAILABLE',
    })
    assert.match(msg, /模型不可用/)
    assert.match(msg, /供应商|不可用/)
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
