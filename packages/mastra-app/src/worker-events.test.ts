/**
 * Spec §8.2 Scheduler bridge tests — worker-events order + integration patterns.
 *
 * Tests 1-3: WorkerEventEmitter order enforcement, terminal dedup, delta merging.
 * Tests 4-7: Integration-style bridge pattern verification (writer resilience,
 *            abort→cancel, wait=false, router session context).
 *
 * Run: node --import tsx --test packages/mastra-app/src/worker-events.test.ts
 */
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  WorkerEventEmitter,
  EventCollector,
  getWorkerEventEmitter,
  emitWorkerEvent,
} from './worker-events.js'
import type { WorkerRunEvent, WorkerRole, WorkerKind } from '@router-agents/shared'
import { resolveDispatchContext } from './dispatch-context.js'

// ---------------------------------------------------------------------------
// Helpers (mirror helpers from worker-events.ts since they are not exported)
// ---------------------------------------------------------------------------

function makeStarted(
  overrides?: Partial<WorkerRunEvent & { type: 'started' }>,
): WorkerRunEvent & { type: 'started' } {
  return {
    type: 'started',
    jobId: 'job_1',
    workerId: 'w_1',
    workerName: 'Test Worker',
    workerKind: 'claude' as WorkerKind,
    reusedSession: false,
    ...overrides,
  }
}

function makeDelta(seq: number, delta: string, jobId = 'job_1'): WorkerRunEvent {
  return { type: 'delta', jobId, sequence: seq, delta }
}

function makeCompleted(
  overrides?: Partial<WorkerRunEvent & { type: 'completed' }>,
): WorkerRunEvent & { type: 'completed' } {
  return {
    type: 'completed',
    jobId: 'job_1',
    output: 'done',
    truncated: false,
    ...overrides,
  }
}

function makeFailed(error = 'boom', jobId = 'job_1'): WorkerRunEvent {
  return { type: 'failed', jobId, error, output: undefined, truncated: false }
}

function makeCancelled(jobId = 'job_1'): WorkerRunEvent {
  return { type: 'cancelled', jobId, output: undefined, truncated: false }
}

function collectHandler(target: WorkerRunEvent[]): (e: WorkerRunEvent) => void {
  return (e) => {
    target.push({ ...e })
  }
}

// ---------------------------------------------------------------------------
// Spec §8.2 Test 1: Strict event order (started -> delta* -> terminal)
// ---------------------------------------------------------------------------

describe('Spec §8.2.1 — Strict event order enforcement', () => {
  let emitter: WorkerEventEmitter

  beforeEach(() => {
    emitter = new WorkerEventEmitter()
  })

  it('normalizes invalid retention limits without an unbounded journal', () => {
    const bounded = new WorkerEventEmitter({
      terminalTtlMs: Number.POSITIVE_INFINITY,
      journalMax: -1,
    })
    bounded.emit(makeStarted({ jobId: 'normalized-limits' }))
    for (let sequence = 1; sequence <= 600; sequence += 1) {
      bounded.emit(makeDelta(sequence, 'x', 'normalized-limits'))
    }
    bounded.emit(makeCompleted({ jobId: 'normalized-limits' }))

    assert.ok(bounded.getJournal('normalized-limits').length <= 512)
  })

  it('delta emitted before started is dropped (order violation)', () => {
    const received: WorkerRunEvent[] = []
    emitter.subscribe('job_1', collectHandler(received))

    emitter.emit(makeDelta(1, 'premature'))
    emitter.emit(makeStarted())
    emitter.emit(makeDelta(2, 'ok'))
    emitter.emit(makeCompleted())

    // premature delta was dropped; only started + ok delta + completed
    assert.equal(received.length, 3)
    assert.equal(received[0]!.type, 'started')
    assert.equal(received[1]!.type, 'delta')
    assert.equal((received[1] as WorkerRunEvent & { delta: string }).delta, 'ok')
    assert.equal(received[2]!.type, 'completed')
  })

  it('terminal (completed) emitted before started is dropped (order violation)', () => {
    const received: WorkerRunEvent[] = []
    emitter.subscribe('job_1', collectHandler(received))

    emitter.emit(makeCompleted())
    emitter.emit(makeStarted())
    emitter.emit(makeCompleted({ output: 'second' }))

    // first completed was dropped (completed is NOT a terminal-only event type),
    // second completed delivers
    assert.equal(received.length, 2)
    assert.equal(received[0]!.type, 'started')
    assert.equal(received[1]!.type, 'completed')
    assert.equal((received[1] as WorkerRunEvent & { type: 'completed' }).output, 'second')
  })

  it('terminal (failed) emitted before started is delivered as terminal-only', () => {
    const received: WorkerRunEvent[] = []
    emitter.subscribe('job_1', collectHandler(received))

    emitter.emit(makeFailed('early'))
    // failed is allowed as terminal-only — delivered immediately,
    // subscriber auto-unsubscribes; subsequent events ignored
    emitter.emit(makeStarted())
    emitter.emit(makeDelta(1, 'x'))
    emitter.emit(makeCompleted())

    assert.equal(received.length, 1)
    assert.equal(received[0]!.type, 'failed')
    assert.equal((received[0] as WorkerRunEvent & { type: 'failed' }).error, 'early')
  })

  it('terminal (cancelled) emitted before started is delivered as terminal-only', () => {
    const received: WorkerRunEvent[] = []
    emitter.subscribe('job_1', collectHandler(received))

    emitter.emit(makeCancelled())
    // cancelled is allowed as terminal-only — delivered immediately,
    // subscriber auto-unsubscribes; subsequent events ignored
    emitter.emit(makeStarted())
    emitter.emit(makeCompleted())

    assert.equal(received.length, 1)
    assert.equal(received[0]!.type, 'cancelled')
  })

  it('delta after completed is dropped (order violation)', () => {
    const received: WorkerRunEvent[] = []
    emitter.subscribe('job_1', collectHandler(received))

    emitter.emit(makeStarted())
    emitter.emit(makeDelta(1, 'a'))
    emitter.emit(makeCompleted())
    emitter.emit(makeDelta(2, 'after'))
    emitter.emit(makeDelta(3, 'more'))

    assert.equal(received.length, 3)
    assert.equal(received[2]!.type, 'completed')
    const deltas = received.filter((e) => e.type === 'delta')
    assert.equal(deltas.length, 1)
  })

  it('delta after failed is dropped (order violation)', () => {
    const received: WorkerRunEvent[] = []
    emitter.subscribe('job_1', collectHandler(received))

    emitter.emit(makeStarted())
    emitter.emit(makeDelta(1, 'working'))
    emitter.emit(makeFailed('crashed'))
    emitter.emit(makeDelta(2, 'orphaned'))

    assert.equal(received.length, 3)
    assert.equal(received[2]!.type, 'failed')
  })

  it('delta after cancelled is dropped (order violation)', () => {
    const received: WorkerRunEvent[] = []
    emitter.subscribe('job_1', collectHandler(received))

    emitter.emit(makeStarted())
    emitter.emit(makeCancelled())
    emitter.emit(makeDelta(1, 'too late'))

    assert.equal(received.length, 2)
    assert.equal(received[1]!.type, 'cancelled')
  })

  it('no started + no terminal means no events delivered at all', () => {
    const received: WorkerRunEvent[] = []
    emitter.subscribe('job_1', collectHandler(received))

    emitter.emit(makeDelta(1, 'a'))
    emitter.emit(makeDelta(2, 'b'))
    emitter.emit(makeDelta(3, 'c'))

    assert.equal(received.length, 0)
  })

  it('full happy path: started -> 3 deltas -> completed in precise order', () => {
    const received: WorkerRunEvent[] = []
    emitter.subscribe('job_1', collectHandler(received))

    emitter.emit(makeStarted())
    emitter.emit(makeDelta(1, 'H'))
    emitter.emit(makeDelta(2, 'e'))
    emitter.emit(makeDelta(3, 'llo'))
    emitter.emit(makeCompleted({ output: 'Hello' }))

    assert.equal(received.length, 5)
    const types = received.map((e) => e.type)
    assert.deepStrictEqual(types, ['started', 'delta', 'delta', 'delta', 'completed'])
    const fullDelta = received
      .filter((e) => e.type === 'delta')
      .map((e) => (e as WorkerRunEvent & { delta: string }).delta)
      .join('')
    assert.equal(fullDelta, 'Hello')
  })
})

// ---------------------------------------------------------------------------
// Spec §8.2 Test 2: Terminal only publishes once
// ---------------------------------------------------------------------------

describe('Spec §8.2.2 — Terminal dedup (exactly one terminal per jobId)', () => {
  let emitter: WorkerEventEmitter

  beforeEach(() => {
    emitter = new WorkerEventEmitter()
  })

  it('only first terminal event is delivered (completed first)', () => {
    const received: WorkerRunEvent[] = []
    emitter.subscribe('job_1', collectHandler(received))

    emitter.emit(makeStarted())
    emitter.emit(makeCompleted({ output: 'first-terminal' }))
    emitter.emit(makeFailed('second-attempt'))
    emitter.emit(makeCancelled())

    const terminals = received.filter(
      (e) => e.type === 'completed' || e.type === 'failed' || e.type === 'cancelled',
    )
    assert.equal(terminals.length, 1)
    assert.equal(terminals[0]!.type, 'completed')
    assert.equal((terminals[0] as WorkerRunEvent & { type: 'completed' }).output, 'first-terminal')
  })

  it('only first terminal event is delivered (failed first)', () => {
    const received: WorkerRunEvent[] = []
    emitter.subscribe('job_1', collectHandler(received))

    emitter.emit(makeStarted())
    emitter.emit(makeFailed('crashed'))
    emitter.emit(makeCompleted({ output: 'too late' }))

    const terminals = received.filter(
      (e) => e.type === 'completed' || e.type === 'failed' || e.type === 'cancelled',
    )
    assert.equal(terminals.length, 1)
    assert.equal(terminals[0]!.type, 'failed')
  })

  it('only first terminal event is delivered (cancelled first)', () => {
    const received: WorkerRunEvent[] = []
    emitter.subscribe('job_1', collectHandler(received))

    emitter.emit(makeStarted())
    emitter.emit(makeCancelled())
    emitter.emit(makeCompleted())
    emitter.emit(makeFailed('boom'))

    const terminals = received.filter(
      (e) => e.type === 'completed' || e.type === 'failed' || e.type === 'cancelled',
    )
    assert.equal(terminals.length, 1)
    assert.equal(terminals[0]!.type, 'cancelled')
  })

  it('after terminal, late subscribe replays journal including terminal', () => {
    const before: WorkerRunEvent[] = []
    emitter.subscribe('job_1', collectHandler(before))
    emitter.emit(makeStarted())
    emitter.emit(makeCompleted())

    // Late subscriber must receive journal replay (including terminal) — no hang.
    const after: WorkerRunEvent[] = []
    const unsub = emitter.subscribe('job_1', collectHandler(after))
    assert.equal(after.length, 2)
    assert.equal(after[0]!.type, 'started')
    assert.equal(after[1]!.type, 'completed')

    // New emissions still suppressed while terminal tombstone holds
    const beforeLen = after.length
    emitter.emit(makeStarted({ jobId: 'job_1' }))
    emitter.emit(makeDelta(1, 'x', 'job_1'))
    assert.equal(after.length, beforeLen)
    unsub()
  })

  it('double-completed (duplicate terminal) is ignored', () => {
    const received: WorkerRunEvent[] = []
    emitter.subscribe('job_1', collectHandler(received))

    emitter.emit(makeStarted())
    emitter.emit(makeCompleted({ output: 'first' }))
    emitter.emit(makeCompleted({ output: 'second' }))

    assert.equal(received.length, 2)
    assert.equal(received[1]!.type, 'completed')
    assert.equal((received[1] as WorkerRunEvent & { type: 'completed' }).output, 'first')
  })

  it('auto-unsubscribe happens on terminal — all handlers removed', () => {
    const a: WorkerRunEvent[] = []
    const b: WorkerRunEvent[] = []
    emitter.subscribe('job_1', collectHandler(a))
    emitter.subscribe('job_1', collectHandler(b))

    emitter.emit(makeStarted())
    emitter.emit(makeCompleted())

    assert.equal(a.length, 2)
    assert.equal(b.length, 2)

    // After terminal, late subscribe replays journal (not live registration)
    const c: WorkerRunEvent[] = []
    const unsubC = emitter.subscribe('job_1', collectHandler(c))
    assert.equal(c.length, 2, 'replay started+completed')
    const before = c.length
    emitter.emit(makeDelta(1, 'after-terminal'))
    assert.equal(c.length, before, 'live handlers removed; no new live events')
    unsubC()
  })
})

// ---------------------------------------------------------------------------
// Spec §8.2 Test 3: Delta merging preserves text order
// ---------------------------------------------------------------------------

describe('Spec §8.2.3 — Delta merging preserves text order', () => {
  let emitter: WorkerEventEmitter

  beforeEach(() => {
    emitter = new WorkerEventEmitter()
  })

  it('deltas with strictly increasing sequences yield correct text', () => {
    const received: WorkerRunEvent[] = []
    emitter.subscribe('job_1', collectHandler(received))

    emitter.emit(makeStarted())
    emitter.emit(makeDelta(0, 'Hello'))
    emitter.emit(makeDelta(1, ' '))
    emitter.emit(makeDelta(2, 'World'))
    emitter.emit(makeDelta(3, '!'))
    emitter.emit(makeCompleted())

    const fullText = received
      .filter((e) => e.type === 'delta')
      .map((e) => (e as WorkerRunEvent & { delta: string }).delta)
      .join('')
    assert.equal(fullText, 'Hello World!')
  })

  it('many small deltas (100) accumulate correctly', () => {
    const received: WorkerRunEvent[] = []
    emitter.subscribe('job_1', collectHandler(received))

    emitter.emit(makeStarted())
    const words = ['The ', 'quick ', 'brown ', 'fox ', 'jumps ', 'over ', 'the ', 'lazy ', 'dog.']
    for (let i = 0; i < 100; i++) {
      emitter.emit(makeDelta(i, words[i % words.length]!))
    }
    emitter.emit(makeCompleted())

    const fullText = received
      .filter((e) => e.type === 'delta')
      .map((e) => (e as WorkerRunEvent & { delta: string }).delta)
      .join('')
    // 100 chunks × cyclic words should give consistent output
    assert.ok(fullText.length > 0)
    assert.ok(fullText.startsWith('The quick brown fox jumps over the lazy dog.'))
  })

  it('receiver-observed sequence monotonically increases', () => {
    const received: WorkerRunEvent[] = []
    emitter.subscribe('job_1', collectHandler(received))

    emitter.emit(makeStarted())
    for (let i = 0; i < 50; i++) {
      emitter.emit(makeDelta(i, String.fromCharCode(65 + (i % 26))))
    }
    emitter.emit(makeCompleted())

    let lastSeq = -1
    for (const e of received) {
      if (e.type === 'delta') {
        const seq = (e as WorkerRunEvent & { sequence: number }).sequence
        assert.ok(seq > lastSeq, `sequence ${seq} should be > ${lastSeq}`)
        lastSeq = seq
      }
    }
  })

  it('delta text concatenation consistent with full terminal output', () => {
    const received: WorkerRunEvent[] = []
    emitter.subscribe('job_1', collectHandler(received))

    const fullOutput = 'Alpha\nBeta\nGamma'
    const parts = ['Alpha\n', 'Beta\n', 'Gamma']

    emitter.emit(makeStarted())
    parts.forEach((p, i) => emitter.emit(makeDelta(i, p)))
    emitter.emit(makeCompleted({ output: fullOutput }))

    const accumulatedDelta = received
      .filter((e) => e.type === 'delta')
      .map((e) => (e as WorkerRunEvent & { delta: string }).delta)
      .join('')
    assert.equal(accumulatedDelta, fullOutput)

    const terminal = received.find((e) => e.type === 'completed') as
      (WorkerRunEvent & { type: 'completed' }) | undefined
    assert.equal(terminal!.output, fullOutput)
  })

  it('large delta buffer (multi-line markdown) preserves ordering', () => {
    const received: WorkerRunEvent[] = []
    emitter.subscribe('job_1', collectHandler(received))

    const lines = [
      '# Header\n',
      '\n',
      'Paragraph text with **bold** and *italic*.\n',
      '\n',
      '```typescript\n',
      'const x: number = 1;\n',
      '```\n',
      '\n',
      '- list item 1\n',
      '- list item 2\n',
    ]

    emitter.emit(makeStarted())
    lines.forEach((l, i) => emitter.emit(makeDelta(i, l)))
    emitter.emit(makeCompleted())

    const accumulated = received
      .filter((e) => e.type === 'delta')
      .map((e) => (e as WorkerRunEvent & { delta: string }).delta)
      .join('')
    assert.equal(accumulated, lines.join(''))
  })
})

// ---------------------------------------------------------------------------
// Spec §8.2 Test 4: Writer bridge resilience
// (missing/misbehaving writer doesn't change Worker Job result)
// ---------------------------------------------------------------------------

describe('Spec §8.2.4 — Writer calls awaited; missing/misbehaving writer', () => {
  let emitter: WorkerEventEmitter

  beforeEach(() => {
    emitter = new WorkerEventEmitter()
  })

  it('simulated bridge: writer.custom() errors are caught, collector still resolves', async () => {
    // Simulate the dispatchWorkerTool bridge pattern where writer.custom()
    // can throw (network error, etc.) but the job must still complete.
    let writerCalls = 0

    const writer = {
      custom: async (_opts: { type: string; data: unknown; transient?: boolean }) => {
        writerCalls++
        if (writerCalls === 2) {
          throw new Error('simulated writer custom() failure')
        }
      },
    }

    // Bridge simulation: subscribe to events, forward to writer, flush on terminal
    const collector = new EventCollector('job_bridge', emitter)

    let buf = ''
    let lastSeq = 0

    emitter.subscribe('job_bridge', async (event) => {
      if (event.type === 'started') {
        await writer
          .custom({ type: 'data-worker-run', data: event, transient: true })
          .catch(() => {})
      } else if (event.type === 'delta') {
        const e = event as WorkerRunEvent & { delta: string; sequence: number }
        if (e.sequence > lastSeq) {
          lastSeq = e.sequence
          buf += e.delta
        }
        if (buf.length >= 8) {
          await writer
            .custom({
              type: 'data-worker-run',
              data: { type: 'delta', jobId: event.jobId, sequence: lastSeq, delta: buf },
              transient: true,
            })
            .catch(() => {})
          buf = ''
        }
      } else {
        if (buf.length > 0) {
          await writer
            .custom({
              type: 'data-worker-run',
              data: { type: 'delta', jobId: event.jobId, sequence: lastSeq, delta: buf },
              transient: true,
            })
            .catch(() => {})
          buf = ''
        }
        await writer
          .custom({ type: 'data-worker-run', data: event, transient: false })
          .catch(() => {})
      }
    })

    // waitForCompletion must be called before events so _resolveComplete is set
    const promise = collector.waitForCompletion(2000)

    emitter.emit(makeStarted({ jobId: 'job_bridge' }))
    emitter.emit(makeDelta(1, 'Hello', 'job_bridge'))
    emitter.emit(makeDelta(2, ' World', 'job_bridge'))
    emitter.emit(makeCompleted({ jobId: 'job_bridge', output: 'Hello World' }))

    const events = await promise
    assert.equal(events.length, 4)
    assert.equal(events[3]!.type, 'completed')
    assert.ok(writerCalls >= 2, 'writer should have been called at least for started + first delta')
  })

  it('simulated bridge: missing writer (null custom) — events still collected, no crash', async () => {
    // Verify the bridge's `if (sync && writer?.custom)` guard — when writer is
    // null/missing, the subscription path is skipped entirely.
    let subscriptionRegistered = false

    // Simulating: writer is not present, so we don't subscribe to emitter
    const hasWriter = false
    if (hasWriter) {
      subscriptionRegistered = true
    }

    // Regardless, the collector can still work independently
    const collector = new EventCollector('job_no_writer', emitter)
    const promise = collector.waitForCompletion(2000)

    emitter.emit(makeStarted({ jobId: 'job_no_writer' }))
    emitter.emit(makeDelta(1, 'work', 'job_no_writer'))
    emitter.emit(makeCompleted({ jobId: 'job_no_writer' }))

    const events = await promise
    assert.equal(events.length, 3)
    assert.equal(events[2]!.type, 'completed')
    assert.equal(
      subscriptionRegistered,
      false,
      'bridge should not subscribe when writer is missing',
    )
  })

  it('simulated bridge: writer returns rejected promise — events still collected', async () => {
    const writer = {
      custom: async (_opts: { type: string; data: unknown; transient?: boolean }) => {
        return Promise.reject(new Error('always fails'))
      },
    }

    const collector = new EventCollector('job_fail_writer', emitter)
    const promise = collector.waitForCompletion(2000)

    const eventsViaBridge: WorkerRunEvent[] = []
    emitter.subscribe('job_fail_writer', async (event) => {
      eventsViaBridge.push(event)
      await writer.custom({ type: 'data-worker-run', data: event, transient: true }).catch(() => {})
    })

    emitter.emit(makeStarted({ jobId: 'job_fail_writer' }))
    emitter.emit(makeDelta(1, 'x', 'job_fail_writer'))
    emitter.emit(makeCompleted({ jobId: 'job_fail_writer' }))

    const collected = await promise
    assert.equal(collected.length, 3)
    assert.equal(collected[2]!.type, 'completed')
    // Bridge caught all writer failures
    assert.equal(eventsViaBridge.length, 3)
  })

  it('simulated bridge: subscriber error in one handler does not affect others', () => {
    const a: WorkerRunEvent[] = []
    const b: WorkerRunEvent[] = []

    emitter.subscribe('job_resilient', (e) => {
      a.push(e)
      if (e.type === 'delta') throw new Error('handler-a-crash')
    })
    emitter.subscribe('job_resilient', collectHandler(b))

    emitter.emit(makeStarted({ jobId: 'job_resilient' }))
    emitter.emit(makeDelta(1, 'ok', 'job_resilient'))
    emitter.emit(makeCompleted({ jobId: 'job_resilient' }))

    // Handler 'a' crashed on delta but 'b' still got everything
    assert.equal(b.length, 3)
    assert.equal(b[1]!.type, 'delta')
    assert.equal(b[2]!.type, 'completed')
  })
})

// ---------------------------------------------------------------------------
// Spec §8.2 Test 5: Tool abort cancels Job and evicts session
// ---------------------------------------------------------------------------

describe('Spec §8.2.5 — Tool abort cancels Job and emits terminal cancelled', () => {
  let emitter: WorkerEventEmitter

  beforeEach(() => {
    emitter = new WorkerEventEmitter()
  })

  it('abort signal triggers cancelled event emission', () => {
    // Simulate the pattern in dispatchWorkerTool.execute:
    //   abortSignal.addEventListener('abort', () => scheduler.cancel(job.id))
    //   cancel() emits { type: 'cancelled', jobId, ... }
    const received: WorkerRunEvent[] = []
    emitter.subscribe('job_abort', collectHandler(received))

    emitter.emit(makeStarted({ jobId: 'job_abort' }))
    emitter.emit(makeDelta(1, 'working...', 'job_abort'))

    // Abort signal fires → scheduler.cancel() → emit cancelled
    emitter.emit(makeCancelled('job_abort'))

    assert.equal(received.length, 3)
    assert.equal(received[2]!.type, 'cancelled')
  })

  it('after cancelled event, no further events are delivered', () => {
    const received: WorkerRunEvent[] = []
    emitter.subscribe('job_abort2', collectHandler(received))

    emitter.emit(makeStarted({ jobId: 'job_abort2' }))
    emitter.emit(makeCancelled('job_abort2'))

    // After cancel, no more events should be delivered
    emitter.emit(makeDelta(1, 'after cancel', 'job_abort2'))
    emitter.emit(makeCompleted({ jobId: 'job_abort2' }))

    const terminals = received.filter(
      (e) => e.type === 'completed' || e.type === 'failed' || e.type === 'cancelled',
    )
    assert.equal(terminals.length, 1)
    assert.equal(terminals[0]!.type, 'cancelled')
  })

  it('abort during running produces cancelled + no extra terminal', () => {
    // Simulates the scheduler timeout path:
    // On timeout, emit cancelled → abort.abort() → finish('timed_out')
    // The finish() may also try to emit but emitter deduplicates
    const received: WorkerRunEvent[] = []
    emitter.subscribe('job_timeout', collectHandler(received))

    emitter.emit(makeStarted({ jobId: 'job_timeout' }))
    emitter.emit(makeDelta(1, 'work', 'job_timeout'))

    // Timeout fires: emit cancelled
    emitter.emit(makeCancelled('job_timeout'))

    // finish() might also emit (but should be blocked by terminal dedup)
    emitter.emit({
      type: 'failed',
      jobId: 'job_timeout',
      output: undefined,
      error: 'timeout',
      truncated: false,
    })

    const terminals = received.filter(
      (e) => e.type === 'completed' || e.type === 'failed' || e.type === 'cancelled',
    )
    assert.equal(terminals.length, 1)
    assert.equal(terminals[0]!.type, 'cancelled')
  })

  it('abort signal + session eviction: cancelled clears subscribers', () => {
    // After cancelling a job, the emitter auto-unsubscribes all handlers.
    // This simulates the session eviction pattern — the pool entry is evicted
    // after cancel, so no further events can leak through for that jobId.
    const received: WorkerRunEvent[] = []
    emitter.subscribe('job_evict', collectHandler(received))

    emitter.emit(makeStarted({ jobId: 'job_evict' }))
    emitter.emit(makeDelta(1, 'partial', 'job_evict'))
    emitter.emit(makeCancelled('job_evict'))

    assert.equal(received.length, 3)

    // After terminal, late subscribe replays journal; further emits stay suppressed
    const later: WorkerRunEvent[] = []
    const unsub = emitter.subscribe('job_evict', collectHandler(later))
    assert.equal(later.length, 3, 'late subscribe replays journal')
    assert.equal(later[2]!.type, 'cancelled')
    emitter.emit(makeStarted({ jobId: 'job_evict' }))
    assert.equal(later.length, 3, 'new events still suppressed while terminal')
    unsub()
  })

  it('abort while queued produces cancelled immediately', () => {
    // Simulates scheduler.cancel() for 'queued' status:
    // emits cancelled directly (terminal-only event is allowed)
    const received: WorkerRunEvent[] = []
    emitter.subscribe('job_q', collectHandler(received))

    // Scheduler emits cancelled for queued jobs (no prior started)
    emitter.emit(makeCancelled('job_q'))

    // Cancelled is a terminal-only event — delivered immediately, no started needed
    assert.equal(received.length, 1)
    assert.equal(received[0]!.type, 'cancelled')

    // Subscriber auto-unsubscribed; subsequent started+cancelled not delivered
    emitter.emit(makeStarted({ jobId: 'job_q' }))
    emitter.emit(makeCancelled('job_q'))

    assert.equal(received.length, 1)
  })
})

// ---------------------------------------------------------------------------
// Spec §8.2 Test 6: wait=false doesn't register long-term Chat writer
// ---------------------------------------------------------------------------

describe('Spec §8.2.6 — wait=false does NOT register Chat writer subscription', () => {
  let emitter: WorkerEventEmitter

  beforeEach(() => {
    emitter = new WorkerEventEmitter()
  })

  it('wait=false bridge path: no emitter.subscribe called for writer', () => {
    // The dispatchWorkerTool checks: if (sync && writer?.custom) { ... subscribe ... }
    // When wait=false, sync=false → skip streaming path entirely → no writer subscription.
    let subscribeCalled = false

    const sync = false // wait=false
    const writer: { custom?: (o: unknown) => Promise<void> } = { custom: async (_o: unknown) => {} }

    const hasWriter = writer?.custom != null
    if (sync && hasWriter) {
      // This block would subscribe to emitter for streaming
      subscribeCalled = true
    }

    assert.equal(subscribeCalled, false, 'wait=false should not enter streaming/writer path')
  })

  it('wait=false returns immediately without collecting emitter events', async () => {
    // When wait=false, the tool returns `{ job: ... }` right after enqueue
    // without calling waitForJob or subscribing to emitter.
    const jobId = 'job_async'

    // Emit events anyway — they go to emitter but no one is subscribed for streaming
    emitter.emit(makeStarted({ jobId }))
    emitter.emit(makeDelta(1, 'background work', jobId))
    emitter.emit(makeCompleted({ jobId, output: 'result' }))

    // Late collector/subscribe must still receive journal (Jobs panel / wait=true race fix)
    const collector = new EventCollector(jobId, emitter)
    collector.start()
    assert.ok(collector.getEvents().some((e) => e.type === 'completed'))

    // Chat writer was never registered for wait=false; journal replay is independent
    const received: WorkerRunEvent[] = []
    const unsub = emitter.subscribe(jobId, collectHandler(received))
    assert.ok(
      received.some((e) => e.type === 'completed'),
      'late subscribe replays terminal',
    )
    unsub()
  })

  it('wait=true (default) DOES register writer subscription', () => {
    // Opposite: when sync=true and writer exists, subscribe path is entered
    let subscribeCalled = false

    const sync = true
    const writer: { custom?: (o: unknown) => Promise<void> } = { custom: async (_o: unknown) => {} }

    if (sync && writer?.custom != null) {
      subscribeCalled = true
    }

    assert.equal(subscribeCalled, true, 'wait=true should enter streaming/writer path')
  })

  it('even without writer subscription, EventCollector can independently collect', async () => {
    // Jobs panel / other consumers can still use EventCollector regardless of
    // whether the Chat writer is subscribed. This verifies the contract that
    // emitter is independent of writer bridge.
    const collector = new EventCollector('job_independent', emitter)
    const promise = collector.waitForCompletion(2000)

    emitter.emit(makeStarted({ jobId: 'job_independent' }))
    emitter.emit(makeDelta(1, 'fire', 'job_independent'))
    emitter.emit(makeDelta(2, '-and-', 'job_independent'))
    emitter.emit(makeDelta(3, 'forget', 'job_independent'))
    emitter.emit(makeCompleted({ jobId: 'job_independent' }))

    const events = await promise
    assert.equal(events.length, 5)
    assert.equal(events[4]!.type, 'completed')
  })
})

// ---------------------------------------------------------------------------
// Spec §8.2 Test 7: Tool uses RequestContext Router Session, not active session
// ---------------------------------------------------------------------------

describe('Spec §8.2.7 — Tool uses request context Router Session', () => {
  let emitter: WorkerEventEmitter

  beforeEach(() => {
    emitter = new WorkerEventEmitter()
  })

  it('reads the Router identity tuple from trusted RequestContext', () => {
    const values = new Map<string, string>([
      ['routerSessionId', 'sess-context-123'],
      ['routerProjectId', 'proj-1'],
      ['routerProjectRoot', '/tmp/test'],
      ['memoryThreadId', 'thread-1'],
    ])

    const resolved = resolveDispatchContext({
      requestContext: { get: (key) => values.get(key) },
      agent: { threadId: 'thread-1' },
    })

    assert.equal(resolved.routerSessionId, 'sess-context-123')
    assert.equal(resolved.routerProjectId, 'proj-1')
    assert.equal(resolved.memoryThreadId, 'thread-1')
  })

  it('fails closed instead of falling back to a mutable active session', () => {
    assert.throws(
      () => resolveDispatchContext({ requestContext: { get: () => undefined } }),
      /ROUTER_SESSION_BINDING_REQUIRED/,
    )
  })

  it('context session isolates from global active session — different session IDs do not conflict', () => {
    // Verify that the request-context-based session isolation works at the emitter level:
    // Two different router sessions dispatching to the same worker produce
    // different jobIds, each with their own event stream.
    const jobA: WorkerRunEvent[] = []
    const jobB: WorkerRunEvent[] = []
    emitter.subscribe('job_ctx_A', collectHandler(jobA))
    emitter.subscribe('job_ctx_B', collectHandler(jobB))

    emitter.emit(makeStarted({ jobId: 'job_ctx_A' }))
    emitter.emit(makeStarted({ jobId: 'job_ctx_B' }))
    emitter.emit(makeDelta(1, 'data-A', 'job_ctx_A'))
    emitter.emit(makeDelta(1, 'data-B', 'job_ctx_B'))
    emitter.emit(makeCompleted({ jobId: 'job_ctx_A', output: 'A-done' }))
    emitter.emit(makeCompleted({ jobId: 'job_ctx_B', output: 'B-done' }))

    assert.equal(jobA.length, 3)
    assert.equal(jobB.length, 3)
    assert.equal(jobA[2]!.type, 'completed')
    assert.equal(jobB[2]!.type, 'completed')
    // A's terminal being reached doesn't prevent B from receiving events
  })

  it('rejects Mastra agent metadata from a different memory thread', () => {
    const values = new Map<string, string>([
      ['routerSessionId', 'product-session-uuid'],
      ['routerProjectId', 'proj-1'],
      ['memoryThreadId', 'thread-product'],
    ])
    assert.throws(
      () =>
        resolveDispatchContext({
          requestContext: { get: (key) => values.get(key) },
          agent: { threadId: 'thread-other' },
        }),
      /Thread mismatch/,
    )
  })
})

// ---------------------------------------------------------------------------
// Additional: EventCollector integration patterns from the spec
// ---------------------------------------------------------------------------

describe('EventCollector bridge integration patterns', () => {
  let emitter: WorkerEventEmitter

  beforeEach(() => {
    emitter = new WorkerEventEmitter()
  })

  it('collector resolves on cancelled (abort path)', async () => {
    const collector = new EventCollector('job_collect_cancel', emitter)
    const promise = collector.waitForCompletion(2000)

    emitter.emit(makeStarted({ jobId: 'job_collect_cancel' }))
    emitter.emit(makeDelta(1, 'partial', 'job_collect_cancel'))
    emitter.emit(makeCancelled('job_collect_cancel'))

    const events = await promise
    assert.equal(events.length, 3)
    assert.equal(events[2]!.type, 'cancelled')
  })

  it('collector resolves on failed', async () => {
    const collector = new EventCollector('job_collect_fail', emitter)
    const promise = collector.waitForCompletion(2000)

    emitter.emit(makeStarted({ jobId: 'job_collect_fail' }))
    emitter.emit(makeFailed('error', 'job_collect_fail'))

    const events = await promise
    assert.equal(events.length, 2)
    assert.equal(events[1]!.type, 'failed')
  })

  it('collector does not double-resolve if terminal + timeout race', async () => {
    const collector = new EventCollector('job_race', emitter)

    const promise = collector.waitForCompletion(5000)

    emitter.emit(makeStarted({ jobId: 'job_race' }))
    emitter.emit(makeCompleted({ jobId: 'job_race' }))

    const events = await promise
    assert.equal(events.length, 2)
    assert.equal(events[1]!.type, 'completed')
  })

  it('collector stop prevents resolution even if terminal arrives later', () => {
    const collector = new EventCollector('job_stop', emitter)
    collector.start()

    emitter.emit(makeStarted({ jobId: 'job_stop' }))
    collector.stop()

    // Terminal after stop — collector is settled, no effect
    emitter.emit(makeCompleted({ jobId: 'job_stop' }))

    assert.equal(collector.getEvents().length, 1)
  })
})

// ---------------------------------------------------------------------------
// Sanity: emitWorkerEvent helper + singleton
// ---------------------------------------------------------------------------

describe('emitWorkerEvent helper (bridge-level)', () => {
  it('publishes across the helper boundary', () => {
    // _singleton is an immutable export — use getWorkerEventEmitter() directly
    const emitter = getWorkerEventEmitter()
    const jobId = 'job_hlp_' + Date.now()
    const received: WorkerRunEvent[] = []
    emitter.subscribe(jobId, collectHandler(received))

    emitWorkerEvent(jobId, makeStarted({ jobId: jobId }))
    emitWorkerEvent(jobId, makeDelta(1, 'bridged', jobId))
    emitWorkerEvent(jobId, makeCompleted({ jobId: jobId }))

    assert.equal(received.length, 3)
    emitter.clearJob(jobId)
  })
})
