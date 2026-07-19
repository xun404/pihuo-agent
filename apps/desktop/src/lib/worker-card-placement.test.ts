import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildToolCallJobIdMap,
  projectWorkerCardPlacements,
  shouldRenderGenericToolShell,
} from './worker-card-placement.js'
import type { WorkerRunState } from '@swarmdesk-agent/shared'

function makeState(overrides: Partial<WorkerRunState> & { jobId: string }): WorkerRunState {
  return {
    workerName: 'Test Worker',
    workerKind: 'codex',
    reusedSession: false,
    sequence: 0,
    output: '',
    status: 'running',
    truncated: false,
    startedAt: 1000,
    lastDeltaAt: 1000,
    ...overrides,
  }
}

function makeMsg(overrides: { parts?: unknown[] } = {}) {
  return { role: 'assistant', ...overrides }
}

function workerRunPart(jobId: string) {
  return { type: 'data-worker-run' as const, data: { jobId } }
}

function toolPart(jobId: string) {
  return {
    type: 'tool-dispatch-worker',
    state: 'output-available',
    output: { jobId, status: 'succeeded', workerName: 'Test' },
  }
}

describe('projectWorkerCardPlacements', () => {
  it('always keeps dispatch tool shells visible (process history)', () => {
    assert.equal(shouldRenderGenericToolShell({ type: 'tool-dispatch-worker' }, true), true)
    assert.equal(shouldRenderGenericToolShell({ type: 'tool-dispatch-worker' }, false), true)
    assert.equal(
      shouldRenderGenericToolShell(
        { type: 'tool-dispatch-worker', output: { jobId: 'job-1' } },
        true,
        { placedJobIds: new Set(['job-1']) },
      ),
      true,
      'worker card must not replace/hide the tool row',
    )
  })

  it('places running card from message parts without hiding tool shell', () => {
    const states = new Map([['j1', makeState({ jobId: 'j1', status: 'running' })]])
    const messages = [
      makeMsg({
        parts: [{ type: 'tool-dispatch-worker' }, workerRunPart('j1')],
      }),
    ]
    const placements = projectWorkerCardPlacements(messages, states, new Map())

    assert.equal(placements.length, 1)
    assert.equal(placements[0]?.source, 'message')
    assert.equal(placements.filter((placement) => placement.source === 'live').length, 0)
    assert.equal(shouldRenderGenericToolShell(messages[0]!.parts![0]!, true), true)
  })

  it('tool shells stay visible regardless of concurrent active cards', () => {
    assert.equal(
      shouldRenderGenericToolShell(
        { type: 'tool-dispatch-worker', output: { jobId: 'job-A' } },
        true,
        { placedJobIds: new Set(['job-B']) },
      ),
      true,
    )
    assert.equal(
      shouldRenderGenericToolShell({ type: 'tool-dispatch-worker', toolCallId: 'tc-1' }, true, {
        placedJobIds: new Set(['job-A']),
        toolCallJobIds: new Map([['tc-1', 'job-A']]),
      }),
      true,
    )
  })

  it('buildToolCallJobIdMap extracts jobId from tool output', () => {
    const map = buildToolCallJobIdMap([
      {
        role: 'assistant',
        parts: [
          {
            type: 'tool-dispatch-worker',
            toolCallId: 'tc-x',
            output: { jobId: 'job-x', status: 'running' },
          },
        ],
      },
    ])
    assert.equal(map.get('tc-x'), 'job-x')
  })

  it('single live job, no message part', () => {
    const states = new Map([['j1', makeState({ jobId: 'j1', status: 'running' })]])
    const placements = projectWorkerCardPlacements([], states, new Map())
    assert.equal(placements.length, 1)
    assert.equal(placements[0].jobId, 'j1')
    assert.equal(placements[0].source, 'live')
  })

  it('single job with message part → message placement, 0 live', () => {
    const states = new Map([['j1', makeState({ jobId: 'j1', status: 'running' })]])
    const messages = [makeMsg({ parts: [workerRunPart('j1')] })]
    const placements = projectWorkerCardPlacements(messages, states, new Map())
    assert.equal(placements.length, 1)
    assert.equal(placements[0].source, 'message')
    assert.equal(placements[0].jobId, 'j1')
  })

  it('same jobId in message + live → only message placement', () => {
    const states = new Map([['j1', makeState({ jobId: 'j1', status: 'running' })]])
    const messages = [makeMsg({ parts: [workerRunPart('j1')] })]
    const placements = projectWorkerCardPlacements(messages, states, new Map())
    assert.equal(placements.length, 1)
    assert.equal(placements[0].source, 'message')
  })

  it('two different jobs, one in message one live', () => {
    const states = new Map([
      ['j1', makeState({ jobId: 'j1', status: 'running' })],
      ['j2', makeState({ jobId: 'j2', status: 'running' })],
    ])
    const messages = [makeMsg({ parts: [workerRunPart('j1')] })]
    const placements = projectWorkerCardPlacements(messages, states, new Map())
    assert.equal(placements.length, 2)
    const msgPlacements = placements.filter((p) => p.source === 'message')
    const livePlacements = placements.filter((p) => p.source === 'live')
    assert.equal(msgPlacements.length, 1)
    assert.equal(msgPlacements[0].jobId, 'j1')
    assert.equal(livePlacements.length, 1)
    assert.equal(livePlacements[0].jobId, 'j2')
  })

  it('same job across multiple messages → only first message placement', () => {
    const states = new Map([['j1', makeState({ jobId: 'j1', status: 'running' })]])
    const messages = [
      makeMsg({ parts: [workerRunPart('j1')] }),
      makeMsg({ parts: [workerRunPart('j1')] }),
    ]
    const placements = projectWorkerCardPlacements(messages, states, new Map())
    assert.equal(placements.length, 1)
    assert.equal(placements[0].messageIndex, 0)
    assert.equal(placements[0].partIndex, 0)
  })

  it('multiple data-worker-run parts in same message → only first part', () => {
    const states = new Map([['j1', makeState({ jobId: 'j1', status: 'running' })]])
    const messages = [makeMsg({ parts: [workerRunPart('j1'), workerRunPart('j1')] })]
    const placements = projectWorkerCardPlacements(messages, states, new Map())
    assert.equal(placements.length, 1)
    assert.equal(placements[0].partIndex, 0)
  })

  it('terminal job in message parts → message placement, no live', () => {
    const runningStates = new Map<string, WorkerRunState>()
    const terminalStates = new Map([['j1', makeState({ jobId: 'j1', status: 'completed' })]])
    const messages = [makeMsg({ parts: [workerRunPart('j1')] })]
    const placements = projectWorkerCardPlacements(messages, runningStates, terminalStates)
    assert.equal(placements.length, 1)
    assert.equal(placements[0].source, 'message')
    assert.equal(placements[0].state.status, 'completed')
  })

  it('terminal job not in messages → no placement', () => {
    const runningStates = new Map<string, WorkerRunState>()
    const terminalStates = new Map([['j1', makeState({ jobId: 'j1', status: 'completed' })]])
    const placements = projectWorkerCardPlacements([], runningStates, terminalStates)
    assert.equal(placements.length, 0)
  })

  it('a snapshot-hydrated job keeps one live placement after becoming terminal', () => {
    const states = new Map([
      ['j1', makeState({ jobId: 'j1', status: 'completed', snapshotHydrated: true })],
    ])
    const placements = projectWorkerCardPlacements([], states, new Map())
    assert.equal(placements.length, 1)
    assert.equal(placements[0].jobId, 'j1')
    assert.equal(placements[0].source, 'live')
  })

  it('pending_approval job without message part → live placement', () => {
    const states = new Map([['j1', makeState({ jobId: 'j1', status: 'pending_approval' })]])
    const placements = projectWorkerCardPlacements([], states, new Map())
    assert.equal(placements.length, 1)
    assert.equal(placements[0].source, 'live')
    assert.equal(placements[0].state.status, 'pending_approval')
  })

  it('pending_approval job with message part → message placement', () => {
    const states = new Map([['j1', makeState({ jobId: 'j1', status: 'pending_approval' })]])
    const messages = [makeMsg({ parts: [workerRunPart('j1')] })]
    const placements = projectWorkerCardPlacements(messages, states, new Map())
    assert.equal(placements.length, 1)
    assert.equal(placements[0].source, 'message')
  })

  it('multiple jobs, mix of live and message → sorted correctly', () => {
    const states = new Map([
      ['j1', makeState({ jobId: 'j1', status: 'running' })],
      ['j2', makeState({ jobId: 'j2', status: 'running', startedAt: 2000 })],
      ['j3', makeState({ jobId: 'j3', status: 'running' })],
    ])
    const messages = [makeMsg({ parts: [workerRunPart('j1')] })]
    const placements = projectWorkerCardPlacements(messages, states, new Map())
    assert.equal(placements.length, 3)
    assert.equal(placements[0].source, 'message')
    assert.equal(placements[0].jobId, 'j1')
    assert.equal(placements[1].source, 'live')
    assert.equal(placements[1].jobId, 'j3')
    assert.equal(placements[2].source, 'live')
    assert.equal(placements[2].jobId, 'j2')
  })

  it('same input returns equivalent output (no randomness)', () => {
    const states = new Map([
      ['j1', makeState({ jobId: 'j1', status: 'running' })],
      ['j2', makeState({ jobId: 'j2', status: 'running' })],
      ['j3', makeState({ jobId: 'j3', status: 'running' })],
    ])
    const messages = [makeMsg({ parts: [workerRunPart('j2')] })]
    const p1 = projectWorkerCardPlacements(messages, states, new Map())
    const p2 = projectWorkerCardPlacements(messages, new Map(states), new Map())
    assert.deepStrictEqual(p1, p2)
  })

  it('live placement order sorted by startedAt', () => {
    const states = new Map([
      ['j1', makeState({ jobId: 'j1', status: 'running', startedAt: 3000 })],
      ['j2', makeState({ jobId: 'j2', status: 'running', startedAt: 1000 })],
      ['j3', makeState({ jobId: 'j3', status: 'running', startedAt: 2000 })],
    ])
    const placements = projectWorkerCardPlacements([], states, new Map())
    assert.equal(placements.length, 3)
    assert.equal(placements[0].jobId, 'j2')
    assert.equal(placements[1].jobId, 'j3')
    assert.equal(placements[2].jobId, 'j1')
  })

  it('tool part with jobId creates message placement', () => {
    const states = new Map([['j1', makeState({ jobId: 'j1', status: 'running' })]])
    const messages = [makeMsg({ parts: [toolPart('j1')] })]
    const placements = projectWorkerCardPlacements(messages, states, new Map())
    assert.equal(placements.length, 1)
    assert.equal(placements[0].source, 'message')
    assert.equal(placements[0].jobId, 'j1')
  })

  it('tool part and worker-run part with same jobId → first wins', () => {
    const states = new Map([['j1', makeState({ jobId: 'j1', status: 'running' })]])
    const messages = [makeMsg({ parts: [toolPart('j1'), workerRunPart('j1')] })]
    const placements = projectWorkerCardPlacements(messages, states, new Map())
    assert.equal(placements.length, 1)
    assert.equal(placements[0].source, 'message')
    assert.equal(placements[0].partIndex, 0)
  })

  it('failed job not in workerStates or terminalStates → skipped', () => {
    const states = new Map<string, WorkerRunState>()
    const terminal = new Map<string, WorkerRunState>()
    const messages = [makeMsg({ parts: [workerRunPart('ghost')] })]
    const placements = projectWorkerCardPlacements(messages, states, terminal)
    assert.equal(placements.length, 0)
  })

  it('empty states and empty messages → empty array', () => {
    const placements = projectWorkerCardPlacements([], new Map(), new Map())
    assert.equal(placements.length, 0)
  })

  it('message without parts is skipped', () => {
    const states = new Map([['j1', makeState({ jobId: 'j1', status: 'running' })]])
    const messages = [makeMsg({ parts: undefined })]
    const placements = projectWorkerCardPlacements(messages, states, new Map())
    assert.equal(placements.length, 1)
    assert.equal(placements[0].source, 'live')
  })

  it('null data in worker-run part is skipped', () => {
    const states = new Map([['j1', makeState({ jobId: 'j1', status: 'running' })]])
    const messages = [makeMsg({ parts: [{ type: 'data-worker-run', data: null }] })]
    const placements = projectWorkerCardPlacements(messages, states, new Map())
    assert.equal(placements.length, 1)
    assert.equal(placements[0].source, 'live')
  })

  it('terminal state preferred from workerStates over terminalWorkerStates', () => {
    const states = new Map([['j1', makeState({ jobId: 'j1', status: 'running', output: 'live' })]])
    const terminal = new Map([
      ['j1', makeState({ jobId: 'j1', status: 'completed', output: 'terminal' })],
    ])
    const messages = [makeMsg({ parts: [workerRunPart('j1')] })]
    const placements = projectWorkerCardPlacements(messages, states, terminal)
    assert.equal(placements.length, 1)
    assert.equal(placements[0].source, 'message')
    assert.equal(placements[0].state.status, 'running')
    assert.equal(placements[0].state.output, 'live')
  })

  it('message placements return messageIndex and partIndex', () => {
    const states = new Map([['j1', makeState({ jobId: 'j1', status: 'completed' })]])
    const terminal = new Map([['j1', makeState({ jobId: 'j1', status: 'completed' })]])
    const messages = [makeMsg({ parts: [workerRunPart('j1')] })]
    const placements = projectWorkerCardPlacements(messages, states, terminal)
    assert.equal(placements[0].messageIndex, 0)
    assert.equal(placements[0].partIndex, 0)
  })

  it('live placements do not have messageIndex/partIndex', () => {
    const states = new Map([['j1', makeState({ jobId: 'j1', status: 'running' })]])
    const placements = projectWorkerCardPlacements([], states, new Map())
    assert.equal(placements[0].messageIndex, undefined)
    assert.equal(placements[0].partIndex, undefined)
  })
})
