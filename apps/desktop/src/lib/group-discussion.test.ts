import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { TeamMember, WorkerRunState } from '@pihuo-agent/shared'
import { deriveGroupDiscussionState } from './group-discussion.js'

function teamMember(id: string): TeamMember {
  return {
    id,
    chatSessionId: 'session-1',
    workerId: `worker-${id}`,
    name: `Member ${id}`,
    roleType: 'coder',
    instructions: 'Work on the assigned task.',
    enabled: true,
    revision: 1,
    createdAt: '2026-08-23T00:00:00.000Z',
    updatedAt: '2026-08-23T00:00:00.000Z',
  }
}

function workerState(overrides: Partial<WorkerRunState> & { jobId: string }): WorkerRunState {
  return {
    workerName: 'Worker',
    workerKind: 'codex',
    reusedSession: false,
    sequence: 0,
    output: '',
    status: 'running',
    truncated: false,
    startedAt: 0,
    lastDeltaAt: 0,
    pendingApprovals: [],
    ...overrides,
  }
}

describe('deriveGroupDiscussionState', () => {
  it('keeps an ordinary single chat out of the group presentation', () => {
    const state = deriveGroupDiscussionState([], [])
    assert.equal(state.enabled, false)
    assert.equal(state.activeWorkerCount, 0)
  })

  it('uses either the existing team or a placed Worker card to enter group presentation', () => {
    assert.equal(deriveGroupDiscussionState([teamMember('1')], []).enabled, true)
    assert.equal(
      deriveGroupDiscussionState([], [workerState({ jobId: 'job-1', status: 'completed' })])
        .enabled,
      true,
    )
  })

  it('counts only running and pending-approval Workers, once per job', () => {
    const state = deriveGroupDiscussionState(
      [],
      [
        workerState({ jobId: 'job-running', status: 'running' }),
        workerState({ jobId: 'job-approval', status: 'pending_approval' }),
        workerState({ jobId: 'job-done', status: 'completed' }),
        workerState({ jobId: 'job-running', status: 'completed' }),
      ],
    )

    assert.equal(state.workerStates.length, 3)
    assert.equal(state.activeWorkerCount, 2)
  })
})
