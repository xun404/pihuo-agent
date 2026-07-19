/**
 * WorkerRunEvent emission system for Scheduler → tool bridge → Chat UI.
 *
 * Event order is enforced: started → delta* → terminal (completed|failed|cancelled).
 * Each jobId gets exactly one terminal event. A bounded journal supports atomic
 * replay+subscribe so late subscribers still receive prior (and terminal) events.
 */
import {
  isTerminalWorkerEvent,
  type WorkerKind,
  type WorkerRole,
  type WorkerRunEvent,
} from '@router-agents/shared'

export const DEFAULT_WORKER_JOB_TIMEOUT_MS = 600_000
export const DEFAULT_WORKER_WRITER_TIMEOUT_MS = 5_000
export const MAX_TIMER_DELAY_MS = 2_147_483_647

/** Safe positive timer value shared by scheduler, local tool waits, and remote observers. */
export function resolveWorkerJobTimeoutMs(
  raw: string | number | undefined = process.env.WORKER_JOB_TIMEOUT_MS,
): number {
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_WORKER_JOB_TIMEOUT_MS
  return Math.min(Math.floor(parsed), MAX_TIMER_DELAY_MS)
}

export function resolveWorkerWriterTimeoutMs(
  raw: string | number | undefined = process.env.WORKER_WRITER_TIMEOUT_MS,
): number {
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_WORKER_WRITER_TIMEOUT_MS
  return Math.min(Math.floor(parsed), MAX_TIMER_DELAY_MS)
}

export type WorkerEventIdentity = {
  workerName?: string
  workerKind?: WorkerKind
  role?: WorkerRole
  model?: string
}

export function enrichTerminalWorkerEvent(
  event: WorkerRunEvent,
  fallback: WorkerEventIdentity,
): WorkerRunEvent {
  if (!isTerminalWorkerEvent(event)) return event
  return {
    ...event,
    workerName: event.workerName ?? fallback.workerName,
    workerKind: event.workerKind ?? fallback.workerKind,
    role: event.role ?? fallback.role,
    model: event.model ?? fallback.model,
  }
}

export function splitWorkerDeltaChunks(
  jobId: string,
  text: string,
  sequence: number,
  maxChunk = 8192,
): { events: WorkerRunEvent[]; nextSequence: number } {
  if (!Number.isInteger(maxChunk) || maxChunk <= 0) {
    throw new RangeError('maxChunk must be a positive integer')
  }
  const events: WorkerRunEvent[] = []
  let nextSequence = sequence
  for (let offset = 0; offset < text.length; offset += maxChunk) {
    nextSequence += 1
    events.push({
      type: 'delta',
      jobId,
      sequence: nextSequence,
      delta: text.slice(offset, offset + maxChunk),
    })
  }
  return { events, nextSequence }
}

export async function raceWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorFactory: () => Error,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(errorFactory()), timeoutMs)
        timer.unref?.()
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export interface WorkerEventWriter {
  custom(options: { type: string; data: unknown; transient?: boolean; id?: string }): Promise<void>
}

export type WorkerEventWriteResult = { ok: true } | { ok: false; timedOut: boolean; error: unknown }

/** A disconnected/backpressured Chat writer must never hold the Leader turn forever. */
export async function writeWorkerEventWithDeadline(
  writer: WorkerEventWriter,
  options: Parameters<WorkerEventWriter['custom']>[0],
  timeoutMs = resolveWorkerWriterTimeoutMs(),
): Promise<WorkerEventWriteResult> {
  let timedOut = false
  try {
    await raceWithTimeout(
      Promise.resolve().then(() => writer.custom(options)),
      resolveWorkerWriterTimeoutMs(timeoutMs),
      () => {
        timedOut = true
        return new Error('Worker event writer timed out')
      },
    )
    return { ok: true }
  } catch (error) {
    return { ok: false, timedOut, error }
  }
}

export function subscribeAbort(signal: AbortSignal, handler: () => void): () => void {
  let active = true
  const onAbort = () => {
    if (!active) return
    active = false
    signal.removeEventListener('abort', onAbort)
    handler()
  }

  if (signal.aborted) {
    active = false
    handler()
    return () => {}
  }

  signal.addEventListener('abort', onAbort, { once: true })
  // Cover an abort racing with listener registration.
  if (signal.aborted) onAbort()

  return () => {
    if (!active) return
    active = false
    signal.removeEventListener('abort', onAbort)
  }
}

// ---------------------------------------------------------------------------
// ANSI / control char sanitisation
// ---------------------------------------------------------------------------

const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]/g
const OSC_RE = /\x1b\][^\x07]*\x07/g
const DANGEROUS_CTRL_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f]/g

function sanitiseDelta(delta: string): string {
  let out = delta.replace(ANSI_RE, '').replace(OSC_RE, '')
  out = out.replace(DANGEROUS_CTRL_RE, '')
  return out
}

/**
 * Events cross several independently-owned boundaries (scheduler, HTTP stream,
 * chat writer). Keep approval sub-objects isolated as well as the event shell so
 * a consumer cannot mutate another consumer's view or the replay journal.
 */
function cloneWorkerRunEvent(event: WorkerRunEvent): WorkerRunEvent {
  if (event.type !== 'approval_requested' && event.type !== 'approval_resolved') {
    return { ...event }
  }
  return {
    ...event,
    approval: {
      ...event.approval,
      options: event.approval.options.map((option) => ({ ...option })),
      locations: event.approval.locations?.map((location) => ({ ...location })),
      selectedOption: event.approval.selectedOption
        ? { ...event.approval.selectedOption }
        : undefined,
    },
  }
}

// ---------------------------------------------------------------------------
// Job state tracking (event ordering + bounded journal)
// ---------------------------------------------------------------------------

/** Max events retained per job (started + deltas + terminal). Drops oldest non-terminal if exceeded. */
const DEFAULT_JOURNAL_MAX = 512

type JobState = {
  started: boolean
  terminal: boolean
  /** Monotonic sequence for journal entries (independent of delta.sequence). */
  emitSequence: number
  journal: Array<{ seq: number; event: WorkerRunEvent }>
  cleanupTimer?: ReturnType<typeof setTimeout>
}

export type SubscribeOptions = {
  /**
   * Replay journal entries with emitSequence strictly greater than this value.
   * Defaults to 0 (replay all retained events).
   */
  afterSequence?: number
}

/** Gap when client cursor is older than the retained journal range (TTL trim / bound). */
export type JournalGapInfo = {
  gap: true
  afterSequence: number
  retainedFrom: number
  retainedTo: number
  /** Highest emitSequence ever assigned (may exceed retainedTo after TTL wipe). */
  emitSequenceHighWater: number
}

// ---------------------------------------------------------------------------
// WorkerEventEmitter (singleton)
// ---------------------------------------------------------------------------

/** Optional emitSequence is the monotonic journal cursor for reconnect (Last-Event-ID). */
export type EventHandler = (event: WorkerRunEvent, meta?: { emitSequence: number }) => void

export class WorkerEventEmitter {
  #subscribers = new Map<string, Set<EventHandler>>()
  #jobStates = new Map<string, JobState>()
  #terminalTtlMs: number
  #journalMax: number

  constructor(options: { terminalTtlMs?: number; journalMax?: number } = {}) {
    const terminalTtlMs = Number(options.terminalTtlMs)
    this.#terminalTtlMs =
      Number.isFinite(terminalTtlMs) && terminalTtlMs > 0
        ? Math.min(Math.floor(terminalTtlMs), MAX_TIMER_DELAY_MS)
        : 60_000
    const journalMax = Number(options.journalMax)
    this.#journalMax =
      Number.isFinite(journalMax) && journalMax > 0
        ? Math.min(Math.floor(journalMax), 10_000)
        : DEFAULT_JOURNAL_MAX
  }

  /**
   * Atomically replay retained events (after `afterSequence`) then subscribe for future ones.
   * Late subscribers on a terminal job receive the journal replay (including terminal) and
   * are not left waiting forever.
   * Returns an unsubscribe function.
   */
  subscribe(jobId: string, handler: EventHandler, options?: SubscribeOptions): () => void {
    const afterSequence = options?.afterSequence ?? 0
    const state = this.#jobStates.get(jobId)

    // Replay first (synchronous), then register for future — prevents lost events
    // between replay and registration for events that arrive during this call.
    if (state?.journal.length) {
      for (const entry of state.journal) {
        if (entry.seq > afterSequence) {
          try {
            handler(cloneWorkerRunEvent(entry.event), { emitSequence: entry.seq })
          } catch {
            // drop handler errors during replay
          }
        }
      }
    }

    // If already terminal, do not register for future (no more events will come).
    if (state?.terminal) {
      return () => {}
    }

    let handlers = this.#subscribers.get(jobId)
    if (!handlers) {
      handlers = new Set()
      this.#subscribers.set(jobId, handlers)
    }
    handlers.add(handler)

    let unsubscribed = false
    return () => {
      if (unsubscribed) return
      unsubscribed = true
      const set = this.#subscribers.get(jobId)
      if (set) {
        set.delete(handler)
        if (set.size === 0) this.#subscribers.delete(jobId)
      }
    }
  }

  /**
   * Read journal snapshot for a job (for diagnostics / remote catch-up).
   * Entries have emitSequence greater than `afterSequence`.
   */
  getJournal(jobId: string, afterSequence = 0): Array<{ seq: number; event: WorkerRunEvent }> {
    const state = this.#jobStates.get(jobId)
    if (!state) return []
    return state.journal
      .filter((entry) => entry.seq > afterSequence)
      .map((entry) => ({ seq: entry.seq, event: cloneWorkerRunEvent(entry.event) }))
  }

  /**
   * Detect whether the client cursor is missing events (trimmed journal / TTL).
   * Uses retained sequences: gap when the next expected seq (after+1) is not present
   * but a later seq still is, or when higher events were wiped entirely.
   */
  detectGap(jobId: string, afterSequence = 0): JournalGapInfo | null {
    const state = this.#jobStates.get(jobId)
    if (!state) return null
    const after = Number.isFinite(afterSequence) ? Math.max(0, afterSequence) : 0
    const retainedTo = state.journal.length
      ? state.journal[state.journal.length - 1]!.seq
      : state.emitSequence
    const highWater = state.emitSequence

    if (state.journal.length === 0) {
      if (after > 0 && highWater > after) {
        return {
          gap: true,
          afterSequence: after,
          retainedFrom: highWater + 1,
          retainedTo: highWater,
          emitSequenceHighWater: highWater,
        }
      }
      return null
    }

    // Unseen retained entries in order
    const unseen = state.journal.filter((e) => e.seq > after)
    if (unseen.length === 0) {
      // Client is caught up with retained; if high-water is further and wiped, gap
      if (highWater > after && highWater > retainedTo) {
        return {
          gap: true,
          afterSequence: after,
          retainedFrom: highWater + 1,
          retainedTo: highWater,
          emitSequenceHighWater: highWater,
        }
      }
      return null
    }

    // Hole before first unseen, or hole between retained entries the client will receive
    if (unseen[0]!.seq > after + 1) {
      return {
        gap: true,
        afterSequence: after,
        retainedFrom: unseen[0]!.seq,
        retainedTo,
        emitSequenceHighWater: highWater,
      }
    }
    for (let i = 1; i < unseen.length; i++) {
      if (unseen[i]!.seq > unseen[i - 1]!.seq + 1) {
        return {
          gap: true,
          afterSequence: after,
          retainedFrom: unseen[i]!.seq,
          retainedTo,
          emitSequenceHighWater: highWater,
        }
      }
    }
    return null
  }

  isTerminal(jobId: string): boolean {
    return this.#jobStates.get(jobId)?.terminal === true
  }

  /** Publish an event to all subscribers for its jobId. */
  emit(event: WorkerRunEvent): void {
    // Never sanitise or retain the caller-owned object.
    event = cloneWorkerRunEvent(event)
    const jobId = event.jobId
    let state = this.#jobStates.get(jobId)
    if (!state) {
      state = { started: false, terminal: false, emitSequence: 0, journal: [] }
      this.#jobStates.set(jobId, state)
    }

    // ---- order enforcement ----
    if (event.type === 'started') {
      if (state.started) return // duplicate started
      state.started = true
    } else {
      // Allow terminal-only events (preflight failure, queued cancel, timed_out)
      if (!state.started) {
        const isTerminalOnly =
          (event.type === 'failed' || event.type === 'cancelled' || event.type === 'timed_out') &&
          !state.started
        if (!isTerminalOnly) return
      }
      if (state.terminal) return // already terminated

      if (event.type === 'delta') {
        ;(event as WorkerRunEvent & { delta: string }).delta = sanitiseDelta(
          (event as WorkerRunEvent & { delta: string }).delta,
        )
      } else if (isTerminalWorkerEvent(event)) {
        state.terminal = true
        const ev = event as any
        if (typeof ev.output === 'string') {
          ev.output = sanitiseDelta(ev.output)
        }
      }
    }

    // Append to bounded journal before delivery so concurrent subscribe sees it.
    state.emitSequence += 1
    const seq = state.emitSequence
    state.journal.push({ seq, event })
    this.#trimJournal(state)

    if (state.terminal && !state.cleanupTimer) {
      state.cleanupTimer = setTimeout(() => {
        if (this.#jobStates.get(jobId) === state) {
          this.#jobStates.delete(jobId)
        }
      }, this.#terminalTtlMs)
      state.cleanupTimer.unref?.()
    }

    // ---- deliver ----
    const handlers = this.#subscribers.get(jobId)
    if (!handlers || handlers.size === 0) {
      // still keep journal for late subscribers
    } else {
      // Snapshot to avoid issues if a handler unsubscribes during iteration
      const snapshot = [...handlers]
      for (const handler of snapshot) {
        try {
          handler(cloneWorkerRunEvent(event), { emitSequence: seq })
        } catch {
          // silently drop handler errors so other subscribers still receive the event
        }
      }
    }

    // ---- auto-unsubscribe on terminal ----
    if (state.terminal) {
      this.#subscribers.delete(jobId)
    }
  }

  #trimJournal(state: JobState): void {
    if (state.journal.length <= this.#journalMax) return
    // Prefer keeping started (first) + terminal (last) + most recent deltas.
    const overflow = state.journal.length - this.#journalMax
    if (overflow <= 0) return
    // Drop oldest non-critical entries from the middle/start after index 0 if started exists
    const keepStarted = state.journal[0]?.event.type === 'started'
    const startIdx = keepStarted ? 1 : 0
    const dropCount = Math.min(overflow, state.journal.length - startIdx - (state.terminal ? 1 : 0))
    if (dropCount > 0) {
      state.journal.splice(startIdx, dropCount)
    }
  }

  /** Remove all subscribers and state for a job (cleanup). */
  clearJob(jobId: string): void {
    this.#subscribers.delete(jobId)
    const state = this.#jobStates.get(jobId)
    if (state?.cleanupTimer) clearTimeout(state.cleanupTimer)
    this.#jobStates.delete(jobId)
  }
}

// ---------------------------------------------------------------------------
// Singleton accessor
// ---------------------------------------------------------------------------

let _singleton: WorkerEventEmitter | null = null

export function getWorkerEventEmitter(): WorkerEventEmitter {
  if (!_singleton) _singleton = new WorkerEventEmitter()
  return _singleton
}

// ---- convenience re-export for clarity ----
export { _singleton }

export function __setSingletonForTest(v: WorkerEventEmitter | null): void {
  _singleton = v
}

// ---------------------------------------------------------------------------
// emitWorkerEvent helper
// ---------------------------------------------------------------------------

export function emitWorkerEvent(jobId: string, event: WorkerRunEvent): void {
  getWorkerEventEmitter().emit(event)
}

// ---------------------------------------------------------------------------
// EventCollector – collects events for a job; used by wait=true tool path
// ---------------------------------------------------------------------------

export class EventCollector {
  private emitter: WorkerEventEmitter
  private jobId: string
  private events: WorkerRunEvent[] = []
  private _completePromise: Promise<WorkerRunEvent[]> | null = null
  private _resolveComplete: ((events: WorkerRunEvent[]) => void) | null = null
  private _rejectComplete: ((err: Error) => void) | null = null
  private _timeout: ReturnType<typeof setTimeout> | null = null
  private _unsub: (() => void) | null = null
  private _settled = false

  constructor(jobId: string, emitter?: WorkerEventEmitter) {
    this.jobId = jobId
    this.emitter = emitter ?? getWorkerEventEmitter()
  }

  /** Start collecting events for the job (includes journal replay). */
  start(): void {
    if (this._unsub) return // already started

    this._unsub = this.emitter.subscribe(this.jobId, (event) => {
      if (this._settled) return
      this.events.push(event)
      if (isTerminalWorkerEvent(event)) {
        this._settled = true
        if (this._timeout) clearTimeout(this._timeout)
        this._unsub?.()
        this._resolveComplete?.(this.events)
      }
    })
  }

  /**
   * Returns a promise that resolves with all collected events
   * when the terminal event arrives (or on timeout).
   * If the job already terminated before start(), resolves via journal replay.
   */
  waitForCompletion(timeoutMs?: number): Promise<WorkerRunEvent[]> {
    if (!this._completePromise) {
      this._completePromise = new Promise<WorkerRunEvent[]>((resolve, reject) => {
        this._resolveComplete = resolve
        this._rejectComplete = reject

        if (timeoutMs && timeoutMs > 0) {
          this._timeout = setTimeout(() => {
            if (this._settled) return
            this._settled = true
            this._unsub?.()
            reject(new Error(`EventCollector timed out after ${timeoutMs}ms for job ${this.jobId}`))
          }, timeoutMs)
        }
      })
      this.start()
      // If replay already delivered terminal synchronously, resolve now.
      if (this._settled) {
        // already resolved in subscribe handler
      } else if (this.events.some(isTerminalWorkerEvent)) {
        this._settled = true
        if (this._timeout) clearTimeout(this._timeout)
        this._unsub?.()
        this._resolveComplete?.(this.events)
      }
    }
    return this._completePromise
  }

  /** Get events collected so far (non-destructive). */
  getEvents(): WorkerRunEvent[] {
    return [...this.events]
  }

  /** Manually stop collecting (no terminal event). */
  stop(): void {
    if (this._settled) return
    this._settled = true
    if (this._timeout) clearTimeout(this._timeout)
    this._unsub?.()
  }
}
