import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { ApprovalWaitRegistry, waitForApprovalDecision } from './approval-wait.js'

describe('ApprovalWaitRegistry', () => {
  it('resolves when settle(allow) is called', async () => {
    const reg = new ApprovalWaitRegistry()
    const p = reg.wait('appr_1', { timeoutMs: 5000 })
    // settle after microtask
    setTimeout(() => {
      const ok = reg.settle('appr_1', 'allow', 'allow')
      assert.equal(ok, true)
    }, 20)
    const result = await p
    assert.equal(result.outcome, 'selected')
    if (result.outcome === 'selected') {
      assert.equal(result.decision, 'allow')
      assert.equal(result.optionId, 'allow')
    }
  })

  it('resolves cancelled on deny', async () => {
    const reg = new ApprovalWaitRegistry()
    const p = reg.wait('appr_2', { timeoutMs: 5000 })
    setTimeout(() => reg.settle('appr_2', 'deny'), 10)
    const result = await p
    assert.equal(result.outcome, 'cancelled')
  })

  it('times out with non-success outcome', async () => {
    const reg = new ApprovalWaitRegistry()
    const result = await reg.wait('appr_3', { timeoutMs: 40 })
    assert.equal(result.outcome, 'timeout')
    assert.equal(reg.has('appr_3'), false)
  })
})

describe('waitForApprovalDecision helper', () => {
  it('uses injected registry', async () => {
    const reg = new ApprovalWaitRegistry()
    const p = waitForApprovalDecision('x', { registry: reg, timeoutMs: 2000 })
    setTimeout(() => reg.settle('x', 'allow'), 15)
    const r = await p
    assert.equal(r.outcome, 'selected')
  })
})
