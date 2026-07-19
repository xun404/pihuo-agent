/**
 * P0: atomic claim — concurrent reuses of the same entry never double-run.
 * Uses a live idle entry with a fake driver injected into the manager map.
 */
import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import {
  AcpSessionManager,
  buildSessionReuseKey,
  computeKeyDigest,
  type SessionEntryConfig,
} from './acp-session-manager.js'

class FakeDriver {
  active = 0
  maxActive = 0
  order: string[] = []
  constructor(private delayMs = 25) {}
  hasCapability() {
    return false
  }
  async prompt(task: string) {
    this.active += 1
    this.maxActive = Math.max(this.maxActive, this.active)
    this.order.push(`start:${task}`)
    await new Promise((r) => setTimeout(r, this.delayMs))
    this.order.push(`end:${task}`)
    this.active -= 1
    return { ok: true, output: `out:${task}`, stopReason: undefined as string | undefined }
  }
  async cancel() {
    return
  }
}

describe('atomic session claim (P0)', () => {
  let mgr: AcpSessionManager

  afterEach(async () => {
    try {
      await mgr?.closeAll()
    } catch {
      /* ok */
    }
  })

  it('20 concurrent prompts on same reuse key: maxActive===1 and FIFO order', async () => {
    process.env.ACP_SESSION_REUSE = '1'
    mgr = new AcpSessionManager({ catalogRequired: false, poolMax: 8 })
    const config: SessionEntryConfig = { command: 'echo', args: [], env: {} }
    const key = buildSessionReuseKey({
      routerSessionId: 'sess-claim',
      workerId: 'w-claim',
      cwd: process.cwd(),
      config,
    })
    const keyDigest = computeKeyDigest(key)
    const driver = new FakeDriver(15)
    const entry = {
      key,
      state: 'idle' as const,
      proc: Object.assign(new EventEmitter(), {
        kill: () => true,
        pid: 1,
      }) as never,
      driver: driver as never,
      agentSessionId: 'ag-1',
      capabilities: {},
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      generation: 1,
      summary: 'claim-test',
      currentBinding: null as null,
      promptQueue: [] as unknown[],
      configOptions: [],
      sessionConfig: config,
      workerKind: 'codex' as const,
    }
    ;(mgr as unknown as { entries: Map<string, typeof entry> }).entries.set(keyDigest, entry)

    const N = 20
    const promises = Array.from({ length: N }, (_, i) =>
      mgr.enqueuePrompt({
        key,
        config,
        kind: 'codex',
        task: `t${String(i).padStart(2, '0')}`,
        binding: { jobId: `j${i}`, sequence: 0 },
      }),
    )
    const results = await Promise.all(promises)
    assert.equal(driver.maxActive, 1, `maxActive must be 1, got ${driver.maxActive}`)
    assert.equal(results.filter((r) => r.ok).length, N)
    // FIFO: starts in order
    const starts = driver.order.filter((x) => x.startsWith('start:')).map((x) => x.slice(6))
    assert.deepEqual(
      starts,
      Array.from({ length: N }, (_, i) => `t${String(i).padStart(2, '0')}`),
    )
    // Nested: each start followed by its end before next start (serialized)
    for (let i = 0; i < N; i++) {
      const task = `t${String(i).padStart(2, '0')}`
      const si = driver.order.indexOf(`start:${task}`)
      const ei = driver.order.indexOf(`end:${task}`)
      assert.ok(si >= 0 && ei > si)
      if (i + 1 < N) {
        const next = `t${String(i + 1).padStart(2, '0')}`
        assert.ok(
          driver.order.indexOf(`start:${next}`) > ei,
          `${next} must start after ${task} ends`,
        )
      }
    }
  })
})
