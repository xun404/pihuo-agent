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
import { globalApprovalWaiters } from './approval-wait.js'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function approvalOptions() {
  return [
    { optionId: 'allow_once', name: 'Allow Once', kind: 'allow_once' as const },
    { optionId: 'reject_once', name: 'Reject Once', kind: 'reject_once' as const },
  ]
}

describe('approvals pure logic', () => {
  it('rejects empty options instead of fabricating allow/deny choices', () => {
    assert.throws(() => createApprovalItem({ title: 'Write file', options: [] }), /options/i)
    assert.throws(() => createApprovalItem({ title: 'Write file' } as any), /options/i)
  })

  it('createApprovalItem preserves validated options and defaults to pending', () => {
    const item = createApprovalItem({
      title: 'Write file',
      pathOrTarget: 'a.ts',
      options: approvalOptions(),
    })
    assert.equal(item.status, 'pending')
    assert.equal(item.title, 'Write file')
    assert.ok(item.options.length >= 2)
    assert.ok(item.id.startsWith('appr_'))
  })

  it('applyApprovalDecision allow/deny and rejects double resolve', () => {
    const item = createApprovalItem({ title: 'Run command', options: approvalOptions() })
    const allowed = applyApprovalDecision({ item, decision: 'allow', optionId: 'allow_once' })
    assert.equal(allowed.status, 'allowed')
    assert.equal(allowed.decision, 'allow')
    assert.ok(allowed.resolvedAt)

    assert.throws(() => applyApprovalDecision({ item: allowed, decision: 'deny' }), /already/)

    const denied = applyApprovalDecision({
      item: createApprovalItem({ title: 'x', options: approvalOptions() }),
      decision: 'deny',
      optionId: 'reject_once',
    })
    assert.equal(denied.status, 'denied')
  })

  it('applyApprovalDecision validates optionId belongs to item', () => {
    const item = createApprovalItem({
      title: 'Edit file',
      options: [
        { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
        { optionId: 'deny', name: 'Deny', kind: 'reject_once' },
      ],
    })
    assert.throws(
      () => applyApprovalDecision({ item, decision: 'allow', optionId: 'nonexistent' }),
      /does not belong/,
    )
  })

  it('applyApprovalDecision with valid optionId resolves correctly', () => {
    const item = createApprovalItem({
      title: 'Edit file',
      options: [
        { optionId: 'allow_once', name: 'Allow Once', kind: 'allow_once' },
        { optionId: 'deny', name: 'Deny', kind: 'reject_once' },
      ],
    })
    const resolved = applyApprovalDecision({
      item,
      decision: 'allow',
      optionId: 'allow_once',
    })
    assert.equal(resolved.status, 'allowed')
    assert.equal(resolved.selectedOptionId, 'allow_once')
  })

  it('applyApprovalDecision rejects a decision that conflicts with option kind', () => {
    const item = createApprovalItem({ title: 'Strict kind', options: approvalOptions() })
    assert.throws(
      () => applyApprovalDecision({ item, decision: 'deny', optionId: 'allow_once' }),
      /reject_\*/,
    )
  })

  it('enqueue and resolve in queue immutably', () => {
    const { queue, item } = enqueueApproval([], {
      title: 'ACP write',
      source: 'acp',
      options: approvalOptions(),
    })
    assert.equal(queue.length, 1)
    assert.equal(listPendingApprovals(queue).length, 1)

    const resolved = resolveApprovalInQueue(queue, item.id, 'allow', 'allow_once')
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
      options: approvalOptions(),
    })
    assert.equal(input.source, 'acp')
    assert.equal(input.action, 'write')
    assert.match(input.detail ?? '', /write/)
  })
})

describe('LocalStore approvals', () => {
  it('cancels a legacy pending approval whose options cannot be validated', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ra-store-'))
    const statePath = join(dir, 'state.json')
    writeFileSync(
      statePath,
      JSON.stringify({
        projects: [],
        sessions: [],
        workers: [],
        jobs: [],
        approvals: [
          {
            id: 'legacy-approval',
            status: 'pending',
            title: 'Legacy request',
            options: [{ optionId: 'allow', name: 'Allow' }],
            source: 'acp',
            createdAt: new Date().toISOString(),
          },
        ],
      }),
    )

    const migrated = new LocalStore(statePath).snapshot().approvals[0]!
    assert.equal(migrated.status, 'cancelled')
    assert.equal(migrated.decision, 'cancel')
    assert.equal(migrated.resolutionSource, 'system')
    assert.equal(migrated.options.length, 0)
  })

  it('persists the exact selected option and manual audit metadata', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ra-store-'))
    const store = new LocalStore(join(dir, 'state.json'))
    const item = store.enqueueApproval({
      title: 'Write file',
      options: [{ optionId: 'allow-once', name: 'Allow Once', kind: 'allow_once' }],
      source: 'acp',
    })
    const resolved = (store as any).resolveApproval(item.id, 'allow', 'allow-once', {
      resolutionSource: 'manual_chat',
      resolutionReason: 'Approved in chat',
    })
    assert.deepEqual(resolved.selectedOption, {
      optionId: 'allow-once',
      name: 'Allow Once',
      kind: 'allow_once',
    })
    assert.equal(resolved.resolutionSource, 'manual_chat')
    assert.equal(resolved.resolutionReason, 'Approved in chat')
  })

  it('auto-resolved approvals do not pre-settle a phantom waiter', async () => {
    globalApprovalWaiters.clear()
    const dir = mkdtempSync(join(tmpdir(), 'ra-store-'))
    const store = new LocalStore(join(dir, 'state.json'))
    const item = store.createResolvedApproval({
      title: 'Auto read',
      source: 'acp',
      option: { optionId: 'allow_once', name: 'Allow Once', kind: 'allow_once' },
      decision: 'allow',
      reason: 'policy',
    })
    const outcome = await Promise.race([
      globalApprovalWaiters.register(item.id).then(() => 'unexpected'),
      new Promise<'not-settled'>((resolve) => setTimeout(() => resolve('not-settled'), 20)),
    ])
    globalApprovalWaiters.clear()
    assert.equal(outcome, 'not-settled')
  })

  it('enqueue and resolve via store API', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ra-store-'))
    const store = new LocalStore(join(dir, 'state.json'))
    const item = store.enqueueApproval({
      title: 'Write SessionList.tsx',
      action: 'write',
      pathOrTarget: 'apps/desktop/src/x.tsx',
      workerName: 'Claude Code',
      source: 'acp',
      options: approvalOptions(),
    })
    assert.equal(store.listPendingApprovals().length, 1)
    assert.equal(store.snapshot().approvals.length, 1)

    const resolved = store.resolveApproval(item.id, 'deny', 'reject_once')
    assert.equal(resolved.status, 'denied')
    assert.equal(store.listPendingApprovals().length, 0)
  })

  it('createResolvedApproval creates atomically without pending state', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ra-store-'))
    const store = new LocalStore(join(dir, 'state.json'))
    const resolved = store.createResolvedApproval({
      title: 'Auto-approved read',
      action: 'read',
      pathOrTarget: 'src/foo.ts',
      workerName: 'Claude Code',
      source: 'acp',
      option: { optionId: 'allow_once', name: 'Allow Once', kind: 'allow_once' },
      decision: 'allow',
    })
    assert.equal(resolved.status, 'allowed')
    assert.equal(resolved.decision, 'allow')
    assert.equal(resolved.selectedOptionId, 'allow_once')
    assert.ok(resolved.resolvedAt)
    assert.equal(store.listPendingApprovals().length, 0)
    assert.equal(store.snapshot().approvals.length, 1)
  })

  it('resolveApproval validates optionId belongs to item', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ra-store-'))
    const store = new LocalStore(join(dir, 'state.json'))
    const item = store.enqueueApproval({
      title: 'Write file',
      action: 'write',
      options: [
        { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
        { optionId: 'deny', name: 'Deny', kind: 'reject_once' },
      ],
      source: 'acp',
    })
    assert.throws(() => store.resolveApproval(item.id, 'allow', 'nonexistent'), /does not belong/)
  })

  it('resolveApproval rejects re-resolve (conflict)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ra-store-'))
    const store = new LocalStore(join(dir, 'state.json'))
    const item = store.enqueueApproval({
      title: 'Write file',
      action: 'write',
      source: 'acp',
      options: approvalOptions(),
    })
    store.resolveApproval(item.id, 'allow', 'allow_once')
    assert.throws(() => store.resolveApproval(item.id, 'deny'), /already/)
  })

  it('tryResolveApproval is compare-and-set and preserves the winning audit record', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ra-store-'))
    const store = new LocalStore(join(dir, 'state.json'))
    const item = store.enqueueApproval({
      title: 'Race',
      source: 'acp',
      options: approvalOptions(),
    })

    const manual = store.tryResolveApproval(item.id, 'allow', 'allow_once', {
      resolutionSource: 'manual_panel',
      resolutionReason: 'User won the race',
    })
    const timeout = store.tryResolveApproval(item.id, 'cancel', undefined, {
      resolutionSource: 'system',
      resolutionReason: 'Approval timed out',
    })

    assert.equal(manual.resolved, true)
    assert.equal(timeout.resolved, false)
    assert.equal(timeout.item.status, 'allowed')
    assert.equal(timeout.item.resolutionSource, 'manual_panel')
    assert.equal(timeout.item.resolutionReason, 'User won the race')
  })

  it('auto path creates resolved directly (one audit record)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ra-store-'))
    const store = new LocalStore(join(dir, 'state.json'))
    // Auto path: create directly as resolved
    store.createResolvedApproval({
      title: 'Auto read',
      action: 'read',
      pathOrTarget: 'src/a.ts',
      workerName: 'Worker',
      source: 'acp',
      option: { optionId: 'allow_once', name: 'Allow Once', kind: 'allow_once' },
      decision: 'allow',
      reason: 'auto-approved by policy',
    })
    // No pending items
    assert.equal(store.listPendingApprovals().length, 0)
    const all = store.snapshot().approvals
    assert.equal(all.length, 1)
    assert.equal(all[0]!.status, 'allowed')
    assert.equal(all[0]!.selectedOptionId, 'allow_once')
  })

  it('manual path returns pending then resolves', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ra-store-'))
    const store = new LocalStore(join(dir, 'state.json'))
    const pending = store.enqueueApproval({
      title: 'Delete file',
      action: 'delete',
      pathOrTarget: 'src/b.ts',
      workerName: 'Worker',
      source: 'acp',
      options: approvalOptions(),
    })
    assert.equal(pending.status, 'pending')
    assert.equal(store.listPendingApprovals().length, 1)

    const resolved = store.resolveApproval(pending.id, 'allow', 'allow_once')
    assert.equal(resolved.status, 'allowed')
    assert.equal(store.listPendingApprovals().length, 0)
  })
})
