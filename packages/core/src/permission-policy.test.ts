import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  decidePermission,
  type AcpToolKind,
  type PermissionOptionKind,
  type SessionApprovalPolicy,
  type PermissionOption,
} from './permission-policy.js'

function opt(optionId: string, name: string, kind: PermissionOptionKind): PermissionOption {
  return { optionId, name, kind }
}

// ---- §14.1 matrix: delete × all 5 policies × all option kinds → manual ----
for (const toolKind of ['delete'] as AcpToolKind[]) {
  for (const policy of [
    'allow_once',
    'allow_always',
    'reject_once',
    'reject_always',
  ] as SessionApprovalPolicy[]) {
    const opts: PermissionOption[] = [
      opt('once', 'Allow once', 'allow_once'),
      opt('always', 'Allow always', 'allow_always'),
      opt('rj1', 'Reject once', 'reject_once'),
      opt('rja', 'Reject always', 'reject_always'),
    ]
    describe(`delete × ${policy}`, () => {
      for (const o of opts) {
        it(`delete with single option ${o.kind} → manual`, () => {
          const result = decidePermission({
            toolKind,
            options: [o],
            sessionPolicy: policy,
          })
          assert.equal(result.mode, 'manual')
        })
      }
      it(`delete with all options → manual`, () => {
        const result = decidePermission({
          toolKind,
          options: opts,
          sessionPolicy: policy,
        })
        assert.equal(result.mode, 'manual')
      })
    })
  }
}

// read/search/think with allow_once → selected (regardless of session policy)
describe('read/search/think auto-approval', () => {
  for (const toolKind of ['read', 'search', 'think'] as AcpToolKind[]) {
    it(`${toolKind} auto-selects allow_once when available (even with manual policy)`, () => {
      const result = decidePermission({
        toolKind,
        options: [
          opt('once', 'Allow once', 'allow_once'),
          opt('always', 'Allow always', 'allow_always'),
        ],
        sessionPolicy: 'manual',
      })
      assert.equal(result.mode, 'automatic')
      if (result.mode === 'automatic') {
        assert.equal(result.option.kind, 'allow_once')
        assert.equal(result.decision, 'allow')
      }
    })

    it(`${toolKind} auto-selects allow_once with reject_always policy`, () => {
      const result = decidePermission({
        toolKind,
        options: [
          opt('once', 'Allow once', 'allow_once'),
          opt('always', 'Allow always', 'allow_always'),
        ],
        sessionPolicy: 'reject_always',
      })
      assert.equal(result.mode, 'automatic')
      if (result.mode === 'automatic') {
        assert.equal(result.option.kind, 'allow_once')
        assert.equal(result.decision, 'allow')
      }
    })

    it(`${toolKind} auto-selects allow_once with reject_once policy`, () => {
      const result = decidePermission({
        toolKind,
        options: [opt('once', 'Allow once', 'allow_once')],
        sessionPolicy: 'reject_once',
      })
      assert.equal(result.mode, 'automatic')
      if (result.mode === 'automatic') {
        assert.equal(result.option.kind, 'allow_once')
      }
    })

    it(`${toolKind} falls back to allow_always when allow_once unavailable (even with manual policy)`, () => {
      const result = decidePermission({
        toolKind,
        options: [opt('always', 'Allow always', 'allow_always')],
        sessionPolicy: 'manual',
      })
      assert.equal(result.mode, 'automatic')
      if (result.mode === 'automatic') {
        assert.equal(result.option.kind, 'allow_always')
      }
    })

    it(`${toolKind} is manual when neither allow_once nor allow_always`, () => {
      const result = decidePermission({
        toolKind,
        options: [opt('rj1', 'Reject once', 'reject_once')],
        sessionPolicy: 'allow_once',
      })
      assert.equal(result.mode, 'manual')
    })

    it(`${toolKind} ignores other option kinds when allow_once exists`, () => {
      const result = decidePermission({
        toolKind,
        options: [
          opt('rj1', 'Reject once', 'reject_once'),
          opt('always', 'Allow always', 'allow_always'),
          opt('once', 'Allow once', 'allow_once'),
        ],
        sessionPolicy: 'reject_always',
      })
      assert.equal(result.mode, 'automatic')
      if (result.mode === 'automatic') {
        assert.equal(result.option.kind, 'allow_once')
      }
    })
  }
})

// Controlled group with exact kind match → selected
describe('controlled tools match session policy', () => {
  const controlled: AcpToolKind[] = ['edit', 'move', 'execute', 'fetch', 'switch_mode', 'other']

  for (const toolKind of controlled) {
    it(`${toolKind} auto-selects matching allow policy option`, () => {
      const result = decidePermission({
        toolKind,
        options: [
          opt('once', 'Allow once', 'allow_once'),
          opt('always', 'Allow always', 'allow_always'),
          opt('rj1', 'Reject once', 'reject_once'),
          opt('rja', 'Reject always', 'reject_always'),
        ],
        sessionPolicy: 'allow_always',
      })
      assert.equal(result.mode, 'automatic')
      if (result.mode === 'automatic') {
        assert.equal(result.option.kind, 'allow_always')
        assert.equal(result.decision, 'allow')
      }
    })

    it(`${toolKind} auto-selects matching reject_once policy with deny decision`, () => {
      const result = decidePermission({
        toolKind,
        options: [
          opt('once', 'Allow once', 'allow_once'),
          opt('rj1', 'Reject once', 'reject_once'),
        ],
        sessionPolicy: 'reject_once',
      })
      assert.equal(result.mode, 'automatic')
      if (result.mode === 'automatic') {
        assert.equal(result.option.kind, 'reject_once')
        assert.equal(result.decision, 'deny')
      }
    })

    it(`${toolKind} auto-selects matching reject_always policy with deny decision`, () => {
      const result = decidePermission({
        toolKind,
        options: [
          opt('once', 'Allow once', 'allow_once'),
          opt('rja', 'Reject always', 'reject_always'),
        ],
        sessionPolicy: 'reject_always',
      })
      assert.equal(result.mode, 'automatic')
      if (result.mode === 'automatic') {
        assert.equal(result.option.kind, 'reject_always')
        assert.equal(result.decision, 'deny')
      }
    })

    it(`${toolKind} manual when no option matches policy`, () => {
      const result = decidePermission({
        toolKind,
        options: [opt('once', 'Allow once', 'allow_once')],
        sessionPolicy: 'reject_once',
      })
      assert.equal(result.mode, 'manual')
    })

    it(`${toolKind} manual with manual session policy`, () => {
      const result = decidePermission({
        toolKind,
        options: [
          opt('once', 'Allow once', 'allow_once'),
          opt('rj1', 'Reject once', 'reject_once'),
        ],
        sessionPolicy: 'manual',
      })
      assert.equal(result.mode, 'manual')
    })
  }
})

// Unknown ToolKind → other behavior
describe('unknown tool kind', () => {
  it('treats unknown tool kind as "other"', () => {
    const result = decidePermission({
      toolKind: 'some_unknown_kind' as unknown as AcpToolKind,
      options: [opt('rj1', 'Reject once', 'reject_once')],
      sessionPolicy: 'reject_once',
    })
    assert.equal(result.mode, 'automatic')
    if (result.mode === 'automatic') {
      assert.equal(result.option.kind, 'reject_once')
      assert.equal(result.decision, 'deny')
    }
  })

  it('unknown tool kind manual when no policy match', () => {
    const result = decidePermission({
      toolKind: 'some_unknown_kind' as unknown as AcpToolKind,
      options: [opt('once', 'Allow once', 'allow_once')],
      sessionPolicy: 'reject_once',
    })
    assert.equal(result.mode, 'manual')
  })

  it('empty string tool kind treated as other', () => {
    const result = decidePermission({
      toolKind: '' as AcpToolKind,
      options: [opt('once', 'Allow once', 'allow_once')],
      sessionPolicy: 'allow_once',
    })
    assert.equal(result.mode, 'automatic')
    if (result.mode === 'automatic') {
      assert.equal(result.option.kind, 'allow_once')
    }
  })
})

// Missing/invalid data
describe('edge cases', () => {
  it('empty options array → manual', () => {
    const result = decidePermission({
      toolKind: 'read',
      options: [],
      sessionPolicy: 'allow_once',
    })
    assert.equal(result.mode, 'manual')
  })

  it('empty options array for delete → manual', () => {
    const result = decidePermission({
      toolKind: 'delete',
      options: [],
      sessionPolicy: 'allow_once',
    })
    assert.equal(result.mode, 'manual')
  })

  it('never infers kind from option name', () => {
    const result = decidePermission({
      toolKind: 'edit',
      options: [{ optionId: 'x', name: 'allow_once', kind: 'reject_once' }],
      sessionPolicy: 'allow_once',
    })
    assert.equal(result.mode, 'manual')
  })

  it('never infers kind from optionId', () => {
    const result = decidePermission({
      toolKind: 'edit',
      options: [{ optionId: 'allow_always', name: 'Run', kind: 'reject_once' }],
      sessionPolicy: 'allow_always',
    })
    assert.equal(result.mode, 'manual')
  })
})

// All policies exercise
describe('session policy permutation', () => {
  const policies: PermissionOptionKind[] = [
    'allow_once',
    'allow_always',
    'reject_once',
    'reject_always',
  ]

  for (const policy of policies) {
    it(`edit tool matches ${policy} option when available`, () => {
      const all = policies.map((k) => opt(k, `${k} option`, k))
      const result = decidePermission({
        toolKind: 'edit',
        options: all,
        sessionPolicy: policy,
      })
      assert.equal(result.mode, 'automatic')
      if (result.mode === 'automatic') {
        assert.equal(result.option.kind, policy)
      }
    })
  }
})

// P0-3: manual / reject policies must NOT override read/search/think whitelist
describe('P0-3 — read/search/think whitelist overrides session policy', () => {
  const allowOnce: PermissionOption = { optionId: 'ao', name: 'Allow Once', kind: 'allow_once' }

  it('manual policy → read still auto-allows', () => {
    const r = decidePermission({
      toolKind: 'read',
      options: [allowOnce],
      sessionPolicy: 'manual',
    })
    assert.equal(r.mode, 'automatic')
  })

  it('reject_once policy → search still auto-allows', () => {
    const r = decidePermission({
      toolKind: 'search',
      options: [allowOnce],
      sessionPolicy: 'reject_once',
    })
    assert.equal(r.mode, 'automatic')
  })

  it('reject_always policy → think still auto-allows', () => {
    const r = decidePermission({
      toolKind: 'think',
      options: [allowOnce],
      sessionPolicy: 'reject_always',
    })
    assert.equal(r.mode, 'automatic')
  })

  it('manual policy → edit goes manual (controlled group respects policy)', () => {
    const r = decidePermission({
      toolKind: 'edit',
      options: [allowOnce],
      sessionPolicy: 'manual',
    })
    assert.equal(r.mode, 'manual')
  })
})
