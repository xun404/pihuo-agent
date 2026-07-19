import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { RequestContext } from '@mastra/core/request-context'
import type { RouterSessionContext } from './runtime-dispatch-port.js'
import {
  applyTrustedRouterBinding,
  extractMemoryThreadIdOnly,
  extractRouterHeadersFromRequest,
} from './studio-context-injector.js'

function mapContext(requestContext: RequestContext) {
  return {
    routerSessionId: requestContext.get('routerSessionId'),
    routerProjectId: requestContext.get('routerProjectId'),
    routerProjectRoot: requestContext.get('routerProjectRoot'),
    memoryThreadId: requestContext.get('memoryThreadId'),
  }
}

describe('studio trusted binding', () => {
  it('ignores router tuple from body; uses memory thread id resolution', async () => {
    const trusted: RouterSessionContext = {
      routerSessionId: 'sess-trusted',
      routerProjectId: 'proj-trusted',
      routerProjectRoot: '/workspace/trusted',
      memoryThreadId: 'thread-studio-1',
    }
    const calls: string[] = []
    const requestContext = new RequestContext()

    const result = await applyTrustedRouterBinding({
      requestContext,
      headers: {},
      body: {
        routerSessionId: 'sess-forged-from-body',
        routerProjectId: 'proj-forged-from-body',
        routerProjectRoot: '/forged',
        memory: { thread: 'thread-studio-1' },
      },
      resolveSessionContext: async (memoryThreadId) => {
        calls.push(memoryThreadId)
        return memoryThreadId === trusted.memoryThreadId ? trusted : null
      },
    })

    assert.equal(result, 'thread')
    assert.deepEqual(calls, ['thread-studio-1'])
    assert.deepEqual(mapContext(requestContext), trusted)
  })

  it('injects trusted tuple when thread maps to one session', async () => {
    const trusted: RouterSessionContext = {
      routerSessionId: 'sess-1',
      routerProjectId: 'proj-1',
      routerProjectRoot: '/tmp/proj',
      memoryThreadId: 'thread-1',
    }
    const requestContext = new RequestContext()

    const result = await applyTrustedRouterBinding({
      requestContext,
      headers: {
        'x-router-memory-thread-id': 'thread-1',
      },
      resolveSessionContext: async (id) => (id === 'thread-1' ? trusted : null),
    })

    assert.equal(result, 'thread')
    assert.deepEqual(mapContext(requestContext), trusted)
  })

  it('leaves chat usable without binding; dispatch needs ROUTER_SESSION_BINDING_REQUIRED', async () => {
    const requestContext = new RequestContext()

    const result = await applyTrustedRouterBinding({
      requestContext,
      headers: {},
      body: { message: 'hello' },
      resolveSessionContext: async () => {
        throw new Error('resolveSessionContext should not be called without thread id')
      },
    })

    assert.equal(result, 'unbound')
    assert.deepEqual(mapContext(requestContext), {
      routerSessionId: undefined,
      routerProjectId: undefined,
      routerProjectRoot: undefined,
      memoryThreadId: undefined,
    })
  })

  it('rejects forged routerSessionId that does not match stored session', async () => {
    const trusted: RouterSessionContext = {
      routerSessionId: 'sess-store',
      routerProjectId: 'proj-store',
      routerProjectRoot: '/store',
      memoryThreadId: 'thread-store',
    }
    const requestContext = new RequestContext()

    const result = await applyTrustedRouterBinding({
      requestContext,
      headers: {
        'x-router-memory-thread-id': 'thread-store',
        // incomplete desktop headers (no session/project) → must resolve via port
      },
      body: {
        routerSessionId: 'sess-forged',
        routerProjectId: 'proj-forged',
        routerProjectRoot: '/forged',
      },
      resolveSessionContext: async (id) => (id === 'thread-store' ? trusted : null),
    })

    assert.equal(result, 'thread')
    assert.deepEqual(mapContext(requestContext), trusted)
    assert.notEqual(requestContext.get('routerSessionId'), 'sess-forged')
  })

  it('never trusts full desktop headers without owner resolution', async () => {
    const requestContext = new RequestContext()
    let called = false
    const result = await applyTrustedRouterBinding({
      requestContext,
      headers: {
        'x-router-session-id': 'sess-forged',
        'x-router-project-id': 'proj-forged',
        'x-router-project-root': '/forged',
        'x-router-memory-thread-id': 'thread-forged',
      },
      resolveSessionContext: async (id) => {
        called = true
        assert.equal(id, 'thread-forged')
        return null
      },
    })
    // Full headers are NOT trusted; owner returned null → unbound
    assert.equal(result, 'unbound')
    assert.equal(called, true, 'must always resolve via owner')
    assert.deepEqual(mapContext(requestContext), {
      routerSessionId: undefined,
      routerProjectId: undefined,
      routerProjectRoot: undefined,
      memoryThreadId: undefined,
    })
  })

  it('forged full headers with successful resolve use store tuple not client headers', async () => {
    const trusted: RouterSessionContext = {
      routerSessionId: 'sess-store',
      routerProjectId: 'proj-store',
      routerProjectRoot: '/store',
      memoryThreadId: 'thread-x',
    }
    const requestContext = new RequestContext()
    const result = await applyTrustedRouterBinding({
      requestContext,
      headers: {
        'x-router-session-id': 'sess-forged',
        'x-router-project-id': 'proj-forged',
        'x-router-project-root': '/forged',
        'x-router-memory-thread-id': 'thread-x',
      },
      resolveSessionContext: async () => trusted,
    })
    assert.equal(result, 'thread')
    assert.deepEqual(mapContext(requestContext), trusted)
    assert.notEqual(requestContext.get('routerSessionId'), 'sess-forged')
  })

  it('unbound when thread has no session mapping', async () => {
    const requestContext = new RequestContext()
    const result = await applyTrustedRouterBinding({
      requestContext,
      headers: { 'x-router-memory-thread-id': 'thread-orphan' },
      resolveSessionContext: async () => null,
    })
    assert.equal(result, 'unbound')
    assert.equal(requestContext.get('routerSessionId'), undefined)
    assert.equal(requestContext.get('memoryThreadId'), undefined)
  })
})

describe('extractMemoryThreadIdOnly', () => {
  it('reads memory thread from header', () => {
    assert.equal(
      extractMemoryThreadIdOnly({
        headers: { 'x-router-memory-thread-id': 't1' },
      }),
      't1',
    )
  })

  it('reads memory.thread string from body', () => {
    assert.equal(
      extractMemoryThreadIdOnly({
        headers: {},
        body: { memory: { thread: 't2' } },
      }),
      't2',
    )
  })

  it('reads memory.thread.id from body', () => {
    assert.equal(
      extractMemoryThreadIdOnly({
        headers: {},
        body: { memory: { thread: { id: 't3' } } },
      }),
      't3',
    )
  })

  it('does not treat routerSessionId as thread id', () => {
    assert.equal(
      extractMemoryThreadIdOnly({
        headers: {},
        body: { routerSessionId: 'sess', routerProjectId: 'proj' },
      }),
      undefined,
    )
  })
})

describe('extractRouterHeadersFromRequest', () => {
  it('requires full desktop tuple', () => {
    assert.equal(
      extractRouterHeadersFromRequest({
        headers: { 'x-router-memory-thread-id': 'only-thread' },
      }),
      undefined,
    )
    assert.deepEqual(
      extractRouterHeadersFromRequest({
        headers: {
          'x-router-session-id': 's',
          'x-router-project-id': 'p',
          'x-router-memory-thread-id': 't',
        },
      }),
      { sessionId: 's', projectId: 'p', projectRoot: undefined, memoryThreadId: 't' },
    )
  })
})
