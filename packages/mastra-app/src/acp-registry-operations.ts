import { randomBytes } from 'node:crypto'

export type RegistryOperationKind = 'prepare' | 'authenticate'
export type RegistryOperationStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export interface RegistryOperationEvent {
  sequence: number
  at: string
  status: RegistryOperationStatus
  stage: string
  progress?: number
  code?: string
}

export interface RegistryOperationSnapshot<T = unknown> {
  operationId: string
  kind: RegistryOperationKind
  status: RegistryOperationStatus
  createdAt: string
  updatedAt: string
  events: RegistryOperationEvent[]
  result?: T
  code?: string
  error?: string
}

export type RegistryOperationReporter = (event: { stage: string; progress?: number }) => void

interface OperationRecord {
  snapshot: RegistryOperationSnapshot
  controller: AbortController
  nextSequence: number
  completedAt?: number
}

function isTerminal(status: RegistryOperationStatus): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled'
}

function operationId(): string {
  // The public route validator requires an alphanumeric first character.
  // Prefixing also makes operation ids distinguishable from other opaque ids.
  return `op_${randomBytes(24).toString('base64url')}`
}

function cloneSnapshot<T>(snapshot: RegistryOperationSnapshot<T>): RegistryOperationSnapshot<T> {
  return structuredClone(snapshot)
}

export class RegistryOperationManager {
  private readonly operations = new Map<string, OperationRecord>()
  private readonly now: () => number
  private readonly maxOperations: number
  private readonly maxEvents: number
  private readonly terminalTtlMs: number

  constructor(
    options: {
      now?: () => number
      maxOperations?: number
      maxEvents?: number
      terminalTtlMs?: number
    } = {},
  ) {
    this.now = options.now ?? Date.now
    this.maxOperations = Math.max(1, options.maxOperations ?? 32)
    this.maxEvents = Math.max(2, options.maxEvents ?? 64)
    this.terminalTtlMs = Math.max(1, options.terminalTtlMs ?? 15 * 60_000)
  }

  start<T>(input: {
    kind: RegistryOperationKind
    run: (signal: AbortSignal, report: RegistryOperationReporter) => Promise<T>
    mapError: (error: unknown) => { code: string; error: string }
  }): RegistryOperationSnapshot<T> {
    this.prune()
    this.makeCapacity()

    const id = operationId()
    const timestamp = this.timestamp()
    const record: OperationRecord = {
      controller: new AbortController(),
      nextSequence: 1,
      snapshot: {
        operationId: id,
        kind: input.kind,
        status: 'queued',
        createdAt: timestamp,
        updatedAt: timestamp,
        events: [],
      },
    }
    this.operations.set(id, record)
    this.appendEvent(record, { status: 'queued', stage: 'queued' })

    queueMicrotask(() => {
      void this.run(record, input)
    })
    return cloneSnapshot(record.snapshot as RegistryOperationSnapshot<T>)
  }

  get<T = unknown>(id: string): RegistryOperationSnapshot<T> | undefined {
    this.prune()
    const record = this.operations.get(id)
    return record ? cloneSnapshot(record.snapshot as RegistryOperationSnapshot<T>) : undefined
  }

  cancel(id: string): RegistryOperationSnapshot {
    this.prune()
    const record = this.operations.get(id)
    if (!record) throw new Error('Registry operation not found')
    if (!isTerminal(record.snapshot.status)) {
      record.controller.abort(new Error('Registry operation cancelled'))
      record.snapshot.status = 'cancelled'
      delete record.snapshot.result
      delete record.snapshot.code
      delete record.snapshot.error
      record.completedAt = this.now()
      this.appendEvent(record, { status: 'cancelled', stage: 'cancelled' })
    }
    return cloneSnapshot(record.snapshot)
  }

  prune(): void {
    const cutoff = this.now() - this.terminalTtlMs
    for (const [id, record] of this.operations) {
      if (record.completedAt !== undefined && record.completedAt < cutoff) {
        this.operations.delete(id)
      }
    }
  }

  private makeCapacity(): void {
    while (this.operations.size >= this.maxOperations) {
      const candidate = [...this.operations.entries()]
        .filter(([, record]) => isTerminal(record.snapshot.status))
        .sort(
          ([, left], [, right]) =>
            (left.completedAt ?? Number.MAX_SAFE_INTEGER) -
            (right.completedAt ?? Number.MAX_SAFE_INTEGER),
        )[0]
      if (!candidate) {
        throw new Error('Registry operation capacity reached')
      }
      this.operations.delete(candidate[0])
    }
  }

  private async run<T>(
    record: OperationRecord,
    input: {
      kind: RegistryOperationKind
      run: (signal: AbortSignal, report: RegistryOperationReporter) => Promise<T>
      mapError: (error: unknown) => { code: string; error: string }
    },
  ): Promise<void> {
    if (record.snapshot.status !== 'queued') return
    record.snapshot.status = 'running'
    this.appendEvent(record, { status: 'running', stage: 'running' })

    try {
      const result = await input.run(record.controller.signal, (event) => {
        if (record.snapshot.status !== 'running') return
        const stage = /^[a-z][a-z0-9_]{0,63}$/u.test(event.stage) ? event.stage : 'working'
        const progress =
          event.progress === undefined ? undefined : Math.max(0, Math.min(1, event.progress))
        this.appendEvent(record, { status: 'running', stage, progress })
      })
      if (record.snapshot.status !== 'running' || record.controller.signal.aborted) return
      record.snapshot.status = 'succeeded'
      record.snapshot.result = structuredClone(result)
      record.completedAt = this.now()
      this.appendEvent(record, { status: 'succeeded', stage: 'succeeded' })
    } catch (error) {
      if (record.snapshot.status !== 'running' || record.controller.signal.aborted) return
      const publicError = input.mapError(error)
      record.snapshot.status = 'failed'
      record.snapshot.code = publicError.code.slice(0, 128)
      record.snapshot.error = publicError.error.slice(0, 512)
      record.completedAt = this.now()
      this.appendEvent(record, {
        status: 'failed',
        stage: 'failed',
        code: record.snapshot.code,
      })
    }
  }

  private appendEvent(
    record: OperationRecord,
    event: Omit<RegistryOperationEvent, 'sequence' | 'at'>,
  ): void {
    const at = this.timestamp()
    record.snapshot.updatedAt = at
    record.snapshot.events.push({
      ...event,
      sequence: record.nextSequence++,
      at,
    })
    if (record.snapshot.events.length > this.maxEvents) {
      record.snapshot.events.splice(0, record.snapshot.events.length - this.maxEvents)
    }
  }

  private timestamp(): string {
    return new Date(this.now()).toISOString()
  }
}

export const registryOperationManager = new RegistryOperationManager()
