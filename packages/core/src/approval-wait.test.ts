import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { ApprovalWaitRegistry, waitForApprovalDecision } from './approval-wait.js'

describe('ApprovalWaitRegistry', () => {
  it('resolves when settle(allow) is called', async () => {
    const reg = new ApprovalWaitRegistry()
    const p = reg.wait('appr_1')
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

  it('resolves selected on deny', async () => {
    const reg = new ApprovalWaitRegistry()
    const p = reg.wait('appr_2')
    setTimeout(() => reg.settle('appr_2', 'deny', 'reject_once'), 10)
    const result = await p
    assert.equal(result.outcome, 'selected')
    assert.equal(result.decision, 'deny')
    assert.equal(result.optionId, 'reject_once')
  })

  it('keeps a waiter pending until an explicit resolution', async () => {
    const reg = new ApprovalWaitRegistry()
    const pending = reg.wait('no-timeout')
    const early = await Promise.race([
      pending.then(() => 'resolved' as const),
      new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 40)),
    ])
    assert.equal(early, 'pending')
    assert.equal(reg.has('no-timeout'), true)
    reg.settle('no-timeout', 'allow', 'allow')
    assert.equal((await pending).outcome, 'selected')
  })

  it('register resolves when settle(allow) is called', async () => {
    const reg = new ApprovalWaitRegistry()
    const p = reg.register('appr_4')
    setTimeout(() => {
      const ok = reg.settle('appr_4', 'allow', 'allow')
      assert.equal(ok, true)
    }, 20)
    const result = await p
    assert.equal(result.outcome, 'selected')
  })

  it('does not cache a settle that had no registered waiter', async () => {
    const reg = new ApprovalWaitRegistry()
    assert.equal(reg.settle('appr_5', 'allow', 'allow'), false)
    const outcome = await Promise.race([
      reg.register('appr_5').then(() => 'unexpected' as const),
      new Promise<'not-settled'>((resolve) => setTimeout(() => resolve('not-settled'), 20)),
    ])
    reg.clear()
    assert.equal(outcome, 'not-settled')
  })

  it('duplicate settle only fires once', async () => {
    const reg = new ApprovalWaitRegistry()
    const p = reg.register('appr_6')
    setTimeout(() => {
      reg.settle('appr_6', 'allow', 'allow')
      const second = reg.settle('appr_6', 'deny')
      assert.equal(second, false)
    }, 10)
    const result = await p
    assert.equal(result.outcome, 'selected')
  })

  it('cancel rejects with reason', async () => {
    const reg = new ApprovalWaitRegistry()
    const p = reg.register('appr_7')
    setTimeout(() => reg.cancel('appr_7', 'job was cancelled'), 10)
    await assert.rejects(p, /job was cancelled/)
    assert.equal(reg.has('appr_7'), false)
  })

  it('cancelMany with reason rejects all waiters', async () => {
    const reg = new ApprovalWaitRegistry()
    const p1 = reg.register('a1')
    const p2 = reg.register('a2')
    setTimeout(() => reg.cancelMany(['a1', 'a2'], 'session closed'), 10)
    await assert.rejects(p1, /session closed/)
    await assert.rejects(p2, /session closed/)
    assert.equal(reg.size(), 0)
  })

  it('cancelMany without reason uses default message', async () => {
    const reg = new ApprovalWaitRegistry()
    const p = reg.register('a3')
    setTimeout(() => reg.cancelMany(['a3']), 10)
    await assert.rejects(p, /cancelled/)
    assert.equal(reg.size(), 0)
  })

  it('clear() removes all waiters without settling', () => {
    const reg = new ApprovalWaitRegistry()
    reg.register('a4')
    reg.register('a5')
    reg.clear()
    assert.equal(reg.size(), 0)
  })

  it('register with no timeout does not timeout', async () => {
    const reg = new ApprovalWaitRegistry()
    const p = reg.register('appr_8')
    setTimeout(() => reg.settle('appr_8', 'allow'), 30)
    const result = await p
    assert.equal(result.outcome, 'selected')
  })

  it('rejects duplicate waiter registration for the same approval', () => {
    const reg = new ApprovalWaitRegistry()
    reg.register('appr_duplicate')
    assert.throws(() => reg.register('appr_duplicate'), /already registered/)
    reg.clear()
  })
})

describe('waitForApprovalDecision helper', () => {
  it('uses injected registry', async () => {
    const reg = new ApprovalWaitRegistry()
    const p = waitForApprovalDecision('x', { registry: reg })
    setTimeout(() => reg.settle('x', 'allow'), 15)
    const r = await p
    assert.equal(r.outcome, 'selected')
  })
})
