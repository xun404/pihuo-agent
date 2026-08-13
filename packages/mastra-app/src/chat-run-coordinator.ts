import {
  type ChatRunAbortDecision,
  type ChatRunAbortIntent,
  type ChatRunPhase,
  type ChatRunStatus,
  type ChatRunTerminal,
  type FollowUpRequestMeta,
} from '@swarmdesk-agent/shared'
import {
  attachChatRunSubscriber,
  getChatRun,
  registerChatRun,
  type ChatRunHub,
} from './chat-run-hub.js'

/**
 * Owns admission for leader runs in a single desktop API process.
 *
 * The coordinator reserves synchronously before any persistence or Mastra
 * await. Stream buffering stays in chat-run-hub; this class owns the only
 * thread -> active run lease mapping and never replaces another token.
 */

type ActiveChatRunPhase = Exclude<ChatRunPhase, 'idle' | 'terminal'>

type RunRecord = {
  threadId: string
  sessionId: string
  followUp: FollowUpRequestMeta
  abortController: AbortController
  phase: ActiveChatRunPhase | 'terminal'
  terminal?: ChatRunTerminal
  toolSeen: boolean
  workerSeen: boolean
  hub?: ChatRunHub
  hubReady: Promise<ChatRunHub | undefined>
  resolveHub: (hub: ChatRunHub | undefined) => void
  done: Promise<ChatRunTerminal>
  resolveDone: (terminal: ChatRunTerminal) => void
  terminalRetentionTimer: ReturnType<typeof setTimeout> | null
}

type TerminalDelivery = {
  threadId: string
  deliveryId: string
  clientRunId: string
  terminal: ChatRunTerminal
  retentionTimer: ReturnType<typeof setTimeout> | null
}

export type ChatRunLease = Readonly<{
  threadId: string
  sessionId: string
  followUp: FollowUpRequestMeta
  abortSignal: AbortSignal
}>

export type ChatRunAdmission =
  | { kind: 'reserved'; lease: ChatRunLease }
  | { kind: 'duplicate'; lease: ChatRunLease }
  | { kind: 'terminal'; status: ChatRunStatus }
  | { kind: 'active'; status: ChatRunStatus }
  | { kind: 'busy'; status: ChatRunStatus }

export type ChatRunCoordinatorOptions = {
  getOpenWorkerJobCount: (sessionId: string) => number
  terminalRetentionMs?: number
  deliveryDedupeRetentionMs?: number
}

const DEFAULT_TERMINAL_RETENTION_MS = 120_000
const DEFAULT_DELIVERY_DEDUPE_RETENTION_MS = 24 * 60 * 60 * 1_000

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function terminalReasonFor(record: RunRecord, fallback: ChatRunTerminal): ChatRunTerminal {
  return record.abortController.signal.aborted ? 'aborted' : fallback
}

function getChunkType(chunk: unknown): string | undefined {
  if (!chunk || typeof chunk !== 'object') return undefined
  const value = (chunk as { type?: unknown }).type
  return typeof value === 'string' ? value : undefined
}

export function chunkProtectsChatRun(chunk: unknown): boolean {
  const type = getChunkType(chunk)
  if (!type) return false
  return (
    type.startsWith('tool-') ||
    type === 'tool-approval-request' ||
    type.startsWith('data-worker') ||
    type === 'data-leader-dispatch'
  )
}

export function chunkShowsTextPhase(chunk: unknown): boolean {
  const type = getChunkType(chunk)
  return type?.startsWith('text-') === true || type?.startsWith('reasoning-') === true
}

/**
 * The coordinator has no HTTP dependency so its safety transitions are fully
 * unit-testable. HTTP handlers decide how to serialize an admission result.
 */
export class ChatRunCoordinator {
  readonly #getOpenWorkerJobCount: ChatRunCoordinatorOptions['getOpenWorkerJobCount']
  readonly #terminalRetentionMs: number
  readonly #deliveryDedupeRetentionMs: number
  readonly #activeByThread = new Map<string, RunRecord>()
  readonly #runsByClientRunId = new Map<string, RunRecord>()
  /** Stable delivery ids prevent a completed / aborted user turn from being
   * re-executed under a fresh client lease token. */
  readonly #runsByThreadDelivery = new Map<string, RunRecord>()
  /** Lightweight terminal metadata outlives stream replay buffers so a lost
   * response cannot re-run the same delivery after the 2-minute SSE grace. */
  readonly #terminalByClientRunId = new Map<string, TerminalDelivery>()
  readonly #terminalByThreadDelivery = new Map<string, TerminalDelivery>()

  constructor(options: ChatRunCoordinatorOptions) {
    this.#getOpenWorkerJobCount = options.getOpenWorkerJobCount
    this.#terminalRetentionMs = options.terminalRetentionMs ?? DEFAULT_TERMINAL_RETENTION_MS
    this.#deliveryDedupeRetentionMs =
      options.deliveryDedupeRetentionMs ?? DEFAULT_DELIVERY_DEDUPE_RETENTION_MS
  }

  reserve(input: {
    threadId: string
    sessionId: string
    followUp: FollowUpRequestMeta
  }): ChatRunAdmission {
    const existingByToken = this.#runsByClientRunId.get(input.followUp.clientRunId)
    if (existingByToken) {
      if (
        existingByToken.threadId !== input.threadId ||
        existingByToken.followUp.deliveryId !== input.followUp.deliveryId
      ) {
        return {
          kind: 'active',
          status: this.status(input.threadId, input.sessionId),
        }
      }
      if (existingByToken.phase === 'terminal') {
        return {
          kind: 'terminal',
          status: this.status(input.threadId, input.sessionId, input.followUp.clientRunId),
        }
      }
      return {
        kind: 'duplicate',
        lease: this.#lease(existingByToken),
      }
    }

    const terminalByToken = this.#terminalByClientRunId.get(input.followUp.clientRunId)
    if (terminalByToken) {
      if (
        terminalByToken.threadId === input.threadId &&
        terminalByToken.deliveryId === input.followUp.deliveryId
      ) {
        return {
          kind: 'terminal',
          status: this.#terminalDeliveryStatus(terminalByToken, input.sessionId),
        }
      }
      return {
        kind: 'active',
        status: this.status(input.threadId, input.sessionId),
      }
    }

    const active = this.#activeByThread.get(input.threadId)
    if (active) {
      return {
        kind: 'active',
        status: this.status(input.threadId, input.sessionId),
      }
    }

    const priorDelivery = this.#runsByThreadDelivery.get(
      this.#deliveryKey(input.threadId, input.followUp.deliveryId),
    )
    if (priorDelivery) {
      if (priorDelivery.phase !== 'terminal') {
        return {
          kind: 'active',
          status: this.#statusFor(priorDelivery, true),
        }
      }
      if (priorDelivery.terminal !== 'failed') {
        return {
          kind: 'terminal',
          status: this.#statusFor(priorDelivery, false),
        }
      }
      // A failed delivery intentionally receives a new clientRunId for an
      // explicit recovery attempt. Keep the prior token for grace replay but
      // replace the delivery index with the new reservation below.
    }

    const terminalDelivery = this.#terminalByThreadDelivery.get(
      this.#deliveryKey(input.threadId, input.followUp.deliveryId),
    )
    if (terminalDelivery && terminalDelivery.terminal !== 'failed') {
      return {
        kind: 'terminal',
        status: this.#terminalDeliveryStatus(terminalDelivery, input.sessionId),
      }
    }

    if (this.#openWorkerJobCount(input.sessionId) > 0) {
      return {
        kind: 'busy',
        status: this.status(input.threadId, input.sessionId),
      }
    }

    const hubReady = deferred<ChatRunHub | undefined>()
    const done = deferred<ChatRunTerminal>()
    const record: RunRecord = {
      threadId: input.threadId,
      sessionId: input.sessionId,
      followUp: input.followUp,
      abortController: new AbortController(),
      phase: 'starting',
      toolSeen: false,
      workerSeen: false,
      hubReady: hubReady.promise,
      resolveHub: hubReady.resolve,
      done: done.promise,
      resolveDone: done.resolve,
      terminalRetentionTimer: null,
    }
    this.#activeByThread.set(record.threadId, record)
    this.#runsByClientRunId.set(record.followUp.clientRunId, record)
    this.#runsByThreadDelivery.set(
      this.#deliveryKey(record.threadId, record.followUp.deliveryId),
      record,
    )
    return { kind: 'reserved', lease: this.#lease(record) }
  }

  status(threadId: string, sessionId: string, requestedClientRunId?: string): ChatRunStatus {
    const active = this.#activeByThread.get(threadId)
    if (active) {
      this.#refreshWorkerProtection(active)
      return this.#statusFor(active, true)
    }

    if (requestedClientRunId) {
      const requested = this.#runsByClientRunId.get(requestedClientRunId)
      if (requested?.threadId === threadId && requested.phase === 'terminal') {
        return this.#statusFor(requested, false)
      }
      const terminal = this.#terminalByClientRunId.get(requestedClientRunId)
      if (terminal?.threadId === threadId) {
        return this.#terminalDeliveryStatus(terminal, sessionId)
      }
    }

    const openWorkerJobCount = this.#openWorkerJobCount(sessionId)
    return {
      threadId,
      active: false,
      phase: 'idle',
      canStart: openWorkerJobCount === 0,
      canSteer: false,
      openWorkerJobCount,
    }
  }

  getLease(clientRunId: string): ChatRunLease | undefined {
    const record = this.#runsByClientRunId.get(clientRunId)
    return record ? this.#lease(record) : undefined
  }

  getHub(clientRunId: string): ChatRunHub | undefined {
    const record = this.#runsByClientRunId.get(clientRunId)
    return record?.hub ?? getChatRun(clientRunId)
  }

  async waitForHub(clientRunId: string): Promise<ChatRunHub | undefined> {
    const record = this.#runsByClientRunId.get(clientRunId)
    if (!record) return undefined
    return record.hub ?? record.hubReady
  }

  attachStream(clientRunId: string, stream: ReadableStream<unknown>): ChatRunHub {
    const record = this.#runsByClientRunId.get(clientRunId)
    if (!record || record.phase === 'terminal') {
      throw new Error(`CHAT_RUN_RESERVATION_NOT_ACTIVE:${clientRunId}`)
    }
    if (record.hub) {
      throw new Error(`CHAT_RUN_STREAM_ALREADY_ATTACHED:${clientRunId}`)
    }
    // If cancellation won the race while handleChatStream was resolving, the
    // returned stream still needs draining so Mastra can unwind onFinish and
    // the registry can reach an actual terminal state. The route checks
    // abortSignal before it *starts* that await, so this only covers the
    // unavoidable in-flight race.
    const hub = registerChatRun(clientRunId, stream, record.abortController, {
      onChunk: (chunk) => this.observeChunk(clientRunId, chunk),
      onDone: (result) => this.#markTerminal(clientRunId, result.terminal),
    })
    record.hub = hub
    record.resolveHub(hub)
    return hub
  }

  failStart(clientRunId: string, reason: ChatRunTerminal | unknown = 'failed'): void {
    const record = this.#runsByClientRunId.get(clientRunId)
    if (!record || record.phase === 'terminal') return
    record.resolveHub(undefined)
    this.#markTerminal(
      clientRunId,
      reason === 'aborted' ? 'aborted' : terminalReasonFor(record, 'failed'),
    )
  }

  observeChunk(clientRunId: string, chunk: unknown): void {
    const record = this.#runsByClientRunId.get(clientRunId)
    if (!record || record.phase === 'terminal' || record.phase === 'aborting') return
    this.#refreshWorkerProtection(record)
    if (chunkProtectsChatRun(chunk)) {
      record.toolSeen = true
      record.phase = 'protected'
      return
    }
    if (record.phase === 'starting' && chunkShowsTextPhase(chunk)) {
      record.phase = 'text'
    }
  }

  async requestAbort(input: {
    threadId: string
    sessionId: string
    clientRunId: string
    intent: ChatRunAbortIntent
    waitMs: number
  }): Promise<ChatRunAbortDecision> {
    const record = this.#runsByClientRunId.get(input.clientRunId)
    if (!record || record.threadId !== input.threadId) {
      const terminal = this.#terminalByClientRunId.get(input.clientRunId)
      if (terminal?.threadId === input.threadId) {
        return {
          accepted: false,
          outcome: 'rejected',
          reason: 'already_terminal',
          status: this.#terminalDeliveryStatus(terminal, input.sessionId),
        }
      }
      return this.#rejected(
        input.threadId,
        input.sessionId,
        this.#activeByThread.has(input.threadId) ? 'stale_run' : 'not_found',
      )
    }
    if (record.phase === 'terminal') {
      return {
        accepted: false,
        outcome: 'rejected',
        reason: 'already_terminal',
        status: this.status(input.threadId, input.sessionId, input.clientRunId),
      }
    }
    const active = this.#activeByThread.get(input.threadId)
    if (active !== record) {
      return this.#rejected(input.threadId, input.sessionId, 'stale_run')
    }

    this.#refreshWorkerProtection(record)
    if (input.intent === 'steer' && !this.#canSteer(record)) {
      return this.#rejected(input.threadId, input.sessionId, 'not_steerable')
    }

    if (record.phase !== 'aborting') {
      record.phase = 'aborting'
      record.abortController.abort()
    }
    const terminal = await this.#waitForDone(record, input.waitMs)
    if (terminal) {
      return {
        accepted: true,
        outcome: 'terminal',
        status: this.status(input.threadId, input.sessionId, input.clientRunId),
      }
    }
    return {
      accepted: true,
      outcome: 'waiting',
      status: this.status(input.threadId, input.sessionId, input.clientRunId),
    }
  }

  attachSubscriber(
    clientRunId: string,
    response: Parameters<typeof attachChatRunSubscriber>[1],
    extraHeaders?: Record<string, string>,
  ): boolean {
    const hub = this.getHub(clientRunId)
    if (!hub) return false
    attachChatRunSubscriber(hub, response, extraHeaders)
    return true
  }

  resetForTest(): void {
    for (const record of this.#runsByClientRunId.values()) {
      if (record.terminalRetentionTimer) clearTimeout(record.terminalRetentionTimer)
      if (record.phase !== 'terminal') record.abortController.abort()
    }
    this.#activeByThread.clear()
    this.#runsByClientRunId.clear()
    this.#runsByThreadDelivery.clear()
    for (const terminal of new Set(this.#terminalByClientRunId.values())) {
      if (terminal.retentionTimer) clearTimeout(terminal.retentionTimer)
    }
    this.#terminalByClientRunId.clear()
    this.#terminalByThreadDelivery.clear()
  }

  #lease(record: RunRecord): ChatRunLease {
    return {
      threadId: record.threadId,
      sessionId: record.sessionId,
      followUp: record.followUp,
      abortSignal: record.abortController.signal,
    }
  }

  #openWorkerJobCount(sessionId: string): number {
    try {
      return Math.max(0, Math.floor(this.#getOpenWorkerJobCount(sessionId)))
    } catch (err) {
      // A scheduler read failure is safety-sensitive. Treat it as an open
      // worker instead of permitting a concurrent leader run.
      console.error('[chat-run-coordinator] worker gate read failed', err)
      return 1
    }
  }

  #deliveryKey(threadId: string, deliveryId: string): string {
    return `${threadId}\u0000${deliveryId}`
  }

  #terminalDeliveryStatus(terminal: TerminalDelivery, sessionId: string): ChatRunStatus {
    const openWorkerJobCount = this.#openWorkerJobCount(sessionId)
    return {
      threadId: terminal.threadId,
      active: false,
      clientRunId: terminal.clientRunId,
      deliveryId: terminal.deliveryId,
      phase: 'terminal',
      terminal: terminal.terminal,
      canStart: openWorkerJobCount === 0,
      canSteer: false,
      openWorkerJobCount,
    }
  }

  #refreshWorkerProtection(record: RunRecord): void {
    if (this.#openWorkerJobCount(record.sessionId) > 0) {
      record.workerSeen = true
      if (record.phase !== 'aborting') record.phase = 'protected'
    }
  }

  #canSteer(record: RunRecord): boolean {
    return (
      record.phase === 'text' &&
      !record.toolSeen &&
      !record.workerSeen &&
      this.#openWorkerJobCount(record.sessionId) === 0
    )
  }

  #statusFor(record: RunRecord, active: boolean): ChatRunStatus {
    const openWorkerJobCount = this.#openWorkerJobCount(record.sessionId)
    const phase = record.phase
    return {
      threadId: record.threadId,
      active,
      clientRunId: record.followUp.clientRunId,
      deliveryId: record.followUp.deliveryId,
      phase,
      ...(record.terminal ? { terminal: record.terminal } : {}),
      canStart: !active && openWorkerJobCount === 0,
      canSteer: active && this.#canSteer(record),
      openWorkerJobCount,
    }
  }

  #rejected(
    threadId: string,
    sessionId: string,
    reason: 'not_found' | 'stale_run' | 'not_steerable',
  ): ChatRunAbortDecision {
    return {
      accepted: false,
      outcome: 'rejected',
      reason,
      status: this.status(threadId, sessionId),
    }
  }

  async #waitForDone(record: RunRecord, waitMs: number): Promise<ChatRunTerminal | undefined> {
    if (record.phase === 'terminal') return record.terminal
    if (waitMs <= 0) return undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const timedOut = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), waitMs)
      timer.unref?.()
    })
    try {
      return await Promise.race([record.done, timedOut])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  #markTerminal(clientRunId: string, terminal: ChatRunTerminal): void {
    const record = this.#runsByClientRunId.get(clientRunId)
    if (!record || record.phase === 'terminal') return
    record.phase = 'terminal'
    record.terminal = terminalReasonFor(record, terminal)
    if (this.#activeByThread.get(record.threadId) === record) {
      this.#activeByThread.delete(record.threadId)
    }
    record.resolveHub(record.hub)
    record.resolveDone(record.terminal)
    this.#retainTerminalDelivery(record)
    record.terminalRetentionTimer = setTimeout(() => {
      if (this.#runsByClientRunId.get(clientRunId) === record) {
        this.#runsByClientRunId.delete(clientRunId)
      }
      const deliveryKey = this.#deliveryKey(record.threadId, record.followUp.deliveryId)
      if (this.#runsByThreadDelivery.get(deliveryKey) === record) {
        this.#runsByThreadDelivery.delete(deliveryKey)
      }
    }, this.#terminalRetentionMs)
    record.terminalRetentionTimer.unref?.()
  }

  #retainTerminalDelivery(record: RunRecord): void {
    const terminal: TerminalDelivery = {
      threadId: record.threadId,
      deliveryId: record.followUp.deliveryId,
      clientRunId: record.followUp.clientRunId,
      terminal: record.terminal ?? 'failed',
      retentionTimer: null,
    }
    const deliveryKey = this.#deliveryKey(terminal.threadId, terminal.deliveryId)
    const priorByToken = this.#terminalByClientRunId.get(terminal.clientRunId)
    if (priorByToken?.retentionTimer) clearTimeout(priorByToken.retentionTimer)
    // A failed delivery may be recovered by a new token. Keep the old token's
    // own timer alive so it remains terminal (rather than becoming reusable)
    // until its independent dedupe grace expires.
    this.#terminalByClientRunId.set(terminal.clientRunId, terminal)
    this.#terminalByThreadDelivery.set(deliveryKey, terminal)
    terminal.retentionTimer = setTimeout(() => {
      if (this.#terminalByClientRunId.get(terminal.clientRunId) === terminal) {
        this.#terminalByClientRunId.delete(terminal.clientRunId)
      }
      if (this.#terminalByThreadDelivery.get(deliveryKey) === terminal) {
        this.#terminalByThreadDelivery.delete(deliveryKey)
      }
    }, this.#deliveryDedupeRetentionMs)
    terminal.retentionTimer.unref?.()
  }
}
