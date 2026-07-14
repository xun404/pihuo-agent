import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { workerRunReducer, seedWorkerStates, cleanupTerminalWorkers } from './worker-run-reducer.js'
import type { WorkerRunEvent, WorkerRunState } from '@router-agents/shared'

function makeStarted(overrides: Partial<WorkerRunEvent & { type: 'started' }> = {}): WorkerRunEvent & { type: 'started' } {
  return {
    type: 'started',
    jobId: 'job-1',
    workerId: 'w-1',
    workerName: 'Codex',
    workerKind: 'codex',
    role: 'coder',
    model: 'gpt-5',
    reusedSession: false,
    ...overrides,
  }
}

function makeDelta(overrides: Partial<WorkerRunEvent & { type: 'delta' }> = {}): WorkerRunEvent & { type: 'delta' } {
  return {
    type: 'delta',
    jobId: 'job-1',
    sequence: 1,
    delta: 'hello\n',
    ...overrides,
  }
}

function makeCompleted(overrides: Partial<WorkerRunEvent & { type: 'completed' }> = {}): WorkerRunEvent & { type: 'completed' } {
  return {
    type: 'completed',
    jobId: 'job-1',
    output: 'hello\nworld\n',
    truncated: false,
    ...overrides,
  }
}

function makeFailed(overrides: Partial<WorkerRunEvent & { type: 'failed' }> = {}): WorkerRunEvent & { type: 'failed' } {
  return {
    type: 'failed',
    jobId: 'job-1',
    output: undefined,
    error: 'ENOENT',
    truncated: false,
    ...overrides,
  }
}

function get(state: Map<string, WorkerRunState>, jobId: string): WorkerRunState {
  const s = state.get(jobId)
  assert.ok(s, `expected state for ${jobId}`)
  return s
}

describe('workerRunReducer', () => {
  describe('started event', () => {
    it('creates a new entry with worker identity', () => {
      const s = workerRunReducer(new Map(), makeStarted())
      const entry = get(s, 'job-1')
      assert.equal(entry.jobId, 'job-1')
      assert.equal(entry.workerName, 'Codex')
      assert.equal(entry.workerKind, 'codex')
      assert.equal(entry.role, 'coder')
      assert.equal(entry.model, 'gpt-5')
      assert.equal(entry.reusedSession, false)
      assert.equal(entry.status, 'running')
      assert.equal(entry.output, '')
      assert.equal(entry.sequence, 0)
      assert.equal(entry.truncated, false)
      assert.ok(entry.startedAt > 0)
    })

    it('is idempotent — does not overwrite existing entry', () => {
      const s1 = workerRunReducer(new Map(), makeStarted())
      const s2 = workerRunReducer(s1, makeStarted({ workerName: 'Claude' }))
      assert.equal(get(s2, 'job-1').workerName, 'Codex')
    })
  })

  describe('delta event', () => {
    it('appends delta text incrementally by sequence', () => {
      let s = workerRunReducer(new Map(), makeStarted())
      s = workerRunReducer(s, makeDelta({ sequence: 1, delta: 'A' }))
      assert.equal(get(s, 'job-1').output, 'A')
      assert.equal(get(s, 'job-1').sequence, 1)
      s = workerRunReducer(s, makeDelta({ sequence: 2, delta: 'B' }))
      assert.equal(get(s, 'job-1').output, 'AB')
      s = workerRunReducer(s, makeDelta({ sequence: 3, delta: 'C' }))
      assert.equal(get(s, 'job-1').output, 'ABC')
    })

    it('ignores duplicate sequence', () => {
      let s = workerRunReducer(new Map(), makeStarted())
      s = workerRunReducer(s, makeDelta({ sequence: 1, delta: 'A' }))
      s = workerRunReducer(s, makeDelta({ sequence: 1, delta: 'X' }))
      assert.equal(get(s, 'job-1').output, 'A')
    })

    it('ignores older (out-of-order) sequence', () => {
      let s = workerRunReducer(new Map(), makeStarted())
      s = workerRunReducer(s, makeDelta({ sequence: 3, delta: 'A' }))
      s = workerRunReducer(s, makeDelta({ sequence: 2, delta: 'X' }))
      assert.equal(get(s, 'job-1').output, 'A')
      assert.equal(get(s, 'job-1').sequence, 3)
    })

    it('ignores delta for unknown jobId', () => {
      const s = workerRunReducer(new Map(), makeDelta({ jobId: 'ghost', sequence: 1 }))
      assert.equal(s.size, 0)
    })

    it('ignores delta after terminal status', () => {
      let s = workerRunReducer(new Map(), makeStarted())
      s = workerRunReducer(s, makeDelta({ sequence: 1, delta: 'A' }))
      s = workerRunReducer(s, makeCompleted({ output: 'final' }))
      s = workerRunReducer(s, makeDelta({ sequence: 2, delta: 'X' }))
      assert.equal(get(s, 'job-1').output, 'final')
      assert.equal(get(s, 'job-1').status, 'completed')
    })
  })

  describe('completed event', () => {
    it('sets terminal status and final output', () => {
      let s = workerRunReducer(new Map(), makeStarted())
      s = workerRunReducer(s, makeDelta({ sequence: 1, delta: 'part' }))
      s = workerRunReducer(s, makeCompleted({ output: 'full output' }))
      const entry = get(s, 'job-1')
      assert.equal(entry.status, 'completed')
      assert.equal(entry.output, 'full output')
      assert.equal(entry.truncated, false)
    })
  })

  describe('failed event', () => {
    it('marks as failed and retains partial output', () => {
      let s = workerRunReducer(new Map(), makeStarted())
      s = workerRunReducer(s, makeDelta({ sequence: 1, delta: 'buildin' }))
      s = workerRunReducer(s, makeFailed({ error: 'ERR', output: undefined }))
      const entry = get(s, 'job-1')
      assert.equal(entry.status, 'failed')
      assert.equal(entry.output, 'buildin')
      assert.equal(entry.error, 'ERR')
    })

    it('uses explicit output from failed event when provided', () => {
      let s = workerRunReducer(new Map(), makeStarted())
      s = workerRunReducer(s, makeDelta({ sequence: 1, delta: 'old' }))
      s = workerRunReducer(s, makeFailed({ output: 'explicit final', error: 'ERR' }))
      assert.equal(get(s, 'job-1').output, 'explicit final')
    })
  })

  describe('cancelled event', () => {
    it('marks as cancelled and retains partial output', () => {
      let s = workerRunReducer(new Map(), makeStarted())
      s = workerRunReducer(s, makeDelta({ sequence: 1, delta: 'running' }))
      s = workerRunReducer(s, {
        type: 'cancelled',
        jobId: 'job-1',
        truncated: false,
      })
      const entry = get(s, 'job-1')
      assert.equal(entry.status, 'cancelled')
      assert.equal(entry.output, 'running')
    })
  })

  describe('truncated hint', () => {
    it('sets truncated=true on terminal events', () => {
      let s = workerRunReducer(new Map(), makeStarted())
      s = workerRunReducer(s, makeCompleted({ output: 'ok', truncated: true }))
      assert.equal(get(s, 'job-1').truncated, true)
    })

    it('sets truncated=true on failed events', () => {
      let s = workerRunReducer(new Map(), makeStarted())
      s = workerRunReducer(s, makeFailed({ truncated: true }))
      assert.equal(get(s, 'job-1').truncated, true)
    })
  })

  describe('multiple parallel jobs', () => {
    it('handles multiple jobIds independently', () => {
      let s = workerRunReducer(new Map(), makeStarted({ jobId: 'j1', workerName: 'A' }))
      s = workerRunReducer(s, makeStarted({ jobId: 'j2', workerName: 'B' }))
      s = workerRunReducer(s, makeDelta({ jobId: 'j1', sequence: 1, delta: 'a1' }))
      s = workerRunReducer(s, makeDelta({ jobId: 'j2', sequence: 1, delta: 'b1' }))
      s = workerRunReducer(s, makeDelta({ jobId: 'j1', sequence: 2, delta: 'a2' }))
      s = workerRunReducer(s, makeCompleted({ jobId: 'j1', output: 'a1a2' }))

      const j1 = get(s, 'j1')
      const j2 = get(s, 'j2')
      assert.equal(j1.status, 'completed')
      assert.equal(j1.output, 'a1a2')
      assert.equal(j1.workerName, 'A')
      assert.equal(j2.status, 'running')
      assert.equal(j2.output, 'b1')
      assert.equal(j2.workerName, 'B')
    })

    it('sequences are per-job, not global', () => {
      let s = workerRunReducer(new Map(), makeStarted({ jobId: 'j1' }))
      s = workerRunReducer(s, makeStarted({ jobId: 'j2' }))
      // j1 at seq 5, j2 at seq 1
      s = workerRunReducer(s, makeDelta({ jobId: 'j1', sequence: 5, delta: 'A' }))
      s = workerRunReducer(s, makeDelta({ jobId: 'j2', sequence: 1, delta: 'B' }))
      assert.equal(get(s, 'j1').sequence, 5)
      assert.equal(get(s, 'j2').sequence, 1)
      assert.equal(get(s, 'j1').output, 'A')
      assert.equal(get(s, 'j2').output, 'B')
    })
  })

  describe('history restoration (Mastra persisted parts)', () => {
    it('can restore a completed card from started + completed events', () => {
      let s = workerRunReducer(new Map(), makeStarted())
      s = workerRunReducer(s, makeCompleted({ output: 'final result' }))
      const entry = get(s, 'job-1')
      assert.equal(entry.status, 'completed')
      assert.equal(entry.output, 'final result')
      assert.equal(entry.workerName, 'Codex')
    })

    it('can restore a failed card with partial output from history', () => {
      let s = workerRunReducer(new Map(), makeStarted())
      s = workerRunReducer(s, makeDelta({ sequence: 1, delta: 'part' }))
      s = workerRunReducer(s, makeFailed({ output: undefined, error: 'timeout' }))
      const entry = get(s, 'job-1')
      assert.equal(entry.status, 'failed')
      assert.equal(entry.output, 'part')
      assert.equal(entry.error, 'timeout')
    })

    it('handles out-of-order history events (terminal before delta)', () => {
      let s = workerRunReducer(new Map(), makeStarted())
      s = workerRunReducer(s, makeCompleted({ output: 'done' }))
      // delta arriving after completed should be ignored
      s = workerRunReducer(s, makeDelta({ sequence: 1, delta: 'late' }))
      assert.equal(get(s, 'job-1').output, 'done')
      assert.equal(get(s, 'job-1').status, 'completed')
    })

    it('idempotent started does not clobber a restored terminal state', () => {
      let s = workerRunReducer(new Map(), makeStarted())
      s = workerRunReducer(s, makeCompleted({ output: 'done' }))
      s = workerRunReducer(s, makeStarted({ workerName: 'Ghost' }))
      assert.equal(get(s, 'job-1').status, 'completed')
      assert.equal(get(s, 'job-1').workerName, 'Codex')
    })
  })

  describe('worker identity is always present', () => {
    it('retains workerName and workerKind through all states', () => {
      let s = workerRunReducer(new Map(), makeStarted({ workerName: 'Claude Code', workerKind: 'claude' }))
      assert.equal(get(s, 'job-1').workerName, 'Claude Code')
      assert.equal(get(s, 'job-1').workerKind, 'claude')

      s = workerRunReducer(s, makeCompleted({ output: 'ok' }))
      assert.equal(get(s, 'job-1').workerName, 'Claude Code')
      assert.equal(get(s, 'job-1').workerKind, 'claude')

      const s2 = workerRunReducer(new Map(), makeStarted({ workerName: 'Codex', workerKind: 'codex' }))
      const s2b = workerRunReducer(s2, makeFailed({ jobId: 'job-1' }))
      assert.equal(get(s2b, 'job-1').workerName, 'Codex')
      assert.equal(get(s2b, 'job-1').workerKind, 'codex')
    })
  })

  describe('running vs terminal rendering markers', () => {
    it('running status means plain text mode (status=running)', () => {
      let s = workerRunReducer(new Map(), makeStarted())
      s = workerRunReducer(s, makeDelta({ sequence: 1, delta: 'text' }))
      assert.equal(get(s, 'job-1').status, 'running')
    })

    it('completed status means Markdown rendering mode', () => {
      let s = workerRunReducer(new Map(), makeStarted())
      s = workerRunReducer(s, makeCompleted({ output: '# markdown' }))
      assert.equal(get(s, 'job-1').status, 'completed')
    })

    it('failed status means Markdown rendering mode', () => {
      let s = workerRunReducer(new Map(), makeStarted())
      s = workerRunReducer(s, makeFailed())
      assert.equal(get(s, 'job-1').status, 'failed')
    })

    it('cancelled status means Markdown rendering mode', () => {
      let s = workerRunReducer(new Map(), makeStarted())
      s = workerRunReducer(s, { type: 'cancelled', jobId: 'job-1', truncated: false })
      assert.equal(get(s, 'job-1').status, 'cancelled')
    })
  })

  describe('immutability', () => {
    it('returns a new Map on every call', () => {
      const initial = new Map()
      const s1 = workerRunReducer(initial, makeStarted())
      assert.notStrictEqual(s1, initial)
      assert.equal(initial.size, 0)

      const s2 = workerRunReducer(s1, makeDelta({ sequence: 1, delta: 'x' }))
      assert.notStrictEqual(s2, s1)
      assert.equal(get(s1, 'job-1').output, '')
    })
  })

  describe('timed_out event', () => {
    it('marks as timed_out like failed/cancelled', () => {
      let s = workerRunReducer(new Map(), makeStarted())
      s = workerRunReducer(s, { type: 'timed_out', jobId: 'job-1', truncated: false })
      const entry = get(s, 'job-1')
      assert.equal(entry.status, 'timed_out')
    })

    it('retains partial output on timed_out', () => {
      let s = workerRunReducer(new Map(), makeStarted())
      s = workerRunReducer(s, makeDelta({ sequence: 1, delta: 'building...' }))
      s = workerRunReducer(s, { type: 'timed_out', jobId: 'job-1', truncated: false })
      const entry = get(s, 'job-1')
      assert.equal(entry.status, 'timed_out')
      assert.equal(entry.output, 'building...')
    })

    it('sets truncated=true on timed_out', () => {
      let s = workerRunReducer(new Map(), makeStarted())
      s = workerRunReducer(s, { type: 'timed_out', jobId: 'job-1', truncated: true })
      assert.equal(get(s, 'job-1').truncated, true)
    })

    it('creates fallback entry from timed_out with workerName', () => {
      const s = workerRunReducer(new Map(), {
        type: 'timed_out',
        jobId: 'job-t',
        output: 'timeout result',
        truncated: true,
        workerName: 'Timeout Worker',
        workerKind: 'codex',
        role: 'coder',
      })
      const entry = get(s, 'job-t')
      assert.equal(entry.status, 'timed_out')
      assert.equal(entry.output, 'timeout result')
      assert.equal(entry.workerName, 'Timeout Worker')
      assert.equal(entry.truncated, true)
    })
  })

  describe('reference stability (no-op returns same Map)', () => {
    it('returns same Map when started event is duplicate', () => {
      const s = workerRunReducer(new Map(), makeStarted())
      const s2 = workerRunReducer(s, makeStarted())
      assert.strictEqual(s2, s)
    })

    it('returns same Map when delta for unknown jobId', () => {
      const s = workerRunReducer(new Map(), makeStarted())
      const s2 = workerRunReducer(s, makeDelta({ jobId: 'unknown', sequence: 1 }))
      assert.strictEqual(s2, s)
    })

    it('returns same Map for duplicate delta sequence', () => {
      let s = workerRunReducer(new Map(), makeStarted())
      s = workerRunReducer(s, makeDelta({ sequence: 1, delta: 'A' }))
      const s2 = workerRunReducer(s, makeDelta({ sequence: 1, delta: 'B' }))
      assert.strictEqual(s2, s)
    })

    it('returns same Map for delta after terminal status', () => {
      let s = workerRunReducer(new Map(), makeStarted())
      s = workerRunReducer(s, makeCompleted({ output: 'done' }))
      const s2 = workerRunReducer(s, makeDelta({ sequence: 1, delta: 'X' }))
      assert.strictEqual(s2, s)
    })

    it('returns same Map when terminal content is identical', () => {
      let s = workerRunReducer(new Map(), makeStarted())
      s = workerRunReducer(s, makeCompleted({ output: 'done', truncated: false }))
      const s2 = workerRunReducer(s, makeCompleted({ output: 'done', truncated: false }))
      assert.strictEqual(s2, s)
    })

    it('returns NEW Map when actual change happens', () => {
      const s = workerRunReducer(new Map(), makeStarted())
      const s2 = workerRunReducer(s, makeDelta({ sequence: 1, delta: 'A' }))
      assert.notStrictEqual(s2, s)
    })

    it('handles streaming deltas efficiently', () => {
      let s: Map<string, WorkerRunState> = new Map()
      s = workerRunReducer(s, makeStarted())
      let changes = 0
      for (let i = 1; i <= 200; i++) {
        const s2 = workerRunReducer(s, makeDelta({ sequence: i, delta: 'x' }))
        if (s2 !== s) changes++
        s = s2
      }
      assert.equal(changes, 200)
    })

    it('skips duplicate terminal event when content matches', () => {
      let s = workerRunReducer(new Map(), makeStarted())
      s = workerRunReducer(s, makeFailed({ output: 'err', error: 'oops', truncated: false }))
      const s2 = workerRunReducer(s, makeFailed({ output: 'err', error: 'oops', truncated: false }))
      assert.strictEqual(s2, s)
    })

    it('creates new Map for terminal event when output differs', () => {
      let s = workerRunReducer(new Map(), makeStarted())
      s = workerRunReducer(s, makeFailed({ output: 'err1', error: 'oops', truncated: false }))
      const s2 = workerRunReducer(s, makeFailed({ output: 'err2', error: 'oops', truncated: false }))
      assert.notStrictEqual(s2, s)
    })
  })

  describe('seedWorkerStates', () => {
    it('seeds worker states from message parts', () => {
      const messages = [
        {
          parts: [
            { type: 'data-worker-run', data: makeStarted() },
            { type: 'data-worker-run', data: makeDelta({ sequence: 1, delta: 'hello' }) },
            { type: 'data-worker-run', data: makeCompleted({ output: 'hello' }) },
          ],
        },
      ]
      const s = seedWorkerStates(new Map(), messages)
      const entry = get(s, 'job-1')
      assert.equal(entry.status, 'completed')
      assert.equal(entry.output, 'hello')
      assert.equal(entry.workerName, 'Codex')
    })

    it('returns same Map when nothing to seed', () => {
      const initial = new Map()
      const s = seedWorkerStates(initial, [])
      assert.strictEqual(s, initial)
    })

    it('skips terminal jobs already in state with non-running status', () => {
      const messages = [
        {
          parts: [
            { type: 'data-worker-run', data: makeStarted() },
            { type: 'data-worker-run', data: makeCompleted({ output: 'done' }) },
          ],
        },
      ]
      let s = workerRunReducer(new Map(), makeStarted())
      s = workerRunReducer(s, makeCompleted({ output: 'done' }))
      const s2 = seedWorkerStates(s, messages)
      assert.strictEqual(s2, s)
    })

    it('processes parallel jobs from multiple messages', () => {
      const messages = [
        {
          parts: [
            { type: 'data-worker-run', data: makeStarted({ jobId: 'j1', workerName: 'A' }) },
            { type: 'data-worker-run', data: makeDelta({ jobId: 'j1', sequence: 1, delta: 'a' }) },
          ],
        },
        {
          parts: [
            { type: 'data-worker-run', data: makeStarted({ jobId: 'j2', workerName: 'B' }) },
            { type: 'data-worker-run', data: makeDelta({ jobId: 'j2', sequence: 1, delta: 'b' }) },
            { type: 'data-worker-run', data: makeCompleted({ jobId: 'j1', output: 'a' }) },
            { type: 'data-worker-run', data: makeCompleted({ jobId: 'j2', output: 'b' }) },
          ],
        },
      ]
      const s = seedWorkerStates(new Map(), messages)
      assert.equal(get(s, 'j1').status, 'completed')
      assert.equal(get(s, 'j1').output, 'a')
      assert.equal(get(s, 'j2').status, 'completed')
      assert.equal(get(s, 'j2').output, 'b')
    })

    it('handles messages without parts', () => {
      const initial = new Map()
      const s = seedWorkerStates(initial, [{}, { parts: undefined }] as any)
      assert.strictEqual(s, initial)
    })

    it('restores a terminal worker card from the persisted dispatch tool result', () => {
      const messages = [
        {
          parts: [
            {
              type: 'tool-dispatch-worker',
              state: 'output-available',
              output: {
                jobId: 'job-fallback',
                status: 'succeeded',
                workerName: 'OpenCode',
                workerId: 'worker-opencode',
                role: 'coder',
                output: 'final answer',
              },
            },
          ],
        },
      ]

      const seeded = seedWorkerStates(new Map(), messages)
      const restored = seeded.get('job-fallback')
      assert.ok(restored)
      assert.equal(restored.status, 'completed')
      assert.equal(restored.workerName, 'OpenCode')
      assert.equal(restored.output, 'final answer')
    })
  })

  describe('cleanupTerminalWorkers', () => {
    it('moves terminal workers to terminal map and removes from active', () => {
      let s = workerRunReducer(new Map(), makeStarted({ jobId: 'j1' }))
      s = workerRunReducer(s, makeStarted({ jobId: 'j2' }))
      s = workerRunReducer(s, makeCompleted({ jobId: 'j1', output: 'done' }))

      const messages = [
        {
          parts: [
            { type: 'data-worker-run', data: makeCompleted({ jobId: 'j1', output: 'done' }) },
          ],
        },
      ]
      const { active, terminal } = cleanupTerminalWorkers(s, messages)
      assert.equal(active.size, 1)
      assert.ok(active.has('j2'))
      assert.ok(!active.has('j1'))
      assert.equal(terminal.size, 1)
      assert.ok(terminal.has('j1'))
      const t = terminal.get('j1')!
      assert.equal(t.status, 'completed')
      assert.equal(t.output, 'done')
    })

    it('returns active as input state when no terminal events', () => {
      let s = workerRunReducer(new Map(), makeStarted())
      const messages = [
        {
          parts: [
            { type: 'data-worker-run', data: makeDelta({ sequence: 1, delta: 'x' }) },
          ],
        },
      ]
      const { active, terminal } = cleanupTerminalWorkers(s, messages)
      assert.strictEqual(active, s)
      assert.equal(terminal.size, 0)
    })

    it('cleans up multiple terminal workers', () => {
      let s = workerRunReducer(new Map(), makeStarted({ jobId: 'j1', workerName: 'A' }))
      s = workerRunReducer(s, makeStarted({ jobId: 'j2', workerName: 'B' }))
      s = workerRunReducer(s, makeStarted({ jobId: 'j3', workerName: 'C' }))
      s = workerRunReducer(s, makeCompleted({ jobId: 'j1', output: 'a' }))
      s = workerRunReducer(s, makeFailed({ jobId: 'j2', output: 'b', error: 'err' }))

      const messages = [
        {
          parts: [
            { type: 'data-worker-run', data: makeCompleted({ jobId: 'j1', output: 'a' }) },
            { type: 'data-worker-run', data: makeFailed({ jobId: 'j2', output: 'b', error: 'err' }) },
          ],
        },
      ]
      const { active, terminal } = cleanupTerminalWorkers(s, messages)
      assert.equal(active.size, 1)
      assert.ok(active.has('j3'))
      assert.equal(terminal.size, 2)
      assert.ok(terminal.has('j1'))
      assert.ok(terminal.has('j2'))
    })

    it('handles timed_out in terminal cleanup', () => {
      let s = workerRunReducer(new Map(), makeStarted())
      s = workerRunReducer(s, { type: 'timed_out', jobId: 'job-1', truncated: false })

      const messages = [
        {
          parts: [
            { type: 'data-worker-run', data: { type: 'timed_out', jobId: 'job-1', truncated: false } },
          ],
        },
      ]
      const { active, terminal } = cleanupTerminalWorkers(s, messages)
      assert.equal(active.size, 0)
      assert.equal(terminal.size, 1)
      assert.equal(terminal.get('job-1')!.status, 'timed_out')
    })

    it('handles empty messages', () => {
      let s = workerRunReducer(new Map(), makeStarted())
      const { active, terminal } = cleanupTerminalWorkers(s, [])
      assert.strictEqual(active, s)
      assert.equal(terminal.size, 0)
    })
  })
})
