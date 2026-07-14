/**
 * WorkerRunEvent emission system for Scheduler → tool bridge → Chat UI.
 *
 * Event order is enforced: started → delta* → terminal (completed|failed|cancelled).
 * Each jobId gets exactly one terminal event, after which all subscribers are unsubscribed.
 */
import type { WorkerKind, WorkerRole, WorkerRunEvent } from '@router-agents/shared'

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
  if (event.type === 'started' || event.type === 'delta') return event
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

// ---------------------------------------------------------------------------
// Job state tracking (event ordering)
// ---------------------------------------------------------------------------

type JobState = {
  started: boolean
  terminal: boolean
  cleanupTimer?: ReturnType<typeof setTimeout>
}

// ---------------------------------------------------------------------------
// WorkerEventEmitter (singleton)
// ---------------------------------------------------------------------------

type EventHandler = (event: WorkerRunEvent) => void

export class WorkerEventEmitter {
  #subscribers = new Map<string, Set<EventHandler>>()
  #jobStates = new Map<string, JobState>()
  #terminalTtlMs: number

  constructor(options: { terminalTtlMs?: number } = {}) {
    this.#terminalTtlMs = options.terminalTtlMs ?? 60_000
  }

  /**
   * Subscribe to all events for a given jobId.
   * Returns an unsubscribe function.
   * If the job has already terminated, the handler is NOT registered
   * and an empty no-op is returned.
   */
  subscribe(jobId: string, handler: EventHandler): () => void {
    const state = this.#jobStates.get(jobId)
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

  /** Publish an event to all subscribers for its jobId. */
  emit(event: WorkerRunEvent): void {
    const jobId = event.jobId
    let state = this.#jobStates.get(jobId)
    if (!state) {
      state = { started: false, terminal: false }
      this.#jobStates.set(jobId, state)
    }

    // ---- order enforcement ----
    if (event.type === 'started') {
      if (state.started) return // duplicate started
      state.started = true
    } else {
      // Allow terminal-only events (preflight failure, queued cancel, timed_out)
      if (!state.started) {
        const isTerminalOnly = (event.type === 'failed' || event.type === 'cancelled' || event.type === 'timed_out') && !state.started
        if (!isTerminalOnly) return
      }
      if (state.terminal) return // already terminated

      if (event.type === 'delta') {
        ;(event as WorkerRunEvent & { delta: string }).delta = sanitiseDelta(
          (event as WorkerRunEvent & { delta: string }).delta,
        )
      } else {
        // terminal event
        state.terminal = true
        const ev = event as any
        if (typeof ev.output === 'string') {
          ev.output = sanitiseDelta(ev.output)
        }
      }
    }

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
    if (!handlers || handlers.size === 0) return

    // Snapshot to avoid issues if a handler unsubscribes during iteration
    const snapshot = [...handlers]
    for (const handler of snapshot) {
      try {
        handler(event)
      } catch {
        // silently drop handler errors so other subscribers still receive the event
      }
    }

    // ---- auto-unsubscribe on terminal ----
    if (state.terminal) {
      this.#subscribers.delete(jobId)
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

  /** Start collecting events for the job. */
  start(): void {
    if (this._unsub) return // already started

    this._unsub = this.emitter.subscribe(this.jobId, (event) => {
      if (this._settled) return
      this.events.push(event)
      if (
        event.type === 'completed' ||
        event.type === 'failed' ||
        event.type === 'cancelled' ||
        event.type === 'timed_out'
      ) {
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
