import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { WorkerRunState } from '@pihuo-agent/shared'
import type { LeaderViewMessage } from './leader-chat-view.js'
import type { WorkerCardPlacement } from './worker-card-placement.js'
import {
  projectChatTimeline,
  taskPromptFromPart,
  timelineConsecutive,
  timelineMessageId,
} from './chat-timeline.js'

function makeState(overrides: Partial<WorkerRunState> & { jobId: string }): WorkerRunState {
  return {
    workerName: 'OpenCode',
    workerKind: 'opencode',
    reusedSession: false,
    sequence: 0,
    output: '',
    status: 'completed',
    truncated: false,
    startedAt: 1000,
    lastDeltaAt: 8000,
    pendingApprovals: [],
    ...overrides,
  }
}

function placement(
  jobId: string,
  loc: { messageIndex: number; partIndex: number },
  state?: Partial<WorkerRunState>,
): WorkerCardPlacement {
  return {
    jobId,
    source: 'message',
    messageIndex: loc.messageIndex,
    partIndex: loc.partIndex,
    state: makeState({ jobId, ...state }),
  }
}

describe('projectChatTimeline', () => {
  it('keeps a user and text-only Leader turn as two speaker items', () => {
    const messages = [
      { id: 'u1', role: 'user', timestamp: 1, parts: [{ type: 'text', text: 'hello' }] },
      { id: 'a1', role: 'assistant', timestamp: 2, parts: [{ type: 'text', text: 'hi' }] },
    ] as LeaderViewMessage[]

    const items = projectChatTimeline({
      messages,
      placementByJobId: new Map(),
      livePlacements: [],
    })

    assert.deepEqual(
      items.map((item) => item.type),
      ['user', 'leader'],
    )
    assert.equal(items[1]?.type === 'leader' && items[1].partIndexes.join(','), '0')
  })

  it('lifts a dispatched Worker out of the Leader turn and keeps the tool row on Leader', () => {
    const messages = [
      {
        id: 'u1',
        role: 'user',
        timestamp: 1,
        parts: [{ type: 'text', text: '跟 OpenCode 打招呼' }],
      },
      {
        id: 'a1',
        role: 'assistant',
        timestamp: 2,
        parts: [
          { type: 'text', text: '先确认任务边界。' },
          {
            type: 'tool-dispatch-worker',
            toolName: 'dispatch-worker',
            state: 'output-available',
            input: { task: '用户想跟你（OpenCode）打个招呼。' },
            output: { jobId: 'job-1' },
          },
          { type: 'data-worker-run', data: { jobId: 'job-1' } },
          { type: 'text', text: '呼叫成功。OpenCode 已回复：' },
        ],
      },
    ] as LeaderViewMessage[]
    const placed = placement(
      'job-1',
      { messageIndex: 1, partIndex: 1 },
      { output: '你好！我是 OpenCode' },
    )
    const items = projectChatTimeline({
      messages,
      placementByJobId: new Map([['job-1', placed]]),
      livePlacements: [],
    })

    assert.deepEqual(
      items.map((item) => item.speaker),
      ['user', 'leader', 'worker', 'leader'],
    )
    const lead0 = items[1]
    const worker = items[2]
    const lead1 = items[3]
    assert.equal(lead0?.type, 'leader')
    assert.equal(lead0?.type === 'leader' && lead0.partIndexes.join(','), '0,1')
    assert.equal(worker?.type, 'worker')
    assert.equal(worker?.type === 'worker' && worker.jobId, 'job-1')
    assert.equal(worker?.type === 'worker' && worker.taskPrompt, '用户想跟你（OpenCode）打个招呼。')
    assert.equal(lead1?.type === 'leader' && lead1.partIndexes.join(','), '3')
    assert.equal(items.filter((item) => item.type === 'worker').length, 1)
  })

  it('emits a Worker only once when the tool row and data-worker-run share a jobId', () => {
    const messages = [
      {
        id: 'a1',
        role: 'assistant',
        timestamp: 1,
        parts: [
          {
            type: 'tool-dispatch-worker',
            output: { jobId: 'job-1' },
            input: { task: 'do it' },
          },
          { type: 'data-worker-run', data: { jobId: 'job-1' } },
        ],
      },
    ] as LeaderViewMessage[]
    const first = placement('job-1', { messageIndex: 0, partIndex: 0 })
    const items = projectChatTimeline({
      messages,
      placementByJobId: new Map([['job-1', first]]),
      livePlacements: [{ jobId: 'job-1', source: 'live', state: makeState({ jobId: 'job-1' }) }],
    })
    assert.equal(items.filter((item) => item.type === 'worker').length, 1)
    assert.equal(items[0]?.type, 'leader')
    assert.equal(items[1]?.type, 'worker')
  })

  it('does not shift existing Leader fragment indexes when inserting a live pending Leader', () => {
    const messages = [
      {
        id: 'a1',
        role: 'assistant',
        timestamp: 1,
        parts: [
          { type: 'text', text: '先派工。' },
          {
            type: 'tool-dispatch-team-member',
            output: { jobId: 'job-1' },
            input: { task: 'do it' },
          },
        ],
      },
    ] as LeaderViewMessage[]
    const placed = placement('job-1', { messageIndex: 0, partIndex: 1 })
    const idle = projectChatTimeline({
      messages,
      placementByJobId: new Map([['job-1', placed]]),
      livePlacements: [],
      busy: false,
      lastAssistantId: 'a1',
    })
    const live = projectChatTimeline({
      messages,
      placementByJobId: new Map([['job-1', placed]]),
      livePlacements: [],
      busy: true,
      lastAssistantId: 'a1',
    })
    const idleLeaders = idle.filter((item) => item.type === 'leader')
    const liveLeaders = live.filter((item) => item.type === 'leader')
    assert.equal(idleLeaders[0]?.type === 'leader' && idleLeaders[0].partIndexes.join(','), '0,1')
    assert.equal(liveLeaders[0]?.type === 'leader' && liveLeaders[0].partIndexes.join(','), '0,1')
    assert.equal(idleLeaders[0]?.key, liveLeaders[0]?.key)
  })

  it('appends unanchored live placements after durable messages', () => {
    const messages = [
      { id: 'a1', role: 'assistant', timestamp: 1, parts: [{ type: 'text', text: 'working' }] },
    ] as LeaderViewMessage[]
    const items = projectChatTimeline({
      messages,
      placementByJobId: new Map(),
      livePlacements: [
        {
          jobId: 'live-1',
          source: 'live',
          state: makeState({ jobId: 'live-1', status: 'running' }),
        },
      ],
    })
    assert.equal(items[0]?.type, 'leader')
    assert.equal(items[1]?.type, 'worker')
    assert.equal(items[1]?.type === 'worker' && items[1].jobId, 'live-1')
    assert.equal(timelineMessageId(items[1]!), undefined)
  })

  it('does not insert an empty Leader fragment after a live Worker', () => {
    const messages = [
      {
        id: 'a1',
        role: 'assistant',
        timestamp: 1,
        parts: [
          {
            type: 'tool-dispatch-worker',
            output: { jobId: 'job-1' },
            input: { task: 'hello' },
          },
        ],
      },
    ] as LeaderViewMessage[]
    const items = projectChatTimeline({
      messages,
      placementByJobId: new Map([
        ['job-1', placement('job-1', { messageIndex: 0, partIndex: 0 }, { status: 'running' })],
      ]),
      livePlacements: [],
      busy: true,
      lastAssistantId: 'a1',
    })
    assert.deepEqual(
      items.map((item) => item.type),
      ['leader', 'worker'],
    )
  })

  it('adds a pending Leader item when a live turn has no parts yet', () => {
    const messages = [
      { id: 'a1', role: 'assistant', timestamp: 1, parts: [] },
    ] as LeaderViewMessage[]
    const items = projectChatTimeline({
      messages,
      placementByJobId: new Map(),
      livePlacements: [],
      busy: true,
      lastAssistantId: 'a1',
    })
    assert.equal(items.length, 1)
    assert.equal(items[0]?.type, 'leader')
    assert.equal(items[0]?.type === 'leader' && items[0].partIndexes.length, 0)
  })
})

describe('timelineConsecutive', () => {
  it('never marks a Worker as consecutive', () => {
    const workerA: ReturnType<typeof projectChatTimeline>[number] = {
      type: 'worker',
      key: 'worker:a',
      speaker: 'worker',
      jobId: 'a',
      placement: placement('a', { messageIndex: 0, partIndex: 0 }),
    }
    const workerB = { ...workerA, key: 'worker:b', jobId: 'b' }
    assert.equal(timelineConsecutive([workerA, workerB], 1), false)
  })

  it('marks adjacent Leader fragments consecutive only when no Worker sits between them', () => {
    const lead = (id: string, fragment: number) =>
      ({
        type: 'leader' as const,
        key: `${id}:l${fragment}`,
        speaker: 'leader' as const,
        messageIndex: 0,
        message: { id, role: 'assistant', timestamp: 1, parts: [] },
        partIndexes: [0],
        fragment,
      }) satisfies ReturnType<typeof projectChatTimeline>[number]
    const items = [lead('a1', 0), lead('a1', 1)]
    assert.equal(timelineConsecutive(items, 0), false)
    assert.equal(timelineConsecutive(items, 1), true)
  })
})

describe('taskPromptFromPart', () => {
  it('reads a non-empty dispatch task and ignores missing input', () => {
    assert.equal(
      taskPromptFromPart({
        type: 'tool-dispatch-worker',
        input: { task: '  greet  ' },
      } as never),
      '  greet  ',
    )
    assert.equal(taskPromptFromPart({ type: 'text', text: 'x' }), undefined)
  })
})
