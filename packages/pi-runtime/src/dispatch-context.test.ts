import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mkdtempSync, mkdirSync, realpathSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { authorizeDispatchCwd, resolveDispatchContext } from './dispatch-context.js'

function requestContext(values: Record<string, unknown>) {
  return {
    get(key: string) {
      return values[key]
    },
  }
}

describe('resolveDispatchContext', () => {
  const values = {
    routerSessionId: 'session-1',
    routerProjectId: 'project-1',
    routerProjectRoot: '/workspace/project-1',
    memoryThreadId: 'thread-1',
  }

  it('accepts an agent execution context that omits optional threadId', () => {
    assert.deepEqual(
      resolveDispatchContext({
        requestContext: requestContext(values),
        agent: { threadId: undefined },
      }),
      values,
    )
  })

  it('accepts a tool execution context without agent metadata', () => {
    assert.deepEqual(resolveDispatchContext({ requestContext: requestContext(values) }), values)
  })

  it('rejects a conflicting agent threadId', () => {
    assert.throws(
      () =>
        resolveDispatchContext({
          requestContext: requestContext(values),
          agent: { threadId: 'thread-2' },
        }),
      /Thread mismatch: agent thread thread-2 vs session thread-1/,
    )
  })

  it('requires the Router Session identity tuple from RequestContext', () => {
    assert.throws(
      () =>
        resolveDispatchContext({
          requestContext: requestContext({ ...values, routerProjectId: undefined }),
        }),
      /PIHUO_AGENT_SESSION_BINDING_REQUIRED/,
    )
  })

  it('throws stable PIHUO_AGENT_SESSION_BINDING_REQUIRED when unbound', () => {
    assert.throws(
      () => resolveDispatchContext({ requestContext: requestContext({}) }),
      (err: unknown) => {
        assert.ok(err instanceof Error)
        assert.match(err.message, /PIHUO_AGENT_SESSION_BINDING_REQUIRED/)
        return true
      },
    )
  })
})

describe('authorizeDispatchCwd', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'ra-cwd-auth-')))
  const inside = join(root, 'src')
  mkdirSync(inside)
  const outside = realpathSync(mkdtempSync(join(tmpdir(), 'ra-cwd-out-')))

  it('defaults to project root', () => {
    const r = authorizeDispatchCwd(root, undefined)
    assert.equal(r.ok, true)
    if (r.ok) assert.equal(r.cwd, root)
  })

  it('allows subdirectory inside project', () => {
    const r = authorizeDispatchCwd(root, inside)
    assert.equal(r.ok, true)
    if (r.ok) assert.equal(r.cwd, realpathSync(inside))
  })

  it('rejects absolute path outside project', () => {
    const r = authorizeDispatchCwd(root, outside)
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.code, 'CWD_OUTSIDE_PROJECT')
  })

  it('rejects .. escape', () => {
    const r = authorizeDispatchCwd(root, join(inside, '..', '..'))
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.code, 'CWD_OUTSIDE_PROJECT')
  })

  it('rejects symlink escape', () => {
    const link = join(root, 'escape-link')
    try {
      symlinkSync(outside, link)
    } catch {
      // platform may disallow symlink; skip
      return
    }
    const r = authorizeDispatchCwd(root, link)
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.code, 'CWD_OUTSIDE_PROJECT')
  })

  it('rejects non-existent path under symlink-style escape (must exist)', () => {
    const link = join(root, 'escape-link2')
    try {
      symlinkSync(outside, link)
    } catch {
      return
    }
    // Non-existent child of symlink would previously pass lexical check
    const r = authorizeDispatchCwd(root, join(link, 'new-dir'))
    assert.equal(r.ok, false)
    if (!r.ok) assert.ok(r.code === 'CWD_INVALID' || r.code === 'CWD_OUTSIDE_PROJECT')
  })

  it('rejects non-existent cwd even under project', () => {
    const r = authorizeDispatchCwd(root, join(root, 'does-not-exist-yet'))
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.code, 'CWD_INVALID')
  })

  it('requires project root', () => {
    const r = authorizeDispatchCwd(undefined, '/tmp')
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.code, 'PROJECT_ROOT_REQUIRED')
  })
})
