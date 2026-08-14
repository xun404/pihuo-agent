import type {
  ChatRunAbortDecision,
  ChatRunAbortIntent,
  ChatRunStatus,
  FollowUpRequestMeta,
  FollowUpSource,
} from '@pihuo-agent/shared'
import type { FollowUpBehavior } from './follow-up-behavior'
import type { FollowUpOutboxItem } from './follow-up-outbox'

export const FOLLOW_UP_RETRY_MIN_MS = 2_000
export const FOLLOW_UP_RETRY_MAX_MS = 60_000
export const FOLLOW_UP_STATUS_POLL_MS = 1_000
/** Keep a stop/steer barrier deterministic instead of polling forever. */
export const FOLLOW_UP_TERMINATION_MAX_POLLS = 30

export type FollowUpCoordinatorPhase =
  | 'bootstrapping'
  | 'ready'
  | 'dispatching'
  | 'observing'
  | 'terminating'
  | 'retry_wait'
  | 'blocked_model'

export type FollowUpIntent = 'direct' | 'enqueue' | 'request_steer' | 'wait' | 'blocked_model'

export type FollowUpCoordinatorSnapshot = {
  phase: FollowUpCoordinatorPhase
  bootstrapped: boolean
  serverStatus: ChatRunStatus | null
  activeClientRunId: string | null
  retryAt: number | null
}

export type FollowUpCoordinatorDependencies = {
  threadId: string
  now: () => number
  createId: () => string
  hasModel: () => boolean
  getOutbox: () => FollowUpOutboxItem[]
  addOutbox: (item: FollowUpOutboxItem) => { ok: true } | { ok: false; reason: 'capacity' }
  updateOutbox: (
    deliveryId: string,
    patch: Partial<Omit<FollowUpOutboxItem, 'deliveryId' | 'createdAt' | 'content'>>,
  ) => void
  removeOutbox: (deliveryId: string) => FollowUpOutboxItem | undefined
  moveToFront: (deliveryId: string) => void
  getRunStatus: (clientRunId?: string) => Promise<ChatRunStatus>
  requestAbort: (clientRunId: string, intent: ChatRunAbortIntent) => Promise<ChatRunAbortDecision>
  send: (input: { id: string; text: string; followUp: FollowUpRequestMeta }) => Promise<void>
  stopLocal: () => void
  resume: (clientRunId?: string) => Promise<void>
  refreshHistory: () => Promise<void>
  onModelRequired: () => void
  onCapacityReached?: () => void
  onChange?: (snapshot: FollowUpCoordinatorSnapshot) => void
  setTimer: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>
  clearTimer: (timer: ReturnType<typeof setTimeout>) => void
}

export function retryDelayMs(attempt: number): number {
  const normalized = Math.max(1, Math.floor(attempt))
  return Math.min(FOLLOW_UP_RETRY_MIN_MS * 2 ** (normalized - 1), FOLLOW_UP_RETRY_MAX_MS)
}

export function resolveFollowUpIntent(input: {
  behavior: FollowUpBehavior
  busy: boolean
  canSteer: boolean
  preferSteer: boolean
  hasModel: boolean
}): FollowUpIntent {
  if (!input.hasModel) return 'blocked_model'
  if (!input.busy) return 'direct'
  if (input.canSteer && (input.behavior === 'steer' || input.preferSteer)) {
    return 'request_steer'
  }
  return input.behavior === 'queue' || !input.canSteer ? 'enqueue' : 'wait'
}

export class FollowUpCoordinator {
  #phase: FollowUpCoordinatorPhase = 'bootstrapping'
  #bootstrapped = false
  #serverStatus: ChatRunStatus | null = null
  #activeClientRunId: string | null = null
  #dispatchClientRunId: string | null = null
  #retryAt: number | null = null
  #timer: ReturnType<typeof setTimeout> | null = null
  #terminationPolls = 0
  #disposed = false
  #operation = 0

  constructor(private readonly deps: FollowUpCoordinatorDependencies) {}

  get snapshot(): FollowUpCoordinatorSnapshot {
    return {
      phase: this.#phase,
      bootstrapped: this.#bootstrapped,
      serverStatus: this.#serverStatus,
      activeClientRunId: this.#activeClientRunId,
      retryAt: this.#retryAt,
    }
  }

  async bootstrap(): Promise<void> {
    const operation = this.#nextOperation()
    this.#phase = 'bootstrapping'
    this.#emit()
    let status: ChatRunStatus
    try {
      status = await this.deps.getRunStatus()
    } catch {
      if (!this.#isCurrent(operation)) return
      this.#bootstrapped = true
      this.#scheduleRetryForHead()
      return
    }
    if (!this.#isCurrent(operation)) return
    this.#serverStatus = status
    this.#activeClientRunId = status.active ? (status.clientRunId ?? null) : null
    if (status.active && status.clientRunId) {
      try {
        await this.deps.resume(status.clientRunId)
      } catch {
        // A reconnect failure is ambiguous, not proof the run disappeared.
        // Reconciliation below retains the server status and blocks dispatch.
      }
    }
    if (!this.#isCurrent(operation)) return
    this.#bootstrapped = true
    this.#phase = status.active || !status.canStart ? 'observing' : 'ready'
    this.#emit()
    await this.reconcileAndDispatch()
  }

  submit(
    text: string,
    input: {
      behavior: FollowUpBehavior
      preferSteer: boolean
      source?: FollowUpSource
    },
  ): FollowUpIntent {
    const content = text.trim()
    if (!content) return 'wait'
    const busy =
      !this.#bootstrapped ||
      this.#phase === 'dispatching' ||
      this.#phase === 'terminating' ||
      this.#phase === 'observing' ||
      this.#serverStatus?.active === true ||
      this.#serverStatus?.canStart === false
    const intent = resolveFollowUpIntent({
      behavior: input.behavior,
      busy,
      canSteer: this.#serverStatus?.canSteer === true,
      preferSteer: input.preferSteer,
      hasModel: this.deps.hasModel(),
    })
    if (intent === 'blocked_model') {
      this.#phase = 'blocked_model'
      this.deps.onModelRequired()
      this.#emit()
      return intent
    }
    const source =
      intent === 'request_steer'
        ? 'steer'
        : intent === 'enqueue'
          ? 'queue'
          : (input.source ?? 'direct')
    const item = this.#enqueue(content, source)
    if (!item) return 'wait'
    if (intent === 'direct') {
      void this.reconcileAndDispatch()
    } else if (intent === 'request_steer') {
      void this.steerTo(item.deliveryId)
    }
    return intent
  }

  async sendNow(deliveryId: string): Promise<void> {
    if (!this.deps.hasModel()) {
      this.#phase = 'blocked_model'
      this.deps.onModelRequired()
      this.#emit()
      return
    }
    if (this.#phase === 'dispatching' || this.#phase === 'terminating') return
    this.deps.moveToFront(deliveryId)
    const item = this.deps.getOutbox().find((candidate) => candidate.deliveryId === deliveryId)
    if (!item) return
    // Manual Send now intentionally overrides a prior retry backoff, but
    // keeps the delivery id / lease and attempt history intact.
    this.deps.updateOutbox(deliveryId, { state: 'queued', nextAttemptAt: null })
    const operation = this.#nextOperation()
    let status: ChatRunStatus
    try {
      status = await this.deps.getRunStatus(this.#activeClientRunId ?? item.clientRunId)
    } catch {
      if (this.#isCurrent(operation)) this.#scheduleRetryForHead()
      return
    }
    if (!this.#isCurrent(operation)) return
    this.#serverStatus = status
    this.#activeClientRunId = status.active ? (status.clientRunId ?? null) : null
    if (status.active && status.canSteer && this.#activeClientRunId) {
      void this.steerTo(deliveryId)
      return
    }
    void this.reconcileAndDispatch()
  }

  async stop(intent: ChatRunAbortIntent = 'stop'): Promise<void> {
    const clientRunId =
      this.#activeClientRunId ?? this.#dispatchClientRunId ?? this.#serverStatus?.clientRunId
    if (!clientRunId) return
    this.#nextOperation()
    this.#terminationPolls = 0
    this.deps.stopLocal()
    this.#phase = 'terminating'
    this.#emit()
    try {
      const decision = await this.deps.requestAbort(clientRunId, intent)
      this.#serverStatus = decision.status
      if (
        decision.outcome === 'terminal' ||
        (!decision.accepted && !decision.status.active && decision.status.phase === 'terminal')
      ) {
        await this.#afterTerminal()
      } else if (decision.accepted) {
        this.#scheduleStatusPoll()
      } else {
        if (decision.status.active) {
          this.#phase = 'observing'
          this.#scheduleObservationPoll()
          this.#emit()
        } else {
          // An idle status is the server-side confirmation that no matching
          // run remains. Refresh durable history before dispatching any
          // successor just as we do for an explicit terminal response.
          await this.#afterTerminal()
        }
      }
    } catch {
      // A failed abort call cannot establish safety. Continue a per-thread
      // status poll and never dispatch a successor on this path.
      this.#scheduleStatusPoll()
    }
  }

  transportAccepted(meta: Pick<FollowUpRequestMeta, 'deliveryId' | 'clientRunId'>): void {
    const item = this.deps.getOutbox().find((candidate) => candidate.deliveryId === meta.deliveryId)
    if (!item || item.clientRunId !== meta.clientRunId || item.state !== 'dispatching') return
    this.#nextOperation()
    this.deps.removeOutbox(meta.deliveryId)
    this.#activeClientRunId = meta.clientRunId
    this.#dispatchClientRunId = null
    this.#serverStatus = {
      threadId: this.deps.threadId,
      active: true,
      clientRunId: meta.clientRunId,
      deliveryId: meta.deliveryId,
      phase: 'starting',
      canStart: false,
      canSteer: false,
      openWorkerJobCount: 0,
    }
    this.#phase = 'observing'
    this.#retryAt = null
    this.#clearTimer()
    this.#scheduleObservationPoll()
    this.#emit()
  }

  transportInitialFailure(
    meta: Pick<FollowUpRequestMeta, 'deliveryId' | 'clientRunId'>,
    _error: unknown,
  ): void {
    const item = this.deps.getOutbox().find((candidate) => candidate.deliveryId === meta.deliveryId)
    if (!item || item.clientRunId !== meta.clientRunId || item.state !== 'dispatching') return
    this.#nextOperation()
    // HTTP failure before a response stream is usually unambiguous, but route
    // timeouts can occur after server admission. Mark unknown and reconcile
    // before retrying; this is conservative and avoids duplicate execution.
    this.deps.updateOutbox(meta.deliveryId, { state: 'unknown' })
    this.#dispatchClientRunId = null
    this.#phase = 'observing'
    this.#emit()
    void this.#reconcileInitialFailure(meta.clientRunId)
  }

  async reconcileAndDispatch(): Promise<void> {
    if (!this.#bootstrapped || this.#disposed) return
    if (this.#phase === 'dispatching' || this.#phase === 'terminating') return
    const operation = this.#nextOperation()
    const head = this.deps.getOutbox()[0]
    let status: ChatRunStatus
    try {
      status = await this.deps.getRunStatus(this.#activeClientRunId ?? head?.clientRunId)
    } catch {
      if (!this.#isCurrent(operation)) return
      this.#scheduleRetryForHead()
      return
    }
    if (!this.#isCurrent(operation)) return
    this.#serverStatus = status
    this.#activeClientRunId = status.active ? (status.clientRunId ?? null) : null
    if (status.active || !status.canStart) {
      this.#phase = 'observing'
      this.#scheduleObservationPoll()
      this.#emit()
      return
    }

    let item = this.deps.getOutbox()[0]
    if (!item) {
      this.#phase = 'ready'
      this.#retryAt = null
      this.#clearTimer()
      this.#emit()
      return
    }
    if (this.#isMatchingTerminalDelivery(status, item)) {
      if (status.terminal === 'failed') {
        // The server accepted this delivery but failed before opening a
        // stream. Preserve the durable deliveryId/user-message id and create
        // a fresh run lease; reusing a terminal token is forbidden.
        this.deps.updateOutbox(item.deliveryId, {
          clientRunId: this.deps.createId(),
          state: 'queued',
          nextAttemptAt: null,
        })
        item = this.deps.getOutbox()[0]
        if (!item) return
      } else {
        // completed / aborted proves this exact delivery reached the server.
        // Removing it is reconciliation, not a sendMessage-promise ack.
        this.deps.removeOutbox(item.deliveryId)
        await this.reconcileAndDispatch()
        return
      }
    }
    if (!this.deps.hasModel()) {
      // blocked_model is coordinator/UI state, not an outbox delivery state:
      // a persisted item must remain a normal queue item until a configured
      // model lets it dispatch.
      this.deps.updateOutbox(item.deliveryId, { state: 'queued' })
      this.#phase = 'blocked_model'
      this.deps.onModelRequired()
      this.#emit()
      return
    }
    if (item.nextAttemptAt !== null && item.nextAttemptAt > this.deps.now()) {
      this.#phase = 'retry_wait'
      this.#retryAt = item.nextAttemptAt
      this.#scheduleAt(item.nextAttemptAt)
      this.#emit()
      return
    }
    if (item.state === 'unknown') {
      // The status above did not find an active matching server run, so it is
      // now safe to turn this ambiguous item into an explicit retry.
      const attempt = item.attempt + 1
      const retryAt = this.deps.now() + retryDelayMs(attempt)
      this.deps.updateOutbox(item.deliveryId, {
        state: 'retry_wait',
        attempt,
        nextAttemptAt: retryAt,
      })
      this.#phase = 'retry_wait'
      this.#retryAt = retryAt
      this.#scheduleAt(retryAt)
      this.#emit()
      return
    }
    this.#dispatch(item.deliveryId)
  }

  dispose(): void {
    this.#disposed = true
    this.#nextOperation()
    this.#clearTimer()
  }

  #dispatch(deliveryId: string): void {
    const item = this.deps.getOutbox().find((candidate) => candidate.deliveryId === deliveryId)
    if (!item || this.#disposed) return
    this.#nextOperation()
    this.#phase = 'dispatching'
    this.#dispatchClientRunId = item.clientRunId
    this.#retryAt = null
    this.deps.updateOutbox(deliveryId, { state: 'dispatching', nextAttemptAt: null })
    this.#emit()
    try {
      void Promise.resolve(
        this.deps.send({
          id: item.deliveryId,
          text: item.content,
          followUp: {
            deliveryId: item.deliveryId,
            clientRunId: item.clientRunId,
            source: item.source,
          },
        }),
      ).catch((error) => {
        // Most AI SDK failures are swallowed, but message construction and
        // adapter failures can still reject. Treat them exactly like an
        // initial transport rejection; the callback itself deduplicates.
        this.transportInitialFailure(
          {
            deliveryId: item.deliveryId,
            clientRunId: item.clientRunId,
          },
          error,
        )
      })
    } catch {
      // send() only throws for programming / message construction failures.
      // Treat it as an initial failure if the transport did not already do so.
      this.transportInitialFailure(
        {
          deliveryId: item.deliveryId,
          clientRunId: item.clientRunId,
        },
        new Error('chat send rejected before transport'),
      )
    }
  }

  async steerTo(deliveryId: string): Promise<void> {
    const item = this.deps.getOutbox().find((candidate) => candidate.deliveryId === deliveryId)
    if (!item) return
    const active = this.#activeClientRunId ?? this.#serverStatus?.clientRunId
    if (!active || this.#serverStatus?.canSteer !== true) {
      await this.reconcileAndDispatch()
      return
    }
    this.deps.updateOutbox(deliveryId, { source: 'steer', state: 'queued' })
    this.#dispatch(deliveryId)
  }

  async #afterTerminal(): Promise<void> {
    const operation = this.#nextOperation()
    this.#terminationPolls = 0
    this.#activeClientRunId = null
    this.#dispatchClientRunId = null
    try {
      await this.deps.refreshHistory()
    } catch {
      if (!this.#isCurrent(operation)) return
      this.#phase = 'terminating'
      this.#scheduleStatusPoll()
      return
    }
    if (!this.#isCurrent(operation)) return
    this.#phase = 'ready'
    this.#emit()
    await this.reconcileAndDispatch()
  }

  #enqueue(content: string, source: FollowUpSource): FollowUpOutboxItem | undefined {
    const now = this.deps.now()
    const item: FollowUpOutboxItem = {
      deliveryId: this.deps.createId(),
      clientRunId: this.deps.createId(),
      content,
      createdAt: now,
      source,
      attempt: 0,
      nextAttemptAt: null,
      state: 'queued',
    }
    const result = this.deps.addOutbox(item)
    if (!result.ok) {
      this.deps.onCapacityReached?.()
      return undefined
    }
    return item
  }

  #scheduleRetryForHead(): void {
    const item = this.deps.getOutbox()[0]
    if (!item) {
      this.#phase = 'ready'
      this.#retryAt = null
      this.#clearTimer()
      this.#emit()
      return
    }
    const attempt = item.attempt + 1
    const retryAt = this.deps.now() + retryDelayMs(attempt)
    this.deps.updateOutbox(item.deliveryId, {
      state: 'retry_wait',
      attempt,
      nextAttemptAt: retryAt,
    })
    this.#phase = 'retry_wait'
    this.#retryAt = retryAt
    this.#scheduleAt(retryAt)
    this.#emit()
  }

  #scheduleStatusPoll(): void {
    if (this.#terminationPolls >= FOLLOW_UP_TERMINATION_MAX_POLLS) {
      // The server has still not provided a terminal answer. Keep the hard
      // barrier (rather than launching a successor) and let the user retry
      // Stop or reload to trigger a fresh, bounded reconciliation cycle.
      this.#phase = 'terminating'
      this.#retryAt = null
      this.#clearTimer()
      this.#emit()
      return
    }
    this.#terminationPolls += 1
    this.#phase = 'terminating'
    this.#retryAt = this.deps.now() + FOLLOW_UP_STATUS_POLL_MS
    this.#scheduleAt(this.#retryAt, () => {
      void this.#pollTermination()
    })
    this.#emit()
  }

  #scheduleObservationPoll(): void {
    if (this.#phase !== 'observing') return
    this.#retryAt = this.deps.now() + FOLLOW_UP_STATUS_POLL_MS
    this.#scheduleAt(this.#retryAt, () => {
      void this.reconcileAndDispatch()
    })
  }

  async #reconcileInitialFailure(clientRunId: string): Promise<void> {
    if (this.#disposed) return
    const operation = this.#nextOperation()
    let status: ChatRunStatus
    try {
      status = await this.deps.getRunStatus(clientRunId)
    } catch {
      if (!this.#isCurrent(operation)) return
      this.#scheduleRetryForHead()
      return
    }
    if (!this.#isCurrent(operation)) return
    this.#serverStatus = status
    this.#activeClientRunId = status.active ? (status.clientRunId ?? null) : null
    if (status.active || !status.canStart) {
      this.#phase = 'observing'
      this.#scheduleObservationPoll()
      this.#emit()
      return
    }
    const item = this.deps.getOutbox()[0]
    if (item && this.#isMatchingTerminalDelivery(status, item)) {
      if (status.terminal === 'failed') {
        this.deps.updateOutbox(item.deliveryId, {
          clientRunId: this.deps.createId(),
          state: 'queued',
          nextAttemptAt: null,
        })
      } else {
        this.deps.removeOutbox(item.deliveryId)
        await this.reconcileAndDispatch()
        return
      }
    }
    this.#scheduleRetryForHead()
  }

  async #pollTermination(): Promise<void> {
    if (this.#disposed) return
    const operation = this.#nextOperation()
    const clientRunId = this.#activeClientRunId ?? this.#dispatchClientRunId
    let status: ChatRunStatus
    try {
      status = await this.deps.getRunStatus(clientRunId ?? undefined)
    } catch {
      if (!this.#isCurrent(operation)) return
      this.#scheduleStatusPoll()
      return
    }
    if (!this.#isCurrent(operation)) return
    this.#serverStatus = status
    this.#activeClientRunId = status.active ? (status.clientRunId ?? null) : null
    if (status.active) {
      this.#scheduleStatusPoll()
      return
    }
    await this.#afterTerminal()
  }

  #scheduleAt(at: number, callback?: () => void): void {
    this.#clearTimer()
    const delay = Math.max(0, at - this.deps.now())
    this.#timer = this.deps.setTimer(() => {
      this.#timer = null
      if (callback) callback()
      else void this.reconcileAndDispatch()
    }, delay)
  }

  #clearTimer(): void {
    if (this.#timer) {
      this.deps.clearTimer(this.#timer)
      this.#timer = null
    }
  }

  #nextOperation(): number {
    this.#operation += 1
    return this.#operation
  }

  #isCurrent(operation: number): boolean {
    return !this.#disposed && operation === this.#operation
  }

  #isMatchingTerminalDelivery(status: ChatRunStatus, item: FollowUpOutboxItem): boolean {
    return (
      status.terminal !== undefined &&
      status.deliveryId === item.deliveryId &&
      status.clientRunId === item.clientRunId
    )
  }

  #emit(): void {
    this.deps.onChange?.(this.snapshot)
  }
}
