import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  decidePermission,
  type AcpToolKind,
  type PermissionOption,
  type PermissionOptionKind,
} from './permission-policy.js'

const allowOnce: PermissionOption = {
  optionId: 'allow-once',
  name: 'Allow once',
  kind: 'allow_once',
}
const allowAlways: PermissionOption = {
  optionId: 'allow-always',
  name: 'Allow always',
  kind: 'allow_always',
}
const rejectOnce: PermissionOption = {
  optionId: 'reject-once',
  name: 'Reject once',
  kind: 'reject_once',
}

function decide(
  toolKind: AcpToolKind,
  permissionMode: 'default' | 'auto',
  targetScope: 'inside_project' | 'outside_project' | 'unknown',
  options: PermissionOption[] = [allowAlways, rejectOnce, allowOnce],
) {
  return decidePermission({ toolKind, permissionMode, targetScope, options })
}

describe('default permission decisions', () => {
  for (const toolKind of [
    'read',
    'search',
    'think',
    'fetch',
    'edit',
    'move',
    'delete',
    'execute',
    'switch_mode',
    'other',
  ] as AcpToolKind[]) {
    for (const targetScope of ['inside_project', 'outside_project', 'unknown'] as const) {
      it(`${toolKind} requires approval for ${targetScope}`, () => {
        assert.equal(decide(toolKind, 'default', targetScope).mode, 'manual')
      })
    }
  }

  it('still creates a manual decision when the Agent exposes only reject options', () => {
    assert.equal(decide('read', 'default', 'inside_project', [rejectOnce]).mode, 'manual')
  })
})

describe('automatic permission decisions', () => {
  for (const toolKind of [
    'read',
    'search',
    'think',
    'fetch',
    'edit',
    'move',
    'delete',
    'execute',
    'switch_mode',
    'other',
  ] as AcpToolKind[]) {
    it(`${toolKind} prefers allow_once even for an unknown target`, () => {
      const result = decide(toolKind, 'auto', 'unknown')
      assert.equal(result.mode, 'automatic')
      if (result.mode === 'automatic') assert.equal(result.option.kind, 'allow_once')
    })
  }

  it('falls back to allow_always when allow_once is absent', () => {
    const result = decide('execute', 'auto', 'outside_project', [allowAlways, rejectOnce])
    assert.equal(result.mode, 'automatic')
    if (result.mode === 'automatic') assert.equal(result.option.kind, 'allow_always')
  })
})

describe('fail-closed option handling', () => {
  it('auto still enters the durable approval path when the Agent offers no allow option', () => {
    const result = decide('read', 'auto', 'inside_project', [rejectOnce])
    assert.equal(result.mode, 'manual')
  })

  it('never infers allow semantics from option names or ids', () => {
    const deceptive: PermissionOption = {
      optionId: 'allow_once',
      name: 'Allow always',
      kind: 'reject_once' as PermissionOptionKind,
    }
    assert.equal(decide('edit', 'auto', 'inside_project', [deceptive]).mode, 'manual')
  })

  it('treats unknown tool kinds as other', () => {
    const result = decide('unknown-kind' as AcpToolKind, 'default', 'inside_project', [allowOnce])
    assert.equal(result.mode, 'manual')
  })
})
