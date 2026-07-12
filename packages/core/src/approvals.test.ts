import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyApprovalDecision,
  createApprovalItem,
  enqueueApproval,
  listPendingApprovals,
  mapAcpPermissionToEnqueue,
  resolveApprovalInQueue,
} from './approvals.js'
import { LocalStore } from './store.js'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('approvals pure logic', () => {
  it('createApprovalItem defaults to pending with allow/deny options', () => {
    const item = createApprovalItem({ title: 'Write file', pathOrTarget: 'a.ts' })
    assert.equal(item.status, 'pending')
    assert.equal(item.title, 'Write file')
    assert.ok(item.options.length >= 2)
    assert.ok(item.id.startsWith('appr_'))
  })

  it('applyApprovalDecision allow/deny and rejects double resolve', () => {
    const item = createApprovalItem({ title: 'Run command' })
    const allowed = applyApprovalDecision({ item, decision: 'allow' })
    assert.equal(allowed.status, 'allowed')
    assert.equal(allowed.decision, 'allow')
    assert.ok(allowed.resolvedAt)

    assert.throws(() => applyApprovalDecision({ item: allowed, decision: 'deny' }), /already/)

    const denied = applyApprovalDecision({
      item: createApprovalItem({ title: 'x' }),
      decision: 'deny',
    })
    assert.equal(denied.status, 'denied')
  })

  it('enqueue and resolve in queue immutably', () => {
    const { queue, item } = enqueueApproval([], {
      title: 'ACP write',
      source: 'acp',
    })
    assert.equal(queue.length, 1)
    assert.equal(listPendingApprovals(queue).length, 1)

    const resolved = resolveApprovalInQueue(queue, item.id, 'allow')
    assert.equal(resolved.item.status, 'allowed')
    assert.equal(listPendingApprovals(resolved.queue).length, 0)
    // original queue unchanged
    assert.equal(listPendingApprovals(queue).length, 1)
  })

  it('mapAcpPermissionToEnqueue tags source acp', () => {
    const input = mapAcpPermissionToEnqueue({
      title: 'Permission',
      pathOrTarget: 'src/a.ts',
      action: 'write',
      workerName: 'Claude Code',
    })
    assert.equal(input.source, 'acp')
    assert.equal(input.action, 'write')
    assert.match(input.detail ?? '', /write/)
  })
})

describe('LocalStore approvals', () => {
  it('enqueue and resolve via store API', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ra-store-'))
    const store = new LocalStore(join(dir, 'state.json'))
    const item = store.enqueueApproval({
      title: 'Write SessionList.tsx',
      action: 'write',
      pathOrTarget: 'apps/desktop/src/x.tsx',
      workerName: 'Claude Code',
      source: 'acp',
    })
    assert.equal(store.listPendingApprovals().length, 1)
    assert.equal(store.snapshot().approvals.length, 1)

    const resolved = store.resolveApproval(item.id, 'deny')
    assert.equal(resolved.status, 'denied')
    assert.equal(store.listPendingApprovals().length, 0)
  })
})
