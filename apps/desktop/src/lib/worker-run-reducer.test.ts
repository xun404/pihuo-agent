import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  workerRunReducer,
  seedWorkerStates,
  cleanupTerminalWorkers,
  seedApprovalsFromSnapshot,
  seedWorkerStatesFromSnapshot,
  terminalWorkerEventFromToolPart,
} from './worker-run-reducer.js'
import type {
  WorkerRunEvent,
  WorkerRunState,
  ApprovalItem,
  WorkerJob,
  WorkerRegistration,
} from '@swarmdesk-agent/shared'

function makeStarted(
  overrides: Partial<WorkerRunEvent & { type: 'started' }> = {},
): WorkerRunEvent & { type: 'started' } {
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

function makeDelta(
  overrides: Partial<WorkerRunEvent & { type: 'delta' }> = {},
): WorkerRunEvent & { type: 'delta' } {
  return {
    type: 'delta',
    jobId: 'job-1',
    sequence: 1,
    delta: 'hello\n',
    ...overrides,
  }
}

function makeCompleted(
  overrides: Partial<WorkerRunEvent & { type: 'completed' }> = {},
): WorkerRunEvent & { type: 'completed' } {
  return {
    type: 'completed',
    jobId: 'job-1',
    output: 'hello\nworld\n',
    truncated: false,
    ...overrides,
  }
}

function makeFailed(
  overrides: Partial<WorkerRunEvent & { type: 'failed' }> = {},
): WorkerRunEvent & { type: 'failed' } {
  return {
    type: 'failed',
    jobId: 'job-1',
    output: undefined,
    error: 'ENOENT',
    truncated: false,
    ...overrides,
  }
}

function makeApprovalItem(overrides: Partial<ApprovalItem> = {}): ApprovalItem {
  return {
    id: 'approval-1',
    status: 'pending',
    title: 'Allow command?',
    detail: 'Run: rm -rf',
    action: 'execute_command',
    pathOrTarget: '/bin/bash',
    workerId: 'w-1',
    workerName: 'Codex',
    sessionId: null,
    jobId: 'job-1',
    toolCallId: 'tc-1',
    toolKind: 'execute',
    locations: [],
    options: [{ optionId: 'allow-once', name: 'Allow Once', kind: 'allow_once' }],
    source: 'acp',
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

function makeJob(overrides: Partial<WorkerJob> = {}): WorkerJob {
  return {
    id: 'job-1',
    sessionId: 'session-1',
    projectId: 'project-1',
    workerId: 'w-1',
    workerName: 'Codex',
    role: 'coder',
    task: 'Implement feature',
    cwd: '/tmp/project',
    status: 'running',
    approvalPolicy: 'manual',
    createdAt: '2026-07-14T01:00:00.000Z',
    startedAt: '2026-07-14T01:00:01.000Z',
    source: 'leader',
    ...overrides,
  }
}

function makeWorker(overrides: Partial<WorkerRegistration> = {}): WorkerRegistration {
  return {
    id: 'w-1',
    name: 'Codex',
    kind: 'codex',
    command: 'codex',
    args: [],
    primaryRole: 'coder',
    roles: ['coder'],
    capabilities: [],
    enabled: true,
    scope: 'global',
    description: '',
    health: 'healthy',
    model: 'gpt-5',
    ...overrides,
  }
}

function makeApprovalRequested(
  overrides: Partial<WorkerRunEvent & { type: 'approval_requested' }> = {},
): WorkerRunEvent & { type: 'approval_requested' } {
  return {
    type: 'approval_requested',
    jobId: 'job-1',
    approval: makeApprovalItem(overrides.approval as Partial<ApprovalItem> | undefined),
    ...overrides,
  }
}

function makeApprovalResolved(
  overrides: Partial<WorkerRunEvent & { type: 'approval_resolved' }> = {},
): WorkerRunEvent & { type: 'approval_resolved' } {
  return {
    type: 'approval_resolved',
    jobId: 'job-1',
    approval: makeApprovalItem({
      status: 'allowed',
      decision: 'allow',
      ...(overrides.approval as Partial<ApprovalItem> | undefined),
    }),
    ...overrides,
  }
}

function get(state: Map<string, WorkerRunState>, jobId: string): WorkerRunState {
  const s = state.get(jobId)
  assert.ok(s, `expected state for ${jobId}`)
  return s
}

describe('workerRunReducer', () => {
  it('restores model and reasoning from a persisted terminal tool result', () => {
    const event = terminalWorkerEventFromToolPart({
      type: 'tool-dispatchTeamMemberTool',
      output: {
        jobId: 'job-1',
        workerName: 'OpenCode',
        status: 'succeeded',
        model: 'opencode-go/deepseek-v4-pro',
        reasoning: 'high',
        output: 'done',
      },
    })

    assert.equal(event?.model, 'opencode-go/deepseek-v4-pro')
    assert.equal(event?.reasoning, 'high')
  })

  it('restores the dispatched Team member name from a persisted terminal tool result', () => {
    const event = terminalWorkerEventFromToolPart({
      type: 'tool-dispatchTeamMemberTool',
      output: {
        jobId: 'job-member',
        workerName: 'Codex CLI',
        teamMemberName: 'Implementation Member',
        status: 'succeeded',
        output: 'done',
      },
    })

    assert.equal(
      (event as (WorkerRunEvent & { teamMemberName?: string }) | null)?.teamMemberName,
      'Implementation Member',
    )
  })

  describe('started event', () => {
    it('creates a new entry with worker identity', () => {
      const s = workerRunReducer(
        new Map(),
        makeStarted({ teamMemberName: 'Implementation Member' } as Partial<
          WorkerRunEvent & { type: 'started'; teamMemberName?: string }
        >),
      )
      const entry = get(s, 'job-1')
      assert.equal(entry.jobId, 'job-1')
      assert.equal((entry as WorkerRunState & { workerId?: string }).workerId, 'w-1')
      assert.equal(entry.workerName, 'Codex')
      assert.equal(entry.workerKind, 'codex')
      assert.equal(
        (entry as WorkerRunState & { teamMemberName?: string }).teamMemberName,
        'Implementation Member',
      )
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
      let s = workerRunReducer(
        new Map(),
        makeStarted({ workerName: 'Claude Code', workerKind: 'claude' }),
      )
      assert.equal(get(s, 'job-1').workerName, 'Claude Code')
      assert.equal(get(s, 'job-1').workerKind, 'claude')

      s = workerRunReducer(s, makeCompleted({ output: 'ok' }))
      assert.equal(get(s, 'job-1').workerName, 'Claude Code')
      assert.equal(get(s, 'job-1').workerKind, 'claude')

      const s2 = workerRunReducer(
        new Map(),
        makeStarted({ workerName: 'Codex', workerKind: 'codex' }),
      )
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
      const s2 = workerRunReducer(
        s,
        makeFailed({ output: 'err2', error: 'oops', truncated: false }),
      )
      assert.notStrictEqual(s2, s)
    })

    it('returns same Map for unmatched approval_resolved', () => {
      let s = workerRunReducer(new Map(), makeStarted())
      s = workerRunReducer(
        s,
        makeApprovalRequested({
          approval: makeApprovalItem({
            id: 'a1',
            createdAt: '2026-07-14T02:00:00.000Z',
          }) as any,
        }),
      )
      // Resolve with non-matching ID
      const s2 = workerRunReducer(
        s,
        makeApprovalResolved({
          approval: makeApprovalItem({
            id: 'a2',
            status: 'allowed',
            createdAt: '2026-07-14T01:00:00.000Z',
          }) as any,
        }),
      )
      assert.strictEqual(s2, s, 'unmatched approval_resolved should return same Map')
    })

    it('records a resolved tombstone even with no prior pendingApproval', () => {
      const s = workerRunReducer(new Map(), makeStarted())
      const event = makeApprovalResolved()
      const s2 = workerRunReducer(s, event)
      assert.notStrictEqual(s2, s)
      assert.equal(get(s2, 'job-1').approvalCursor?.resolved, true)
      assert.strictEqual(workerRunReducer(s2, event), s2)
    })

    it('returns same Map when delta after pending_approval has same sequence', () => {
      let s = workerRunReducer(new Map(), makeStarted())
      s = workerRunReducer(s, makeDelta({ sequence: 1, delta: 'A' }))
      s = workerRunReducer(s, makeApprovalRequested())
      const s2 = workerRunReducer(s, makeDelta({ sequence: 1, delta: 'B' }))
      assert.strictEqual(s2, s)
    })
  })

  describe('approval events', () => {
    it('approval_requested sets pending_approval status and pendingApproval', () => {
      let s = workerRunReducer(new Map(), makeStarted())
      s = workerRunReducer(s, makeApprovalRequested())
      const entry = get(s, 'job-1')
      assert.equal(entry.status, 'pending_approval')
      assert.ok(entry.pendingApproval)
      assert.equal(entry.pendingApproval!.id, 'approval-1')
    })

    it('approval_resolved clears pending and restores running', () => {
      let s = workerRunReducer(new Map(), makeStarted())
      s = workerRunReducer(s, makeApprovalRequested())
      s = workerRunReducer(s, makeApprovalResolved())
      const entry = get(s, 'job-1')
      assert.equal(entry.status, 'running')
      assert.equal(entry.pendingApproval, undefined)
    })

    it('unmatched approval_resolved is no-op (same Map reference)', () => {
      let s = workerRunReducer(new Map(), makeStarted())
      s = workerRunReducer(
        s,
        makeApprovalRequested({
          approval: makeApprovalItem({
            id: 'a1',
            createdAt: '2026-07-14T02:00:00.000Z',
          }) as any,
        }),
      )
      const s2 = workerRunReducer(
        s,
        makeApprovalResolved({
          approval: makeApprovalItem({
            id: 'a2',
            createdAt: '2026-07-14T01:00:00.000Z',
          }) as any,
        }),
      )
      assert.strictEqual(s2, s)
    })

    it('terminal event clears pending_approval', () => {
      let s = workerRunReducer(new Map(), makeStarted())
      s = workerRunReducer(s, makeApprovalRequested())
      s = workerRunReducer(s, makeCompleted({ output: 'done' }))
      const entry = get(s, 'job-1')
      assert.equal(entry.status, 'completed')
      assert.equal(entry.pendingApproval, undefined)
    })

    it('terminal failed event clears pending_approval', () => {
      let s = workerRunReducer(new Map(), makeStarted())
      s = workerRunReducer(s, makeApprovalRequested())
      s = workerRunReducer(s, makeFailed({ error: 'boom' }))
      const entry = get(s, 'job-1')
      assert.equal(entry.status, 'failed')
      assert.equal(entry.pendingApproval, undefined)
    })

    it('repeated approval_requested is idempotent', () => {
      let s = workerRunReducer(new Map(), makeStarted())
      s = workerRunReducer(s, makeApprovalRequested())
      const s2 = workerRunReducer(s, makeApprovalRequested())
      assert.strictEqual(s2, s, 'should return same Map for duplicate approval')
      const entry = get(s, 'job-1')
      assert.equal(entry.pendingApproval!.id, 'approval-1')
    })

    it('long sequence with approval rounds maintains reference stability', () => {
      let s: Map<string, WorkerRunState> = new Map()
      s = workerRunReducer(s, makeStarted())
      s = workerRunReducer(s, makeDelta({ sequence: 1, delta: 'pre' }))
      const sA = workerRunReducer(s, makeApprovalRequested())
      assert.notStrictEqual(sA, s, 'approval_requested should change')
      const sA2 = workerRunReducer(sA, makeApprovalRequested())
      assert.strictEqual(sA2, sA, 'duplicate approval_requested should be no-op')
      const sR = workerRunReducer(sA, makeApprovalResolved())
      assert.notStrictEqual(sR, sA, 'approval_resolved should change')
      s = sR
      s = workerRunReducer(s, makeDelta({ sequence: 2, delta: 'post' }))
      s = workerRunReducer(s, makeCompleted({ output: 'prepost' }))
      const entry = get(s, 'job-1')
      assert.equal(entry.status, 'completed')
      assert.equal(entry.output, 'prepost')
      assert.equal(entry.pendingApproval, undefined)
    })

    it('deltas are accumulated while in pending_approval status', () => {
      let s = workerRunReducer(new Map(), makeStarted())
      s = workerRunReducer(s, makeDelta({ sequence: 1, delta: 'before-' }))
      s = workerRunReducer(s, makeApprovalRequested())
      s = workerRunReducer(s, makeDelta({ sequence: 2, delta: 'during-approval' }))
      const entry = get(s, 'job-1')
      assert.equal(entry.output, 'before-during-approval')
      assert.equal(entry.status, 'pending_approval')
    })

    it('approval_requested on unknown jobId is no-op', () => {
      const s = workerRunReducer(new Map(), makeApprovalRequested())
      assert.equal(s.size, 0)
    })

    it('approval_resolved on unknown jobId is no-op', () => {
      const s = workerRunReducer(new Map(), makeApprovalResolved())
      assert.equal(s.size, 0)
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

    it('restores auth-required identity and code from persisted tool output and snapshot', () => {
      const messages = [
        {
          parts: [
            {
              type: 'tool-dispatch-worker',
              state: 'output-available',
              output: {
                jobId: 'job-auth-required',
                status: 'failed',
                workerId: 'worker-registry',
                workerName: 'Registry Agent',
                workerKind: 'custom',
                role: 'general',
                error: 'Authentication required',
                errorCode: 'WORKER_AUTH_REQUIRED',
              },
            },
          ],
        },
      ]

      const seeded = seedWorkerStates(new Map(), messages)
      assert.equal(seeded.get('job-auth-required')?.workerId, 'worker-registry')
      assert.equal(seeded.get('job-auth-required')?.errorCode, 'WORKER_AUTH_REQUIRED')

      const hydrated = seedWorkerStatesFromSnapshot(seeded, {
        sessionId: 'session-1',
        jobs: [
          makeJob({
            id: 'job-auth-required',
            status: 'failed',
            workerId: 'worker-registry',
            workerName: 'Registry Agent',
            error: 'Authentication required',
            errorCode: 'WORKER_AUTH_REQUIRED',
          }),
        ],
        workers: [makeWorker({ id: 'worker-registry', name: 'Registry Agent', kind: 'custom' })],
        approvals: [],
      })
      assert.equal(hydrated.get('job-auth-required')?.workerId, 'worker-registry')
      assert.equal(hydrated.get('job-auth-required')?.errorCode, 'WORKER_AUTH_REQUIRED')
    })

    it('snapshot seeding: pending ApprovalItem restores pendingApproval on WorkerRunState', () => {
      const messages = [
        {
          parts: [
            { type: 'data-worker-run', data: makeStarted() },
            { type: 'data-worker-run', data: makeApprovalRequested() },
          ],
        },
      ]
      const s = seedWorkerStates(new Map(), messages)
      const entry = get(s, 'job-1')
      assert.equal(entry.status, 'pending_approval')
      assert.ok(entry.pendingApproval)
      assert.equal(entry.pendingApproval!.id, 'approval-1')
    })

    it('snapshot seeding: pending_approval state accepts approval_resolved', () => {
      const approval = makeApprovalItem({ id: 'a1' })
      const messages = [
        {
          parts: [
            { type: 'data-worker-run', data: makeStarted() },
            { type: 'data-worker-run', data: makeApprovalRequested({ approval: approval as any }) },
            {
              type: 'data-worker-run',
              data: makeApprovalResolved({
                approval: makeApprovalItem({ id: 'a1', status: 'allowed' }) as any,
              }),
            },
            { type: 'data-worker-run', data: makeCompleted({ output: 'done' }) },
          ],
        },
      ]
      const s = seedWorkerStates(new Map(), messages)
      const entry = get(s, 'job-1')
      assert.equal(entry.status, 'completed')
      assert.equal(entry.output, 'done')
      assert.equal(entry.pendingApproval, undefined)
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
      const s = workerRunReducer(new Map(), makeStarted())
      const messages = [
        {
          parts: [{ type: 'data-worker-run', data: makeDelta({ sequence: 1, delta: 'x' }) }],
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
            {
              type: 'data-worker-run',
              data: makeFailed({ jobId: 'j2', output: 'b', error: 'err' }),
            },
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
            {
              type: 'data-worker-run',
              data: { type: 'timed_out', jobId: 'job-1', truncated: false },
            },
          ],
        },
      ]
      const { active, terminal } = cleanupTerminalWorkers(s, messages)
      assert.equal(active.size, 0)
      assert.equal(terminal.size, 1)
      assert.equal(terminal.get('job-1')!.status, 'timed_out')
    })

    it('handles empty messages', () => {
      const s = workerRunReducer(new Map(), makeStarted())
      const { active, terminal } = cleanupTerminalWorkers(s, [])
      assert.strictEqual(active, s)
      assert.equal(terminal.size, 0)
    })

    it('approval events are not treated as terminal for cleanup', () => {
      let s = workerRunReducer(new Map(), makeStarted({ jobId: 'j1' }))
      s = workerRunReducer(s, makeStarted({ jobId: 'j2' }))
      s = workerRunReducer(s, makeApprovalRequested({ jobId: 'j1' }))
      s = workerRunReducer(s, makeCompleted({ jobId: 'j2', output: 'done' }))

      const messages = [
        {
          parts: [
            { type: 'data-worker-run', data: makeApprovalRequested({ jobId: 'j1' }) },
            { type: 'data-worker-run', data: makeCompleted({ jobId: 'j2', output: 'done' }) },
          ],
        },
      ]
      const { active, terminal } = cleanupTerminalWorkers(s, messages)
      // j1 is pending_approval, should stay in active
      assert.equal(active.size, 1, 'pending_approval job should remain active')
      assert.ok(active.has('j1'), 'j1 (pending_approval) should be in active')
      assert.equal(terminal.size, 1, 'completed job should be terminal')
      assert.ok(terminal.has('j2'), 'j2 (completed) should be in terminal')
    })

    it('nothing to clean up when only approval events in messages', () => {
      let s = workerRunReducer(new Map(), makeStarted())
      s = workerRunReducer(s, makeApprovalRequested())
      const messages = [
        {
          parts: [
            { type: 'data-worker-run', data: makeApprovalRequested() },
            { type: 'data-worker-run', data: makeApprovalResolved() },
          ],
        },
      ]
      const { active, terminal } = cleanupTerminalWorkers(s, messages)
      assert.strictEqual(active, s, 'no terminal events means same active map')
      assert.equal(terminal.size, 0)
    })
  })

  describe('seedApprovalsFromSnapshot', () => {
    it('sets running worker to pending_approval for matching pending snapshot approval', () => {
      let s = workerRunReducer(new Map(), makeStarted({ jobId: 'j1' }))
      s = workerRunReducer(s, makeStarted({ jobId: 'j2' }))
      const approvals: ApprovalItem[] = [
        makeApprovalItem({ id: 'a1', jobId: 'j1', status: 'pending' }),
      ]
      const result = seedApprovalsFromSnapshot(s, approvals)
      const j1 = result.get('j1')!
      assert.equal(j1.status, 'pending_approval')
      assert.ok(j1.pendingApproval)
      assert.equal(j1.pendingApproval!.id, 'a1')
      const j2 = result.get('j2')!
      assert.equal(j2.status, 'running')
      assert.equal(j2.pendingApproval, undefined)
    })

    it('skips approvals that are not pending', () => {
      const s = workerRunReducer(new Map(), makeStarted({ jobId: 'j1' }))
      const approvals: ApprovalItem[] = [
        makeApprovalItem({ id: 'a1', jobId: 'j1', status: 'allowed' }),
        makeApprovalItem({ id: 'a2', jobId: 'j1', status: 'denied' }),
        makeApprovalItem({ id: 'a3', jobId: 'j1', status: 'cancelled' }),
      ]
      const result = seedApprovalsFromSnapshot(s, approvals)
      const j1 = result.get('j1')!
      assert.equal(j1.status, 'running')
      assert.equal(j1.pendingApproval, undefined)
    })

    it('skips approvals without a jobId', () => {
      const s = workerRunReducer(new Map(), makeStarted({ jobId: 'j1' }))
      const approvals: ApprovalItem[] = [
        makeApprovalItem({ id: 'a1', jobId: undefined, status: 'pending' }),
      ]
      const result = seedApprovalsFromSnapshot(s, approvals)
      const j1 = result.get('j1')!
      assert.equal(j1.status, 'running')
    })

    it('skips approvals for jobIds not in state', () => {
      const s = workerRunReducer(new Map(), makeStarted({ jobId: 'j1' }))
      const approvals: ApprovalItem[] = [
        makeApprovalItem({ id: 'a1', jobId: 'ghost', status: 'pending' }),
      ]
      const result = seedApprovalsFromSnapshot(s, approvals)
      assert.strictEqual(result, s)
    })

    it('skips non-running workers (completed, failed)', () => {
      let s = workerRunReducer(new Map(), makeStarted({ jobId: 'j1' }))
      s = workerRunReducer(s, makeCompleted({ jobId: 'j1', output: 'done' }))
      s = workerRunReducer(s, makeStarted({ jobId: 'j2' }))
      s = workerRunReducer(s, makeFailed({ jobId: 'j2', error: 'err' }))
      const approvals: ApprovalItem[] = [
        makeApprovalItem({ id: 'a1', jobId: 'j1', status: 'pending' }),
        makeApprovalItem({ id: 'a2', jobId: 'j2', status: 'pending' }),
      ]
      const result = seedApprovalsFromSnapshot(s, approvals)
      assert.strictEqual(result, s)
    })

    it('skips workers that are already pending_approval', () => {
      let s = workerRunReducer(new Map(), makeStarted({ jobId: 'j1' }))
      // Live event sets approval-1; pin createdAt so snapshot re-seed cannot race by 1ms.
      const liveAt = '2026-07-14T12:00:00.000Z'
      s = workerRunReducer(
        s,
        makeApprovalRequested({
          jobId: 'j1',
          approval: makeApprovalItem({
            id: 'approval-1',
            jobId: 'j1',
            status: 'pending',
            createdAt: liveAt,
          }),
        }),
      )
      assert.equal(s.get('j1')!.status, 'pending_approval')
      // Same-or-older snapshot row must not thrash the live pending card.
      const approvals: ApprovalItem[] = [
        makeApprovalItem({
          id: 'a1',
          jobId: 'j1',
          status: 'pending',
          createdAt: liveAt,
        }),
      ]
      const result = seedApprovalsFromSnapshot(s, approvals)
      assert.strictEqual(result, s)
      assert.equal(result.get('j1')!.pendingApproval!.id, 'approval-1')
    })

    it('returns a new Map on change', () => {
      const s = workerRunReducer(new Map(), makeStarted({ jobId: 'j1' }))
      const approvals: ApprovalItem[] = [
        makeApprovalItem({ id: 'a1', jobId: 'j1', status: 'pending' }),
      ]
      const result = seedApprovalsFromSnapshot(s, approvals)
      assert.notStrictEqual(result, s)
    })

    it('returns same Map when no changes', () => {
      const s = workerRunReducer(new Map(), makeStarted({ jobId: 'j1' }))
      const approvals: ApprovalItem[] = []
      const result = seedApprovalsFromSnapshot(s, approvals)
      assert.strictEqual(result, s)
    })

    it('handles multiple pending approvals across different jobs', () => {
      let s = workerRunReducer(new Map(), makeStarted({ jobId: 'j1' }))
      s = workerRunReducer(s, makeStarted({ jobId: 'j2' }))
      s = workerRunReducer(s, makeStarted({ jobId: 'j3' }))
      const approvals: ApprovalItem[] = [
        makeApprovalItem({ id: 'a1', jobId: 'j1', status: 'pending' }),
        makeApprovalItem({ id: 'a2', jobId: 'j3', status: 'pending' }),
      ]
      const result = seedApprovalsFromSnapshot(s, approvals)
      assert.equal(result.get('j1')!.status, 'pending_approval')
      assert.equal(result.get('j1')!.pendingApproval!.id, 'a1')
      assert.equal(result.get('j2')!.status, 'running')
      assert.equal(result.get('j3')!.status, 'pending_approval')
      assert.equal(result.get('j3')!.pendingApproval!.id, 'a2')
    })

    it('resolved snapshot after pending real-time does NOT resurrect (monotonic)', () => {
      let s = workerRunReducer(new Map(), makeStarted({ jobId: 'j1' }))
      s = workerRunReducer(
        s,
        makeApprovalRequested({ jobId: 'j1', approval: makeApprovalItem({ id: 'a1' }) as any }),
      )
      s = workerRunReducer(
        s,
        makeApprovalResolved({
          jobId: 'j1',
          approval: makeApprovalItem({ id: 'a1', status: 'allowed' }) as any,
        }),
      )
      assert.equal(get(s, 'j1').status, 'running')
      assert.equal(get(s, 'j1').pendingApproval, undefined)

      const approvals: ApprovalItem[] = [
        makeApprovalItem({ id: 'a1', jobId: 'j1', status: 'pending' }),
        makeApprovalItem({ id: 'a1', jobId: 'j1', status: 'allowed', decision: 'allow' }),
      ]
      const result = seedApprovalsFromSnapshot(s, approvals)
      assert.strictEqual(result, s, 'resolved beats pending, no resurrection')
    })

    it('resolved snapshot clears existing pending_approval (lost real-time event case)', () => {
      let s = workerRunReducer(new Map(), makeStarted({ jobId: 'j1' }))
      s = workerRunReducer(
        s,
        makeApprovalRequested({ jobId: 'j1', approval: makeApprovalItem({ id: 'a1' }) as any }),
      )
      assert.equal(get(s, 'j1').status, 'pending_approval')

      const approvals: ApprovalItem[] = [
        makeApprovalItem({ id: 'a1', jobId: 'j1', status: 'allowed', decision: 'allow' }),
      ]
      const result = seedApprovalsFromSnapshot(s, approvals)
      assert.equal(get(result, 'j1').status, 'running')
      assert.equal(get(result, 'j1').pendingApproval, undefined)
    })

    it('different approval ids are ordered by createdAt before resolved status', () => {
      const s = workerRunReducer(new Map(), makeStarted({ jobId: 'j1' }))
      const approvals: ApprovalItem[] = [
        makeApprovalItem({
          id: 'new-pending',
          jobId: 'j1',
          status: 'pending',
          createdAt: '2026-07-14T02:00:00.000Z',
        }),
        makeApprovalItem({
          id: 'old-resolved',
          jobId: 'j1',
          status: 'allowed',
          decision: 'allow',
          createdAt: '2026-07-14T01:00:00.000Z',
        }),
      ]
      const result = seedApprovalsFromSnapshot(s, approvals)
      assert.equal(get(result, 'j1').status, 'pending_approval')
      assert.equal(get(result, 'j1').pendingApproval?.id, 'new-pending')
    })

    it('an older resolved event cannot clear a newer pending approval', () => {
      let s = workerRunReducer(new Map(), makeStarted({ jobId: 'j1' }))
      s = workerRunReducer(
        s,
        makeApprovalRequested({
          jobId: 'j1',
          approval: makeApprovalItem({
            id: 'new-pending',
            jobId: 'j1',
            createdAt: '2026-07-14T02:00:00.000Z',
          }),
        }),
      )
      const result = workerRunReducer(
        s,
        makeApprovalResolved({
          jobId: 'j1',
          approval: makeApprovalItem({
            id: 'old-resolved',
            jobId: 'j1',
            status: 'allowed',
            createdAt: '2026-07-14T01:00:00.000Z',
          }),
        }),
      )
      assert.strictEqual(result, s)
      assert.equal(get(result, 'j1').pendingApproval?.id, 'new-pending')
    })

    it('pending snapshot on already-resolved job is no-op when snapshot includes resolution', () => {
      const s = workerRunReducer(new Map(), makeStarted({ jobId: 'j1' }))
      const approvals: ApprovalItem[] = [
        makeApprovalItem({ id: 'a1', jobId: 'j1', status: 'allowed', decision: 'allow' }),
        makeApprovalItem({ id: 'a1', jobId: 'j1', status: 'pending' }),
      ]
      const result = seedApprovalsFromSnapshot(s, approvals)
      assert.notStrictEqual(result, s, 'resolved snapshot records a tombstone')
      assert.equal(get(result, 'j1').status, 'running')
      assert.equal(get(result, 'j1').approvalCursor?.resolved, true)
      assert.strictEqual(seedApprovalsFromSnapshot(result, approvals), result)
    })
  })

  describe('seedWorkerStatesFromSnapshot', () => {
    it('hydrates the immutable Team member name from the durable job', () => {
      const result = seedWorkerStatesFromSnapshot(new Map(), {
        sessionId: 'session-1',
        jobs: [makeJob({ teamMemberName: 'Implementation Member' })],
        workers: [makeWorker()],
        approvals: [],
      })

      assert.equal(
        (get(result, 'job-1') as WorkerRunState & { teamMemberName?: string }).teamMemberName,
        'Implementation Member',
      )
    })

    it('hydrates the immutable job model and reasoning instead of current worker defaults', () => {
      const result = seedWorkerStatesFromSnapshot(new Map(), {
        sessionId: 'session-1',
        jobs: [
          makeJob({
            effectiveModel: 'opencode-go/deepseek-v4-pro',
            effectiveReasoning: 'xhigh',
          }),
        ],
        workers: [makeWorker({ model: 'worker-current-model', reasoning: 'low' })],
        approvals: [],
      })

      assert.equal(get(result, 'job-1').model, 'opencode-go/deepseek-v4-pro')
      assert.equal(get(result, 'job-1').reasoning, 'xhigh')
    })

    it('hydrates only active jobs for the current session with worker identity and approval', () => {
      const jobs = [
        makeJob({ id: 'running', status: 'running' }),
        makeJob({
          id: 'pending',
          workerId: 'w-2',
          workerName: 'Claude',
          status: 'pending_approval',
        }),
        makeJob({ id: 'other-session', sessionId: 'session-2', status: 'running' }),
        makeJob({ id: 'terminal', status: 'succeeded' }),
      ]
      const workers = [
        makeWorker(),
        makeWorker({ id: 'w-2', name: 'Claude', kind: 'claude', model: 'sonnet' }),
      ]
      const approvals = [
        makeApprovalItem({
          id: 'approval-pending',
          jobId: 'pending',
          sessionId: 'session-1',
          createdAt: '2026-07-14T02:00:00.000Z',
        }),
      ]

      const result = seedWorkerStatesFromSnapshot(new Map(), {
        sessionId: 'session-1',
        jobs,
        workers,
        approvals,
      })

      assert.deepEqual([...result.keys()].sort(), ['pending', 'running'])
      assert.equal(get(result, 'running').workerKind, 'codex')
      assert.equal(get(result, 'pending').workerKind, 'claude')
      assert.equal(get(result, 'pending').model, 'sonnet')
      assert.equal(get(result, 'pending').status, 'pending_approval')
      assert.equal(get(result, 'pending').pendingApproval?.id, 'approval-pending')

      const repeated = seedWorkerStatesFromSnapshot(result, {
        sessionId: 'session-1',
        jobs,
        workers,
        approvals,
      })
      assert.strictEqual(repeated, result)
    })

    it('applies a persisted reset marker once and does not revive the reset action', () => {
      let state = workerRunReducer(new Map(), makeStarted({ jobId: 'reset-job' }))
      state = workerRunReducer(
        state,
        makeFailed({
          jobId: 'reset-job',
          recoveryError: 'Session recovery failed',
          canResetAcpContext: true,
        }),
      )
      const jobs = [
        makeJob({
          id: 'reset-job',
          status: 'failed',
          meta: { acpContextResetAt: '2026-07-14T03:00:00.000Z' },
        }),
      ]

      const result = seedWorkerStatesFromSnapshot(state, {
        sessionId: 'session-1',
        jobs,
        workers: [makeWorker()],
        approvals: [],
      })
      assert.equal(get(result, 'reset-job').canResetAcpContext, false)
      assert.strictEqual(
        seedWorkerStatesFromSnapshot(result, {
          sessionId: 'session-1',
          jobs,
          workers: [makeWorker()],
          approvals: [],
        }),
        result,
      )
    })

    it('advances a hydrated running job to its durable terminal result', () => {
      const runningJob = makeJob({ id: 'durable-job', status: 'running' })
      const hydrated = seedWorkerStatesFromSnapshot(new Map(), {
        sessionId: 'session-1',
        jobs: [runningJob],
        workers: [makeWorker()],
        approvals: [],
      })
      const completed = seedWorkerStatesFromSnapshot(hydrated, {
        sessionId: 'session-1',
        jobs: [
          {
            ...runningJob,
            status: 'succeeded',
            output: 'final output',
            finishedAt: '2026-07-14T03:00:00.000Z',
          },
        ],
        workers: [makeWorker()],
        approvals: [],
      })

      assert.equal(get(completed, 'durable-job').status, 'completed')
      assert.equal(get(completed, 'durable-job').output, 'final output')
      assert.equal(get(completed, 'durable-job').snapshotHydrated, true)
    })
  })
})
