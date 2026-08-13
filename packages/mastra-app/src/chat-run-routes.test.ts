import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type {
  ChatRunAbortDecision,
  ChatRunStatus,
  FollowUpRequestMeta,
} from '@swarmdesk-agent/shared'
import type { ChatRunAdmission, ChatRunLease } from './chat-run-coordinator.js'
import {
  startReservedChatRun,
  requestChatRunAbort,
  subscribeToChatRun,
  type ChatRunRouteRegistry,
} from './chat-run-routes.js'

const followUp: FollowUpRequestMeta = {
  deliveryId: 'delivery-00000001',
  clientRunId: 'client-run-00000001',
  source: 'direct',
}

function status(patch: Partial<ChatRunStatus> = {}): ChatRunStatus {
  return {
    threadId: 'thread-001',
    active: false,
    phase: 'idle',
    canStart: true,
    canSteer: false,
    openWorkerJobCount: 0,
    ...patch,
  }
}

function lease(signal = new AbortController().signal): ChatRunLease {
  return {
    threadId: 'thread-001',
    sessionId: 'session-001',
    followUp,
    abortSignal: signal,
  }
}

function stream(): ReadableStream<unknown> {
  return new ReadableStream({
    start(controller) {
      controller.close()
    },
  })
}

function registry(input: {
  admission: ChatRunAdmission
  lease?: ChatRunLease
  status?: ChatRunStatus
  hub?: unknown
  trace?: string[]
  abortDecision?: ChatRunAbortDecision
}): {
  value: ChatRunRouteRegistry
  calls: string[]
  attached: Array<{ clientRunId: string; response: unknown }>
  failed: Array<{ clientRunId: string; reason: unknown }>
  aborts: unknown[]
} {
  const calls: string[] = []
  const attached: Array<{ clientRunId: string; response: unknown }> = []
  const failed: Array<{ clientRunId: string; reason: unknown }> = []
  const aborts: unknown[] = []
  const knownLease =
    input.lease ?? (input.admission.kind === 'reserved' ? input.admission.lease : undefined)
  const value = {
    reserve: () => {
      calls.push('reserve')
      input.trace?.push('reserve')
      return input.admission
    },
    status: () => input.status ?? status(),
    getLease: () => knownLease,
    waitForHub: async () => input.hub ?? { token: 'hub' },
    attachStream: () => {
      calls.push('attachStream')
      input.trace?.push('attachStream')
      return {} as never
    },
    attachSubscriber: (clientRunId: string, response: unknown) => {
      attached.push({ clientRunId, response })
      return true
    },
    failStart: (clientRunId: string, reason?: unknown) => {
      failed.push({ clientRunId, reason })
    },
    requestAbort: (request: unknown) => {
      aborts.push(request)
      return Promise.resolve(
        input.abortDecision ?? {
          accepted: false,
          outcome: 'rejected',
          reason: 'not_found',
          status: status(),
        },
      )
    },
  } as unknown as ChatRunRouteRegistry
  return { value, calls, attached, failed, aborts }
}

describe('chat run route lifecycle', () => {
  it('reserves before persistence and stream creation, then attaches exactly the reserved token', async () => {
    const reservedLease = lease()
    const trace: string[] = []
    const harness = registry({ admission: { kind: 'reserved', lease: reservedLease }, trace })

    const result = await startReservedChatRun({
      registry: harness.value,
      threadId: 'thread-001',
      sessionId: 'session-001',
      followUp,
      persistUserTurn: async () => {
        trace.push('persist')
      },
      createStream: async () => {
        trace.push('stream')
        return stream()
      },
    })

    assert.equal(result.kind, 'started')
    assert.deepEqual(trace, ['reserve', 'persist', 'stream', 'attachStream'])
    assert.equal(harness.failed.length, 0)
  })

  it('does not persist or invoke the agent for active, worker-busy, or terminal admissions', async () => {
    for (const kind of ['active', 'busy', 'terminal'] as const) {
      const harness = registry({
        admission: { kind, status: status({ active: kind === 'active' }) },
      })
      let persisted = 0
      let streamed = 0
      const result = await startReservedChatRun({
        registry: harness.value,
        threadId: 'thread-001',
        sessionId: 'session-001',
        followUp,
        persistUserTurn: async () => {
          persisted += 1
        },
        createStream: async () => {
          streamed += 1
          return stream()
        },
      })
      assert.equal(result.kind, kind)
      assert.equal(persisted, 0)
      assert.equal(streamed, 0)
    }
  })

  it('treats a duplicate token as a reconnect and never persists or creates another stream', async () => {
    const duplicateLease = lease()
    const harness = registry({
      admission: { kind: 'duplicate', lease: duplicateLease },
      lease: duplicateLease,
    })
    let persisted = 0
    let streamed = 0
    const result = await startReservedChatRun({
      registry: harness.value,
      threadId: 'thread-001',
      sessionId: 'session-001',
      followUp,
      persistUserTurn: async () => {
        persisted += 1
      },
      createStream: async () => {
        streamed += 1
        return stream()
      },
    })

    assert.equal(result.kind, 'duplicate')
    assert.equal(persisted, 0)
    assert.equal(streamed, 0)
  })

  it('honors an abort that lands before persistence and reports a terminal-safe result', async () => {
    const controller = new AbortController()
    controller.abort()
    const harness = registry({ admission: { kind: 'reserved', lease: lease(controller.signal) } })
    let persisted = 0
    let streamed = 0
    const result = await startReservedChatRun({
      registry: harness.value,
      threadId: 'thread-001',
      sessionId: 'session-001',
      followUp,
      persistUserTurn: async () => {
        persisted += 1
      },
      createStream: async () => {
        streamed += 1
        return stream()
      },
    })

    assert.equal(result.kind, 'aborted')
    assert.equal(persisted, 0)
    assert.equal(streamed, 0)
    assert.deepEqual(harness.failed, [{ clientRunId: followUp.clientRunId, reason: 'aborted' }])
  })

  it('fails a reservation when persistence or stream startup fails so waiters cannot hang', async () => {
    const harness = registry({ admission: { kind: 'reserved', lease: lease() } })
    const result = await startReservedChatRun({
      registry: harness.value,
      threadId: 'thread-001',
      sessionId: 'session-001',
      followUp,
      persistUserTurn: async () => {
        throw new Error('storage unavailable')
      },
      createStream: async () => stream(),
    })

    assert.equal(result.kind, 'failed')
    assert.match(String(result.kind === 'failed' ? result.error : ''), /storage unavailable/u)
    assert.equal(harness.failed.length, 1)
  })

  it('subscribes only to a matching token and never falls back to a different thread run', async () => {
    const matching = registry({
      admission: { kind: 'reserved', lease: lease() },
      lease: lease(),
    })
    const response = {} as never
    assert.equal(
      await subscribeToChatRun({
        registry: matching.value,
        threadId: 'thread-001',
        clientRunId: followUp.clientRunId,
        response,
      }),
      true,
    )
    assert.deepEqual(matching.attached, [{ clientRunId: followUp.clientRunId, response }])

    const wrongThreadLease: ChatRunLease = { ...lease(), threadId: 'thread-other' }
    const mismatched = registry({
      admission: { kind: 'reserved', lease: wrongThreadLease },
      lease: wrongThreadLease,
    })
    assert.equal(
      await subscribeToChatRun({
        registry: mismatched.value,
        threadId: 'thread-001',
        clientRunId: followUp.clientRunId,
        response,
      }),
      false,
    )
    assert.equal(mismatched.attached.length, 0)
  })

  it('preserves terminal, waiting, and rejected abort decisions for the HTTP layer', async () => {
    const decisions: ChatRunAbortDecision[] = [
      {
        accepted: true,
        outcome: 'terminal',
        status: status({ phase: 'terminal', terminal: 'aborted' }),
      },
      {
        accepted: true,
        outcome: 'waiting',
        status: status({ active: true, phase: 'aborting', canStart: false }),
      },
      {
        accepted: false,
        outcome: 'rejected',
        reason: 'not_steerable',
        status: status({ active: true, phase: 'protected', canStart: false }),
      },
      {
        accepted: false,
        outcome: 'rejected',
        reason: 'stale_run',
        status: status({ active: true, phase: 'text', canStart: false }),
      },
    ]
    for (const decision of decisions) {
      const harness = registry({
        admission: { kind: 'reserved', lease: lease() },
        abortDecision: decision,
      })
      assert.deepEqual(
        await requestChatRunAbort({
          registry: harness.value,
          threadId: 'thread-001',
          sessionId: 'session-001',
          clientRunId: followUp.clientRunId,
          intent: 'steer',
          waitMs: 1_500,
        }),
        decision,
      )
      assert.deepEqual(harness.aborts, [
        {
          threadId: 'thread-001',
          sessionId: 'session-001',
          clientRunId: followUp.clientRunId,
          intent: 'steer',
          waitMs: 1_500,
        },
      ])
    }
  })
})
