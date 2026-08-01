import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  WorkerEventEmitter,
  getWorkerEventEmitter,
  emitWorkerEvent,
  EventCollector,
  __setSingletonForTest,
} from './worker-events.js'
import * as workerEventHelpers from './worker-events.js'
import {
  isTerminalWorkerEvent,
  type WorkerRunEvent,
  type ApprovalItem,
} from '@swarmdesk-agent/shared'

describe('worker job timeout normalization', () => {
  it('falls back for missing, non-finite, zero, and negative values', () => {
    for (const raw of [undefined, '', 'NaN', 'Infinity', '0', '-1']) {
      assert.equal(workerEventHelpers.resolveWorkerJobTimeoutMs(raw), 600_000)
    }
  })

  it('uses integer milliseconds and caps values at the Node timer maximum', () => {
    assert.equal(workerEventHelpers.resolveWorkerJobTimeoutMs('123.9'), 123)
    assert.equal(workerEventHelpers.resolveWorkerJobTimeoutMs('999999999999'), 2_147_483_647)
  })
})

describe('worker writer deadline', () => {
  it('bounds a writer promise that never settles', async () => {
    const result = await workerEventHelpers.writeWorkerEventWithDeadline(
      { custom: () => new Promise<void>(() => {}) },
      { type: 'data-worker-run', data: { type: 'delta' }, transient: true },
      20,
    )
    assert.equal(result.ok, false)
    if (result.ok) assert.fail('expected timeout')
    assert.equal(result.timedOut, true)
  })

  it('distinguishes an ordinary writer rejection from a timeout', async () => {
    const result = await workerEventHelpers.writeWorkerEventWithDeadline(
      {
        custom: async () => {
          throw new Error('writer closed')
        },
      },
      { type: 'data-worker-run', data: { type: 'completed' }, transient: false },
      20,
    )
    assert.equal(result.ok, false)
    if (result.ok) assert.fail('expected rejection')
    assert.equal(result.timedOut, false)
  })
})

function makeStarted(
  overrides?: Partial<WorkerRunEvent & { type: 'started' }>,
): WorkerRunEvent & { type: 'started' } {
  return {
    type: 'started',
    jobId: 'job_1',
    workerId: 'w_1',
    workerName: 'Test Worker',
    workerKind: 'claude',
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

function makeApprovalItem(overrides?: Partial<ApprovalItem>): ApprovalItem {
  return {
    id: 'approval-1',
    status: 'pending',
    title: 'Allow command?',
    detail: 'Run: rm -rf',
    action: 'execute_command',
    pathOrTarget: '/bin/bash',
    workerId: 'w_1',
    workerName: 'Test Worker',
    sessionId: null,
    jobId: 'job_1',
    toolCallId: 'tc-1',
    toolKind: 'execute',
    locations: [],
    options: [
      { optionId: 'allow-once', name: 'Allow Once', kind: 'allow_once' },
      { optionId: 'allow-always', name: 'Allow Always', kind: 'allow_always' },
    ],
    source: 'acp',
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

function makeApprovalRequested(
  overrides?: Partial<WorkerRunEvent & { type: 'approval_requested' }>,
): WorkerRunEvent & { type: 'approval_requested' } {
  return {
    type: 'approval_requested',
    jobId: 'job_1',
    approval: makeApprovalItem(overrides?.approval as Partial<ApprovalItem> | undefined),
    ...overrides,
  }
}

function makeApprovalResolved(
  overrides?: Partial<WorkerRunEvent & { type: 'approval_resolved' }>,
): WorkerRunEvent & { type: 'approval_resolved' } {
  return {
    type: 'approval_resolved',
    jobId: 'job_1',
    approval: makeApprovalItem({
      status: 'allowed',
      decision: 'allow',
      ...(overrides?.approval as Partial<ApprovalItem> | undefined),
    }),
    ...overrides,
  }
}

type ReceivedEvent = { type: string; delta?: string }

function collectHandler(target: WorkerRunEvent[]): (e: WorkerRunEvent) => void {
  return (e) => {
    const snapshot = { ...e }
    target.push(snapshot)
  }
}

describe('WorkerEventEmitter', () => {
  let emitter: WorkerEventEmitter

  beforeEach(() => {
    emitter = new WorkerEventEmitter()
  })

  describe('basic subscribe + emit', () => {
    it('delivers started, deltas, completed in order', () => {
      const received: WorkerRunEvent[] = []
      emitter.subscribe('job_1', collectHandler(received))

      emitter.emit(makeStarted())
      emitter.emit(makeDelta(1, 'hello'))
      emitter.emit(makeDelta(2, ' world'))
      emitter.emit(makeCompleted())

      assert.equal(received.length, 4)
      assert.equal(received[0]!.type, 'started')
      assert.equal(received[1]!.type, 'delta')
      assert.equal((received[1] as WorkerRunEvent & { delta: string }).delta, 'hello')
      assert.equal(received[2]!.type, 'delta')
      assert.equal(received[3]!.type, 'completed')
    })

    it('drops events before started', () => {
      const received: WorkerRunEvent[] = []
      emitter.subscribe('job_1', collectHandler(received))

      emitter.emit(makeDelta(1, 'early'))
      emitter.emit(makeCompleted())

      assert.equal(received.length, 0)
    })

    it('delivers failed/cancelled before started as terminal-only', () => {
      const failed: WorkerRunEvent[] = []
      emitter.subscribe('job_fail_only', collectHandler(failed))
      emitter.emit(makeFailed('preflight', 'job_fail_only'))
      assert.equal(failed.length, 1)
      assert.equal(failed[0]!.type, 'failed')

      const cancelled: WorkerRunEvent[] = []
      emitter.subscribe('job_cancel_only', collectHandler(cancelled))
      emitter.emit(makeCancelled('job_cancel_only'))
      assert.equal(cancelled.length, 1)
      assert.equal(cancelled[0]!.type, 'cancelled')
    })

    it('normalizes invalid journalMax without unbounded retention', () => {
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

    it('drops duplicate started events', () => {
      const received: WorkerRunEvent[] = []
      emitter.subscribe('job_1', collectHandler(received))

      emitter.emit(makeStarted())
      emitter.emit(makeStarted())
      emitter.emit(makeDelta(1, 'ok'))
      emitter.emit(makeCompleted())

      // only one started
      assert.equal(received.filter((e) => e.type === 'started').length, 1)
      assert.equal(received.length, 3)
    })

    it('enforces exactly one terminal event', () => {
      const received: WorkerRunEvent[] = []
      emitter.subscribe('job_1', collectHandler(received))

      emitter.emit(makeStarted())
      emitter.emit(makeCompleted())
      emitter.emit(makeFailed('late-error'))

      const terminals = received.filter(
        (e) => e.type === 'completed' || e.type === 'failed' || e.type === 'cancelled',
      )
      assert.equal(terminals.length, 1)
      assert.equal(terminals[0]!.type, 'completed')
    })

    it('drops events after terminal', () => {
      const received: WorkerRunEvent[] = []
      emitter.subscribe('job_1', collectHandler(received))

      emitter.emit(makeStarted())
      emitter.emit(makeCompleted())
      emitter.emit(makeDelta(99, 'post-termination'))

      assert.equal(received.length, 2)
      assert.equal(received[1]!.type, 'completed')
    })

    it('handles multi-round stable order', () => {
      const received: WorkerRunEvent[] = []
      emitter.subscribe('job_1', collectHandler(received))

      emitter.emit(makeStarted())
      for (let i = 0; i < 50; i++) {
        emitter.emit(makeDelta(i, `d${i}`))
      }
      emitter.emit(makeCompleted())

      assert.equal(received.length, 52)
      assert.equal(received[0]!.type, 'started')
      let lastSeq = -1
      for (const e of received.slice(1, 51)) {
        assert.equal(e.type, 'delta')
        const seq = (e as WorkerRunEvent & { sequence: number }).sequence
        assert.ok(seq > lastSeq)
        lastSeq = seq
      }
      assert.equal(received[51]!.type, 'completed')
    })
  })

  describe('multiple subscribers', () => {
    it('all subscribers receive events', () => {
      const a: WorkerRunEvent[] = []
      const b: WorkerRunEvent[] = []
      emitter.subscribe('job_1', collectHandler(a))
      emitter.subscribe('job_1', collectHandler(b))

      emitter.emit(makeStarted())
      emitter.emit(makeDelta(1, 'x'))
      emitter.emit(makeCompleted())

      assert.equal(a.length, 3)
      assert.equal(b.length, 3)
    })

    it('unsubscribe removes one handler only', () => {
      const a: WorkerRunEvent[] = []
      const b: WorkerRunEvent[] = []
      const unsubA = emitter.subscribe('job_1', collectHandler(a))
      emitter.subscribe('job_1', collectHandler(b))

      unsubA()

      emitter.emit(makeStarted())
      emitter.emit(makeCompleted())

      assert.equal(a.length, 0)
      assert.equal(b.length, 2)
    })

    it('double-unsubscribe is safe', () => {
      const a: WorkerRunEvent[] = []
      const unsub = emitter.subscribe('job_1', collectHandler(a))
      unsub()
      unsub()
      emitter.emit(makeStarted())
      assert.equal(a.length, 0)
    })

    it('auto-unsubscribes all on terminal', () => {
      const a: WorkerRunEvent[] = []
      const b: WorkerRunEvent[] = []
      emitter.subscribe('job_1', collectHandler(a))
      emitter.subscribe('job_1', collectHandler(b))

      emitter.emit(makeStarted())
      emitter.emit(makeCompleted())

      assert.equal(a.length, 2)
      assert.equal(b.length, 2)

      // Late subscribe replays journal; live registration not kept for future emits
      const c: WorkerRunEvent[] = []
      const unsubC = emitter.subscribe('job_1', collectHandler(c))
      assert.equal(c.length, 2, 'late subscribe replays started+completed')
      emitter.emit(makeStarted({ jobId: 'job_1' }))
      assert.equal(c.length, 2, 'new emits suppressed while terminal')
      unsubC()
    })

    it('independent jobIds do not interfere', () => {
      const j1: WorkerRunEvent[] = []
      const j2: WorkerRunEvent[] = []
      emitter.subscribe('job_1', collectHandler(j1))
      emitter.subscribe('job_2', collectHandler(j2))

      emitter.emit(makeStarted({ jobId: 'job_1' }))
      emitter.emit(makeStarted({ jobId: 'job_2' }))
      emitter.emit(makeDelta(1, 'a', 'job_1'))
      emitter.emit(makeCompleted({ jobId: 'job_1' }))
      emitter.emit(makeCompleted({ jobId: 'job_2' }))

      assert.equal(j1.length, 3)
      assert.equal(j2.length, 2)
    })
  })

  describe('ANSI / control char sanitisation', () => {
    it('strips ANSI SGR codes from delta', () => {
      const received: WorkerRunEvent[] = []
      emitter.subscribe('job_1', collectHandler(received))
      emitter.emit(makeStarted())
      emitter.emit({
        type: 'delta',
        jobId: 'job_1',
        sequence: 1,
        delta: '\x1b[32mgreen\x1b[0m',
      })

      assert.equal((received[1] as WorkerRunEvent & { delta: string }).delta, 'green')
    })

    it('strips OSC sequences', () => {
      const received: WorkerRunEvent[] = []
      emitter.subscribe('job_1', collectHandler(received))
      emitter.emit(makeStarted())
      emitter.emit({
        type: 'delta',
        jobId: 'job_1',
        sequence: 1,
        delta: 'before\x1b]0;title\x07after',
      })

      assert.equal((received[1] as WorkerRunEvent & { delta: string }).delta, 'beforeafter')
    })

    it('strips dangerous control chars but keeps safe whitespace', () => {
      const received: WorkerRunEvent[] = []
      emitter.subscribe('job_1', collectHandler(received))
      emitter.emit(makeStarted())
      emitter.emit({
        type: 'delta',
        jobId: 'job_1',
        sequence: 1,
        delta: 'line1\nline2\tindented',
      })

      const delta = (received[1] as WorkerRunEvent & { delta: string }).delta
      assert.ok(delta.includes('\n'))
      assert.ok(delta.includes('\t'))
    })

    it('strips null byte and other control chars', () => {
      const received: WorkerRunEvent[] = []
      emitter.subscribe('job_1', collectHandler(received))
      emitter.emit(makeStarted())
      emitter.emit({
        type: 'delta',
        jobId: 'job_1',
        sequence: 1,
        delta: 'a\x00b\x01c\x1fd',
      })

      const delta = (received[1] as WorkerRunEvent & { delta: string }).delta
      assert.equal(delta, 'abcd')
    })

    it('sanitises completed/failed output', () => {
      const received: WorkerRunEvent[] = []
      emitter.subscribe('job_1', collectHandler(received))
      emitter.emit(makeStarted())
      emitter.emit(makeCompleted({ output: '\x1b[32mok\x1b[0m' }))

      const completed = received[1] as WorkerRunEvent & { type: 'completed' }
      assert.equal(completed.output, 'ok')
    })

    it('sanitises composite ANSI + ctrl in a single delta', () => {
      const received: WorkerRunEvent[] = []
      emitter.subscribe('job_1', collectHandler(received))
      emitter.emit(makeStarted())
      emitter.emit({
        type: 'delta',
        jobId: 'job_1',
        sequence: 1,
        delta: '\x1b[1;31mERR\x1b[0m\x07bell\x00\x1f',
      })

      const delta = (received[1] as WorkerRunEvent & { delta: string }).delta
      assert.equal(delta, 'ERRbell')
    })
  })

  describe('thread safety', () => {
    it('handler that unsubscribes during emission does not affect other handlers', () => {
      const a: WorkerRunEvent[] = []
      const b: WorkerRunEvent[] = []
      let unsubA: (() => void) | null = null

      unsubA = emitter.subscribe('job_1', (e) => {
        a.push(e)
        unsubA?.()
      })
      emitter.subscribe('job_1', collectHandler(b))

      emitter.emit(makeStarted())
      emitter.emit(makeDelta(1, 'x'))

      // b should still receive even though a unsubscribed mid-emission
      assert.equal(b.length, 2)
      assert.equal(a.length, 1) // A unsubscribed during started, misses delta
    })

    it('subscribe during emit does not affect current emission', () => {
      const a: WorkerRunEvent[] = []
      let newSubAdded = false
      emitter.subscribe('job_1', (e) => {
        a.push(e)
        if (!newSubAdded) {
          newSubAdded = true
          emitter.subscribe('job_1', () => {})
        }
      })

      emitter.emit(makeStarted())
      // New subscriber added after snapshot was taken — they won't get this one
      emitter.emit(makeCompleted())

      assert.equal(a.length, 2)
    })

    it('does not let one subscriber mutate the event observed by another subscriber', () => {
      let secondDelta = ''
      emitter.subscribe('job_1', (event) => {
        if (event.type === 'delta') event.delta = 'tampered'
      })
      emitter.subscribe('job_1', (event) => {
        if (event.type === 'delta') secondDelta = event.delta
      })

      emitter.emit(makeStarted())
      emitter.emit(makeDelta(1, 'original'))

      assert.equal(secondDelta, 'original')
    })

    it('does not mutate caller-owned events while sanitising output', () => {
      const input = makeDelta(1, '\x1b[32mgreen\x1b[0m') as WorkerRunEvent & {
        type: 'delta'
      }
      const received: WorkerRunEvent[] = []
      emitter.subscribe('job_1', collectHandler(received))

      emitter.emit(makeStarted())
      emitter.emit(input)

      assert.equal(input.delta, '\x1b[32mgreen\x1b[0m')
      assert.equal((received[1] as WorkerRunEvent & { type: 'delta' }).delta, 'green')
    })

    it('returns journal snapshots whose nested approval data cannot mutate retained events', () => {
      emitter.emit(makeStarted())
      emitter.emit({
        type: 'approval_requested',
        jobId: 'job_1',
        approval: {
          id: 'approval_1',
          status: 'pending',
          title: 'Run command',
          locations: [{ filePath: '/tmp/a.ts', line: 3 }],
          options: [{ optionId: 'once', name: 'Allow once', kind: 'allow_once' }],
          source: 'acp',
          createdAt: new Date().toISOString(),
        },
      })

      const first = emitter.getJournal('job_1')
      const approval = first[1]!.event
      assert.equal(approval.type, 'approval_requested')
      if (approval.type !== 'approval_requested') return
      approval.approval.title = 'tampered'
      approval.approval.options[0]!.name = 'tampered'
      approval.approval.locations![0]!.filePath = '/tmp/tampered.ts'

      const second = emitter.getJournal('job_1')[1]!.event
      assert.equal(second.type, 'approval_requested')
      if (second.type !== 'approval_requested') return
      assert.equal(second.approval.title, 'Run command')
      assert.equal(second.approval.options[0]!.name, 'Allow once')
      assert.equal(second.approval.locations![0]!.filePath, '/tmp/a.ts')
    })
  })

  describe('singleton', () => {
    it('getWorkerEventEmitter returns same instance', () => {
      __setSingletonForTest(null)
      const a = getWorkerEventEmitter()
      const b = getWorkerEventEmitter()
      assert.strictEqual(a, b)
      __setSingletonForTest(null)
    })
  })

  describe('clearJob', () => {
    it('removes all subscribers and state', () => {
      const received: WorkerRunEvent[] = []
      emitter.subscribe('job_1', collectHandler(received))
      emitter.emit(makeStarted())

      emitter.clearJob('job_1')

      emitter.emit(makeDelta(1, 'after-clear'))
      emitter.emit(makeCompleted())

      assert.equal(received.length, 1) // only started
    })
  })

  describe('terminal tombstone lifetime', () => {
    it('keeps the dedup tombstone briefly and then releases it', async () => {
      const ConfigurableEmitter = WorkerEventEmitter as unknown as new (options: {
        terminalTtlMs: number
      }) => WorkerEventEmitter
      const emitter = new ConfigurableEmitter({ terminalTtlMs: 10 })
      const received: WorkerRunEvent[] = []

      emitter.subscribe('job_ttl', (event) => received.push(event))
      emitter.emit(makeStarted({ jobId: 'job_ttl' }))
      emitter.emit(makeCompleted({ jobId: 'job_ttl' }))
      assert.equal(received.length, 2)

      // During tombstone: late subscribe replays journal; new started suppressed
      emitter.subscribe('job_ttl', (event) => received.push(event))
      assert.equal(received.length, 4, 'replay adds started+completed')
      emitter.emit(makeStarted({ jobId: 'job_ttl' }))
      assert.equal(received.length, 4, 'dedup holds during tombstone window')

      // The production cleanup timer is deliberately unref'ed, so under a
      // heavily parallel test run a ref'ed fixed sleep can resume before the
      // already-due cleanup callback. Poll the observable state with a strict
      // bound instead of relying on timer callback ordering.
      for (let poll = 0; poll < 100 && emitter.isTerminal('job_ttl'); poll += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1))
      }
      assert.equal(emitter.isTerminal('job_ttl'), false, 'terminal tombstone expires')
      // Journal expired — new job lifecycle can start
      emitter.subscribe('job_ttl', (event) => received.push(event))
      emitter.emit(makeStarted({ jobId: 'job_ttl' }))
      assert.equal(received.length, 5, 'expired journal no longer blocks new started')
      emitter.clearJob('job_ttl')
    })
  })

  describe('approval events', () => {
    it('delivers started → approval_requested', () => {
      const received: WorkerRunEvent[] = []
      emitter.subscribe('job_1', collectHandler(received))

      emitter.emit(makeStarted())
      emitter.emit(makeApprovalRequested())

      assert.equal(received.length, 2)
      assert.equal(received[0]!.type, 'started')
      assert.equal(received[1]!.type, 'approval_requested')
      const approval = (received[1] as WorkerRunEvent & { type: 'approval_requested' }).approval
      assert.equal(approval.id, 'approval-1')
    })

    it('full chain: started → approval_requested → approval_resolved → delta → completed', () => {
      const received: WorkerRunEvent[] = []
      emitter.subscribe('job_1', collectHandler(received))

      emitter.emit(makeStarted())
      emitter.emit(makeApprovalRequested())
      emitter.emit(makeApprovalResolved())
      emitter.emit(makeDelta(1, 'after approval'))
      emitter.emit(makeCompleted())

      assert.equal(received.length, 5)
      assert.equal(received[0]!.type, 'started')
      assert.equal(received[1]!.type, 'approval_requested')
      assert.equal(received[2]!.type, 'approval_resolved')
      assert.equal(received[3]!.type, 'delta')
      assert.equal(received[4]!.type, 'completed')
    })

    it('approval_requested does NOT trigger terminal tombstone', () => {
      const received: WorkerRunEvent[] = []
      emitter.subscribe('job_1', collectHandler(received))

      emitter.emit(makeStarted())
      emitter.emit(makeApprovalRequested())

      // Late mid-stream subscribe replays journal then receives live events
      const more: WorkerRunEvent[] = []
      emitter.subscribe('job_1', collectHandler(more))
      assert.equal(more.length, 2) // replay started + approval_requested
      emitter.emit(makeDelta(1, 'still streaming'))
      emitter.emit(makeCompleted())

      assert.equal(more.length, 4) // + delta, completed
      assert.equal(received.length, 4) // started, approval_requested, delta, completed
    })

    it('approval_requested does NOT trigger auto-unsubscribe', () => {
      const received: WorkerRunEvent[] = []
      emitter.subscribe('job_1', collectHandler(received))

      emitter.emit(makeStarted())
      emitter.emit(makeApprovalRequested())

      // Handlers still active — approval is not terminal
      emitter.emit(makeDelta(1, 'post-approval'))
      assert.equal(received.length, 3)
    })

    it('approval_resolved does NOT trigger terminal', () => {
      const received: WorkerRunEvent[] = []
      emitter.subscribe('job_1', collectHandler(received))

      emitter.emit(makeStarted())
      emitter.emit(makeApprovalRequested())
      emitter.emit(makeApprovalResolved())
      emitter.emit(makeDelta(1, 'resumed'))

      assert.equal(received.length, 4)
      assert.equal(received[3]!.type, 'delta')
    })

    it('terminal after approval events → correct terminal cleanup', () => {
      const received: WorkerRunEvent[] = []
      emitter.subscribe('job_1', collectHandler(received))

      emitter.emit(makeStarted())
      emitter.emit(makeApprovalRequested())
      emitter.emit(makeApprovalResolved())
      emitter.emit(makeDelta(1, 'd'))
      emitter.emit(makeCompleted())

      assert.equal(received[received.length - 1]!.type, 'completed')

      // After terminal, late subscribe replays journal including terminal
      const late: WorkerRunEvent[] = []
      emitter.subscribe('job_1', collectHandler(late))
      assert.ok(late.some((e) => e.type === 'completed'))
      assert.equal(late[late.length - 1]!.type, 'completed')
    })

    it('repeated approval_requested (same approvalId) is handled', () => {
      const received: WorkerRunEvent[] = []
      emitter.subscribe('job_1', collectHandler(received))

      emitter.emit(makeStarted())
      emitter.emit(makeApprovalRequested())
      emitter.emit(makeApprovalRequested())

      assert.equal(received.length, 3)
      assert.equal(received[1]!.type, 'approval_requested')
      assert.equal(received[2]!.type, 'approval_requested')
    })

    it('approval events are legal after started, not terminal-only', () => {
      const received: WorkerRunEvent[] = []
      emitter.subscribe('job_1', collectHandler(received))

      // approval_requested without started should be dropped (not terminal-only)
      emitter.emit(makeApprovalRequested())
      assert.equal(received.length, 0)

      emitter.emit(makeStarted())
      emitter.emit(makeApprovalRequested())
      assert.equal(received.length, 2)
      assert.equal(received[1]!.type, 'approval_requested')
    })

    it('multiple approval rounds in a single job lifecycle', () => {
      const received: WorkerRunEvent[] = []
      emitter.subscribe('job_1', collectHandler(received))

      emitter.emit(makeStarted())
      emitter.emit(makeDelta(1, 'pre-approval'))
      emitter.emit(makeApprovalRequested({ approval: makeApprovalItem({ id: 'a1' }) }))
      emitter.emit(
        makeApprovalResolved({ approval: makeApprovalItem({ id: 'a1', status: 'allowed' }) }),
      )
      emitter.emit(makeDelta(2, 'mid-work'))
      emitter.emit(makeApprovalRequested({ approval: makeApprovalItem({ id: 'a2' }) }))
      emitter.emit(
        makeApprovalResolved({
          approval: makeApprovalItem({ id: 'a2', status: 'denied', decision: 'deny' }),
        }),
      )
      emitter.emit(makeDelta(3, 'final'))
      emitter.emit(makeCompleted())

      assert.equal(received.length, 9)
      const types = received.map((e) => e.type)
      assert.deepStrictEqual(types, [
        'started',
        'delta',
        'approval_requested',
        'approval_resolved',
        'delta',
        'approval_requested',
        'approval_resolved',
        'delta',
        'completed',
      ])
    })
  })
})

describe('emitWorkerEvent helper', () => {
  let emitter: WorkerEventEmitter

  beforeEach(() => {
    emitter = new WorkerEventEmitter()
    __setSingletonForTest(emitter)
  })

  it('publishes to subscribers', () => {
    const received: WorkerRunEvent[] = []
    emitter.subscribe('job_1', collectHandler(received))

    emitWorkerEvent('job_1', makeStarted())
    emitWorkerEvent('job_1', makeCompleted({ output: 'ok' }))

    assert.equal(received.length, 2)
    assert.equal(received[0]!.type, 'started')
    assert.equal(received[1]!.type, 'completed')
  })
})

describe('EventCollector', () => {
  let emitter: WorkerEventEmitter

  beforeEach(() => {
    emitter = new WorkerEventEmitter()
  })

  it('waitForCompletion resolves with all events on terminal', async () => {
    const collector = new EventCollector('job_1', emitter)

    const promise = collector.waitForCompletion(2000)

    emitter.emit(makeStarted({ jobId: 'job_1' }))
    emitter.emit(makeDelta(1, 'building'))
    emitter.emit(makeCompleted({ jobId: 'job_1' }))

    const events = await promise
    assert.equal(events.length, 3)
    assert.equal(events[0]!.type, 'started')
    assert.equal(events[1]!.type, 'delta')
    assert.equal(events[2]!.type, 'completed')
  })

  it('waitForCompletion times out', async () => {
    const collector = new EventCollector('job_1', emitter)

    emitter.emit(makeStarted({ jobId: 'job_1' }))
    emitter.emit(makeDelta(1, 'working...'))

    await assert.rejects(() => collector.waitForCompletion(30), /timed out after 30ms/)
  })

  it('getEvents returns snapshot of collected events', () => {
    const collector = new EventCollector('job_1', emitter)
    collector.start()

    emitter.emit(makeStarted({ jobId: 'job_1' }))
    emitter.emit(makeDelta(1, 'a'))

    const events = collector.getEvents()
    assert.equal(events.length, 2)
    // Ensure snapshot is independent
    events.pop()
    assert.equal(collector.getEvents().length, 2)
  })

  it('stop() prevents further collection', () => {
    const collector = new EventCollector('job_1', emitter)
    collector.start()

    emitter.emit(makeStarted({ jobId: 'job_1' }))
    collector.stop()

    emitter.emit(makeDelta(1, 'after-stop'))
    emitter.emit(makeCompleted({ jobId: 'job_1' }))

    assert.equal(collector.getEvents().length, 1)
  })

  it('start() is idempotent', () => {
    const collector = new EventCollector('job_1', emitter)
    collector.start()
    collector.start()

    emitter.emit(makeStarted({ jobId: 'job_1' }))
    emitter.emit(makeCompleted({ jobId: 'job_1' }))

    assert.equal(collector.getEvents().length, 2)
  })

  it('handles failed terminal', async () => {
    const collector = new EventCollector('job_1', emitter)

    const promise = collector.waitForCompletion(2000)
    emitter.emit(makeStarted({ jobId: 'job_1' }))
    emitter.emit(makeFailed('timeout', 'job_1'))

    const events = await promise
    assert.equal(events.length, 2)
    assert.equal(events[1]!.type, 'failed')
  })

  it('handles cancelled terminal', async () => {
    const collector = new EventCollector('job_1', emitter)

    const promise = collector.waitForCompletion(2000)
    emitter.emit(makeStarted({ jobId: 'job_1' }))
    emitter.emit(makeCancelled('job_1'))

    const events = await promise
    assert.equal(events.length, 2)
    assert.equal(events[1]!.type, 'cancelled')
  })

  it('collects approval events but only resolves on true terminal', async () => {
    const collector = new EventCollector('job_1', emitter)

    const promise = collector.waitForCompletion(2000)

    emitter.emit(makeStarted({ jobId: 'job_1' }))
    emitter.emit(makeDelta(1, 'before', 'job_1'))
    emitter.emit(makeApprovalRequested())

    // Not yet resolved — approval_requested is not terminal
    let resolved = false
    promise.then(() => {
      resolved = true
    })

    await new Promise((r) => setTimeout(r, 20))
    assert.equal(resolved, false, 'should not resolve on approval_requested')

    emitter.emit(makeApprovalResolved())
    emitter.emit(makeDelta(2, 'after', 'job_1'))
    emitter.emit(makeCompleted({ jobId: 'job_1' }))

    const events = await promise
    assert.equal(events.length, 6)
    assert.equal(events[events.length - 1]!.type, 'completed')
  })
})

describe('worker writer bridge helpers', () => {
  it('adds fallback worker identity to terminal-only events', () => {
    const enrich = (workerEventHelpers as Record<string, unknown>).enrichTerminalWorkerEvent
    assert.equal(typeof enrich, 'function')

    const event = (
      enrich as (event: WorkerRunEvent, fallback: Record<string, unknown>) => WorkerRunEvent
    )(
      {
        type: 'failed',
        jobId: 'job_preflight',
        error: 'No worker',
        truncated: false,
      },
      {
        workerName: 'OpenCode',
        workerKind: 'opencode',
        role: 'coder',
        model: 'model-a',
      },
    )

    assert.equal(event.type, 'failed')
    if (event.type !== 'failed') assert.fail('expected failed event')
    assert.equal(event.workerName, 'OpenCode')
    assert.equal(event.workerKind, 'opencode')
    assert.equal(event.role, 'coder')
    assert.equal(event.model, 'model-a')
  })

  it('enrichTerminalWorkerEvent does NOT touch approval events', () => {
    const enrich = (workerEventHelpers as Record<string, unknown>).enrichTerminalWorkerEvent
    assert.equal(typeof enrich, 'function')

    const approvalReq = (
      enrich as (event: WorkerRunEvent, fallback: Record<string, unknown>) => WorkerRunEvent
    )(makeApprovalRequested(), {
      workerName: 'ShouldNotApply',
      workerKind: 'claude',
      role: 'coder',
      model: 'm1',
    })

    assert.equal(approvalReq.type, 'approval_requested')
    // identity should NOT be enriched for non-terminal events
    if (approvalReq.type === 'approval_requested') {
      assert.equal((approvalReq as any).workerName, undefined)
    }
  })

  it('isTerminalWorkerEvent returns false for approval events', () => {
    assert.equal(isTerminalWorkerEvent(makeApprovalRequested()), false)
    assert.equal(isTerminalWorkerEvent(makeApprovalResolved()), false)
    assert.equal(isTerminalWorkerEvent(makeStarted()), false)
    assert.equal(isTerminalWorkerEvent(makeDelta(1, 'x')), false)
    assert.equal(isTerminalWorkerEvent(makeCompleted()), true)
    assert.equal(isTerminalWorkerEvent(makeFailed()), true)
    assert.equal(isTerminalWorkerEvent(makeCancelled()), true)
    assert.equal(isTerminalWorkerEvent({ type: 'timed_out', jobId: 'j', truncated: false }), true)
  })

  it('assigns a distinct increasing sequence to every 8192-char writer chunk', () => {
    const split = (workerEventHelpers as Record<string, unknown>).splitWorkerDeltaChunks
    assert.equal(typeof split, 'function')

    const text = 'x'.repeat(8192 * 2 + 17)
    const result = (
      split as (
        jobId: string,
        text: string,
        sequence: number,
        maxChunk?: number,
      ) => { events: WorkerRunEvent[]; nextSequence: number }
    )('job_large', text, 4, 8192)

    assert.deepEqual(
      result.events.map((event) => (event.type === 'delta' ? event.sequence : -1)),
      [5, 6, 7],
    )
    assert.equal(
      result.events.map((event) => (event.type === 'delta' ? event.delta : '')).join(''),
      text,
    )
    assert.equal(result.nextSequence, 7)
  })

  it('clears the safety timer when the watched job finishes first', async () => {
    const race = (workerEventHelpers as Record<string, unknown>).raceWithTimeout
    assert.equal(typeof race, 'function')
    let timeoutFactoryCalled = false
    const result = await (
      race as <T>(promise: Promise<T>, timeoutMs: number, errorFactory: () => Error) => Promise<T>
    )(Promise.resolve('done'), 10, () => {
      timeoutFactoryCalled = true
      return new Error('late timeout')
    })

    assert.equal(result, 'done')
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(timeoutFactoryCalled, false)
  })

  it('detaches a tool abort listener after the watched job completes', () => {
    const subscribe = (workerEventHelpers as Record<string, unknown>).subscribeAbort
    assert.equal(typeof subscribe, 'function')

    let listener: (() => void) | undefined
    let removed = 0
    const signal = {
      aborted: false,
      addEventListener: (_type: string, next: () => void) => {
        listener = next
      },
      removeEventListener: (_type: string, next: () => void) => {
        if (next === listener) removed += 1
      },
    } as unknown as AbortSignal

    let aborts = 0
    const cleanup = (subscribe as (signal: AbortSignal, handler: () => void) => () => void)(
      signal,
      () => {
        aborts += 1
      },
    )
    cleanup()
    listener?.()

    assert.equal(removed, 1)
    assert.equal(aborts, 0)
  })
})
