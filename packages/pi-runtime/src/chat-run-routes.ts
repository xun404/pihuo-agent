import type { ServerResponse } from 'node:http'
import type {
  ChatRunAbortDecision,
  ChatRunAbortIntent,
  ChatRunStatus,
  FollowUpRequestMeta,
} from '@pihuo-agent/shared'
import type { ChatRunAdmission, ChatRunCoordinator, ChatRunLease } from './chat-run-coordinator.js'

/**
 * Small, injectable lifecycle boundary used by the HTTP routes. Keeping this
 * outside http-server makes the ordering guarantees behavior-testable: a
 * reservation is created before persistence / stream creation, and all
 * terminal paths resolve the reservation rather than leaving a hung lease.
 */
export type ChatRunRouteRegistry = Pick<
  ChatRunCoordinator,
  | 'reserve'
  | 'status'
  | 'getLease'
  | 'waitForHub'
  | 'attachStream'
  | 'attachSubscriber'
  | 'failStart'
  | 'requestAbort'
>

export type StartReservedChatRunInput = {
  registry: ChatRunRouteRegistry
  threadId: string
  sessionId: string
  followUp: FollowUpRequestMeta
  persistUserTurn: (lease: ChatRunLease) => Promise<void>
  createStream: (lease: ChatRunLease) => Promise<ReadableStream<unknown>>
}

export type StartReservedChatRunResult =
  | { kind: 'started'; status: ChatRunStatus }
  | { kind: 'duplicate'; status: ChatRunStatus }
  | { kind: 'terminal'; status: ChatRunStatus }
  | { kind: 'active'; status: ChatRunStatus }
  | { kind: 'busy'; status: ChatRunStatus }
  | { kind: 'aborted'; status: ChatRunStatus }
  | { kind: 'failed'; status: ChatRunStatus; error: unknown }

function statusFor(
  registry: ChatRunRouteRegistry,
  input: Pick<StartReservedChatRunInput, 'threadId' | 'sessionId' | 'followUp'>,
): ChatRunStatus {
  return registry.status(input.threadId, input.sessionId, input.followUp.clientRunId)
}

function admissionResult(
  admission: Exclude<ChatRunAdmission, { kind: 'reserved' | 'duplicate' }>,
): StartReservedChatRunResult {
  return { kind: admission.kind, status: admission.status }
}

/**
 * Admit and start exactly one leader run. The caller may attach an HTTP
 * subscriber only after this returns `started`; duplicate callers attach to
 * the already-owned token through subscribeToChatRun instead.
 */
export async function startReservedChatRun(
  input: StartReservedChatRunInput,
): Promise<StartReservedChatRunResult> {
  const admission = input.registry.reserve({
    threadId: input.threadId,
    sessionId: input.sessionId,
    followUp: input.followUp,
  })
  if (admission.kind === 'active' || admission.kind === 'busy' || admission.kind === 'terminal') {
    return admissionResult(admission)
  }
  if (admission.kind === 'duplicate') {
    return { kind: 'duplicate', status: statusFor(input.registry, input) }
  }

  const lease = admission.lease
  if (lease.abortSignal.aborted) {
    input.registry.failStart(input.followUp.clientRunId, 'aborted')
    return { kind: 'aborted', status: statusFor(input.registry, input) }
  }
  try {
    await input.persistUserTurn(lease)
    if (lease.abortSignal.aborted) {
      input.registry.failStart(input.followUp.clientRunId, 'aborted')
      return { kind: 'aborted', status: statusFor(input.registry, input) }
    }
    const stream = await input.createStream(lease)
    // A cancellation that races handleChatStream may still yield a stream.
    // Attach it so the source can drain and onFinish can settle; the registry
    // will classify its terminal state as aborted from the same signal.
    input.registry.attachStream(input.followUp.clientRunId, stream)
    return { kind: 'started', status: statusFor(input.registry, input) }
  } catch (error) {
    input.registry.failStart(input.followUp.clientRunId)
    return { kind: 'failed', status: statusFor(input.registry, input), error }
  }
}

export type SubscribeToChatRunInput = {
  registry: ChatRunRouteRegistry
  threadId: string
  clientRunId: string
  response: ServerResponse
  extraHeaders?: Record<string, string>
}

/**
 * Token-scoped replay / live subscription. A missing or mismatched token is
 * deliberately a no-op; callers turn it into HTTP 204 rather than ever
 * falling back to an unrelated current thread run.
 */
export async function subscribeToChatRun(input: SubscribeToChatRunInput): Promise<boolean> {
  const lease = input.registry.getLease(input.clientRunId)
  if (!lease || lease.threadId !== input.threadId) return false
  const hub = await input.registry.waitForHub(input.clientRunId)
  if (!hub) return false
  return input.registry.attachSubscriber(input.clientRunId, input.response, input.extraHeaders)
}

/** Forward structured abort decisions without reducing them to a local boolean. */
export function requestChatRunAbort(input: {
  registry: ChatRunRouteRegistry
  threadId: string
  sessionId: string
  clientRunId: string
  intent: ChatRunAbortIntent
  waitMs: number
}): Promise<ChatRunAbortDecision> {
  return input.registry.requestAbort({
    threadId: input.threadId,
    sessionId: input.sessionId,
    clientRunId: input.clientRunId,
    intent: input.intent,
    waitMs: input.waitMs,
  })
}
