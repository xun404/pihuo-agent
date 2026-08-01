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
  for (const toolKind of ['read', 'search', 'think', 'fetch'] as AcpToolKind[]) {
    it(`${toolKind} allows once regardless of target scope`, () => {
      const result = decide(toolKind, 'default', 'outside_project')
      assert.equal(result.mode, 'automatic')
      if (result.mode === 'automatic') assert.equal(result.option.kind, 'allow_once')
    })
  }

  for (const toolKind of ['edit', 'move', 'delete', 'execute'] as AcpToolKind[]) {
    it(`${toolKind} automatically allows a proven project-local target`, () => {
      const result = decide(toolKind, 'default', 'inside_project')
      assert.equal(result.mode, 'automatic')
      if (result.mode === 'automatic') {
        assert.equal(result.option.kind, 'allow_once')
        assert.equal(result.decision, 'allow')
      }
    })

    it(`${toolKind} requires approval outside the project`, () => {
      assert.equal(decide(toolKind, 'default', 'outside_project').mode, 'manual')
    })

    it(`${toolKind} requires approval when scope evidence is missing`, () => {
      assert.equal(decide(toolKind, 'default', 'unknown').mode, 'manual')
    })
  }

  for (const toolKind of ['switch_mode', 'other'] as AcpToolKind[]) {
    it(`${toolKind} remains manual without reliable range semantics`, () => {
      assert.equal(decide(toolKind, 'default', 'inside_project').mode, 'manual')
    })
  }
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
  for (const permissionMode of ['default', 'auto'] as const) {
    it(`${permissionMode} cancels when the Agent offers no allow option`, () => {
      const result = decide('read', permissionMode, 'inside_project', [rejectOnce])
      assert.equal(result.mode, 'cancelled')
    })
  }

  it('never infers allow semantics from option names or ids', () => {
    const deceptive: PermissionOption = {
      optionId: 'allow_once',
      name: 'Allow always',
      kind: 'reject_once' as PermissionOptionKind,
    }
    assert.equal(decide('edit', 'auto', 'inside_project', [deceptive]).mode, 'cancelled')
  })

  it('treats unknown tool kinds as other', () => {
    const result = decide('unknown-kind' as AcpToolKind, 'default', 'inside_project', [allowOnce])
    assert.equal(result.mode, 'manual')
  })
})
