import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  AcpSessionManager,
  buildSessionReuseKey,
  computeExecutionFingerprint,
  computeKeyDigest,
  resetAcpSessionManager,
} from './acp-session-manager.js'
import * as sessionManagerModule from './acp-session-manager.js'
import type { SessionReuseKey, SessionEntryConfig } from './acp-session-manager.js'
import { AcpSessionDriver, type PromptBinding } from './acp-session-driver.js'

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
  return computeKeyDigest(k)
}

function makeFakeIdleEntry(key: SessionReuseKey): any {
  return {
    key,
    state: 'idle',
    proc: { pid: 99999, exitCode: 0, signalCode: null, on: () => {}, stderr: { on: () => {} } },
    driver: {
      prompt: () => Promise.resolve({ ok: true, output: '', stopReason: 'end_turn' }),
      cancel: () => Promise.resolve(),
      close: () => {},
      dispose: () => {},
    },
    agentSessionId: 'fake-sid',
    capabilities: {},
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
    generation: 1,
    summary: 'test',
    currentBinding: null,
    promptQueue: [],
    configOptions: [],
  }
}

function emptyCatalogPort() {
  return {
    lookup: () => undefined,
    listAll: () => [],
    listByRouterSession: () => [],
    listByWorker: () => [],
    upsert: () => {},
    touch: () => {},
    markStale: () => {},
    deleteByKey: () => {},
    deleteByRouterSession: () => {},
    deleteByRouterSessions: () => {},
    deleteByWorker: () => {},
    isAvailable: () => true,
  }
}

describe('installation reference accounting', () => {
  it('combines live and persisted installation references and reports legacy worker ids', () => {
    const port = {
      ...emptyCatalogPort(),
      listAll: () => [
        catalogRecord({
          keyDigest: 'persisted-installation',
          workerId: 'worker-persisted',
          installationId: 'inst_persisted',
          manifestDigest: 'sha256:persisted',
        }),
        catalogRecord({
          keyDigest: 'legacy-session',
          workerId: 'worker-legacy',
        }),
      ],
    }
    const mgr = new AcpSessionManager({ catalogPort: port, catalogRequired: true })
    const timer = (mgr as any).idleTimer as ReturnType<typeof setInterval> | null
    if (timer) clearInterval(timer)
    const liveKey = mkKey({ workerId: 'worker-live' })
    const live = makeFakeIdleEntry(liveKey)
    live.sessionConfig = mkConfig({
      installationId: 'inst_live',
      manifestDigest: 'sha256:live',
    })
    ;(mgr as any).entries.set(keyToString(liveKey), live)

    assert.deepEqual(mgr.listInstallationReferences(), {
      installationIds: ['inst_live', 'inst_persisted'],
      legacyWorkerIds: ['worker-legacy'],
    })
  })

  it('fails closed when the persisted catalog cannot be enumerated', () => {
    const mgr = new AcpSessionManager({
      catalogRequired: true,
      catalogPort: { ...emptyCatalogPort(), listAll: undefined, isAvailable: () => true },
    })
    const timer = (mgr as any).idleTimer as ReturnType<typeof setInterval> | null
    if (timer) clearInterval(timer)
    assert.throws(
      () => mgr.listInstallationReferences(),
      (error: any) => error?.code === 'catalog_repair_required',
    )
  })

  it('still fails closed on an unavailable durable catalog when reuse is disabled', () => {
    const previousReuse = process.env.ACP_SESSION_REUSE
    process.env.ACP_SESSION_REUSE = '0'
    const mgr = new AcpSessionManager({
      catalogRequired: true,
      catalogPort: { ...emptyCatalogPort(), listAll: undefined, isAvailable: () => false },
    })
    const timer = (mgr as any).idleTimer as ReturnType<typeof setInterval> | null
    if (timer) clearInterval(timer)
    try {
      assert.throws(
        () => mgr.listInstallationReferences(),
        (error: any) => error?.code === 'catalog_repair_required',
      )
      assert.throws(
        () => mgr.deleteContextByWorker('worker-unavailable'),
        (error: any) => error?.code === 'catalog_repair_required',
      )
    } finally {
      if (previousReuse === undefined) delete process.env.ACP_SESSION_REUSE
      else process.env.ACP_SESSION_REUSE = previousReuse
    }
  })

  it('accounts for and deletes durable records even when dispatch reuse is disabled', () => {
    const previousReuse = process.env.ACP_SESSION_REUSE
    process.env.ACP_SESSION_REUSE = '0'
    let listAllCalls = 0
    let deletedWorker: string | undefined
    const port = {
      ...emptyCatalogPort(),
      listAll: () => {
        listAllCalls += 1
        return [
          catalogRecord({
            keyDigest: 'reuse-disabled-installation',
            workerId: 'worker-reuse-disabled',
            installationId: 'inst_reuse_disabled',
            manifestDigest: 'sha256:reuse-disabled',
          }),
        ]
      },
      listByWorker: (workerId: string) => [
        catalogRecord({
          keyDigest: 'reuse-disabled-worker',
          workerId,
          installationId: 'inst_reuse_disabled',
        }),
      ],
      deleteByWorker: (workerId: string) => {
        deletedWorker = workerId
      },
    }
    const mgr = new AcpSessionManager({ catalogPort: port, catalogRequired: true })
    const timer = (mgr as any).idleTimer as ReturnType<typeof setInterval> | null
    if (timer) clearInterval(timer)
    try {
      assert.deepEqual(mgr.listInstallationReferences(), {
        installationIds: ['inst_reuse_disabled'],
        legacyWorkerIds: [],
      })
      assert.equal(listAllCalls, 1)

      mgr.deleteContextByWorker('worker-reuse-disabled')
      assert.equal(deletedWorker, 'worker-reuse-disabled')
    } finally {
      if (previousReuse === undefined) delete process.env.ACP_SESSION_REUSE
      else process.env.ACP_SESSION_REUSE = previousReuse
    }
  })

  it('persists installation identity with a newly created ACP session', async () => {
    const originalFactory = AcpSessionDriver.fromChildProcess
    let persisted: any
    ;(AcpSessionDriver as any).fromChildProcess = async () => ({
      initialize: async () => ({ agentCapabilities: {} }),
      get capabilities() {
        return {}
      },
      sessionNew: async () => ({ sessionId: 'installation-session', configOptions: [] }),
      get configOptions() {
        return []
      },
      hasCapability: () => false,
      prompt: async () => ({ ok: true, output: 'ok', stopReason: 'end_turn' }),
      close: () => {},
    })
    const mgr = new AcpSessionManager({
      catalogPort: {
        ...emptyCatalogPort(),
        upsert: (record: unknown) => {
          persisted = record
        },
      },
    })
    const timer = (mgr as any).idleTimer as ReturnType<typeof setInterval> | null
    if (timer) clearInterval(timer)
    try {
      await mgr.enqueuePrompt({
        key: mkKey({ workerId: 'worker-installation' }),
        config: {
          command: process.execPath,
          args: ['-e', 'setInterval(() => {}, 1000)'],
          env: {},
          model: undefined,
          installationId: 'inst_created',
          manifestDigest: 'sha256:created',
        },
        kind: 'custom',
        task: 'create',
        binding: { jobId: 'job-installation', sequence: 0 },
      })
      assert.equal(persisted?.installationId, 'inst_created')
      assert.equal(persisted?.manifestDigest, 'sha256:created')
    } finally {
      await mgr.closeAll()
      ;(AcpSessionDriver as any).fromChildProcess = originalFactory
    }
  })
})

function catalogRecord(overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString()
  return {
    version: 1 as const,
    keyDigest: computeKeyDigest(mkKey()),
    routerSessionId: 'sess-1',
    workerId: 'worker-a',
    canonicalCwd: SAFE_CWD,
    executionFingerprint: mkKey().executionFingerprint,
    agentSessionId: 'private-agent-session-id',
    capabilities: { loadSession: true, resume: true, close: false, delete: false },
    state: 'ready' as const,
    createdAt: now,
    lastUsedAt: now,
    ...overrides,
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
  delete process.env.ACP_SESSION_CANCEL_GRACE_MS
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

  it('falls back for invalid constructor and environment limits', () => {
    process.env.ACP_SESSION_IDLE_MS = '-1'
    process.env.ACP_SESSION_POOL_MAX = 'not-a-number'
    const mgr = new AcpSessionManager({ idleTimeoutMs: 0, poolMax: -4 })
    const timer = (mgr as any).idleTimer as ReturnType<typeof setInterval> | null
    if (timer) clearInterval(timer)

    assert.equal((mgr as any).idleTimeoutMs, 900_000)
    assert.equal((mgr as any).poolMax, 8)
  })

  it('caps timer-backed session limits at the Node timer maximum', () => {
    process.env.ACP_SESSION_IDLE_MS = '999999999999'
    process.env.ACP_SESSION_CANCEL_GRACE_MS = '999999999999'
    const mgr = new AcpSessionManager()
    const timer = (mgr as any).idleTimer as ReturnType<typeof setInterval> | null
    if (timer) clearInterval(timer)

    assert.equal((mgr as any).idleTimeoutMs, 2_147_483_647)
    assert.equal((mgr as any).cancelGraceMs, 2_147_483_647)
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

  it('isolates different Chat roles bound to the same Worker', () => {
    const implementer = buildSessionReuseKey({
      ...baseParams,
      teamMemberId: 'role-implementer',
      teamMemberRevision: 1,
    })
    const reviewer = buildSessionReuseKey({
      ...baseParams,
      teamMemberId: 'role-reviewer',
      teamMemberRevision: 1,
    })

    assert.notDeepEqual(implementer, reviewer)
    assert.notEqual(computeKeyDigest(implementer), computeKeyDigest(reviewer))
  })

  it('invalidates a role session when its execution revision changes', () => {
    const before = buildSessionReuseKey({
      ...baseParams,
      teamMemberId: 'role-implementer',
      teamMemberRevision: 1,
    })
    const after = buildSessionReuseKey({
      ...baseParams,
      teamMemberId: 'role-implementer',
      teamMemberRevision: 2,
    })

    assert.notDeepEqual(before, after)
    assert.notEqual(computeKeyDigest(before), computeKeyDigest(after))
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
  it('keeps spawn-only worker secret values out of fingerprint input', () => {
    let captured: Record<string, string> | undefined
    const secretValue = 'target-worker-secret-value'
    const fingerprint = computeExecutionFingerprint(
      mkConfig({ workerSecrets: { AGENT_API_KEY: secretValue } } as Partial<SessionEntryConfig>),
      (input) => {
        captured = { ...input.explicitEnv }
        return 'stable-test-fingerprint'
      },
    )
    assert.equal(fingerprint, 'stable-test-fingerprint')
    assert.equal(JSON.stringify(captured).includes(secretValue), false)
    assert.equal(captured?.AGENT_API_KEY, undefined)
  })

  it('builds target-process env with only the selected worker secrets', () => {
    const build = (sessionManagerModule as Record<string, unknown>).buildWorkerProcessEnv
    assert.equal(typeof build, 'function')
    const fn = build as (
      config: SessionEntryConfig,
      ambient: Record<string, string | undefined>,
    ) => Record<string, string>
    const selected = fn(
      mkConfig({
        workerSecrets: { AGENT_API_KEY: 'selected-only' },
      } as Partial<SessionEntryConfig>),
      { PATH: '/bin', UNRELATED_API_KEY: 'ambient-secret' },
    )
    const other = fn(mkConfig(), { PATH: '/bin', UNRELATED_API_KEY: 'ambient-secret' })
    assert.equal(selected.AGENT_API_KEY, 'selected-only')
    assert.equal(selected.UNRELATED_API_KEY, undefined)
    assert.equal(other.AGENT_API_KEY, undefined)
  })

  it('changes when installationId or authRevision changes', () => {
    const base = mkConfig()
    const f1 = computeExecutionFingerprint({ ...base, installationId: 'inst_a', authRevision: 0 })
    const f2 = computeExecutionFingerprint({ ...base, installationId: 'inst_b', authRevision: 0 })
    const f3 = computeExecutionFingerprint({ ...base, installationId: 'inst_a', authRevision: 1 })
    assert.notEqual(f1, f2)
    assert.notEqual(f1, f3)
  })

  it('changes when the Registry manifest digest changes', () => {
    const base = mkConfig({ installationId: 'inst_a' })
    const f1 = computeExecutionFingerprint({ ...base, manifestDigest: 'sha256:first' })
    const f2 = computeExecutionFingerprint({ ...base, manifestDigest: 'sha256:second' })
    assert.notEqual(f1, f2)
  })

  it('changes when runtimeProfile or workerSecretRevisionHmac changes', () => {
    const base = mkConfig()
    const f1 = computeExecutionFingerprint({ ...base, runtimeProfile: 'generic-acp' })
    const f2 = computeExecutionFingerprint({ ...base, runtimeProfile: 'opencode' })
    const f3 = computeExecutionFingerprint({
      ...base,
      runtimeProfile: 'generic-acp',
      workerSecretRevisionHmac: 'abc',
    })
    assert.notEqual(f1, f2)
    assert.notEqual(f1, f3)
  })

  it('does not collide when env delimiters appear in keys or values', () => {
    const f1 = computeExecutionFingerprint(mkConfig({ env: { A: 'b|C=d' } }))
    const f2 = computeExecutionFingerprint(mkConfig({ env: { A: 'b', C: 'd' } }))
    assert.notEqual(f1, f2)
  })

  it('is stable across explicit env insertion order', () => {
    const f1 = computeExecutionFingerprint(mkConfig({ env: { B: '2', A: '1' } }))
    const f2 = computeExecutionFingerprint(mkConfig({ env: { A: '1', B: '2' } }))
    assert.equal(f1, f2)
  })

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

// -- P0-2: Stable fingerprint across instances --
describe('stable fingerprint across instances', () => {
  it('delegates to an explicitly supplied fingerprintFn', () => {
    let callCount = 0
    const stableFn = (input: { command: string; args: readonly string[]; model?: string }) => {
      callCount++
      return `stable-${input.command}-${input.args.join('-')}-${input.model}`
    }

    const f = computeExecutionFingerprint(
      mkConfig({ command: 'cmd', args: ['a', 'b'], model: 'm1' }),
      stableFn,
    )
    assert.equal(callCount, 1)
    assert.match(f, /^stable-cmd-a-b-m1$/)
  })

  it('falls back to an in-memory HMAC when no fingerprintFn is supplied', () => {
    const f = computeExecutionFingerprint(mkConfig())
    assert.match(f, /^[0-9a-f]{64}$/)
  })

  it('same fingerprintFn produces same fingerprint across manager instances', () => {
    let callCount = 0
    const stableFn = () => {
      callCount++
      return 'same-fingerprint'
    }
    const cfg = mkConfig()

    const f1 = computeExecutionFingerprint(cfg, stableFn)

    // Simulate process restart: recreate the manager with same fingerprintFn
    resetAcpSessionManager()
    const f2 = computeExecutionFingerprint(cfg, stableFn)

    assert.equal(f1, f2)
    assert.equal(callCount, 2)
  })

  it('computeKeyDigest is stable for identical structured keys', () => {
    const stableFn = () => 'fixed-fp'

    const key1 = buildSessionReuseKey(
      { routerSessionId: 's', workerId: 'w', cwd: SAFE_CWD, config: mkConfig() },
      stableFn,
    )
    const key2 = buildSessionReuseKey(
      { routerSessionId: 's', workerId: 'w', cwd: SAFE_CWD, config: mkConfig() },
      stableFn,
    )
    const d1 = computeKeyDigest(key1)
    const d2 = computeKeyDigest(key2)
    assert.equal(d1, d2)
    assert.match(d1, /^[0-9a-f]{64}$/)
  })

  it('computeKeyDigest always returns a stable SHA-256 digest', () => {
    const key = mkKey()
    const d = computeKeyDigest(key)
    assert.match(d, /^[0-9a-f]{64}$/)
  })

  it('keeps fingerprint providers isolated per manager instance', () => {
    const first = new AcpSessionManager({
      fingerprintFn: () => 'first-fingerprint',
    })
    const second = new AcpSessionManager({
      fingerprintFn: () => 'second-fingerprint',
    })
    try {
      const params = {
        routerSessionId: 'sess-isolated',
        workerId: 'worker-isolated',
        cwd: SAFE_CWD,
        config: mkConfig(),
      }
      assert.equal((first as any).buildReuseKey(params).executionFingerprint, 'first-fingerprint')
      assert.equal((second as any).buildReuseKey(params).executionFingerprint, 'second-fingerprint')
      assert.equal((first as any).buildReuseKey(params).executionFingerprint, 'first-fingerprint')
    } finally {
      void first.closeAll()
      void second.closeAll()
    }
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
      key,
      config,
      kind: 'opencode',
      task: 'task-1',
      binding,
    })
    assert.ok(r1.ok)
    assert.equal(r1.reusedSession, true)
    assert.equal(manager.getDebugInfo().entries, 1)

    const r2 = await manager.enqueuePrompt({
      key,
      config,
      kind: 'opencode',
      task: 'task-2',
      binding: { jobId: 'j2', sequence: 0 },
    })
    assert.ok(r2.ok)
    assert.equal(r2.reusedSession, true)
    assert.equal(manager.getDebugInfo().entries, 1)
  })

  it('keeps role prompts on distinct ACP sessions while sharing one worker process', async () => {
    const originalFactory = AcpSessionDriver.fromChildProcess
    let factoryCalls = 0
    let driverCloseCalls = 0
    let activeSessionId: string | undefined
    let sessionNumber = 0
    const promptedSessionIds: string[] = []
    ;(AcpSessionDriver as any).fromChildProcess = async () => {
      factoryCalls += 1
      return {
        initialize: async () => ({ agentCapabilities: {} }),
        get capabilities() {
          return {}
        },
        sessionNew: async () => {
          activeSessionId = `role-session-${++sessionNumber}`
          return { sessionId: activeSessionId, configOptions: [] }
        },
        get configOptions() {
          return []
        },
        hasCapability: () => false,
        prompt: async (_task: string, _binding: PromptBinding, requestedSessionId?: string) => {
          const sessionId = requestedSessionId ?? activeSessionId
          promptedSessionIds.push(sessionId ?? 'missing')
          return { ok: true, output: sessionId, stopReason: 'end_turn' }
        },
        cancel: async () => {},
        close: () => {
          driverCloseCalls += 1
        },
        dispose: () => {},
      }
    }

    const cfg = mkConfig({
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      model: undefined,
      env: {},
    })
    const writerKey = mkKey({
      workerId: 'shared-worker',
      teamMemberId: 'writer',
      executionFingerprint: computeExecutionFingerprint(cfg),
    })
    const readerKey = mkKey({
      workerId: 'shared-worker',
      teamMemberId: 'reader',
      executionFingerprint: computeExecutionFingerprint(cfg),
    })

    try {
      const writerFirst = await manager.enqueuePrompt({
        key: writerKey,
        config: cfg,
        kind: 'custom',
        task: 'write essay',
        binding: { jobId: 'writer-first', sequence: 0 },
      })
      const readerFirst = await manager.enqueuePrompt({
        key: readerKey,
        config: cfg,
        kind: 'custom',
        task: 'read essay',
        binding: { jobId: 'reader-first', sequence: 0 },
      })
      const [writerFollowUp, readerFollowUp] = await Promise.all([
        manager.enqueuePrompt({
          key: writerKey,
          config: cfg,
          kind: 'custom',
          task: 'what was your previous question?',
          binding: { jobId: 'writer-follow-up', sequence: 0 },
        }),
        manager.enqueuePrompt({
          key: readerKey,
          config: cfg,
          kind: 'custom',
          task: 'what was your previous question?',
          binding: { jobId: 'reader-follow-up', sequence: 0 },
        }),
      ])

      assert.equal(writerFirst.output, 'role-session-1')
      assert.equal(readerFirst.output, 'role-session-2')
      assert.equal(writerFollowUp.output, 'role-session-1')
      assert.equal(readerFollowUp.output, 'role-session-2')
      assert.deepEqual(promptedSessionIds, [
        'role-session-1',
        'role-session-2',
        'role-session-1',
        'role-session-2',
      ])
      assert.equal(factoryCalls, 1)
      assert.equal(manager.getDebugInfo().entries, 2)

      manager.closeLiveByReuseKey(writerKey)
      const readerAfterOwnerClose = await manager.enqueuePrompt({
        key: readerKey,
        config: cfg,
        kind: 'custom',
        task: 'reader still alive',
        binding: { jobId: 'reader-after-owner-close', sequence: 0 },
      })
      assert.equal(driverCloseCalls, 0)
      assert.equal(readerAfterOwnerClose.output, 'role-session-2')
    } finally {
      await manager.closeAll()
      ;(AcpSessionDriver as any).fromChildProcess = originalFactory
    }
  })

  it('shares one worker process across simultaneous cold role starts', async () => {
    const originalFactory = AcpSessionDriver.fromChildProcess
    let factoryCalls = 0
    let sessionNumber = 0
    ;(AcpSessionDriver as any).fromChildProcess = async () => {
      factoryCalls += 1
      await new Promise((resolve) => setTimeout(resolve, 20))
      let activeSessionId: string | undefined
      return {
        initialize: async () => ({ agentCapabilities: {} }),
        get capabilities() {
          return {}
        },
        sessionNew: async () => {
          activeSessionId = `cold-session-${++sessionNumber}`
          return { sessionId: activeSessionId, configOptions: [] }
        },
        get configOptions() {
          return []
        },
        hasCapability: () => false,
        prompt: async (_task: string, _binding: PromptBinding, requestedSessionId?: string) => ({
          ok: true,
          output: requestedSessionId ?? activeSessionId,
          stopReason: 'end_turn',
        }),
        cancel: async () => {},
        close: () => {},
        dispose: () => {},
      }
    }

    const cfg = mkConfig({
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      model: undefined,
      env: {},
    })
    const writerKey = mkKey({
      workerId: 'cold-shared-worker',
      teamMemberId: 'writer',
      executionFingerprint: computeExecutionFingerprint(cfg),
    })
    const readerKey = mkKey({
      workerId: 'cold-shared-worker',
      teamMemberId: 'reader',
      executionFingerprint: computeExecutionFingerprint(cfg),
    })

    try {
      const [writer, reader] = await Promise.all([
        manager.enqueuePrompt({
          key: writerKey,
          config: cfg,
          kind: 'custom',
          task: 'write essay',
          binding: { jobId: 'cold-writer', sequence: 0 },
        }),
        manager.enqueuePrompt({
          key: readerKey,
          config: cfg,
          kind: 'custom',
          task: 'read essay',
          binding: { jobId: 'cold-reader', sequence: 0 },
        }),
      ])

      assert.equal(factoryCalls, 1)
      assert.notEqual(writer.output, reader.output)
      assert.equal(manager.getDebugInfo().entries, 2)
    } finally {
      await manager.closeAll()
      ;(AcpSessionDriver as any).fromChildProcess = originalFactory
    }
  })

  it('releases a failed cold start before a waiting role spawns a replacement', async () => {
    const originalFactory = AcpSessionDriver.fromChildProcess
    let factoryCalls = 0
    let failedDriverClosed = false
    let replacementStartedAfterCleanup = false
    ;(AcpSessionDriver as any).fromChildProcess = async () => {
      factoryCalls += 1
      if (factoryCalls === 1) {
        return {
          initialize: async () => {
            await new Promise((resolve) => setTimeout(resolve, 20))
            throw new Error('initialization failed')
          },
          sessionNew: async () => {
            throw new Error('failed driver must not be reused')
          },
          hasCapability: () => false,
          close: () => {
            failedDriverClosed = true
          },
          dispose: () => {},
        }
      }
      replacementStartedAfterCleanup = failedDriverClosed
      let activeSessionId: string | undefined
      return {
        initialize: async () => ({ agentCapabilities: {} }),
        get capabilities() {
          return {}
        },
        sessionNew: async () => {
          activeSessionId = 'replacement-session'
          return { sessionId: activeSessionId, configOptions: [] }
        },
        get configOptions() {
          return []
        },
        hasCapability: () => false,
        prompt: async () => ({
          ok: true,
          output: activeSessionId,
          stopReason: 'end_turn',
        }),
        cancel: async () => {},
        close: () => {},
        dispose: () => {},
      }
    }

    const cfg = mkConfig({
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      model: undefined,
      env: {},
    })
    const firstKey = mkKey({
      workerId: 'cold-failure-worker',
      teamMemberId: 'first',
      executionFingerprint: computeExecutionFingerprint(cfg),
    })
    const waitingKey = mkKey({
      workerId: 'cold-failure-worker',
      teamMemberId: 'waiting',
      executionFingerprint: computeExecutionFingerprint(cfg),
    })

    try {
      const results = await Promise.allSettled([
        manager.enqueuePrompt({
          key: firstKey,
          config: cfg,
          kind: 'custom',
          task: 'first',
          binding: { jobId: 'cold-failure-first', sequence: 0 },
        }),
        manager.enqueuePrompt({
          key: waitingKey,
          config: cfg,
          kind: 'custom',
          task: 'waiting',
          binding: { jobId: 'cold-failure-waiting', sequence: 0 },
        }),
      ])

      assert.equal(results[0].status, 'rejected')
      assert.equal(results[1].status, 'fulfilled')
      assert.equal(factoryCalls, 2)
      assert.equal(replacementStartedAfterCleanup, true)
    } finally {
      await manager.closeAll()
      ;(AcpSessionDriver as any).fromChildProcess = originalFactory
    }
  })

  it('evicts a live connection after a transport-level prompt failure', async () => {
    const key = mkKey()
    const entry = makeFakeIdleEntry(key)
    let closed = 0
    entry.driver.prompt = async () => ({
      ok: false,
      output: 'partial',
      error: 'connection closed',
    })
    entry.driver.close = () => {
      closed += 1
    }
    ;(manager as any).entries.set(keyToString(key), entry)

    const result = await manager.enqueuePrompt({
      key,
      config: mkConfig(),
      kind: 'custom',
      task: 'continue',
      binding: { jobId: 'job-transport-failure', sequence: 0 },
    })

    assert.equal(result.ok, false)
    assert.equal(result.error, 'ACP agent failed while processing the task: connection closed')
    assert.equal(manager.getDebugInfo().entries, 0)
    assert.equal(closed, 1)
  })

  it('evicts every shared role after a common transport failure', async () => {
    const ownerKey = mkKey({ workerId: 'transport-worker', teamMemberId: 'owner' })
    const siblingKey = mkKey({ workerId: 'transport-worker', teamMemberId: 'sibling' })
    const owner = makeFakeIdleEntry(ownerKey)
    const sibling = makeFakeIdleEntry(siblingKey)
    const driver = owner.driver
    driver.prompt = async () => ({ ok: false, output: '', error: 'connection closed' })
    sibling.driver = driver
    sibling.proc = owner.proc
    sibling._sharesProcess = true
    const processGroup = {
      proc: owner.proc,
      driver,
      entries: new Set([owner, sibling]),
    }
    owner._processGroup = processGroup
    sibling._processGroup = processGroup
    ;(manager as any).entries.set(keyToString(ownerKey), owner)
    ;(manager as any).entries.set(keyToString(siblingKey), sibling)

    const result = await manager.enqueuePrompt({
      key: ownerKey,
      config: mkConfig(),
      kind: 'custom',
      task: 'trigger transport failure',
      binding: { jobId: 'transport-failure', sequence: 0 },
    })

    assert.equal(result.ok, false)
    assert.equal(manager.getDebugInfo().entries, 0)
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
    fakeEntry.driver.prompt = () => {
      callCount++
      if (callCount === 1) {
        return new Promise((resolve) => {
          resolveFirst = resolve
        })
      }
      return Promise.resolve({ ok: true, output: '', stopReason: 'end_turn' })
    }

    ;(manager as any).entries.set(ks, fakeEntry)

    const p1 = manager.enqueuePrompt({
      key,
      config,
      kind: 'opencode',
      task: 'task-1',
      binding: { jobId: 'j1', sequence: 0 },
    })

    await new Promise((r) => setTimeout(r, 50))
    assert.equal(fakeEntry.state, 'running')

    const p2 = manager.enqueuePrompt({
      key,
      config,
      kind: 'opencode',
      task: 'task-2',
      binding: { jobId: 'j2', sequence: 0 },
    })
    assert.equal(fakeEntry.promptQueue.length, 1)

    resolveFirst({ ok: true, output: '', stopReason: 'end_turn' })
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
    fakeEntry.driver.prompt = () => {
      callCount++
      if (callCount === 1) {
        return new Promise((resolve) => {
          resolveFirst = resolve
        })
      }
      return Promise.resolve({ ok: true, output: '', stopReason: 'end_turn' })
    }

    ;(manager as any).entries.set(ks, fakeEntry)

    const p1 = manager.enqueuePrompt({
      key,
      config,
      kind: 'opencode',
      task: 'task-1',
      binding: { jobId: 'j1', sequence: 0 },
    })

    await new Promise((r) => setTimeout(r, 50))
    const p2 = manager.enqueuePrompt({
      key,
      config,
      kind: 'opencode',
      task: 'task-2',
      binding: { jobId: 'j2', sequence: 0 },
    })

    resolveFirst({ ok: true, output: '', stopReason: 'end_turn' })
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
    ;(mgr as any).createAndExecute = () => {
      throw new Error('no-spawn')
    }

    await mgr
      .enqueuePrompt({
        key,
        config: mkConfig(),
        kind: 'opencode',
        task: 't',
        binding: { jobId: 'j1', sequence: 0 },
      })
      .catch(() => {})

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
      key,
      config,
      kind: 'opencode',
      task: 'task-1',
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
      key,
      config,
      kind: 'opencode',
      task: 'task-2',
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

  it('evicts a session when an aborted agent races back with success', async () => {
    const key = mkKey()
    const entry = makeFakeIdleEntry(key)
    let resolvePrompt!: (result: { ok: boolean; output: string; stopReason: string }) => void
    entry.driver.prompt = () =>
      new Promise((resolve) => {
        resolvePrompt = resolve
      })
    ;(manager as any).entries.set(keyToString(key), entry)

    const abort = new AbortController()
    const pending = (manager as any).executePrompt(
      entry,
      'task',
      { jobId: 'job-abort-race', sequence: 0, signal: abort.signal },
      true,
      'live_reused',
    )
    await Promise.resolve()
    abort.abort()
    resolvePrompt({ ok: true, output: 'late output', stopReason: 'end_turn' })

    const result = await pending
    assert.equal(result.ok, false)
    assert.equal(result.error, 'Cancelled')
    assert.equal(result.stopReason, 'cancelled')
    assert.equal(result.output, 'late output')
    assert.equal(manager.getDebugInfo().entries, 0)
  })

  it('bounds cancellation when the ACP prompt never settles', async () => {
    const key = mkKey()
    const mgr = new AcpSessionManager({ cancelGraceMs: 10 })
    const timer = (mgr as any).idleTimer as ReturnType<typeof setInterval> | null
    if (timer) clearInterval(timer)
    const entry = makeFakeIdleEntry(key)
    entry.driver.partialOutput = 'partial before cancellation'
    entry.driver.partialOutputFor = () => 'partial before cancellation'
    entry.driver.prompt = () => new Promise(() => {})
    ;(mgr as any).entries.set(keyToString(key), entry)

    const abort = new AbortController()
    const pending = (mgr as any).executePrompt(
      entry,
      'task',
      { jobId: 'job-never-settles', sequence: 0, signal: abort.signal },
      true,
      'live_reused',
    )
    abort.abort()

    const result = await Promise.race([
      pending,
      new Promise<'deadline-missed'>((resolve) => {
        setTimeout(() => resolve('deadline-missed'), 100)
      }),
    ])
    assert.notEqual(result, 'deadline-missed')
    if (result === 'deadline-missed') return
    assert.equal(result.ok, false)
    assert.equal(result.error, 'Cancelled')
    assert.equal(result.output, 'partial before cancellation')
    assert.equal(mgr.getDebugInfo().entries, 0)
  })

  it('does not return sibling partial output when cancelling a driver-queued role', async () => {
    const key = mkKey({ teamMemberId: 'queued-reader' })
    const mgr = new AcpSessionManager({ cancelGraceMs: 10 })
    const timer = (mgr as any).idleTimer as ReturnType<typeof setInterval> | null
    if (timer) clearInterval(timer)
    const entry = makeFakeIdleEntry(key)
    entry.driver.partialOutput = 'private writer output'
    entry.driver.partialOutputFor = () => ''
    entry.driver.prompt = () => new Promise(() => {})
    ;(mgr as any).entries.set(keyToString(key), entry)

    const abort = new AbortController()
    const pending = (mgr as any).executePrompt(
      entry,
      'reader task',
      { jobId: 'queued-reader', sequence: 0, signal: abort.signal },
      true,
      'live_reused',
    )
    abort.abort()

    const result = await pending
    assert.equal(result.ok, false)
    assert.equal(result.error, 'Cancelled')
    assert.equal(result.output, '')
  })

  it('isolates session-ready observer failures from the agent prompt', async () => {
    const key = mkKey()
    const activities: string[] = []
    const mgr = new AcpSessionManager({
      onActivity: (event) => {
        activities.push(event)
      },
    })
    const timer = (mgr as any).idleTimer as ReturnType<typeof setInterval> | null
    if (timer) clearInterval(timer)
    const entry = makeFakeIdleEntry(key)
    ;(mgr as any).entries.set(keyToString(key), entry)

    const result = await (mgr as any).executePrompt(
      entry,
      'task',
      {
        jobId: 'job-observer-failure',
        sequence: 0,
        onSessionReady: () => {
          throw new Error('private observer failure')
        },
      },
      true,
      'live_reused',
    )

    assert.equal(result.ok, true)
    assert.equal(entry.state, 'idle')
    assert.equal(mgr.getDebugInfo().entries, 1)
    assert.deepEqual(activities, ['session_ready_observer_failed'])
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
      key: key3,
      config: mkConfig(),
      kind: 'opencode',
      task: 'task',
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

// -- 7. closeLiveByRouterSession --
describe('closeByRouterSession', () => {
  it('removes all entries for the given routerSessionId', () => {
    const keyA1 = mkKey({ routerSessionId: 'sess-A', workerId: 'w1' })
    const keyA2 = mkKey({ routerSessionId: 'sess-A', workerId: 'w2' })
    const keyB = mkKey({ routerSessionId: 'sess-B' })

    ;(manager as any).entries.set(keyToString(keyA1), makeFakeIdleEntry(keyA1))
    ;(manager as any).entries.set(keyToString(keyA2), makeFakeIdleEntry(keyA2))
    ;(manager as any).entries.set(keyToString(keyB), makeFakeIdleEntry(keyB))

    assert.equal(manager.getDebugInfo().entries, 3)

    manager.closeLiveByRouterSession('sess-A')

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
        task: 't',
        binding: { jobId: 'j2', sequence: 0 },
        resolve: () => {},
        reject,
      })
    })

    manager.closeLiveByRouterSession(key.routerSessionId)

    assert.rejects(qPromise, /closed by router session/i)
  })

  it('cannot resurrect or delete a replacement entry when startup closes concurrently', async () => {
    const key = mkKey()
    const keyStr = keyToString(key)
    const originalFactory = AcpSessionDriver.fromChildProcess
    let factorySeen!: () => void
    const seen = new Promise<void>((resolve) => {
      factorySeen = resolve
    })
    let finishInitialize!: () => void
    const initialize = new Promise<void>((resolve) => {
      finishInitialize = resolve
    })
    let sessionNewCalls = 0
    let promptCalls = 0
    let closeCalls = 0
    ;(AcpSessionDriver as any).fromChildProcess = async () => {
      factorySeen()
      return {
        initialize: async () => {
          await initialize
          return { agentCapabilities: {} }
        },
        get capabilities() {
          return {}
        },
        sessionNew: async () => {
          sessionNewCalls += 1
          return { sessionId: 'must-not-be-created', configOptions: [] }
        },
        get configOptions() {
          return []
        },
        prompt: async () => {
          promptCalls += 1
          return { ok: true, output: '', stopReason: 'end_turn' }
        },
        hasCapability: () => false,
        close: () => {
          closeCalls += 1
        },
      }
    }

    const mgr = new AcpSessionManager()
    const timer = (mgr as any).idleTimer as ReturnType<typeof setInterval> | null
    if (timer) clearInterval(timer)
    try {
      const pending = mgr.enqueuePrompt({
        key,
        config: {
          command: process.execPath,
          args: ['-e', 'setInterval(() => {}, 1000)'],
          env: {},
          model: undefined,
        },
        kind: 'custom',
        task: 'must not run',
        binding: { jobId: 'job-startup-close', sequence: 0 },
      })
      pending.catch(() => {})
      await seen

      mgr.closeLiveByRouterSession(key.routerSessionId)
      const replacement = makeFakeIdleEntry(key)
      ;(mgr as any).entries.set(keyStr, replacement)
      finishInitialize()

      await assert.rejects(pending, /closed during startup/i)
      assert.equal((mgr as any).entries.get(keyStr), replacement)
      assert.equal(sessionNewCalls, 0)
      assert.equal(promptCalls, 0)
      assert.ok(closeCalls >= 1)
    } finally {
      ;(AcpSessionDriver as any).fromChildProcess = originalFactory
      await mgr.closeAll()
    }
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

// -- 11. Lifecycle: closeLiveByRouterSession (rename of closeByRouterSession) --
describe('closeLiveByRouterSession', () => {
  it('removes all live entries for the given routerSessionId, no catalog effect', () => {
    const keyA1 = mkKey({ routerSessionId: 'sess-A', workerId: 'w1' })
    const keyA2 = mkKey({ routerSessionId: 'sess-A', workerId: 'w2' })
    const keyB = mkKey({ routerSessionId: 'sess-B' })

    ;(manager as any).entries.set(keyToString(keyA1), makeFakeIdleEntry(keyA1))
    ;(manager as any).entries.set(keyToString(keyA2), makeFakeIdleEntry(keyA2))
    ;(manager as any).entries.set(keyToString(keyB), makeFakeIdleEntry(keyB))

    assert.equal(manager.getDebugInfo().entries, 3)

    manager.closeLiveByRouterSession('sess-A')

    assert.equal(manager.getDebugInfo().entries, 1)
    assert.ok((manager as any).entries.has(keyToString(keyB)))
    assert.ok(!(manager as any).entries.has(keyToString(keyA1)))
    assert.ok(!(manager as any).entries.has(keyToString(keyA2)))
  })

  it('rejects queued prompts for closed live entries', () => {
    const key = mkKey()
    const fakeEntry = makeFakeIdleEntry(key)
    fakeEntry.state = 'running'
    fakeEntry.currentBinding = { jobId: 'j1' }
    ;(manager as any).entries.set(keyToString(key), fakeEntry)

    const qPromise = new Promise<void>((_resolve, reject) => {
      fakeEntry.promptQueue.push({
        task: 't',
        binding: { jobId: 'j2', sequence: 0 },
        resolve: () => {},
        reject,
      })
    })

    manager.closeLiveByRouterSession(key.routerSessionId)

    assert.rejects(qPromise, /closed by router session/i)
  })
})

// -- 11b. Lifecycle: closeLiveByReuseKey --
describe('closeLiveByReuseKey', () => {
  it('closes only the specific entry, not other entries in the same router session', () => {
    const keyA1 = mkKey({ routerSessionId: 'sess-A', workerId: 'w1' })
    const keyA2 = mkKey({ routerSessionId: 'sess-A', workerId: 'w2' })
    const keyB = mkKey({ routerSessionId: 'sess-B' })

    ;(manager as any).entries.set(keyToString(keyA1), makeFakeIdleEntry(keyA1))
    ;(manager as any).entries.set(keyToString(keyA2), makeFakeIdleEntry(keyA2))
    ;(manager as any).entries.set(keyToString(keyB), makeFakeIdleEntry(keyB))

    assert.equal(manager.getDebugInfo().entries, 3)

    manager.closeLiveByReuseKey(keyA1)

    assert.equal(manager.getDebugInfo().entries, 2)
    assert.ok(!(manager as any).entries.has(keyToString(keyA1)), 'keyA1 should be removed')
    assert.ok(
      (manager as any).entries.has(keyToString(keyA2)),
      'keyA2 (same session) should remain',
    )
    assert.ok((manager as any).entries.has(keyToString(keyB)), 'keyB should remain')
  })

  it('does not close the common driver when removing a shared-process entry', () => {
    const key = mkKey({ teamMemberId: 'shared-role' })
    const entry = makeFakeIdleEntry(key)
    let driverCloseCalls = 0
    entry._sharesProcess = true
    entry.driver.close = () => {
      driverCloseCalls += 1
    }
    ;(manager as any).entries.set(keyToString(key), entry)

    manager.closeLiveByReuseKey(key)

    assert.equal(driverCloseCalls, 0)
    assert.equal(manager.getDebugInfo().entries, 0)
  })

  it('rejects queued prompts for the closed entry only', () => {
    const keyA = mkKey({ routerSessionId: 'sess-A', workerId: 'w1' })
    const keyA2 = mkKey({ routerSessionId: 'sess-A', workerId: 'w2' })

    const fakeEntryA = makeFakeIdleEntry(keyA)
    fakeEntryA.state = 'running'
    fakeEntryA.currentBinding = { jobId: 'j1' }
    ;(manager as any).entries.set(keyToString(keyA), fakeEntryA)

    const fakeEntryA2 = makeFakeIdleEntry(keyA2)
    fakeEntryA2.state = 'running'
    fakeEntryA2.currentBinding = { jobId: 'j2' }
    ;(manager as any).entries.set(keyToString(keyA2), fakeEntryA2)

    const qReject1 = new Promise<void>((_resolve, reject) => {
      fakeEntryA.promptQueue.push({
        task: 't',
        binding: { jobId: 'j3', sequence: 0 },
        resolve: () => {},
        reject,
      })
    })
    const qReject2 = new Promise<void>((_resolve, reject) => {
      fakeEntryA2.promptQueue.push({
        task: 't2',
        binding: { jobId: 'j4', sequence: 0 },
        resolve: () => {},
        reject,
      })
    })

    manager.closeLiveByReuseKey(keyA)

    assert.rejects(qReject1, /closed by router session/i)
    // qReject2 should NOT be rejected - resolve it manually
    assert.ok((manager as any).entries.has(keyToString(keyA2)), 'other entry should remain')
  })

  it('is a no-op when the key does not exist', () => {
    const key = mkKey()
    manager.closeLiveByReuseKey(key)
    // Should not throw
    assert.equal(manager.getDebugInfo().entries, 0)
  })
})

// -- 12. Lifecycle: deleteContextByRouterSession --
describe('deleteContextByRouterSession', () => {
  it('closes live entries AND calls catalog deleteByRouterSession', () => {
    let catalogDeleteCalled = false
    let catalogDeleteArg: string | undefined
    const mockCatalog = {
      ...emptyCatalogPort(),
      lookup: () => undefined,
      upsert: () => {},
      markStale: () => {},
      deleteByKey: () => {},
      deleteByRouterSession: (id: string) => {
        catalogDeleteCalled = true
        catalogDeleteArg = id
      },
      deleteByWorker: () => {},
      isAvailable: () => true,
    }
    manager.setCatalogPort(mockCatalog)

    const keyA = mkKey({ routerSessionId: 'sess-A', workerId: 'w1' })
    ;(manager as any).entries.set(keyToString(keyA), makeFakeIdleEntry(keyA))

    manager.deleteContextByRouterSession('sess-A')

    assert.equal(manager.getDebugInfo().entries, 0)
    assert.ok(catalogDeleteCalled)
    assert.equal(catalogDeleteArg, 'sess-A')
  })

  it('catalog unavailable fails closed after live entries are closed', () => {
    const mockCatalog = {
      ...emptyCatalogPort(),
      lookup: () => undefined,
      upsert: () => {},
      markStale: () => {},
      deleteByKey: () => {},
      deleteByRouterSession: () => {
        throw new Error('unavailable')
      },
      deleteByWorker: () => {},
      isAvailable: () => false,
    }
    manager.setCatalogPort(mockCatalog)

    const keyA = mkKey({ routerSessionId: 'sess-A' })
    ;(manager as any).entries.set(keyToString(keyA), makeFakeIdleEntry(keyA))
    assert.equal(manager.getDebugInfo().entries, 1)

    assert.throws(
      () => manager.deleteContextByRouterSession('sess-A'),
      (error: any) => error?.code === 'catalog_repair_required',
    )

    assert.equal(manager.getDebugInfo().entries, 0)
  })
})

// -- 13. Lifecycle: deleteContextByWorker --
describe('deleteContextByWorker', () => {
  it('closes live entries AND calls catalog deleteByWorker', () => {
    let catalogDeleteCalled = false
    let catalogDeleteArg: string | undefined
    const mockCatalog = {
      ...emptyCatalogPort(),
      lookup: () => undefined,
      upsert: () => {},
      markStale: () => {},
      deleteByKey: () => {},
      deleteByRouterSession: () => {},
      deleteByWorker: (id: string) => {
        catalogDeleteCalled = true
        catalogDeleteArg = id
      },
      isAvailable: () => true,
    }
    manager.setCatalogPort(mockCatalog)

    const keyA = mkKey({ workerId: 'worker-x', routerSessionId: 'sess-1' })
    const keyB = mkKey({ workerId: 'worker-x', routerSessionId: 'sess-2' })
    ;(manager as any).entries.set(keyToString(keyA), makeFakeIdleEntry(keyA))
    ;(manager as any).entries.set(keyToString(keyB), makeFakeIdleEntry(keyB))

    manager.deleteContextByWorker('worker-x')

    assert.equal(manager.getDebugInfo().entries, 0)
    assert.ok(catalogDeleteCalled)
    assert.equal(catalogDeleteArg, 'worker-x')
  })

  it('catalog unavailable fails closed after live entries are closed', () => {
    const mockCatalog = {
      ...emptyCatalogPort(),
      lookup: () => undefined,
      upsert: () => {},
      markStale: () => {},
      deleteByKey: () => {},
      deleteByRouterSession: () => {},
      deleteByWorker: () => {
        throw new Error('unavailable')
      },
      isAvailable: () => false,
    }
    manager.setCatalogPort(mockCatalog)

    const keyA = mkKey({ workerId: 'worker-x' })
    ;(manager as any).entries.set(keyToString(keyA), makeFakeIdleEntry(keyA))
    assert.equal(manager.getDebugInfo().entries, 1)

    assert.throws(
      () => manager.deleteContextByWorker('worker-x'),
      (error: any) => error?.code === 'catalog_repair_required',
    )

    assert.equal(manager.getDebugInfo().entries, 0)
  })
})

// -- 14. Lifecycle: deleteContextByProject --
describe('deleteContextByProject', () => {
  it('closes live entries AND deletes all project sessions in one catalog mutation', () => {
    const deleteCalls: string[][] = []
    const mockCatalog = {
      ...emptyCatalogPort(),
      lookup: () => undefined,
      upsert: () => {},
      markStale: () => {},
      deleteByKey: () => {},
      deleteByRouterSessions: (ids: string[]) => {
        deleteCalls.push(ids)
      },
      deleteByWorker: () => {},
      isAvailable: () => true,
    }
    manager.setCatalogPort(mockCatalog)

    const keyA = mkKey({ routerSessionId: 'sess-A', workerId: 'w1' })
    const keyB = mkKey({ routerSessionId: 'sess-B', workerId: 'w2' })
    ;(manager as any).entries.set(keyToString(keyA), makeFakeIdleEntry(keyA))
    ;(manager as any).entries.set(keyToString(keyB), makeFakeIdleEntry(keyB))
    manager.setSessionProject('sess-A', 'proj-1')
    manager.setSessionProject('sess-B', 'proj-1')

    manager.deleteContextByProject('proj-1')

    assert.equal(manager.getDebugInfo().entries, 0)
    assert.deepEqual(deleteCalls, [['sess-A', 'sess-B']])
  })

  it('does not affect entries from other projects', () => {
    const mockCatalog = {
      ...emptyCatalogPort(),
      lookup: () => undefined,
      upsert: () => {},
      markStale: () => {},
      deleteByKey: () => {},
      deleteByRouterSession: () => {},
      deleteByWorker: () => {},
      isAvailable: () => true,
    }
    manager.setCatalogPort(mockCatalog)

    const keyIn = mkKey({ routerSessionId: 'sess-A' })
    const keyOut = mkKey({ routerSessionId: 'sess-B' })
    ;(manager as any).entries.set(keyToString(keyIn), makeFakeIdleEntry(keyIn))
    ;(manager as any).entries.set(keyToString(keyOut), makeFakeIdleEntry(keyOut))
    manager.setSessionProject('sess-A', 'proj-1')

    manager.deleteContextByProject('proj-1')

    assert.equal(manager.getDebugInfo().entries, 1)
    assert.ok((manager as any).entries.has(keyToString(keyOut)))
  })
})

// -- 15. Lifecycle: closeAll preserves catalog --
describe('closeAll catalog preservation', () => {
  it('closeAll clears live entries but does NOT touch catalog', async () => {
    let catalogTouched = false
    const mockCatalog = {
      ...emptyCatalogPort(),
      lookup: () => undefined,
      upsert: () => {},
      markStale: () => {},
      deleteByKey: () => {
        catalogTouched = true
      },
      deleteByRouterSession: () => {
        catalogTouched = true
      },
      deleteByWorker: () => {
        catalogTouched = true
      },
      isAvailable: () => true,
    }
    manager.setCatalogPort(mockCatalog)

    const key = mkKey()
    ;(manager as any).entries.set(keyToString(key), makeFakeIdleEntry(key))
    assert.equal(manager.getDebugInfo().entries, 1)

    await manager.closeAll()

    assert.equal(manager.getDebugInfo().entries, 0)
    assert.ok(!catalogTouched)
  })
})

// -- 16. Lifecycle: TTL idle reap preserves catalog --
describe('TTL idle reap catalog preservation', () => {
  it('TTL closes live entry, catalog untouched', () => {
    let catalogTouched = false
    const mockCatalog = {
      ...emptyCatalogPort(),
      lookup: () => undefined,
      upsert: () => {},
      markStale: () => {},
      deleteByKey: () => {
        catalogTouched = true
      },
      deleteByRouterSession: () => {
        catalogTouched = true
      },
      deleteByWorker: () => {
        catalogTouched = true
      },
      isAvailable: () => true,
    }
    const mgr = new AcpSessionManager({ idleTimeoutMs: 100 })
    const timer = (mgr as any).idleTimer as ReturnType<typeof setInterval> | null
    if (timer) clearInterval(timer)
    mgr.setCatalogPort(mockCatalog)

    const oldKey = mkKey({ routerSessionId: 'sess-old' })
    const newKey = mkKey({ routerSessionId: 'sess-new' })

    const oldEntry = makeFakeIdleEntry(oldKey)
    oldEntry.lastUsedAt = Date.now() - 10_000
    const newEntry = makeFakeIdleEntry(newKey)
    newEntry.lastUsedAt = Date.now()

    ;(mgr as any).entries.set(keyToString(oldKey), oldEntry)
    ;(mgr as any).entries.set(keyToString(newKey), newEntry)
    assert.equal(mgr.getDebugInfo().entries, 2)

    ;(mgr as any).reapIdle()

    assert.equal(mgr.getDebugInfo().entries, 1)
    assert.ok(!(mgr as any).entries.has(keyToString(oldKey)))
    assert.ok((mgr as any).entries.has(keyToString(newKey)))
    assert.ok(!catalogTouched)
  })
})

// -- 17. Lifecycle: LRU evict preserves catalog --
describe('LRU evict catalog preservation', () => {
  it('LRU evict closes live entry, catalog untouched', () => {
    let catalogTouched = false
    const mockCatalog = {
      ...emptyCatalogPort(),
      lookup: () => undefined,
      upsert: () => {},
      markStale: () => {},
      deleteByKey: () => {
        catalogTouched = true
      },
      deleteByRouterSession: () => {
        catalogTouched = true
      },
      deleteByWorker: () => {
        catalogTouched = true
      },
      isAvailable: () => true,
    }
    manager.setCatalogPort(mockCatalog)

    const oldestKey = mkKey({ routerSessionId: 'sess-oldest' })
    const newestKey = mkKey({ routerSessionId: 'sess-newest' })

    const oldestEntry = makeFakeIdleEntry(oldestKey)
    oldestEntry.lastUsedAt = Date.now() - 3000
    const newestEntry = makeFakeIdleEntry(newestKey)
    newestEntry.lastUsedAt = Date.now()

    ;(manager as any).entries.set(keyToString(oldestKey), oldestEntry)
    ;(manager as any).entries.set(keyToString(newestKey), newestEntry)

    ;(manager as any).evictLRU()

    assert.equal(manager.getDebugInfo().entries, 1)
    assert.ok(!(manager as any).entries.has(keyToString(oldestKey)))
    assert.ok((manager as any).entries.has(keyToString(newestKey)))
    assert.ok(!catalogTouched)
  })
})

// -- P0-1: enqueuePrompt routes through openAndBind when catalog is available --
describe('P0-1: enqueuePrompt with catalog routes through openAndBind', () => {
  it('routes through openAndBind when catalog is available and reuse is enabled', async () => {
    let openAndBindCalled = false
    const mockCatalog = {
      ...emptyCatalogPort(),
      lookup: () => undefined,
      upsert: () => {},
      markStale: () => {},
      deleteByKey: () => {},
      deleteByRouterSession: () => {},
      deleteByWorker: () => {},
      isAvailable: () => true,
    }
    const mgr = new AcpSessionManager({ poolMax: 4, catalogPort: mockCatalog })
    const timer = (mgr as any).idleTimer as ReturnType<typeof setInterval> | null
    if (timer) clearInterval(timer)

    const origOpenAndBind = mgr.openAndBind.bind(mgr)
    mgr.openAndBind = async function (req: any, onReady?: any) {
      openAndBindCalled = true
      return origOpenAndBind(req, onReady).catch((_e: any) => ({
        ok: false,
        error: 'simulated',
        reusedSession: false,
      }))
    }

    await mgr.enqueuePrompt({
      key: mkKey(),
      config: mkConfig(),
      kind: 'opencode',
      task: 'test',
      binding: { jobId: 'j1', sequence: 0 },
    })

    assert.ok(
      openAndBindCalled,
      'enqueuePrompt should route to openAndBind when catalog is available',
    )
  })

  it('does not route through openAndBind when catalog is not available', async () => {
    let openAndBindCalled = false
    const mockCatalog = {
      ...emptyCatalogPort(),
      lookup: () => undefined,
      upsert: () => {},
      markStale: () => {},
      deleteByKey: () => {},
      deleteByRouterSession: () => {},
      deleteByWorker: () => {},
      isAvailable: () => false,
    }
    const mgr = new AcpSessionManager({ poolMax: 4, catalogPort: mockCatalog })
    const timer = (mgr as any).idleTimer as ReturnType<typeof setInterval> | null
    if (timer) clearInterval(timer)

    const origOpenAndBind = mgr.openAndBind.bind(mgr)
    mgr.openAndBind = async function (req: any, onReady?: any) {
      openAndBindCalled = true
      return origOpenAndBind(req, onReady).catch((_e: any) => ({
        ok: false,
        error: 'simulated',
        reusedSession: false,
      }))
    }

    await assert.rejects(
      () =>
        mgr.enqueuePrompt({
          key: mkKey(),
          config: mkConfig(),
          kind: 'opencode',
          task: 'test',
          binding: { jobId: 'j1', sequence: 0 },
        }),
      (error: any) => error?.code === 'catalog_repair_required',
    )

    assert.ok(
      !openAndBindCalled,
      'enqueuePrompt should NOT route to openAndBind when catalog is unavailable',
    )
  })
})

// -- P0-4a: Catalog unavailable rejects dispatch --
describe('P0-4a: catalog unavailable rejects dispatch', () => {
  it('rejects with a typed public error when required runtime dependencies are absent', async () => {
    const mgr = new AcpSessionManager({ poolMax: 4, catalogRequired: true })
    const timer = (mgr as any).idleTimer as ReturnType<typeof setInterval> | null
    if (timer) clearInterval(timer)

    await assert.rejects(
      () =>
        mgr.enqueuePrompt({
          key: mkKey(),
          config: mkConfig(),
          kind: 'opencode',
          task: 'test',
          binding: { jobId: 'j1', sequence: 0 },
        }),
      (error: any) =>
        error?.code === 'acp_runtime_not_configured' &&
        /restart the application/i.test(error?.publicMessage),
    )
  })

  it('rejects with catalog_repair_required when catalog is configured but unavailable', async () => {
    const mockCatalog = {
      ...emptyCatalogPort(),
      lookup: () => undefined,
      upsert: () => {},
      markStale: () => {},
      deleteByKey: () => {},
      deleteByRouterSession: () => {},
      deleteByWorker: () => {},
      isAvailable: () => false,
    }
    const mgr = new AcpSessionManager({ poolMax: 4, catalogPort: mockCatalog })
    const timer = (mgr as any).idleTimer as ReturnType<typeof setInterval> | null
    if (timer) clearInterval(timer)

    await assert.rejects(
      () =>
        mgr.enqueuePrompt({
          key: mkKey(),
          config: mkConfig(),
          kind: 'opencode',
          task: 'test',
          binding: { jobId: 'j1', sequence: 0 },
        }),
      (error: any) =>
        error?.code === 'catalog_repair_required' &&
        /storage is unavailable/i.test(error?.publicMessage),
    )
  })

  it('does not reject when catalog is available', async () => {
    const mockCatalog = {
      ...emptyCatalogPort(),
      lookup: () => undefined,
      upsert: () => {},
      markStale: () => {},
      deleteByKey: () => {},
      deleteByRouterSession: () => {},
      deleteByWorker: () => {},
      isAvailable: () => true,
    }
    const mgr = new AcpSessionManager({ poolMax: 4, catalogPort: mockCatalog })
    const timer = (mgr as any).idleTimer as ReturnType<typeof setInterval> | null
    if (timer) clearInterval(timer)

    // Will fail because openAndBind tries to spawn, but should not be catalog_repair_required
    const p = mgr
      .enqueuePrompt({
        key: mkKey(),
        config: mkConfig(),
        kind: 'opencode',
        task: 'test',
        binding: { jobId: 'j1', sequence: 0 },
      })
      .catch((_e: any) => ({ ok: false, error: 'spawn_error', reusedSession: false }))

    const result = await p
    assert.notEqual(result.error, 'catalog_repair_required')
  })

  it('does not reject when no catalog is configured', async () => {
    const mgr = new AcpSessionManager({ poolMax: 4 })
    const timer = (mgr as any).idleTimer as ReturnType<typeof setInterval> | null
    if (timer) clearInterval(timer)
    ;(mgr as any).createAndExecute = () => ({ ok: false, error: 'no-spawn', reusedSession: false })

    const result = await mgr.enqueuePrompt({
      key: mkKey(),
      config: mkConfig(),
      kind: 'opencode',
      task: 'test',
      binding: { jobId: 'j1', sequence: 0 },
    })

    assert.notEqual(result.error, 'catalog_repair_required')
  })
})

describe('catalog recovery state machine', () => {
  function request() {
    return {
      key: mkKey(),
      config: mkConfig({ model: undefined }),
      kind: 'custom' as const,
      task: 'continue',
      binding: { jobId: 'job-recovery', sequence: 0 },
    }
  }

  it('maps catalog lookup failures to the public catalog repair error', async () => {
    const port = {
      ...emptyCatalogPort(),
      lookup: () => {
        throw new Error('private catalog path /secret/catalog.json')
      },
    }
    const mgr = new AcpSessionManager({ catalogPort: port })
    const timer = (mgr as any).idleTimer as ReturnType<typeof setInterval> | null
    if (timer) clearInterval(timer)

    await assert.rejects(
      () => mgr.openAndBind(request()),
      (error: any) => {
        assert.equal(error.code, 'catalog_repair_required')
        assert.doesNotMatch(error.publicMessage ?? error.message, /secret|catalog\.json/)
        return true
      },
    )
  })

  it('does not mask a catalog mark-stale write failure as unsupported recovery', async () => {
    const port = {
      ...emptyCatalogPort(),
      lookup: () =>
        catalogRecord({
          capabilities: { loadSession: false, resume: false, close: false, delete: false },
        }),
      markStale: () => {
        throw new Error('disk full')
      },
    }
    const mgr = new AcpSessionManager({ catalogPort: port })
    const timer = (mgr as any).idleTimer as ReturnType<typeof setInterval> | null
    if (timer) clearInterval(timer)

    await assert.rejects(
      () => mgr.openAndBind(request()),
      (error: any) => error?.code === 'catalog_repair_required',
    )
  })

  it('reports catalog repair when persisting a recovery failure cannot be committed', async () => {
    const port = {
      ...emptyCatalogPort(),
      lookup: () => catalogRecord(),
      markStale: () => {
        throw new Error('read-only catalog')
      },
    }
    const mgr = new AcpSessionManager({ catalogPort: port })
    const timer = (mgr as any).idleTimer as ReturnType<typeof setInterval> | null
    if (timer) clearInterval(timer)
    ;(mgr as any).openSessionForRecovery = async () => {
      throw new Error('private resume transport failure')
    }

    await assert.rejects(
      () => mgr.openAndBind(request()),
      (error: any) => error?.code === 'catalog_repair_required',
    )
  })

  it('never falls back to load when resume is supported but fails', async () => {
    const calls: string[] = []
    const staleReasons: string[] = []
    const record = catalogRecord()
    const port = {
      ...emptyCatalogPort(),
      lookup: () => record,
      markStale: (_digest: string, reason: string) => {
        staleReasons.push(reason)
      },
    }
    const mgr = new AcpSessionManager({ catalogPort: port })
    const timer = (mgr as any).idleTimer as ReturnType<typeof setInterval> | null
    if (timer) clearInterval(timer)
    ;(mgr as any).openSessionForRecovery = async (_req: unknown, disposition: string) => {
      calls.push(disposition)
      throw new Error('resume transport failed')
    }

    await assert.rejects(() => mgr.openAndBind(request()))
    assert.deepEqual(calls, ['resume'])
    assert.deepEqual(staleReasons, ['recovery_failed'])
  })

  it('reports a successfully resumed catalog context as reused', async () => {
    const originalFactory = AcpSessionDriver.fromChildProcess
    ;(AcpSessionDriver as any).fromChildProcess = async () => ({
      initialize: async () => ({ agentCapabilities: {} }),
      get capabilities() {
        return {}
      },
      sessionResume: async () => ({ configOptions: [] }),
      sessionLoad: async () => ({ configOptions: [] }),
      get configOptions() {
        return []
      },
      prompt: async () => ({ ok: true, output: 'continued', stopReason: 'end_turn' }),
      close: () => {},
    })
    const port = {
      ...emptyCatalogPort(),
      lookup: () => catalogRecord(),
    }
    const mgr = new AcpSessionManager({ catalogPort: port })
    const timer = (mgr as any).idleTimer as ReturnType<typeof setInterval> | null
    if (timer) clearInterval(timer)

    try {
      const result = await mgr.openAndBind({
        ...request(),
        config: {
          command: process.execPath,
          args: ['-e', 'setInterval(() => {}, 1000)'],
          env: {},
          model: undefined,
        },
      })
      assert.equal(result.ok, true)
      assert.equal(result.reusedSession, true)
      assert.equal(result.sessionDisposition, 'resumed')
    } finally {
      await mgr.closeAll()
      ;(AcpSessionDriver as any).fromChildProcess = originalFactory
    }
  })

  it('marks unsupported recovery stale and exposes a resettable safe error', async () => {
    const staleReasons: string[] = []
    const port = {
      ...emptyCatalogPort(),
      lookup: () =>
        catalogRecord({
          capabilities: { loadSession: false, resume: false, close: false, delete: false },
        }),
      markStale: (_digest: string, reason: string) => {
        staleReasons.push(reason)
      },
    }
    const mgr = new AcpSessionManager({ catalogPort: port })
    const timer = (mgr as any).idleTimer as ReturnType<typeof setInterval> | null
    if (timer) clearInterval(timer)

    await assert.rejects(
      () => mgr.openAndBind(request()),
      (error: any) => {
        assert.equal(error.code, 'recovery_not_supported')
        assert.equal(error.canResetAcpContext, true)
        assert.doesNotMatch(
          error.publicMessage ?? error.message,
          /private-agent-session-id|worker-a|sess-1|swarmdesk-agent/,
        )
        return true
      },
    )
    assert.deepEqual(staleReasons, ['recovery_not_supported'])
  })

  it('does not disclose the stale catalog identity in recovery errors', async () => {
    const port = {
      ...emptyCatalogPort(),
      lookup: () => catalogRecord({ state: 'stale' as const }),
    }
    const mgr = new AcpSessionManager({ catalogPort: port })
    const timer = (mgr as any).idleTimer as ReturnType<typeof setInterval> | null
    if (timer) clearInterval(timer)

    await assert.rejects(
      () => mgr.openAndBind(request()),
      (error: any) => {
        const publicText = error.publicMessage ?? error.message
        assert.doesNotMatch(publicText, /private-agent-session-id|worker-a|sess-1|swarmdesk-agent/)
        assert.equal(publicText.includes(computeKeyDigest(request().key)), false)
        assert.equal(error.canResetAcpContext, true)
        return true
      },
    )
  })
})

describe('pinned model transaction boundary', () => {
  it('does nothing when no model is pinned', async () => {
    let setCalls = 0
    const driver = {
      configOptions: [],
      setConfigOption: async () => {
        setCalls++
      },
    }
    await (sessionManagerModule as any).applyPinnedModelOrThrow(driver, undefined)
    assert.equal(setCalls, 0)
  })

  it('fails before prompt when the pinned model cannot be applied', async () => {
    const driver = {
      configOptions: [
        {
          id: 'model',
          type: 'select',
          name: 'Model',
          currentValue: 'm1',
          options: [{ value: 'm1', name: 'm1' }],
        },
      ],
      setConfigOption: async () => {
        throw new Error('private transport failure')
      },
    }
    await assert.rejects(
      () => (sessionManagerModule as any).applyPinnedModelOrThrow(driver, 'm1'),
      (error: any) => {
        assert.equal(error.code, 'model_configuration_failed')
        assert.doesNotMatch(error.publicMessage ?? error.message, /private transport failure/)
        return true
      },
    )
  })

  it('applies a pinned model to the requested shared session', async () => {
    let configuredSessionId: string | undefined
    const driver = {
      configOptions: [
        {
          id: 'model',
          type: 'select',
          name: 'Model',
          currentValue: 'm1',
          options: [{ value: 'm1', name: 'm1' }],
        },
      ],
      setConfigOption: async (_configId: string, _value: string, sessionId?: string) => {
        configuredSessionId = sessionId
      },
    }

    await (sessionManagerModule as any).applyPinnedModelOrThrow(driver, 'm1', 'sid-writer')

    assert.equal(configuredSessionId, 'sid-writer')
  })

  it('uses the requested session options when a sibling changed driver-global options', async () => {
    const configured: string[] = []
    const driver = {
      configOptions: [
        {
          id: 'model',
          type: 'select',
          name: 'Model',
          currentValue: 'reader-model',
          options: [{ value: 'reader-model', name: 'reader-model' }],
        },
      ],
      setConfigOption: async (_configId: string, value: string, sessionId?: string) => {
        configured.push(`${sessionId}:${value}`)
      },
    }
    const writerOptions = [
      {
        id: 'model',
        type: 'select',
        name: 'Model',
        currentValue: 'writer-model',
        options: [{ value: 'writer-model', name: 'writer-model' }],
      },
    ]

    await (sessionManagerModule as any).applyPinnedModelOrThrow(
      driver,
      'writer-model',
      'sid-writer',
      writerOptions,
    )

    assert.deepEqual(configured, ['sid-writer:writer-model'])
  })

  it('deletes an uncommitted remote session when catalog upsert fails', async () => {
    const calls: string[] = []
    const originalFactory = AcpSessionDriver.fromChildProcess
    ;(AcpSessionDriver as any).fromChildProcess = async () => ({
      initialize: async () => ({ agentCapabilities: {} }),
      get capabilities() {
        return {}
      },
      sessionNew: async () => ({ sessionId: 'uncommitted-private-id', configOptions: [] }),
      get configOptions() {
        return []
      },
      hasCapability: (capability: string) => capability === 'delete',
      deleteSession: () => {
        calls.push('remote-delete')
        throw new Error('synchronous cleanup failure')
      },
      closeSession: async () => {
        calls.push('remote-close')
      },
      close: () => {
        calls.push('transport-close')
      },
      prompt: async () => {
        calls.push('prompt')
        return { ok: true, output: '', stopReason: 'end_turn' }
      },
    })

    const port = {
      ...emptyCatalogPort(),
      upsert: () => {
        throw new Error('disk full')
      },
    }
    const mgr = new AcpSessionManager({ catalogPort: port })
    const timer = (mgr as any).idleTimer as ReturnType<typeof setInterval> | null
    if (timer) clearInterval(timer)

    try {
      await assert.rejects(
        () =>
          mgr.enqueuePrompt({
            key: mkKey(),
            config: {
              command: process.execPath,
              args: ['-e', 'setInterval(() => {}, 1000)'],
              model: undefined,
              env: {},
            },
            kind: 'custom',
            task: 'must not run',
            binding: { jobId: 'job-catalog-failure', sequence: 0 },
          }),
        (error: any) => error?.code === 'catalog_repair_required',
      )
      assert.deepEqual(calls.slice(0, 2), ['remote-delete', 'transport-close'])
      assert.equal(calls.includes('prompt'), false)
      assert.equal(calls.includes('remote-close'), false)
    } finally {
      ;(AcpSessionDriver as any).fromChildProcess = originalFactory
      await mgr.closeAll()
    }
  })
})

describe('remote cleanup handoff', () => {
  it('resets only contexts owned by one Chat role', () => {
    const roleA = catalogRecord({
      keyDigest: 'digest-role-a',
      routerSessionId: 'session-role',
      teamMemberId: 'role-a',
      teamMemberRevision: 2,
    })
    const roleB = catalogRecord({
      keyDigest: 'digest-role-b',
      routerSessionId: 'session-role',
      teamMemberId: 'role-b',
      teamMemberRevision: 1,
    })
    const records = [roleA, roleB]
    const deleted: string[] = []
    const port = {
      ...emptyCatalogPort(),
      listByRouterSession: () => records,
      lookup: (digest: string) => records.find((record) => record.keyDigest === digest),
      deleteByKey: (digest: string) => deleted.push(digest),
    }
    const mgr = new AcpSessionManager({ catalogPort: port })
    const timer = (mgr as any).idleTimer as ReturnType<typeof setInterval> | null
    if (timer) clearInterval(timer)

    assert.deepEqual(mgr.deleteContextsByTeamMember('session-role', 'role-a'), { deleted: 1 })
    assert.deepEqual(deleted, ['digest-role-a'])
  })

  it('resets one reuse key through local close, catalog delete, then remote cleanup', async () => {
    const key = mkKey({ routerSessionId: 'session-reset', workerId: 'worker-reset' })
    const keyDigest = computeKeyDigest(key)
    const record = catalogRecord({
      keyDigest,
      routerSessionId: key.routerSessionId,
      workerId: key.workerId,
    })
    const order: string[] = []
    const entry = makeFakeIdleEntry(key)
    entry.driver.close = () => {
      order.push('local-close')
    }
    const port = {
      ...emptyCatalogPort(),
      lookup: (digest: string) => (digest === keyDigest ? record : undefined),
      deleteByKey: (digest: string) => {
        order.push(`catalog-delete:${digest}`)
      },
    }
    const mgr = new AcpSessionManager({
      catalogPort: port,
      remoteCleanup: async () => {
        order.push('remote-cleanup')
      },
    })
    const timer = (mgr as any).idleTimer as ReturnType<typeof setInterval> | null
    if (timer) clearInterval(timer)
    ;(mgr as any).entries.set(keyDigest, entry)

    mgr.deleteContextByReuseKey(key)
    await new Promise((resolve) => setImmediate(resolve))

    assert.equal(mgr.getDebugInfo().entries, 0)
    assert.deepEqual(order, ['local-close', `catalog-delete:${keyDigest}`, 'remote-cleanup'])
  })

  it('does not launch reset remote cleanup when its catalog deletion fails', async () => {
    const key = mkKey({ routerSessionId: 'session-reset', workerId: 'worker-reset' })
    const record = catalogRecord({ keyDigest: computeKeyDigest(key) })
    const cleaned: string[] = []
    const port = {
      ...emptyCatalogPort(),
      lookup: () => record,
      deleteByKey: () => {
        throw new Error('catalog write failed')
      },
    }
    const mgr = new AcpSessionManager({
      catalogPort: port,
      remoteCleanup: async () => {
        cleaned.push('remote')
      },
    })
    const timer = (mgr as any).idleTimer as ReturnType<typeof setInterval> | null
    if (timer) clearInterval(timer)

    assert.throws(
      () => mgr.deleteContextByReuseKey(key),
      (error: any) => error?.code === 'catalog_repair_required',
    )
    await new Promise((resolve) => setImmediate(resolve))
    assert.deepEqual(cleaned, [])
  })

  it('captures catalog records, commits local delete, then launches remote cleanup', async () => {
    const record = catalogRecord({ workerId: 'worker-cleanup' })
    const order: string[] = []
    const port = {
      ...emptyCatalogPort(),
      listByWorker: () => [record],
      deleteByWorker: () => {
        order.push('local-delete')
      },
    }
    const cleaned: string[] = []
    const mgr = new AcpSessionManager({
      catalogPort: port,
      remoteCleanup: async (captured: any) => {
        order.push('remote-cleanup')
        cleaned.push(captured.workerId)
      },
    } as any)
    const timer = (mgr as any).idleTimer as ReturnType<typeof setInterval> | null
    if (timer) clearInterval(timer)

    mgr.deleteContextByWorker('worker-cleanup')
    await new Promise((resolve) => setImmediate(resolve))

    assert.deepEqual(order, ['local-delete', 'remote-cleanup'])
    assert.deepEqual(cleaned, ['worker-cleanup'])
  })

  it('does not launch remote cleanup when local catalog deletion fails', async () => {
    const record = catalogRecord({ workerId: 'worker-cleanup' })
    const cleaned: string[] = []
    const port = {
      ...emptyCatalogPort(),
      listByWorker: () => [record],
      deleteByWorker: () => {
        throw new Error('catalog write failed')
      },
    }
    const mgr = new AcpSessionManager({
      catalogPort: port,
      remoteCleanup: async (captured: any) => {
        cleaned.push(captured.workerId)
      },
    })
    const timer = (mgr as any).idleTimer as ReturnType<typeof setInterval> | null
    if (timer) clearInterval(timer)

    assert.throws(
      () => mgr.deleteContextByWorker('worker-cleanup'),
      (error: any) => error?.code === 'catalog_repair_required',
    )
    await new Promise((resolve) => setImmediate(resolve))
    assert.deepEqual(cleaned, [])
  })
})
