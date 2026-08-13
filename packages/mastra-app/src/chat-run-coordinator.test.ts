import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isJobOpen, type FollowUpRequestMeta, type JobStatus } from '@swarmdesk-agent/shared'
import {
  ChatRunCoordinator,
  chunkProtectsChatRun,
  chunkShowsTextPhase,
} from './chat-run-coordinator.js'
import { _resetChatRunHubsForTest } from './chat-run-hub.js'

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))

function followUp(
  clientRunId: string,
  deliveryId = `delivery-${clientRunId}`,
): FollowUpRequestMeta {
  return { clientRunId, deliveryId, source: 'direct' }
}

function controllableStream() {
  let controller: ReadableStreamDefaultController<unknown> | undefined
  const stream = new ReadableStream<unknown>({
    start(next) {
      controller = next
    },
  })
  return {
    stream,
    push(value: unknown) {
      controller?.enqueue(value)
    },
    close() {
      controller?.close()
    },
    fail(error: unknown) {
      controller?.error(error)
    },
  }
}

function createCoordinator(
  getOpenWorkerJobCount = () => 0,
  timing: { terminalRetentionMs?: number; deliveryDedupeRetentionMs?: number } = {},
) {
  _resetChatRunHubsForTest()
  return new ChatRunCoordinator({
    getOpenWorkerJobCount,
    terminalRetentionMs: timing.terminalRetentionMs ?? 5_000,
    deliveryDedupeRetentionMs: timing.deliveryDedupeRetentionMs ?? 5_000,
  })
}

describe('ChatRunCoordinator', () => {
  it('reserves before a stream exists and can abort that starting reservation', async () => {
    const coordinator = createCoordinator()
    const admission = coordinator.reserve({
      threadId: 'thread-001',
      sessionId: 'session-001',
      followUp: followUp('run-001'),
    })
    assert.equal(admission.kind, 'reserved')
    assert.equal(coordinator.status('thread-001', 'session-001').phase, 'starting')

    const decision = await coordinator.requestAbort({
      threadId: 'thread-001',
      sessionId: 'session-001',
      clientRunId: 'run-001',
      intent: 'stop',
      waitMs: 0,
    })
    assert.equal(decision.accepted, true)
    assert.equal(decision.outcome, 'waiting')
    assert.equal(coordinator.getLease('run-001')?.abortSignal.aborted, true)

    coordinator.failStart('run-001', 'aborted')
    const status = coordinator.status('thread-001', 'session-001', 'run-001')
    assert.equal(status.active, false)
    assert.equal(status.phase, 'terminal')
    assert.equal(status.terminal, 'aborted')
  })

  it('treats same token as idempotent and rejects a different active token without aborting it', () => {
    const coordinator = createCoordinator()
    const first = coordinator.reserve({
      threadId: 'thread-002',
      sessionId: 'session-002',
      followUp: followUp('run-002a'),
    })
    assert.equal(first.kind, 'reserved')
    const duplicate = coordinator.reserve({
      threadId: 'thread-002',
      sessionId: 'session-002',
      followUp: followUp('run-002a'),
    })
    assert.equal(duplicate.kind, 'duplicate')
    const conflict = coordinator.reserve({
      threadId: 'thread-002',
      sessionId: 'session-002',
      followUp: followUp('run-002b'),
    })
    assert.equal(conflict.kind, 'active')
    assert.equal(coordinator.getLease('run-002a')?.abortSignal.aborted, false)
    assert.equal(coordinator.getLease('run-002b'), undefined)
  })

  it('allows steer only after text starts and permanently protects a tool run', async () => {
    const coordinator = createCoordinator()
    coordinator.reserve({
      threadId: 'thread-003',
      sessionId: 'session-003',
      followUp: followUp('run-003'),
    })
    const source = controllableStream()
    coordinator.attachStream('run-003', source.stream)

    source.push({ type: 'text-delta', id: 'text', delta: 'hello' })
    await tick()
    assert.equal(coordinator.status('thread-003', 'session-003').phase, 'text')
    assert.equal(coordinator.status('thread-003', 'session-003').canSteer, true)

    source.push({ type: 'tool-input-start', toolCallId: 'tool-1', toolName: 'delegate' })
    await tick()
    const protectedStatus = coordinator.status('thread-003', 'session-003')
    assert.equal(protectedStatus.phase, 'protected')
    assert.equal(protectedStatus.canSteer, false)
    const decision = await coordinator.requestAbort({
      threadId: 'thread-003',
      sessionId: 'session-003',
      clientRunId: 'run-003',
      intent: 'steer',
      waitMs: 0,
    })
    assert.equal(decision.accepted, false)
    assert.equal(decision.reason, 'not_steerable')
    source.close()
  })

  it('treats queued, running, and pending-approval workers as admission and steer gates', async () => {
    for (const workerStatus of [
      'queued',
      'running',
      'pending_approval',
    ] as const satisfies readonly JobStatus[]) {
      const coordinator = createCoordinator(() => (isJobOpen(workerStatus) ? 1 : 0))
      const busy = coordinator.reserve({
        threadId: `thread-004-${workerStatus}`,
        sessionId: `session-004-${workerStatus}`,
        followUp: followUp(`run-004-${workerStatus}`),
      })
      assert.equal(isJobOpen(workerStatus), true)
      assert.equal(busy.kind, 'busy')
      if (busy.kind === 'busy') assert.equal(busy.status.openWorkerJobCount, 1)
    }

    let openWorkers = 1
    const coordinator = createCoordinator(() => openWorkers)
    const busy = coordinator.reserve({
      threadId: 'thread-004',
      sessionId: 'session-004',
      followUp: followUp('run-004a'),
    })
    assert.equal(busy.kind, 'busy')
    assert.equal(busy.status.openWorkerJobCount, 1)

    openWorkers = 0
    const admitted = coordinator.reserve({
      threadId: 'thread-004',
      sessionId: 'session-004',
      followUp: followUp('run-004b'),
    })
    assert.equal(admitted.kind, 'reserved')
    const source = controllableStream()
    coordinator.attachStream('run-004b', source.stream)
    source.push({ type: 'text-delta', id: 'text', delta: 'hello' })
    await tick()
    assert.equal(coordinator.status('thread-004', 'session-004').canSteer, true)

    openWorkers = 1
    const status = coordinator.status('thread-004', 'session-004')
    assert.equal(status.phase, 'protected')
    assert.equal(status.canSteer, false)
    source.close()
  })

  it('does not release a thread for a successor until an abort reaches terminal', async () => {
    const coordinator = createCoordinator()
    coordinator.reserve({
      threadId: 'thread-005',
      sessionId: 'session-005',
      followUp: followUp('run-005a'),
    })
    const source = controllableStream()
    coordinator.attachStream('run-005a', source.stream)
    source.push({ type: 'text-delta', id: 'text', delta: 'hello' })
    await tick()

    const waiting = await coordinator.requestAbort({
      threadId: 'thread-005',
      sessionId: 'session-005',
      clientRunId: 'run-005a',
      intent: 'stop',
      waitMs: 1,
    })
    assert.equal(waiting.outcome, 'waiting')
    const conflict = coordinator.reserve({
      threadId: 'thread-005',
      sessionId: 'session-005',
      followUp: followUp('run-005b'),
    })
    assert.equal(conflict.kind, 'active')

    source.close()
    await tick()
    const next = coordinator.reserve({
      threadId: 'thread-005',
      sessionId: 'session-005',
      followUp: followUp('run-005b'),
    })
    assert.equal(next.kind, 'reserved')
  })

  it('rejects stale abort tokens without affecting the active controller', async () => {
    const coordinator = createCoordinator()
    coordinator.reserve({
      threadId: 'thread-006',
      sessionId: 'session-006',
      followUp: followUp('run-006a'),
    })
    const decision = await coordinator.requestAbort({
      threadId: 'thread-006',
      sessionId: 'session-006',
      clientRunId: 'run-006b',
      intent: 'stop',
      waitMs: 0,
    })
    assert.equal(decision.accepted, false)
    assert.equal(decision.reason, 'stale_run')
    assert.equal(coordinator.getLease('run-006a')?.abortSignal.aborted, false)
    assert.throws(
      () => coordinator.attachStream('run-006b', controllableStream().stream),
      /CHAT_RUN_RESERVATION_NOT_ACTIVE/u,
    )
    assert.equal(coordinator.getLease('run-006a')?.abortSignal.aborted, false)
  })

  it('marks a source-stream failure terminal and frees the active lease', async () => {
    const coordinator = createCoordinator()
    coordinator.reserve({
      threadId: 'thread-007',
      sessionId: 'session-007',
      followUp: followUp('run-007'),
    })
    const source = controllableStream()
    coordinator.attachStream('run-007', source.stream)
    source.fail(new Error('stream boom'))
    await tick()
    const status = coordinator.status('thread-007', 'session-007', 'run-007')
    assert.equal(status.active, false)
    assert.equal(status.terminal, 'failed')
    assert.equal(
      coordinator.reserve({
        threadId: 'thread-007',
        sessionId: 'session-007',
        followUp: followUp('run-007-next'),
      }).kind,
      'reserved',
    )
  })

  it('does not re-execute a completed or aborted delivery under a fresh client token', async () => {
    const coordinator = createCoordinator()
    const first = coordinator.reserve({
      threadId: 'thread-008',
      sessionId: 'session-008',
      followUp: followUp('run-008a', 'delivery-stable-008'),
    })
    assert.equal(first.kind, 'reserved')
    const source = controllableStream()
    coordinator.attachStream('run-008a', source.stream)
    source.close()
    await tick()

    const duplicateCompleted = coordinator.reserve({
      threadId: 'thread-008',
      sessionId: 'session-008',
      followUp: followUp('run-008b', 'delivery-stable-008'),
    })
    assert.equal(duplicateCompleted.kind, 'terminal')
    if (duplicateCompleted.kind === 'terminal') {
      assert.equal(duplicateCompleted.status.terminal, 'completed')
      assert.equal(duplicateCompleted.status.clientRunId, 'run-008a')
    }

    const abortable = coordinator.reserve({
      threadId: 'thread-008-abort',
      sessionId: 'session-008-abort',
      followUp: followUp('run-008c', 'delivery-stable-008-abort'),
    })
    assert.equal(abortable.kind, 'reserved')
    coordinator.failStart('run-008c', 'aborted')
    const duplicateAborted = coordinator.reserve({
      threadId: 'thread-008-abort',
      sessionId: 'session-008-abort',
      followUp: followUp('run-008d', 'delivery-stable-008-abort'),
    })
    assert.equal(duplicateAborted.kind, 'terminal')
    if (duplicateAborted.kind === 'terminal') {
      assert.equal(duplicateAborted.status.terminal, 'aborted')
    }
  })

  it('allows an explicitly failed delivery to recover only with a fresh client token', () => {
    const coordinator = createCoordinator()
    coordinator.reserve({
      threadId: 'thread-009',
      sessionId: 'session-009',
      followUp: followUp('run-009a', 'delivery-failed-009'),
    })
    coordinator.failStart('run-009a', 'failed')

    const sameToken = coordinator.reserve({
      threadId: 'thread-009',
      sessionId: 'session-009',
      followUp: followUp('run-009a', 'delivery-failed-009'),
    })
    assert.equal(sameToken.kind, 'terminal')
    const recovered = coordinator.reserve({
      threadId: 'thread-009',
      sessionId: 'session-009',
      followUp: followUp('run-009b', 'delivery-failed-009'),
    })
    assert.equal(recovered.kind, 'reserved')
  })

  it('retains lightweight delivery dedupe after the stream replay grace expires', async () => {
    const coordinator = createCoordinator(() => 0, {
      terminalRetentionMs: 1,
      deliveryDedupeRetentionMs: 5_000,
    })
    coordinator.reserve({
      threadId: 'thread-010',
      sessionId: 'session-010',
      followUp: followUp('run-010a', 'delivery-stable-010'),
    })
    const source = controllableStream()
    coordinator.attachStream('run-010a', source.stream)
    source.close()
    await tick(25)

    const statusAfterReplayEviction = coordinator.status('thread-010', 'session-010', 'run-010a')
    assert.equal(statusAfterReplayEviction.terminal, 'completed')
    const terminalAbort = await coordinator.requestAbort({
      threadId: 'thread-010',
      sessionId: 'session-010',
      clientRunId: 'run-010a',
      intent: 'stop',
      waitMs: 0,
    })
    assert.equal(terminalAbort.reason, 'already_terminal')
    assert.equal(
      coordinator.reserve({
        threadId: 'thread-010',
        sessionId: 'session-010',
        followUp: followUp('run-010b', 'delivery-stable-010'),
      }).kind,
      'terminal',
    )
  })

  it('classifies only text/reasoning as steerable output and tool/worker chunks as protected', () => {
    assert.equal(chunkShowsTextPhase({ type: 'text-delta' }), true)
    assert.equal(chunkShowsTextPhase({ type: 'reasoning-start' }), true)
    assert.equal(chunkShowsTextPhase({ type: 'start' }), false)
    assert.equal(chunkProtectsChatRun({ type: 'tool-input-start' }), true)
    assert.equal(chunkProtectsChatRun({ type: 'data-worker-run' }), true)
    assert.equal(chunkProtectsChatRun({ type: 'text-delta' }), false)
  })
})
