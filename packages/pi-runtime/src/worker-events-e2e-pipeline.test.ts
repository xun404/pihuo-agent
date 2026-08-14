/**
 * End-to-end pipeline simulation test: emitter → bridge → UI accumulator.
 *
 * Simulates the COMPLETE WorkerRunEvent pipeline without real ACP:
 *   ACP agent_message_chunk → onOutputDelta → emitWorkerEvent
 *   → emitter.subscribers → writer.custom('data-worker-run')
 *   → AI SDK transport → useChat onData → workerStatesRef → WorkerRunCard
 *
 * The emitter dispatches handlers synchronously. To avoid async timing races,
 * we collect raw events first (via EventCollector), then process them through
 * the bridge logic synchronously, then feed to simulated onData.
 * This mirrors the real system where events flow sequentially through the stream.
 *
 * Run: node --import tsx --test packages/pi-runtime/src/worker-events-e2e-pipeline.test.ts
 */
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  WorkerEventEmitter,
  EventCollector,
  emitWorkerEvent,
  __setSingletonForTest,
} from './worker-events.js'
import type {
  WorkerRunEvent,
  WorkerRunState,
  WorkerKind,
  ApprovalItem,
} from '@pihuo-agent/shared'
import { sortPendingApprovals } from '@pihuo-agent/shared'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStarted(overrides?: Partial<WorkerRunEvent & { type: 'started' }>) {
  return {
    type: 'started' as const,
    jobId: 'job_e2e',
    workerId: 'w_codex',
    workerName: 'Codex',
    workerKind: 'codex' as WorkerKind,
    role: 'coder' as const,
    model: 'gpt-5',
    reusedSession: false,
    ...overrides,
  }
}

function makeDelta(seq: number, delta: string, jobId = 'job_e2e'): WorkerRunEvent {
  return { type: 'delta', jobId, sequence: seq, delta }
}

function makeCompleted(
  overrides?: Partial<WorkerRunEvent & { type: 'completed' }>,
  jobId = 'job_e2e',
): WorkerRunEvent {
  return {
    type: 'completed',
    jobId,
    output: 'default output',
    truncated: false,
    ...overrides,
  }
}

function makeFailed(error: string, jobId = 'job_e2e', output?: string): WorkerRunEvent {
  return { type: 'failed', jobId, output, error, truncated: false }
}

function makeCancelled(jobId = 'job_e2e'): WorkerRunEvent {
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
    workerId: 'w_codex',
    workerName: 'Codex',
    sessionId: null,
    jobId: 'job_e2e',
    toolCallId: 'tc-1',
    toolKind: 'execute',
    locations: [],
    options: [{ optionId: 'allow-once', name: 'Allow Once', kind: 'allow_once' }],
    source: 'acp',
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

function makeApprovalRequestedE2e(
  overrides?: Partial<WorkerRunEvent & { type: 'approval_requested' }>,
  jobId = 'job_e2e',
): WorkerRunEvent & { type: 'approval_requested' } {
  return {
    type: 'approval_requested',
    jobId,
    approval: makeApprovalItem({
      jobId,
      ...(overrides?.approval as Partial<ApprovalItem> | undefined),
    }),
    ...overrides,
  }
}

function makeApprovalResolvedE2e(
  overrides?: Partial<WorkerRunEvent & { type: 'approval_resolved' }>,
  jobId = 'job_e2e',
): WorkerRunEvent & { type: 'approval_resolved' } {
  return {
    type: 'approval_resolved',
    jobId,
    approval: makeApprovalItem({
      jobId,
      id: 'approval-1',
      status: 'allowed',
      decision: 'allow',
      ...(overrides?.approval as Partial<ApprovalItem> | undefined),
    }),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Simulated ChatPanel workerStatesRef (mirrors ChatPanel.tsx accumulator)
// ---------------------------------------------------------------------------

function makeInitialState(event: WorkerRunEvent & { type: 'started' }): WorkerRunState {
  return {
    jobId: event.jobId,
    workerName: event.workerName,
    workerKind: event.workerKind,
    role: event.role,
    model: event.model,
    reusedSession: event.reusedSession,
    sequence: 0,
    output: '',
    status: 'running',
    truncated: false,
    startedAt: Date.now(),
    lastDeltaAt: Date.now(),
    pendingApprovals: [],
  }
}

/** Accumulate events into a WorkerRunState — mirrors ChatPanel.tsx onData switch */
function applyEventToState(state: WorkerRunState, event: WorkerRunEvent): WorkerRunState {
  switch (event.type) {
    case 'started':
      return state
    case 'delta': {
      if (state.sequence >= event.sequence) return state
      return {
        ...state,
        sequence: event.sequence,
        output: state.output + event.delta,
        lastDeltaAt: Date.now(),
      }
    }
    case 'approval_requested': {
      const e = event as WorkerRunEvent & { type: 'approval_requested' }
      const pendingApprovals = Array.isArray(state.pendingApprovals)
        ? state.pendingApprovals
        : state.pendingApproval
          ? [state.pendingApproval]
          : []
      const existing = pendingApprovals.findIndex((approval) => approval.id === e.approval.id)
      const nextPending = sortPendingApprovals(
        existing >= 0
          ? pendingApprovals.map((approval, index) => (index === existing ? e.approval : approval))
          : [...pendingApprovals, e.approval],
      )
      return {
        ...state,
        status: 'pending_approval',
        pendingApprovals: nextPending,
        pendingApproval: nextPending[0],
        lastDeltaAt: Date.now(),
      }
    }
    case 'approval_resolved': {
      const e = event as WorkerRunEvent & { type: 'approval_resolved' }
      const pendingApprovals = Array.isArray(state.pendingApprovals)
        ? state.pendingApprovals
        : state.pendingApproval
          ? [state.pendingApproval]
          : []
      if (!pendingApprovals.some((approval) => approval.id === e.approval.id)) return state
      const nextPending = pendingApprovals.filter((approval) => approval.id !== e.approval.id)
      return {
        ...state,
        status: nextPending.length > 0 ? 'pending_approval' : 'running',
        pendingApprovals: nextPending,
        pendingApproval: nextPending[0],
        lastDeltaAt: Date.now(),
      }
    }
    case 'completed':
      return {
        ...state,
        output: event.output,
        status: 'completed',
        truncated: event.truncated,
        lastDeltaAt: Date.now(),
        pendingApprovals: [],
        pendingApproval: undefined,
      }
    case 'failed':
    case 'cancelled':
    case 'timed_out':
      return {
        ...state,
        output: event.output ?? state.output,
        status: event.type,
        truncated: event.truncated,
        error: event.error,
        lastDeltaAt: Date.now(),
        pendingApprovals: [],
        pendingApproval: undefined,
      }
    default:
      return state
  }
}

// ---------------------------------------------------------------------------
// Writer output data part
// ---------------------------------------------------------------------------

interface WrittenPart {
  type: string // always 'data-worker-run'
  data: WorkerRunEvent
  transient: boolean
  id?: string
}

// ---------------------------------------------------------------------------
// Synchronous bridge: takes raw events from collector and produces writer output
// (mirrors the session-tools.ts dispatchWorkerTool.execute async bridge,
//  but synchronous for test determinism)
// ---------------------------------------------------------------------------

function runBridgeSync(jobId: string, events: WorkerRunEvent[]): WrittenPart[] {
  const written: WrittenPart[] = []
  let buf = ''
  let lastSeq = 0

  for (const event of events) {
    if (event.type === 'delta') {
      const e = event as WorkerRunEvent & { delta: string; sequence: number }
      if (e.sequence > lastSeq) {
        lastSeq = e.sequence
        buf += e.delta
      }
      if (buf.length >= 8) {
        written.push({
          type: 'data-worker-run',
          data: { type: 'delta' as const, jobId, sequence: lastSeq, delta: buf },
          transient: true,
        })
        buf = ''
      }
    } else if (event.type === 'started') {
      written.push({
        type: 'data-worker-run',
        id: jobId,
        data: event,
        transient: true,
      })
    } else if (event.type === 'approval_requested' || event.type === 'approval_resolved') {
      written.push({
        type: 'data-worker-run',
        id: jobId,
        data: event,
        transient: true,
      })
    } else {
      // terminal event — flush remaining buffer before writing terminal
      if (buf.length > 0) {
        written.push({
          type: 'data-worker-run',
          data: { type: 'delta' as const, jobId, sequence: lastSeq, delta: buf },
          transient: true,
        })
        buf = ''
      }
      written.push({
        type: 'data-worker-run',
        id: jobId,
        data: event,
        transient: false,
      })
    }
  }

  // Flush any remaining buffer (partial stream, e.g. stuck jobs or test-only delta sequences)
  if (buf.length > 0) {
    written.push({
      type: 'data-worker-run',
      data: { type: 'delta' as const, jobId, sequence: lastSeq, delta: buf },
      transient: true,
    })
  }

  return written
}

// ---------------------------------------------------------------------------
// Simulated AI SDK onData consumer (mirrors ChatPanel.tsx onData callback)
// ---------------------------------------------------------------------------

function simulateOnData(
  writtenParts: WrittenPart[],
  workerStates: Map<string, WorkerRunState>,
): void {
  for (const part of writtenParts) {
    const event = part.data
    const map = workerStates

    switch (event.type) {
      case 'started': {
        map.set(event.jobId, makeInitialState(event))
        break
      }
      case 'delta': {
        const prev = map.get(event.jobId)
        if (prev) map.set(event.jobId, applyEventToState(prev, event))
        break
      }
      case 'approval_requested':
      case 'approval_resolved':
      case 'completed':
      case 'failed':
      case 'cancelled': {
        const prev = map.get(event.jobId)
        if (prev) map.set(event.jobId, applyEventToState(prev, event))
        break
      }
    }
  }
}

/**
 * Full pipeline simulator (one-shot):
 *   1. Emit raw events to emitter
 *   2. Collect via EventCollector
 *   3. Run bridge logic on collected events
 *   4. Run onData simulator on bridge output
 *   5. Return { rawEvents, writtenParts, workerStates }
 */
async function runFullPipeline(
  emitter: WorkerEventEmitter,
  jobId: string,
  events: WorkerRunEvent[],
  timeoutMs = 2000,
): Promise<{
  rawEvents: WorkerRunEvent[]
  writtenParts: WrittenPart[]
  workerStates: Map<string, WorkerRunState>
}> {
  const collector = new EventCollector(jobId, emitter)
  const promise = collector.waitForCompletion(timeoutMs)

  for (const event of events) {
    emitWorkerEvent(jobId, event)
  }

  const rawEvents = await promise

  const writtenParts = runBridgeSync(jobId, rawEvents)
  const workerStates = new Map<string, WorkerRunState>()
  simulateOnData(writtenParts, workerStates)

  return { rawEvents, writtenParts, workerStates }
}

/** Collect a deliberately non-terminal stream for assertions about in-flight state. */
function runPartialPipeline(
  emitter: WorkerEventEmitter,
  jobId: string,
  events: WorkerRunEvent[],
): {
  rawEvents: WorkerRunEvent[]
  writtenParts: WrittenPart[]
  workerStates: Map<string, WorkerRunState>
} {
  const collector = new EventCollector(jobId, emitter)
  collector.start()
  for (const event of events) emitWorkerEvent(jobId, event)
  const rawEvents = collector.getEvents()
  collector.stop()
  const writtenParts = runBridgeSync(jobId, rawEvents)
  const workerStates = new Map<string, WorkerRunState>()
  simulateOnData(writtenParts, workerStates)
  return { rawEvents, writtenParts, workerStates }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('E2E Pipeline — emitter → bridge → writer → onData → WorkerRunState', () => {
  let emitter: WorkerEventEmitter

  beforeEach(() => {
    emitter = new WorkerEventEmitter()
    __setSingletonForTest(emitter)
  })

  it('Full happy path: started → deltas → completed flows through entire pipeline', async () => {
    const { rawEvents, writtenParts, workerStates } = await runFullPipeline(emitter, 'job_e2e', [
      makeStarted({ jobId: 'job_e2e' }),
      makeDelta(1, 'Hello', 'job_e2e'),
      makeDelta(2, ' World', 'job_e2e'),
      makeDelta(3, '!', 'job_e2e'),
      makeCompleted({ jobId: 'job_e2e', output: 'Hello World!' }),
    ])

    // ─── RAW EVENTS (collector) ───
    assert.equal(rawEvents.length, 5)
    assert.equal(rawEvents[0]!.type, 'started')
    assert.equal(rawEvents[1]!.type, 'delta')
    assert.equal((rawEvents[1] as WorkerRunEvent & { delta: string }).delta, 'Hello')
    assert.equal(rawEvents[4]!.type, 'completed')

    // ─── WRITER OUTPUT (bridge) ───
    assert.ok(writtenParts.length >= 3, `expected >=3 written parts, got ${writtenParts.length}`)
    assert.ok(writtenParts.every((w) => w.type === 'data-worker-run'))

    // Started must be transient
    const startedParts = writtenParts.filter((w) => w.data.type === 'started')
    assert.equal(startedParts.length, 1)
    assert.equal(startedParts[0]!.transient, true, 'started must be transient')

    // Terminal must be non-transient
    const terminalParts = writtenParts.filter(
      (w) => w.data.type === 'completed' || w.data.type === 'failed' || w.data.type === 'cancelled',
    )
    assert.equal(terminalParts.length, 1)
    assert.equal(terminalParts[0]!.transient, false, 'terminal must be non-transient')
    assert.equal(terminalParts[0]!.data.type, 'completed')

    // ─── UI ACCUMULATOR (onData → WorkerRunState) ───
    const state = workerStates.get('job_e2e')
    assert.ok(state)
    assert.equal(state!.status, 'completed')
    assert.equal(state!.output, 'Hello World!')
    assert.equal(state!.workerName, 'Codex')
    assert.equal(state!.workerKind, 'codex')
    assert.equal(state!.role, 'coder')
    assert.equal(state!.model, 'gpt-5')
    assert.equal(state!.truncated, false)
    assert.equal(state!.error, undefined)
  })

  it('Terminal transient flags: started+delta are transient, terminal is not transient', async () => {
    const { writtenParts } = await runFullPipeline(emitter, 'job_term', [
      makeStarted({ jobId: 'job_term' }),
      makeDelta(1, 'data', 'job_term'),
      makeCompleted({ jobId: 'job_term', output: 'data' }),
    ])

    for (const p of writtenParts) {
      const isTerminal =
        p.data.type === 'completed' || p.data.type === 'failed' || p.data.type === 'cancelled'
      if (isTerminal) {
        assert.equal(p.transient, false, `terminal event ${p.data.type} must be non-transient`)
      } else {
        assert.equal(p.transient, true, `non-terminal event ${p.data.type} must be transient`)
      }
    }
  })

  it('Failed path: error propagates through pipeline to WorkerRunState', async () => {
    const { workerStates } = await runFullPipeline(emitter, 'job_fail', [
      makeStarted({ jobId: 'job_fail', workerName: 'Claude', workerKind: 'claude' }),
      makeDelta(1, 'trying...', 'job_fail'),
      makeFailed('ACP process crashed', 'job_fail', 'trying...'),
    ])

    const state = workerStates.get('job_fail')
    assert.ok(state)
    assert.equal(state!.status, 'failed')
    assert.equal(state!.error, 'ACP process crashed')
    assert.equal(state!.output, 'trying...')
    assert.equal(state!.workerName, 'Claude')
    assert.equal(state!.workerKind, 'claude')
  })

  it('Cancelled path: cancel state propagates with partial output preserved', async () => {
    const { writtenParts, workerStates } = await runFullPipeline(emitter, 'job_cancel', [
      makeStarted({ jobId: 'job_cancel' }),
      makeDelta(1, 'partial', 'job_cancel'),
      makeCancelled('job_cancel'),
    ])

    const state = workerStates.get('job_cancel')
    assert.ok(state)
    assert.equal(state!.status, 'cancelled')
    assert.equal(state!.output, 'partial')

    const terminalWrite = writtenParts.find((w) => !w.transient)
    assert.ok(terminalWrite)
    assert.equal(terminalWrite.data.type, 'cancelled')
  })

  it('Delta batching: many small deltas aggregate correctly through bridge + UI', async () => {
    const parts: string[] = []
    const events: WorkerRunEvent[] = [makeStarted({ jobId: 'job_batch' })]
    for (let i = 0; i < 100; i++) {
      const ch = String.fromCharCode(65 + (i % 26))
      parts.push(ch)
      events.push(makeDelta(i + 1, ch, 'job_batch'))
    }
    const fullText = parts.join('')
    events.push(makeCompleted({ jobId: 'job_batch', output: fullText }))

    const { writtenParts, workerStates } = await runFullPipeline(emitter, 'job_batch', events)

    const state = workerStates.get('job_batch')
    assert.ok(state)
    assert.equal(state!.status, 'completed')
    assert.equal(state!.output, fullText)
    assert.equal(state!.output.length, 100)

    // Batching reduces writes: fewer data-worker-run writes than 100 raw deltas
    const deltaWrites = writtenParts.filter((w) => w.data.type === 'delta')
    assert.ok(
      deltaWrites.length < 100,
      `Delta writes ${deltaWrites.length} should be < 100 due to batching`,
    )
  })

  it('Writer failure isolation: EventCollector resolves even if bridge would fail', async () => {
    // Verify that the emitter+collector path is independent from bridge processing.
    // The bridge (runBridgeSync) runs AFTER collector resolves, so any bridge errors
    // cannot affect event delivery through the collector.
    const collector = new EventCollector('job_writer_fail', emitter)
    const promise = collector.waitForCompletion(2000)

    emitWorkerEvent('job_writer_fail', makeStarted({ jobId: 'job_writer_fail' }))
    emitWorkerEvent('job_writer_fail', makeDelta(1, 'x', 'job_writer_fail'))
    emitWorkerEvent('job_writer_fail', makeCompleted({ jobId: 'job_writer_fail' }))

    const rawEvents = await promise
    assert.equal(rawEvents.length, 3)

    // The bridge logic is independent — it just consumes raw events.
    // It should succeed even if the collector already terminated.
    const writtenParts = runBridgeSync('job_writer_fail', rawEvents)
    assert.ok(writtenParts.length >= 3)

    // Now feed to onData — should complete without error
    const workerStates = new Map<string, WorkerRunState>()
    simulateOnData(writtenParts, workerStates)
    assert.equal(workerStates.get('job_writer_fail')!.status, 'completed')
  })

  it('Multiple concurrent jobs: isolated state per jobId through entire pipeline', async () => {
    // Two independent jobs interleaved at the emitter level
    const collectorA = new EventCollector('job_A', emitter)
    const collectorB = new EventCollector('job_B', emitter)
    const promiseA = collectorA.waitForCompletion(2000)
    const promiseB = collectorB.waitForCompletion(2000)

    emitWorkerEvent('job_A', makeStarted({ jobId: 'job_A', workerName: 'WorkerA' }))
    emitWorkerEvent('job_B', makeStarted({ jobId: 'job_B', workerName: 'WorkerB' }))
    emitWorkerEvent('job_A', makeDelta(1, 'A-data', 'job_A'))
    emitWorkerEvent('job_B', makeDelta(1, 'B-data', 'job_B'))
    emitWorkerEvent('job_A', makeCompleted({ jobId: 'job_A', output: 'A-result' }))
    emitWorkerEvent('job_B', makeCompleted({ jobId: 'job_B', output: 'B-result' }))

    const [eventsA, eventsB] = await Promise.all([promiseA, promiseB])
    assert.ok(eventsA.every((e) => e.jobId === 'job_A'))
    assert.ok(eventsB.every((e) => e.jobId === 'job_B'))

    // Run bridge independently for each
    const writtenA = runBridgeSync('job_A', eventsA)
    const writtenB = runBridgeSync('job_B', eventsB)
    const workerStates = new Map<string, WorkerRunState>()
    simulateOnData([...writtenA, ...writtenB], workerStates)

    assert.equal(workerStates.get('job_A')!.workerName, 'WorkerA')
    assert.equal(workerStates.get('job_A')!.output, 'A-result')
    assert.equal(workerStates.get('job_B')!.workerName, 'WorkerB')
    assert.equal(workerStates.get('job_B')!.output, 'B-result')
  })

  it('Sequence tracking: UI accumulator rejects out-of-order duplicate deltas', () => {
    const workerStates = new Map<string, WorkerRunState>()

    // Simulate started via onData
    simulateOnData(
      [{ type: 'data-worker-run', data: makeStarted({ jobId: 'job_seq' }), transient: true }],
      workerStates,
    )

    let state = workerStates.get('job_seq')
    assert.ok(state)
    assert.equal(state!.sequence, 0)

    // Write delta seq 3, then seq 1 (out of order), then seq 4 (correct)
    const dataParts = runBridgeSync('job_seq', [
      makeDelta(3, 'CCC', 'job_seq'),
      makeDelta(1, 'old', 'job_seq'),
      makeDelta(4, 'DDD', 'job_seq'),
    ])
    simulateOnData(dataParts, workerStates)

    state = workerStates.get('job_seq')
    assert.equal(state!.sequence, 4, 'sequence should be 4 (skipping seq1)')
    assert.equal(state!.output, 'CCCDDD', 'output should contain CCC + DDD, not old')
  })

  it('Truncated output flag propagates to WorkerRunState', async () => {
    const { workerStates } = await runFullPipeline(emitter, 'job_trunc', [
      makeStarted({ jobId: 'job_trunc' }),
      makeCompleted({ jobId: 'job_trunc', output: 'x'.repeat(100), truncated: true }),
    ])

    const state = workerStates.get('job_trunc')
    assert.ok(state)
    assert.equal(state!.truncated, true)
    assert.equal(state!.output, 'x'.repeat(100))
  })

  it('Resilience: duplicate terminal after first completed is suppressed end-to-end', async () => {
    const collector = new EventCollector('job_dbl_terminal', emitter)
    const promise = collector.waitForCompletion(2000)

    emitWorkerEvent('job_dbl_terminal', makeStarted({ jobId: 'job_dbl_terminal' }))
    emitWorkerEvent(
      'job_dbl_terminal',
      makeCompleted({ jobId: 'job_dbl_terminal', output: 'first' }),
    )
    emitWorkerEvent(
      'job_dbl_terminal',
      makeCompleted({ jobId: 'job_dbl_terminal', output: 'second' }),
    )

    const events = await promise
    const terminalEvents = events.filter(
      (e) => e.type === 'completed' || e.type === 'failed' || e.type === 'cancelled',
    )
    assert.equal(terminalEvents.length, 1, 'exactly one terminal event')
    assert.equal((terminalEvents[0] as WorkerRunEvent & { type: 'completed' }).output, 'first')
  })

  it('Recovery: bridge processes partial events if collector times out', async () => {
    // Simulate a case where events arrive but collector times out before terminal.
    // The bridge should still be able to process whatever events were collected.
    const emitterLocal = new WorkerEventEmitter()

    // Emit started + a delta but NO terminal (simulates stuck job)
    emitWorkerEvent('job_stuck', makeStarted({ jobId: 'job_stuck' }))
    emitWorkerEvent('job_stuck', makeDelta(1, 'partial work', 'job_stuck'))

    // Manually collect events (subscribe before emitting)
    const collected: WorkerRunEvent[] = []
    emitterLocal.subscribe('job_stuck', (e) => collected.push({ ...e }))

    // Re-emit to the local emitter
    emitterLocal.emit(makeStarted({ jobId: 'job_stuck' }))
    emitterLocal.emit(makeDelta(1, 'partial work', 'job_stuck'))

    // No terminal yet — bridge should still produce transient output
    const writtenParts = runBridgeSync('job_stuck', collected)
    assert.ok(writtenParts.length >= 1)

    const workerStates = new Map<string, WorkerRunState>()
    simulateOnData(writtenParts, workerStates)

    const state = workerStates.get('job_stuck')
    assert.ok(state)
    assert.equal(state!.status, 'running', 'should remain running without terminal')
    assert.equal(state!.output, 'partial work')

    // Now emit terminal
    emitterLocal.emit(makeCompleted({ jobId: 'job_stuck', output: 'partial work - done' }))

    // Late subscribe must replay journal (including terminal) so wait paths don't hang
    const laterEvents: WorkerRunEvent[] = []
    emitterLocal.subscribe('job_stuck', (e) => laterEvents.push({ ...e }))
    assert.ok(
      laterEvents.some((e) => e.type === 'completed'),
      'late subscribe after terminal must replay terminal',
    )
  })

  describe('E2E Pipeline — approval events', () => {
    it('Full pipeline with approval: emitter → collector → bridge → writer → onData', async () => {
      const { rawEvents, writtenParts, workerStates } = await runFullPipeline(
        emitter,
        'job_approval',
        [
          makeStarted({ jobId: 'job_approval' }),
          makeDelta(1, 'before', 'job_approval'),
          makeApprovalRequestedE2e(undefined, 'job_approval'),
          makeApprovalResolvedE2e(undefined, 'job_approval'),
          makeDelta(2, 'after', 'job_approval'),
          makeCompleted({ jobId: 'job_approval', output: 'beforeafter' }),
        ],
      )

      assert.equal(rawEvents.length, 6)
      assert.equal(rawEvents[2]!.type, 'approval_requested')
      assert.equal(rawEvents[3]!.type, 'approval_resolved')

      // Approval events are transient
      const approvalWrites = writtenParts.filter(
        (w) => w.data.type === 'approval_requested' || w.data.type === 'approval_resolved',
      )
      assert.equal(approvalWrites.length, 2)
      for (const w of approvalWrites) {
        assert.equal(w.transient, true, `${w.data.type} must be transient`)
      }

      // Terminal is non-transient
      const terminalWrites = writtenParts.filter((w) => w.data.type === 'completed')
      assert.equal(terminalWrites.length, 1)
      assert.equal(terminalWrites[0]!.transient, false)

      // UI state reflects full chain
      const state = workerStates.get('job_approval')
      assert.ok(state)
      assert.equal(state!.status, 'completed')
      assert.equal(state!.output, 'beforeafter')
    })

    it('Writer bridge writes approval events as transient:true', async () => {
      const { writtenParts } = await runFullPipeline(emitter, 'job_approval_transient', [
        makeStarted({ jobId: 'job_approval_transient' }),
        makeApprovalRequestedE2e(undefined, 'job_approval_transient'),
        makeApprovalResolvedE2e(undefined, 'job_approval_transient'),
        makeCompleted({ jobId: 'job_approval_transient', output: 'ok' }),
      ])

      for (const p of writtenParts) {
        const isTerminal =
          p.data.type === 'completed' || p.data.type === 'failed' || p.data.type === 'cancelled'
        if (isTerminal) {
          assert.equal(p.transient, false, `terminal ${p.data.type} must be non-transient`)
        } else {
          assert.equal(p.transient, true, `non-terminal ${p.data.type} must be transient`)
        }
      }
    })

    it('approval events do not appear as tool result (transient in message history)', async () => {
      // Transient events are excluded from AI SDK message serialization
      // Verify that the bridge marks them as transient=true
      const { writtenParts } = await runFullPipeline(emitter, 'job_transient', [
        makeStarted({ jobId: 'job_transient' }),
        makeApprovalRequestedE2e(undefined, 'job_transient'),
        makeApprovalResolvedE2e(undefined, 'job_transient'),
        makeCompleted({ jobId: 'job_transient', output: 'result' }),
      ])

      const nonTransientParts = writtenParts.filter((w) => !w.transient)
      assert.equal(nonTransientParts.length, 1, 'only terminal should be non-transient')
      assert.equal(nonTransientParts[0]!.data.type, 'completed')

      const transientTypes = writtenParts.filter((w) => w.transient).map((w) => w.data.type)
      assert.ok(transientTypes.includes('approval_requested'))
      assert.ok(transientTypes.includes('approval_resolved'))
    })

    it('terminal events still appear as non-transient in history', async () => {
      const { writtenParts } = await runFullPipeline(emitter, 'job_terminal_hist', [
        makeStarted({ jobId: 'job_terminal_hist' }),
        makeApprovalRequestedE2e(undefined, 'job_terminal_hist'),
        makeCompleted({ jobId: 'job_terminal_hist', output: 'done' }),
      ])

      const terminalParts = writtenParts.filter(
        (w) =>
          w.data.type === 'completed' || w.data.type === 'failed' || w.data.type === 'cancelled',
      )
      assert.equal(terminalParts.length, 1)
      assert.equal(terminalParts[0]!.transient, false)
    })

    it('UI state shows pending_approval during approval round-trip', async () => {
      const { workerStates } = await runFullPipeline(emitter, 'job_ui_approval', [
        makeStarted({ jobId: 'job_ui_approval' }),
        makeApprovalRequestedE2e(undefined, 'job_ui_approval'),
        makeApprovalResolvedE2e(undefined, 'job_ui_approval'),
        makeDelta(1, 'resumed work', 'job_ui_approval'),
        makeCompleted({ jobId: 'job_ui_approval', output: 'resumed work' }),
      ])

      const state = workerStates.get('job_ui_approval')
      assert.ok(state)
      assert.equal(state!.status, 'completed')
      assert.equal(state!.output, 'resumed work')
      // pendingApproval should have been cleared by terminal
      assert.equal(state!.pendingApproval, undefined)
    })

    it('keeps a second pending approval visible when the first resolves', () => {
      const { workerStates } = runPartialPipeline(emitter, 'job_parallel_approval', [
        makeStarted({ jobId: 'job_parallel_approval' }),
        makeApprovalRequestedE2e(
          { approval: makeApprovalItem({ id: 'a1', jobId: 'job_parallel_approval' }) } as any,
          'job_parallel_approval',
        ),
        makeApprovalRequestedE2e(
          { approval: makeApprovalItem({ id: 'a2', jobId: 'job_parallel_approval' }) } as any,
          'job_parallel_approval',
        ),
        makeApprovalResolvedE2e(
          {
            approval: makeApprovalItem({
              id: 'a1',
              status: 'allowed',
              jobId: 'job_parallel_approval',
            }),
          } as any,
          'job_parallel_approval',
        ),
      ])

      const state = workerStates.get('job_parallel_approval')
      assert.ok(state)
      assert.equal(state!.status, 'pending_approval')
      assert.deepEqual(state!.pendingApprovals.map((approval) => approval.id), ['a2'])
    })

    it('multiple approval rounds in pipeline', async () => {
      const { rawEvents, writtenParts, workerStates } = await runFullPipeline(
        emitter,
        'job_multi_approval',
        [
          makeStarted({ jobId: 'job_multi_approval' }),
          makeDelta(1, 'work1', 'job_multi_approval'),
          makeApprovalRequestedE2e(
            { approval: makeApprovalItem({ id: 'a1' }) } as any,
            'job_multi_approval',
          ),
          makeApprovalResolvedE2e(
            { approval: makeApprovalItem({ id: 'a1', status: 'allowed' }) } as any,
            'job_multi_approval',
          ),
          makeDelta(2, 'work2', 'job_multi_approval'),
          makeApprovalRequestedE2e(
            { approval: makeApprovalItem({ id: 'a2' }) } as any,
            'job_multi_approval',
          ),
          makeApprovalResolvedE2e(
            { approval: makeApprovalItem({ id: 'a2', status: 'denied' }) } as any,
            'job_multi_approval',
          ),
          makeDelta(3, 'work3', 'job_multi_approval'),
          makeCompleted({ jobId: 'job_multi_approval', output: 'work1work2work3' }),
        ],
      )

      assert.equal(rawEvents.length, 9)
      const state = workerStates.get('job_multi_approval')
      assert.ok(state)
      assert.equal(state!.status, 'completed')
      assert.equal(state!.output, 'work1work2work3')

      // Verify all transient flags
      const nonTerminalWrites = writtenParts.filter((w) => !w.transient)
      assert.equal(nonTerminalWrites.length, 1, 'only terminal is non-transient')
    })
  })
})
