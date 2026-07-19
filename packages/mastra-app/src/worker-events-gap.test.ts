import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { WorkerEventEmitter } from './worker-events.js'
import type { WorkerRunEvent } from '@swarmdesk-agent/shared'

describe('WorkerEventEmitter.detectGap', () => {
  it('returns null when journal covers afterSequence', () => {
    const em = new WorkerEventEmitter({ journalMax: 100 })
    em.emit({
      type: 'started',
      jobId: 'j1',
      workerId: 'w',
      workerName: 'W',
      workerKind: 'codex',
      role: 'coder',
      reusedSession: false,
    })
    em.emit({ type: 'delta', jobId: 'j1', sequence: 1, delta: 'a' })
    assert.equal(em.detectGap('j1', 0), null)
    assert.equal(em.detectGap('j1', 1), null)
  })

  it('signals gap when journal is trimmed past client cursor', () => {
    const em = new WorkerEventEmitter({ journalMax: 5 })
    const jid = 'j-gap'
    em.emit({
      type: 'started',
      jobId: jid,
      workerId: 'w',
      workerName: 'W',
      workerKind: 'codex',
      role: 'coder',
      reusedSession: false,
    })
    for (let i = 0; i < 20; i++) {
      em.emit({ type: 'delta', jobId: jid, sequence: i + 1, delta: `d${i}` })
    }
    // Client that only saw started (seq 1) reconnects — middle deltas dropped
    const gap = em.detectGap(jid, 1)
    assert.ok(gap, 'expected gap after trim')
    assert.equal(gap!.gap, true)
    assert.ok(gap!.retainedFrom > 2, `retainedFrom=${gap!.retainedFrom}`)
  })

  it('signals gap for afterSequence=0 when retained journal has holes', () => {
    const em = new WorkerEventEmitter({ journalMax: 4 })
    const jid = 'j-replay'
    em.emit({
      type: 'started',
      jobId: jid,
      workerId: 'w',
      workerName: 'W',
      workerKind: 'codex',
      role: 'coder',
      reusedSession: false,
    })
    for (let i = 0; i < 10; i++) {
      em.emit({ type: 'delta', jobId: jid, sequence: i + 1, delta: `x${i}` })
    }
    const gap = em.detectGap(jid, 0)
    assert.ok(gap, 'hole after started must signal gap')
    const received: WorkerRunEvent[] = []
    em.subscribe(jid, (e) => received.push(e), { afterSequence: 0 })
    assert.ok(received.length > 0)
    assert.ok(received.every((e) => e.type === 'started' || e.type === 'delta'))
  })
})
