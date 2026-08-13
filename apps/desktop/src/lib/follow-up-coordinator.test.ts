import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type {
  ChatRunAbortDecision,
  ChatRunStatus,
  FollowUpRequestMeta,
} from '@swarmdesk-agent/shared'
import {
  FOLLOW_UP_RETRY_MAX_MS,
  FOLLOW_UP_TERMINATION_MAX_POLLS,
  FollowUpCoordinator,
  resolveFollowUpIntent,
  retryDelayMs,
  type FollowUpCoordinatorDependencies,
} from './follow-up-coordinator.js'
import type { FollowUpOutboxItem } from './follow-up-outbox.js'

const flush = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

class FakeClock {
  now = 0
  #nextId = 0
  #timers = new Map<number, { at: number; callback: () => void }>()

  setTimer = (callback: () => void, delayMs: number): ReturnType<typeof setTimeout> => {
    const id = ++this.#nextId
    this.#timers.set(id, { at: this.now + delayMs, callback })
    return id as never
  }

  clearTimer = (timer: ReturnType<typeof setTimeout>): void => {
    this.#timers.delete(timer as never as number)
  }

  async advance(ms: number): Promise<void> {
    this.now += ms
    for (;;) {
      const due = [...this.#timers.entries()]
        .filter(([, timer]) => timer.at <= this.now)
        .sort(([, left], [, right]) => left.at - right.at)[0]
      if (!due) break
      const [id, timer] = due
      this.#timers.delete(id)
      timer.callback()
      await flush()
    }
  }

  get timerCount(): number {
    return this.#timers.size
  }
}

function idleStatus(threadId: string): ChatRunStatus {
  return {
    threadId,
    active: false,
    phase: 'idle',
    canStart: true,
    canSteer: false,
    openWorkerJobCount: 0,
  }
}

function activeStatus(
  threadId: string,
  meta: Pick<FollowUpRequestMeta, 'deliveryId' | 'clientRunId'>,
  patch: Partial<ChatRunStatus> = {},
): ChatRunStatus {
  return {
    threadId,
    active: true,
    clientRunId: meta.clientRunId,
    deliveryId: meta.deliveryId,
    phase: 'text',
    canStart: false,
    canSteer: true,
    openWorkerJobCount: 0,
    ...patch,
  }
}

type Harness = {
  threadId: string
  clock: FakeClock
  items: FollowUpOutboxItem[]
  sent: Array<{ id: string; text: string; followUp: FollowUpRequestMeta }>
  resumes: string[]
  stopped: { count: number }
  refreshed: { count: number }
  modelRequired: { count: number }
  coordinator: FollowUpCoordinator
  setStatus: (next: ChatRunStatus) => void
  setAbort: (next: ChatRunAbortDecision) => void
}

function makeHarness(
  input: {
    threadId?: string
    initialItems?: FollowUpOutboxItem[]
    status?: ChatRunStatus
    hasModel?: boolean
  } = {},
): Harness {
  const threadId = input.threadId ?? 'thread-0001'
  const clock = new FakeClock()
  const items = [...(input.initialItems ?? [])]
  const sent: Harness['sent'] = []
  const resumes: string[] = []
  const stopped = { count: 0 }
  const refreshed = { count: 0 }
  const modelRequired = { count: 0 }
  let id = 0
  let status = input.status ?? idleStatus(threadId)
  let abort: ChatRunAbortDecision = {
    accepted: true,
    outcome: 'terminal',
    status: idleStatus(threadId),
  }
  const dependencies: FollowUpCoordinatorDependencies = {
    threadId,
    now: () => clock.now,
    createId: () => `generated-id-${String(++id).padStart(12, '0')}`,
    hasModel: () => input.hasModel ?? true,
    getOutbox: () => items.map((entry) => ({ ...entry })),
    addOutbox: (entry) => {
      if (items.length >= 20) return { ok: false, reason: 'capacity' }
      items.push({ ...entry })
      return { ok: true }
    },
    updateOutbox: (deliveryId, patch) => {
      const index = items.findIndex((entry) => entry.deliveryId === deliveryId)
      if (index >= 0) items[index] = { ...items[index]!, ...patch }
    },
    removeOutbox: (deliveryId) => {
      const index = items.findIndex((entry) => entry.deliveryId === deliveryId)
      if (index < 0) return undefined
      return items.splice(index, 1)[0]
    },
    moveToFront: (deliveryId) => {
      const index = items.findIndex((entry) => entry.deliveryId === deliveryId)
      if (index > 0) items.unshift(items.splice(index, 1)[0]!)
    },
    getRunStatus: async () => ({ ...status }),
    requestAbort: async () => ({ ...abort, status: { ...abort.status } }),
    send: async (entry) => {
      sent.push(entry)
    },
    stopLocal: () => {
      stopped.count += 1
    },
    resume: async (clientRunId) => {
      resumes.push(clientRunId)
    },
    refreshHistory: async () => {
      refreshed.count += 1
    },
    onModelRequired: () => {
      modelRequired.count += 1
    },
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  }
  const coordinator = new FollowUpCoordinator(dependencies)
  return {
    threadId,
    clock,
    items,
    sent,
    resumes,
    stopped,
    refreshed,
    modelRequired,
    coordinator,
    setStatus: (next) => {
      status = next
    },
    setAbort: (next) => {
      abort = next
    },
  }
}

function queuedItem(index: number, text = `queued ${index}`): FollowUpOutboxItem {
  return {
    deliveryId: `delivery-${String(index).padStart(8, '0')}`,
    clientRunId: `client-run-${String(index).padStart(8, '0')}`,
    content: text,
    createdAt: index,
    source: 'queue',
    attempt: 0,
    nextAttemptAt: null,
    state: 'queued',
  }
}

describe('FollowUpCoordinator', () => {
  it('uses a real retry timer, retains the item on initial transport failure, and backs off 2s/4s/8s', async () => {
    const harness = makeHarness()
    await harness.coordinator.bootstrap()
    assert.equal(
      harness.coordinator.submit('first', { behavior: 'queue', preferSteer: false }),
      'direct',
    )
    await flush()
    assert.equal(harness.sent.length, 1)
    const first = harness.sent[0]!.followUp

    harness.coordinator.transportInitialFailure(first, new Error('HTTP 500'))
    await flush()
    assert.equal(harness.items.length, 1)
    assert.equal(harness.items[0]?.state, 'retry_wait')
    assert.equal(harness.items[0]?.nextAttemptAt, 2_000)
    assert.equal(harness.clock.timerCount, 1)
    await harness.clock.advance(1_999)
    assert.equal(harness.sent.length, 1)
    await harness.clock.advance(1)
    assert.equal(harness.sent.length, 2)

    harness.coordinator.transportInitialFailure(
      harness.sent[1]!.followUp,
      new Error('HTTP 500 again'),
    )
    await flush()
    assert.equal(harness.items[0]?.nextAttemptAt, 6_000)
    await harness.clock.advance(4_000)
    assert.equal(harness.sent.length, 3)

    harness.coordinator.transportInitialFailure(
      harness.sent[2]!.followUp,
      new Error('HTTP 500 third'),
    )
    await flush()
    assert.equal(harness.items[0]?.nextAttemptAt, 14_000)
    await harness.clock.advance(8_000)
    assert.equal(harness.sent.length, 4)
  })

  it('caps retry delay and never treats sendMessage resolution as queue acknowledgement', async () => {
    assert.equal(retryDelayMs(1), 2_000)
    assert.equal(retryDelayMs(2), 4_000)
    assert.equal(retryDelayMs(3), 8_000)
    assert.equal(retryDelayMs(99), FOLLOW_UP_RETRY_MAX_MS)

    const harness = makeHarness()
    await harness.coordinator.bootstrap()
    harness.coordinator.submit('ack only after transport', {
      behavior: 'queue',
      preferSteer: false,
    })
    await flush()
    assert.equal(harness.sent.length, 1)
    assert.equal(harness.items.length, 1)
    harness.coordinator.transportAccepted(harness.sent[0]!.followUp)
    assert.equal(harness.items.length, 0)
  })

  it('lets Send now override retry_wait without dropping the queued delivery', async () => {
    const harness = makeHarness()
    await harness.coordinator.bootstrap()
    harness.coordinator.submit('manual retry', { behavior: 'queue', preferSteer: false })
    await flush()
    harness.coordinator.transportInitialFailure(harness.sent[0]!.followUp, new Error('HTTP 500'))
    await flush()
    const deliveryId = harness.items[0]!.deliveryId
    assert.equal(harness.items[0]?.state, 'retry_wait')

    await harness.coordinator.sendNow(deliveryId)
    await flush()
    assert.equal(harness.sent.length, 2)
    assert.equal(harness.items.length, 1)
    assert.equal(harness.items[0]?.state, 'dispatching')
  })

  it('reconciles an ambiguous initial failure before retrying and does not duplicate a matching active run', async () => {
    const harness = makeHarness()
    await harness.coordinator.bootstrap()
    harness.coordinator.submit('ambiguous', { behavior: 'queue', preferSteer: false })
    await flush()
    const meta = harness.sent[0]!.followUp
    harness.setStatus(activeStatus(harness.threadId, meta))
    harness.coordinator.transportInitialFailure(meta, new Error('connection reset'))
    await flush()

    assert.equal(harness.sent.length, 1)
    assert.equal(harness.items.length, 1)
    assert.equal(harness.items[0]?.state, 'unknown')
    assert.equal(harness.coordinator.snapshot.phase, 'observing')
  })

  it('removes an unknown delivery only when reconciliation proves the same delivery completed or aborted', async () => {
    const harness = makeHarness()
    await harness.coordinator.bootstrap()
    harness.coordinator.submit('server accepted', { behavior: 'queue', preferSteer: false })
    await flush()
    const meta = harness.sent[0]!.followUp
    harness.setStatus({
      ...idleStatus(harness.threadId),
      clientRunId: meta.clientRunId,
      deliveryId: meta.deliveryId,
      phase: 'terminal',
      terminal: 'completed',
    })
    harness.coordinator.transportInitialFailure(meta, new Error('response lost'))
    await flush()

    assert.equal(harness.items.length, 0)
    assert.equal(harness.sent.length, 1)
  })

  it('bootstraps active runs by resuming their exact token before considering a queued item', async () => {
    const queued = queuedItem(1)
    const harness = makeHarness({
      initialItems: [queued],
      status: activeStatus('thread-0001', queued),
    })
    await harness.coordinator.bootstrap()

    assert.deepEqual(harness.resumes, [queued.clientRunId])
    assert.equal(harness.sent.length, 0)
    assert.equal(harness.coordinator.snapshot.phase, 'observing')
  })

  it('keeps queued worker gates and model guards from dispatching or losing items', async () => {
    const queued = queuedItem(2)
    const workerBlocked = makeHarness({
      initialItems: [queued],
      status: {
        ...idleStatus('thread-0001'),
        canStart: false,
        openWorkerJobCount: 1,
      },
    })
    await workerBlocked.coordinator.bootstrap()
    assert.equal(workerBlocked.sent.length, 0)
    assert.equal(workerBlocked.coordinator.snapshot.phase, 'observing')

    const noModel = makeHarness({ initialItems: [queuedItem(3)], hasModel: false })
    await noModel.coordinator.bootstrap()
    await noModel.coordinator.sendNow(noModel.items[0]!.deliveryId)
    assert.equal(noModel.items.length, 1)
    assert.equal(noModel.items[0]?.state, 'queued')
    assert.ok(noModel.modelRequired.count >= 1)
    assert.equal(noModel.sent.length, 0)
  })

  it('keeps a Steer successor behind the server terminal barrier, then refreshes history before dispatch', async () => {
    const active: FollowUpRequestMeta = {
      deliveryId: 'delivery-active-0001',
      clientRunId: 'client-run-active-0001',
      source: 'direct',
    }
    const harness = makeHarness({ status: activeStatus('thread-0001', active) })
    harness.setAbort({
      accepted: true,
      outcome: 'waiting',
      status: activeStatus('thread-0001', active, {
        phase: 'aborting',
        canSteer: false,
      }),
    })
    await harness.coordinator.bootstrap()
    assert.equal(
      harness.coordinator.submit('successor', { behavior: 'steer', preferSteer: false }),
      'request_steer',
    )
    await flush()
    assert.equal(harness.stopped.count, 1)
    assert.equal(harness.sent.length, 0)
    assert.equal(harness.coordinator.snapshot.phase, 'terminating')

    await harness.clock.advance(1_000)
    assert.equal(harness.sent.length, 0)
    harness.setStatus(idleStatus(harness.threadId))
    await harness.clock.advance(1_000)
    assert.equal(harness.refreshed.count, 1)
    assert.equal(harness.sent.length, 1)
  })

  it('bounds termination polling while retaining the no-successor barrier', async () => {
    const active: FollowUpRequestMeta = {
      deliveryId: 'delivery-active-0002',
      clientRunId: 'client-run-active-0002',
      source: 'direct',
    }
    const harness = makeHarness({ status: activeStatus('thread-0001', active) })
    harness.setAbort({
      accepted: true,
      outcome: 'waiting',
      status: activeStatus('thread-0001', active, {
        phase: 'aborting',
        canSteer: false,
      }),
    })
    await harness.coordinator.bootstrap()
    await harness.coordinator.stop()
    for (let attempt = 0; attempt < FOLLOW_UP_TERMINATION_MAX_POLLS; attempt += 1) {
      await harness.clock.advance(1_000)
    }

    assert.equal(harness.coordinator.snapshot.phase, 'terminating')
    assert.equal(harness.clock.timerCount, 0)
    assert.equal(harness.sent.length, 0)
  })

  it('isolates retry timers by thread', async () => {
    const left = makeHarness({ threadId: 'thread-left' })
    const right = makeHarness({ threadId: 'thread-right' })
    await Promise.all([left.coordinator.bootstrap(), right.coordinator.bootstrap()])
    left.coordinator.submit('left', { behavior: 'queue', preferSteer: false })
    right.coordinator.submit('right', { behavior: 'queue', preferSteer: false })
    await flush()
    left.coordinator.transportInitialFailure(left.sent[0]!.followUp, new Error('left only'))
    await flush()
    await left.clock.advance(2_000)

    assert.equal(left.sent.length, 2)
    assert.equal(right.sent.length, 1)
    assert.equal(right.items.length, 1)
  })

  it('resolves Queue / Steer / modifier decisions conservatively', () => {
    assert.equal(
      resolveFollowUpIntent({
        behavior: 'queue',
        busy: false,
        canSteer: false,
        preferSteer: false,
        hasModel: true,
      }),
      'direct',
    )
    assert.equal(
      resolveFollowUpIntent({
        behavior: 'queue',
        busy: true,
        canSteer: true,
        preferSteer: false,
        hasModel: true,
      }),
      'enqueue',
    )
    assert.equal(
      resolveFollowUpIntent({
        behavior: 'steer',
        busy: true,
        canSteer: true,
        preferSteer: false,
        hasModel: true,
      }),
      'request_steer',
    )
    assert.equal(
      resolveFollowUpIntent({
        behavior: 'queue',
        busy: true,
        canSteer: true,
        preferSteer: true,
        hasModel: true,
      }),
      'request_steer',
    )
    assert.equal(
      resolveFollowUpIntent({
        behavior: 'steer',
        busy: true,
        canSteer: false,
        preferSteer: false,
        hasModel: true,
      }),
      'enqueue',
    )
    assert.equal(
      resolveFollowUpIntent({
        behavior: 'queue',
        busy: false,
        canSteer: false,
        preferSteer: false,
        hasModel: false,
      }),
      'blocked_model',
    )
  })
})
