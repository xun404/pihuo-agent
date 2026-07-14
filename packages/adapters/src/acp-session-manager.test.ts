import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  AcpSessionManager,
  buildSessionReuseKey,
  computeExecutionFingerprint,
  resetAcpSessionManager,
} from './acp-session-manager.js'
import * as sessionManagerModule from './acp-session-manager.js'
import type { SessionReuseKey, SessionEntryConfig } from './acp-session-manager.js'

const SAFE_CWD = process.cwd()

function mkConfig(overrides: Partial<SessionEntryConfig> = {}): SessionEntryConfig {
  return {
    command: 'test-cmd',
    args: ['arg1'],
    model: 'test-model',
    env: { OPENCODE_MODEL: 'test-model' },
    ...overrides,
  }
}

function mkKey(overrides: Partial<SessionReuseKey> = {}): SessionReuseKey {
  return {
    routerSessionId: 'sess-1',
    workerId: 'worker-a',
    canonicalCwd: SAFE_CWD,
    executionFingerprint: computeExecutionFingerprint(mkConfig()),
    ...overrides,
  }
}

function keyToString(k: SessionReuseKey): string {
  return `${k.routerSessionId}::${k.workerId}::${k.canonicalCwd}::${k.executionFingerprint.slice(0, 12)}`
}

function makeFakeIdleEntry(key: SessionReuseKey): any {
  return {
    key,
    state: 'idle',
    proc: { pid: 99999, exitCode: 0, signalCode: null, on: () => {}, stderr: { on: () => {} } },
    session: {
      prompt: () => {},
      nextUpdate: () => Promise.resolve({ kind: 'stop', stopReason: 'end_turn' }),
      dispose: () => {},
    },
    ctx: { notify: () => Promise.resolve(), request: () => Promise.resolve() },
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
    generation: 1,
    summary: 'test',
    currentBinding: null,
    promptQueue: [],
    configOptions: [],
  }
}

let manager: AcpSessionManager

beforeEach(() => {
  resetAcpSessionManager()
  manager = new AcpSessionManager({ idleTimeoutMs: 900_000 })
})

afterEach(() => {
  const timer = (manager as any).idleTimer as ReturnType<typeof setInterval> | null
  if (timer) clearInterval(timer)
  delete process.env.ACP_SESSION_REUSE
  delete process.env.ACP_SESSION_IDLE_MS
  delete process.env.ACP_SESSION_POOL_MAX
})

describe('manager environment configuration', () => {
  it('uses ACP session TTL and pool limits from the environment', () => {
    process.env.ACP_SESSION_IDLE_MS = '12345'
    process.env.ACP_SESSION_POOL_MAX = '3'
    const mgr = new AcpSessionManager()
    const timer = (mgr as any).idleTimer as ReturnType<typeof setInterval> | null
    if (timer) clearInterval(timer)

    assert.equal((mgr as any).idleTimeoutMs, 12345)
    assert.equal((mgr as any).poolMax, 3)
  })
})

// -- 1. buildSessionReuseKey --
describe('buildSessionReuseKey', () => {
  const baseParams = {
    routerSessionId: 'sess-1',
    workerId: 'w1',
    cwd: '/tmp/a',
    config: mkConfig(),
  }

  it('same params produce the same key', () => {
    const k1 = buildSessionReuseKey(baseParams)
    const k2 = buildSessionReuseKey(baseParams)
    assert.deepEqual(k1, k2)
  })

  it('different routerSessionId produces different key', () => {
    const k1 = buildSessionReuseKey(baseParams)
    const k2 = buildSessionReuseKey({ ...baseParams, routerSessionId: 'sess-2' })
    assert.notDeepEqual(k1, k2)
    assert.notEqual(k1.routerSessionId, k2.routerSessionId)
  })

  it('different workerId produces different key', () => {
    const k1 = buildSessionReuseKey(baseParams)
    const k2 = buildSessionReuseKey({ ...baseParams, workerId: 'w2' })
    assert.notDeepEqual(k1, k2)
    assert.notEqual(k1.workerId, k2.workerId)
  })

  it('different cwd produces different key', () => {
    const k1 = buildSessionReuseKey(baseParams)
    const k2 = buildSessionReuseKey({ ...baseParams, cwd: '/tmp/b' })
    assert.notDeepEqual(k1, k2)
    assert.notEqual(k1.canonicalCwd, k2.canonicalCwd)
  })

  it('different model produces different key (via fingerprint)', () => {
    const k1 = buildSessionReuseKey(baseParams)
    const k2 = buildSessionReuseKey({ ...baseParams, config: mkConfig({ model: 'other-model' }) })
    assert.notEqual(k1.executionFingerprint, k2.executionFingerprint)
    assert.notDeepEqual(k1, k2)
  })

  it('different command produces different key (via fingerprint)', () => {
    const k1 = buildSessionReuseKey(baseParams)
    const k2 = buildSessionReuseKey({ ...baseParams, config: mkConfig({ command: 'other-cmd' }) })
    assert.notEqual(k1.executionFingerprint, k2.executionFingerprint)
    assert.notDeepEqual(k1, k2)
  })

  it('different args produce different key (via fingerprint)', () => {
    const k1 = buildSessionReuseKey(baseParams)
    const k2 = buildSessionReuseKey({ ...baseParams, config: mkConfig({ args: ['other-arg'] }) })
    assert.notEqual(k1.executionFingerprint, k2.executionFingerprint)
    assert.notDeepEqual(k1, k2)
  })
})

// -- 2. computeExecutionFingerprint --
describe('computeExecutionFingerprint', () => {
  it('different model produces different fingerprint', () => {
    const f1 = computeExecutionFingerprint(mkConfig({ model: 'm1' }))
    const f2 = computeExecutionFingerprint(mkConfig({ model: 'm2' }))
    assert.notEqual(f1, f2)
    assert.equal(typeof f1, 'string')
    assert.ok(f1.length > 0)
  })

  it('same config produces same fingerprint', () => {
    const cfg = mkConfig({ command: 'cmd', args: ['a', 'b'], model: 'm1' })
    assert.equal(computeExecutionFingerprint(cfg), computeExecutionFingerprint(cfg))
  })

  it('different command produces different fingerprint', () => {
    const f1 = computeExecutionFingerprint(mkConfig({ command: 'cmd-a' }))
    const f2 = computeExecutionFingerprint(mkConfig({ command: 'cmd-b' }))
    assert.notEqual(f1, f2)
  })

  it('different args produce different fingerprint', () => {
    const f1 = computeExecutionFingerprint(mkConfig({ args: ['a'] }))
    const f2 = computeExecutionFingerprint(mkConfig({ args: ['b'] }))
    assert.notEqual(f1, f2)
  })

  it('fingerprint is a hex string (HMAC-SHA256)', () => {
    const f = computeExecutionFingerprint(mkConfig())
    assert.match(f, /^[0-9a-f]{64}$/)
  })

  it('execution-relevant env changes produce different fingerprint', () => {
    const f1 = computeExecutionFingerprint(mkConfig({ env: { OPENCODE_MODEL: 'm1' } }))
    const f2 = computeExecutionFingerprint(mkConfig({ env: { OPENCODE_MODEL: 'm2' } }))
    assert.notEqual(f1, f2)
  })

  it('arbitrary explicit env changes are part of the execution boundary', () => {
    const f1 = computeExecutionFingerprint(mkConfig({ env: { MY_ENDPOINT: 'https://a' } }))
    const f2 = computeExecutionFingerprint(mkConfig({ env: { MY_ENDPOINT: 'https://b' } }))
    assert.notEqual(f1, f2)
  })

  it('PATH changes produce different fingerprint', () => {
    const f1 = computeExecutionFingerprint(mkConfig({ env: { PATH: '/usr/bin' } }))
    const f2 = computeExecutionFingerprint(mkConfig({ env: { PATH: '/opt/bin' } }))
    assert.notEqual(f1, f2)
  })

  it('proxy env changes produce different fingerprint', () => {
    const f1 = computeExecutionFingerprint(mkConfig({ env: { HTTP_PROXY: 'http://a:8080' } }))
    const f2 = computeExecutionFingerprint(mkConfig({ env: { HTTP_PROXY: 'http://b:8080' } }))
    assert.notEqual(f1, f2)
  })

  it('HOME changes produce different fingerprint', () => {
    const f1 = computeExecutionFingerprint(mkConfig({ env: { HOME: '/home/a' } }))
    const f2 = computeExecutionFingerprint(mkConfig({ env: { HOME: '/home/b' } }))
    assert.notEqual(f1, f2)
  })

  it('API_ prefix is included in fingerprint', () => {
    const f1 = computeExecutionFingerprint(mkConfig({ env: { API_BASE_URL: 'https://a' } }))
    const f2 = computeExecutionFingerprint(mkConfig({ env: { API_BASE_URL: 'https://b' } }))
    assert.notEqual(f1, f2)
  })

  it('lowercase proxy env vars produce different fingerprint', () => {
    const f1 = computeExecutionFingerprint(mkConfig({ env: { http_proxy: 'http://a:8080' } }))
    const f2 = computeExecutionFingerprint(mkConfig({ env: { http_proxy: 'http://b:8080' } }))
    assert.notEqual(f1, f2)
  })

  it('NO_PROXY changes produce different fingerprint', () => {
    const f1 = computeExecutionFingerprint(mkConfig({ env: { NO_PROXY: 'a' } }))
    const f2 = computeExecutionFingerprint(mkConfig({ env: { NO_PROXY: 'b' } }))
    assert.notEqual(f1, f2)
  })
})

describe('worker execution invalidation boundary', () => {
  it('invalidates when command, args, env, model, kind, or enabled changes', () => {
    const changed = (sessionManagerModule as Record<string, unknown>).workerExecutionConfigChanged
    assert.equal(typeof changed, 'function')
    const fn = changed as (a: Record<string, unknown>, b: Record<string, unknown>) => boolean
    const base = {
      command: 'opencode',
      args: ['acp'],
      env: { MY_ENDPOINT: 'https://a' },
      model: 'm1',
      kind: 'opencode',
      enabled: true,
    }
    assert.equal(fn(base, { ...base, args: [...base.args], env: { ...base.env } }), false)

    for (const patch of [
      { command: 'other' },
      { args: ['acp', '--flag'] },
      { env: { MY_ENDPOINT: 'https://b' } },
      { model: 'm2' },
      { kind: 'custom' },
      { enabled: false },
    ]) {
      assert.equal(fn(base, { ...base, ...patch }), true)
    }
    assert.equal(fn(base, { ...base }), false)
  })
})

// -- 3. Session reuse --
describe('session reuse', () => {
  it('enqueuePrompt twice with same key creates only one entry', async () => {
    const key = mkKey()
    const config = mkConfig()
    const binding = { jobId: 'j1', sequence: 0 }
    const ks = keyToString(key)

    ;(manager as any).entries.set(ks, makeFakeIdleEntry(key))

    const r1 = await manager.enqueuePrompt({
      key, config, kind: 'opencode', task: 'task-1', binding,
    })
    assert.ok(r1.ok)
    assert.equal(r1.reusedSession, true)
    assert.equal(manager.getDebugInfo().entries, 1)

    const r2 = await manager.enqueuePrompt({
      key, config, kind: 'opencode', task: 'task-2',
      binding: { jobId: 'j2', sequence: 0 },
    })
    assert.ok(r2.ok)
    assert.equal(r2.reusedSession, true)
    assert.equal(manager.getDebugInfo().entries, 1)
  })
})

// -- 4. No reuse with different keys --
describe('no reuse with different keys', () => {
  it('different routerSessionIds produce different entries', () => {
    const key1 = mkKey({ routerSessionId: 'sess-A' })
    const key2 = mkKey({ routerSessionId: 'sess-B' })

    ;(manager as any).entries.set(keyToString(key1), makeFakeIdleEntry(key1))
    ;(manager as any).entries.set(keyToString(key2), makeFakeIdleEntry(key2))

    assert.equal(manager.getDebugInfo().entries, 2)
    assert.notEqual(keyToString(key1), keyToString(key2))
  })

  it('different workerIds produce different entries', () => {
    const key1 = mkKey({ workerId: 'worker-a' })
    const key2 = mkKey({ workerId: 'worker-b' })

    ;(manager as any).entries.set(keyToString(key1), makeFakeIdleEntry(key1))
    ;(manager as any).entries.set(keyToString(key2), makeFakeIdleEntry(key2))

    assert.equal(manager.getDebugInfo().entries, 2)
    assert.notEqual(keyToString(key1), keyToString(key2))
  })
})

// -- 5. FIFO serialization --
describe('FIFO serialization', () => {
  it('second enqueuePrompt with same key waits for first to complete', async () => {
    const key = mkKey()
    const config = mkConfig()
    const ks = keyToString(key)

    let callCount = 0
    let resolveFirst!: (value: any) => void
    const fakeEntry = makeFakeIdleEntry(key)
    fakeEntry.session.nextUpdate = () => {
      callCount++
      if (callCount === 1) {
        return new Promise((resolve) => { resolveFirst = resolve })
      }
      return Promise.resolve({ kind: 'stop', stopReason: 'end_turn' })
    }

    ;(manager as any).entries.set(ks, fakeEntry)

    const p1 = manager.enqueuePrompt({
      key, config, kind: 'opencode', task: 'task-1',
      binding: { jobId: 'j1', sequence: 0 },
    })

    await new Promise((r) => setTimeout(r, 50))
    assert.equal(fakeEntry.state, 'running')

    const p2 = manager.enqueuePrompt({
      key, config, kind: 'opencode', task: 'task-2',
      binding: { jobId: 'j2', sequence: 0 },
    })
    assert.equal(fakeEntry.promptQueue.length, 1)

    resolveFirst({ kind: 'stop', stopReason: 'end_turn' })
    const r1 = await p1
    assert.ok(r1.ok)

    const r2 = await p2
    assert.ok(r2.ok)
    assert.equal(fakeEntry.promptQueue.length, 0)
  })

  it('queued prompt resolves with reusedSession true', async () => {
    const key = mkKey()
    const config = mkConfig()
    const ks = keyToString(key)

    let callCount = 0
    let resolveFirst!: (value: any) => void
    const fakeEntry = makeFakeIdleEntry(key)
    fakeEntry.session.nextUpdate = () => {
      callCount++
      if (callCount === 1) {
        return new Promise((resolve) => { resolveFirst = resolve })
      }
      return Promise.resolve({ kind: 'stop', stopReason: 'end_turn' })
    }

    ;(manager as any).entries.set(ks, fakeEntry)

    const p1 = manager.enqueuePrompt({
      key, config, kind: 'opencode', task: 'task-1',
      binding: { jobId: 'j1', sequence: 0 },
    })

    await new Promise((r) => setTimeout(r, 50))
    const p2 = manager.enqueuePrompt({
      key, config, kind: 'opencode', task: 'task-2',
      binding: { jobId: 'j2', sequence: 0 },
    })

    resolveFirst({ kind: 'stop', stopReason: 'end_turn' })
    await p1
    const r2 = await p2
    assert.ok(r2.ok)
    assert.equal(r2.reusedSession, true)
  })
})

// -- 6. ACP_SESSION_REUSE=0 --
describe('ACP_SESSION_REUSE=0', () => {
  it('does not reuse idle entries when reuse is disabled', async () => {
    process.env.ACP_SESSION_REUSE = '0'
    const mgr = new AcpSessionManager()
    const timer = (mgr as any).idleTimer as ReturnType<typeof setInterval> | null
    if (timer) clearInterval(timer)

    const key = mkKey()
    const ks = keyToString(key)
    ;(mgr as any).entries.set(ks, makeFakeIdleEntry(key))

    assert.equal(mgr.getDebugInfo().entries, 1)

    // Override createAndExecute to throw sync — prevents a new entry from being added
    // to the map during the (normally async) spawn flow.
    ;(mgr as any).createAndExecute = () => { throw new Error('no-spawn') }

    await mgr.enqueuePrompt({
      key, config: mkConfig(), kind: 'opencode', task: 't',
      binding: { jobId: 'j1', sequence: 0 },
    }).catch(() => {})

    // The idle entry was deleted by the REUSE=0 path; no new entry was created.
    assert.equal(mgr.getDebugInfo().entries, 0)
  })

  it('creates fresh session each time', async () => {
    process.env.ACP_SESSION_REUSE = '0'
    const mgr = new AcpSessionManager()
    const timer = (mgr as any).idleTimer as ReturnType<typeof setInterval> | null
    if (timer) clearInterval(timer)

    const key = mkKey()
    const config = mkConfig()
    const binding = { jobId: 'j1', sequence: 0 }

    // Inject an idle entry - when REUSE=0, this gets closed and a new session is spawned
    const ks = keyToString(key)
    ;(mgr as any).entries.set(ks, makeFakeIdleEntry(key))

    const p = mgr.enqueuePrompt({ key, config, kind: 'opencode', task: 'task', binding })
    // Will reject because createAndExecute tries to spawn a process
    await assert.rejects(p)
    assert.equal(mgr.getDebugInfo().entries, 0)
  })

  it('does not queue onto a running session when reuse is disabled', async () => {
    process.env.ACP_SESSION_REUSE = '0'
    const mgr = new AcpSessionManager()
    const timer = (mgr as any).idleTimer as ReturnType<typeof setInterval> | null
    if (timer) clearInterval(timer)

    const key = mkKey()
    const running = makeFakeIdleEntry(key)
    running.state = 'running'
    running.currentBinding = { jobId: 'j1' }
    ;(mgr as any).entries.set(keyToString(key), running)

    const result = await Promise.race([
      mgr.enqueuePrompt({
        key,
        config: mkConfig(),
        kind: 'opencode',
        task: 'task-2',
        binding: { jobId: 'j2', sequence: 0 },
      }),
      new Promise<'still-queued'>((resolve) => setTimeout(() => resolve('still-queued'), 20)),
    ])

    assert.notEqual(result, 'still-queued')
    if (result === 'still-queued') return
    assert.equal(result.ok, false)
    assert.equal(result.error, 'capacity_exhausted')
    assert.equal(running.promptQueue.length, 0)
  })
})

// -- 6b. enqueue while starting is queued (Bug 1: P1-1) --
describe('enqueue while starting is queued', () => {
  it('enqueues when session is in starting state', async () => {
    const key = mkKey()
    const config = mkConfig()
    const ks = keyToString(key)

    const startingEntry = makeFakeIdleEntry(key)
    startingEntry.state = 'starting'
    ;(manager as any).entries.set(ks, startingEntry)

    const p1 = manager.enqueuePrompt({
      key, config, kind: 'opencode', task: 'task-1',
      binding: { jobId: 'j1', sequence: 0 },
    })
    await new Promise((r) => setTimeout(r, 20))

    assert.equal(startingEntry.promptQueue.length, 1)
    assert.equal(startingEntry.promptQueue[0].task, 'task-1')

    p1.catch(() => {})
  })
})

// -- 6c. queued prompt abort (Bug 2: P1-3) --
describe('queued prompt abort', () => {
  it('aborted signal while queued rejects with Cancelled', async () => {
    const key = mkKey()
    const config = mkConfig()
    const ks = keyToString(key)

    const runningEntry = makeFakeIdleEntry(key)
    runningEntry.state = 'running'
    runningEntry.currentBinding = { jobId: 'j1' }
    ;(manager as any).entries.set(ks, runningEntry)

    const ac = new AbortController()

    const p = manager.enqueuePrompt({
      key, config, kind: 'opencode', task: 'task-2',
      binding: { jobId: 'j2', sequence: 0, signal: ac.signal },
    })
    p.catch(() => {}) // suppress unhandled rejection before await

    await new Promise((r) => setTimeout(r, 20))
    assert.equal(runningEntry.promptQueue.length, 1)

    ac.abort()

    await assert.rejects(p, { message: 'Cancelled' })
    assert.equal(runningEntry.promptQueue.length, 0)
  })

  it('removes the queued abort listener when the item is dequeued', async () => {
    const key = mkKey()
    const config = mkConfig()
    const ks = keyToString(key)
    const entry = makeFakeIdleEntry(key)
    entry.state = 'running'
    entry.currentBinding = { jobId: 'j1' }
    ;(manager as any).entries.set(ks, entry)

    const listeners: Array<() => void> = []
    let removeCount = 0
    const signal = {
      aborted: false,
      addEventListener: (_type: string, listener: () => void) => listeners.push(listener),
      removeEventListener: (_type: string, listener: () => void) => {
        if (listeners.includes(listener)) removeCount += 1
      },
    } as unknown as AbortSignal

    const queued = manager.enqueuePrompt({
      key,
      config,
      kind: 'opencode',
      task: 'task-2',
      binding: { jobId: 'j2', sequence: 0, signal },
    })
    assert.equal(entry.promptQueue.length, 1)

    entry.currentBinding = null
    entry.state = 'idle'
    ;(manager as any).drainQueue(entry)
    await queued

    assert.equal(removeCount, 2, 'queued and active abort listeners should both be detached')
  })
})

// -- 6d. pool at capacity with no idle entries rejects (Bug 3: P1-4) --
describe('pool at capacity rejects', () => {
  it('rejects with capacity_exhausted when pool is full and all entries are running', async () => {
    const mgr = new AcpSessionManager({ poolMax: 2 })
    const timer = (mgr as any).idleTimer as ReturnType<typeof setInterval> | null
    if (timer) clearInterval(timer)

    const key1 = mkKey({ routerSessionId: 'sess-1' })
    const key2 = mkKey({ routerSessionId: 'sess-2' })
    const key3 = mkKey({ routerSessionId: 'sess-3' })

    const running1 = makeFakeIdleEntry(key1)
    running1.state = 'running'
    running1.currentBinding = { jobId: 'j1' }

    const running2 = makeFakeIdleEntry(key2)
    running2.state = 'running'
    running2.currentBinding = { jobId: 'j2' }

    ;(mgr as any).entries.set(keyToString(key1), running1)
    ;(mgr as any).entries.set(keyToString(key2), running2)

    assert.equal(mgr.getDebugInfo().entries, 2)

    const result = await mgr.enqueuePrompt({
      key: key3, config: mkConfig(), kind: 'opencode', task: 'task',
      binding: { jobId: 'j3', sequence: 0 },
    })

    assert.ok(!result.ok)
    assert.equal(result.error, 'capacity_exhausted')
    assert.equal(result.reusedSession, false)
    assert.equal(mgr.getDebugInfo().entries, 2)
  })

  it('reports whether a key can be admitted before a job is marked running', () => {
    const mgr = new AcpSessionManager({ poolMax: 1 })
    const timer = (mgr as any).idleTimer as ReturnType<typeof setInterval> | null
    if (timer) clearInterval(timer)

    const activeKey = mkKey({ routerSessionId: 'active' })
    const waitingKey = mkKey({ routerSessionId: 'waiting' })
    const active = makeFakeIdleEntry(activeKey)
    active.state = 'running'
    active.currentBinding = { jobId: 'active-job' }
    ;(mgr as any).entries.set(keyToString(activeKey), active)

    assert.equal(mgr.canAccept(activeKey), true)
    assert.equal(mgr.canAccept(waitingKey), false)
  })

  it('reports whether an admitted key will reuse an existing live session', () => {
    const mgr = new AcpSessionManager({ poolMax: 2 })
    const timer = (mgr as any).idleTimer as ReturnType<typeof setInterval> | null
    if (timer) clearInterval(timer)
    const existingKey = mkKey({ routerSessionId: 'existing' })
    const newKey = mkKey({ routerSessionId: 'new' })
    ;(mgr as any).entries.set(keyToString(existingKey), makeFakeIdleEntry(existingKey))

    assert.equal(mgr.willReuse(existingKey), true)
    assert.equal(mgr.willReuse(newKey), false)
  })
})

// -- 7. closeByRouterSession --
describe('closeByRouterSession', () => {
  it('removes all entries for the given routerSessionId', () => {
    const keyA1 = mkKey({ routerSessionId: 'sess-A', workerId: 'w1' })
    const keyA2 = mkKey({ routerSessionId: 'sess-A', workerId: 'w2' })
    const keyB = mkKey({ routerSessionId: 'sess-B' })

    ;(manager as any).entries.set(keyToString(keyA1), makeFakeIdleEntry(keyA1))
    ;(manager as any).entries.set(keyToString(keyA2), makeFakeIdleEntry(keyA2))
    ;(manager as any).entries.set(keyToString(keyB), makeFakeIdleEntry(keyB))

    assert.equal(manager.getDebugInfo().entries, 3)

    manager.closeByRouterSession('sess-A')

    assert.equal(manager.getDebugInfo().entries, 1)
    assert.ok((manager as any).entries.has(keyToString(keyB)))
    assert.ok(!(manager as any).entries.has(keyToString(keyA1)))
    assert.ok(!(manager as any).entries.has(keyToString(keyA2)))
  })

  it('rejects queued prompts for closed entries', () => {
    const key = mkKey()
    const fakeEntry = makeFakeIdleEntry(key)
    fakeEntry.state = 'running'
    fakeEntry.currentBinding = { jobId: 'j1' }
    ;(manager as any).entries.set(keyToString(key), fakeEntry)

    // Queue a prompt
    const qPromise = new Promise<void>((_resolve, reject) => {
      fakeEntry.promptQueue.push({
        task: 't', binding: { jobId: 'j2', sequence: 0 },
        resolve: () => {},
        reject,
      })
    })

    manager.closeByRouterSession(key.routerSessionId)

    assert.rejects(qPromise, /closed by router session/i)
  })
})

// -- 8. invalidateWorker --
describe('invalidateWorker', () => {
  it('removes idle entries and marks running entries as closing for the given worker', () => {
    const idleKey = mkKey({ workerId: 'worker-x', routerSessionId: 'sess-1' })
    const runningKey = mkKey({ workerId: 'worker-x', routerSessionId: 'sess-2' })
    const otherKey = mkKey({ workerId: 'worker-y', routerSessionId: 'sess-3' })

    const idleEntry = makeFakeIdleEntry(idleKey)
    const runningEntry = makeFakeIdleEntry(runningKey)
    runningEntry.state = 'running'
    runningEntry.currentBinding = { jobId: 'j1' }
    const otherEntry = makeFakeIdleEntry(otherKey)

    ;(manager as any).entries.set(keyToString(idleKey), idleEntry)
    ;(manager as any).entries.set(keyToString(runningKey), runningEntry)
    ;(manager as any).entries.set(keyToString(otherKey), otherEntry)

    assert.equal(manager.getDebugInfo().entries, 3)

    manager.invalidateWorker('worker-x')

    assert.equal(manager.getDebugInfo().entries, 2)
    assert.ok(!(manager as any).entries.has(keyToString(idleKey)))
    assert.ok((manager as any).entries.has(keyToString(runningKey)))
    assert.equal(runningEntry.state, 'closing')
    assert.ok((manager as any).entries.has(keyToString(otherKey)))
    assert.equal(otherEntry.state, 'idle')
  })

  it('does not affect entries of other workers', () => {
    const key1 = mkKey({ workerId: 'worker-y' })
    const key2 = mkKey({ workerId: 'worker-y', routerSessionId: 'sess-2' })

    ;(manager as any).entries.set(keyToString(key1), makeFakeIdleEntry(key1))
    ;(manager as any).entries.set(keyToString(key2), makeFakeIdleEntry(key2))

    assert.equal(manager.getDebugInfo().entries, 2)
    manager.invalidateWorker('worker-z') // different worker
    assert.equal(manager.getDebugInfo().entries, 2)
  })
})

// -- 9. TTL idle reaping --
describe('TTL idle reaping', () => {
  it('removes idle entries older than idleTimeoutMs', () => {
    const mgr = new AcpSessionManager({ idleTimeoutMs: 100 })
    const timer = (mgr as any).idleTimer as ReturnType<typeof setInterval> | null
    if (timer) clearInterval(timer)

    const oldKey = mkKey({ routerSessionId: 'sess-old' })
    const newKey = mkKey({ routerSessionId: 'sess-new' })
    const runningKey = mkKey({ routerSessionId: 'sess-running' })

    const oldEntry = makeFakeIdleEntry(oldKey)
    oldEntry.lastUsedAt = Date.now() - 10_000

    const newEntry = makeFakeIdleEntry(newKey)
    newEntry.lastUsedAt = Date.now()

    const runningEntry = makeFakeIdleEntry(runningKey)
    runningEntry.state = 'running'
    runningEntry.currentBinding = { jobId: 'j1' }
    runningEntry.lastUsedAt = Date.now() - 10_000 // old but running

    ;(mgr as any).entries.set(keyToString(oldKey), oldEntry)
    ;(mgr as any).entries.set(keyToString(newKey), newEntry)
    ;(mgr as any).entries.set(keyToString(runningKey), runningEntry)

    assert.equal(mgr.getDebugInfo().entries, 3)

    ;(mgr as any).reapIdle()

    assert.equal(mgr.getDebugInfo().entries, 2)
    assert.ok(!(mgr as any).entries.has(keyToString(oldKey)))
    assert.ok((mgr as any).entries.has(keyToString(newKey)))
    assert.ok((mgr as any).entries.has(keyToString(runningKey)))
  })

  it('does not reap entries still within TTL', () => {
    const mgr = new AcpSessionManager({ idleTimeoutMs: 60_000 })
    const timer = (mgr as any).idleTimer as ReturnType<typeof setInterval> | null
    if (timer) clearInterval(timer)

    const key = mkKey()
    const entry = makeFakeIdleEntry(key)
    entry.lastUsedAt = Date.now() - 30_000 // within 60s TTL

    ;(mgr as any).entries.set(keyToString(key), entry)
    ;(mgr as any).reapIdle()

    assert.equal(mgr.getDebugInfo().entries, 1)
  })
})

// -- 10. LRU eviction --
describe('LRU eviction', () => {
  it('evicts the oldest idle entry when evictLRU is called', () => {
    const mgr = new AcpSessionManager({ poolMax: 4 })
    const timer = (mgr as any).idleTimer as ReturnType<typeof setInterval> | null
    if (timer) clearInterval(timer)

    const oldestKey = mkKey({ routerSessionId: 'sess-oldest' })
    const middleKey = mkKey({ routerSessionId: 'sess-middle' })
    const newestKey = mkKey({ routerSessionId: 'sess-newest' })
    const runningKey = mkKey({ routerSessionId: 'sess-running' })

    const oldestEntry = makeFakeIdleEntry(oldestKey)
    oldestEntry.lastUsedAt = Date.now() - 3000

    const middleEntry = makeFakeIdleEntry(middleKey)
    middleEntry.lastUsedAt = Date.now() - 1000

    const newestEntry = makeFakeIdleEntry(newestKey)
    newestEntry.lastUsedAt = Date.now()

    const runningEntry = makeFakeIdleEntry(runningKey)
    runningEntry.state = 'running'
    runningEntry.currentBinding = { jobId: 'j1' }

    ;(mgr as any).entries.set(keyToString(oldestKey), oldestEntry)
    ;(mgr as any).entries.set(keyToString(middleKey), middleEntry)
    ;(mgr as any).entries.set(keyToString(newestKey), newestEntry)
    ;(mgr as any).entries.set(keyToString(runningKey), runningEntry)

    assert.equal(mgr.getDebugInfo().entries, 4)

    ;(mgr as any).evictLRU()

    assert.equal(mgr.getDebugInfo().entries, 3)
    assert.ok(!(mgr as any).entries.has(keyToString(oldestKey)))
    assert.ok((mgr as any).entries.has(keyToString(middleKey)))
    assert.ok((mgr as any).entries.has(keyToString(newestKey)))
    assert.ok((mgr as any).entries.has(keyToString(runningKey)))
  })

  it('only evicts idle entries, never runs when idle entries exist', () => {
    const mgr = new AcpSessionManager({ poolMax: 2 })
    const timer = (mgr as any).idleTimer as ReturnType<typeof setInterval> | null
    if (timer) clearInterval(timer)

    const idleKey = mkKey({ routerSessionId: 'sess-idle' })
    const runningKey = mkKey({ routerSessionId: 'sess-running' })

    const idleEntry = makeFakeIdleEntry(idleKey)
    idleEntry.lastUsedAt = Date.now()

    const runningEntry = makeFakeIdleEntry(runningKey)
    runningEntry.state = 'running'
    runningEntry.currentBinding = { jobId: 'j1' }
    runningEntry.lastUsedAt = Date.now() - 10000 // older, but running

    ;(mgr as any).entries.set(keyToString(idleKey), idleEntry)
    ;(mgr as any).entries.set(keyToString(runningKey), runningEntry)

    ;(mgr as any).evictLRU()

    // The idle entry should be evicted even though the running entry is older
    assert.ok(!(mgr as any).entries.has(keyToString(idleKey)))
    assert.ok((mgr as any).entries.has(keyToString(runningKey)))
  })

  it('does nothing when no idle entries exist', () => {
    const mgr = new AcpSessionManager()
    const timer = (mgr as any).idleTimer as ReturnType<typeof setInterval> | null
    if (timer) clearInterval(timer)

    const key = mkKey()
    const entry = makeFakeIdleEntry(key)
    entry.state = 'running'
    entry.currentBinding = { jobId: 'j1' }
    ;(mgr as any).entries.set(keyToString(key), entry)

    ;(mgr as any).evictLRU()

    assert.equal(mgr.getDebugInfo().entries, 1)
  })
})

// -- Additional: closeAll and getDebugInfo --
describe('closeAll', () => {
  it('drains all entries and clears the pool', async () => {
    const mgr = new AcpSessionManager()
    const timer = (mgr as any).idleTimer as ReturnType<typeof setInterval> | null
    if (timer) clearInterval(timer)

    const key = mkKey()
    ;(mgr as any).entries.set(keyToString(key), makeFakeIdleEntry(key))

    assert.equal(mgr.getDebugInfo().entries, 1)

    await mgr.closeAll()

    assert.equal(mgr.getDebugInfo().entries, 0)
  })
})

describe('getDebugInfo', () => {
  it('reports entries by state', () => {
    const idleKey = mkKey({ routerSessionId: 'sess-1' })
    const runningKey = mkKey({ routerSessionId: 'sess-2' })

    const runningEntry = makeFakeIdleEntry(runningKey)
    runningEntry.state = 'running'
    runningEntry.currentBinding = { jobId: 'j1' }

    ;(manager as any).entries.set(keyToString(idleKey), makeFakeIdleEntry(idleKey))
    ;(manager as any).entries.set(keyToString(runningKey), runningEntry)

    const info = manager.getDebugInfo()
    assert.equal(info.entries, 2)
    assert.equal(info.entriesByState.idle, 1)
    assert.equal(info.entriesByState.running, 1)
  })

  it('returns zero entries for an empty pool', () => {
    assert.equal(manager.getDebugInfo().entries, 0)
    assert.deepEqual(manager.getDebugInfo().entriesByState, {})
  })
})
