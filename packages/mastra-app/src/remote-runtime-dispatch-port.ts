import type { WorkerJob, WorkerRunEvent } from '@swarmdesk-agent/shared'
import { isTerminalWorkerEvent } from '@swarmdesk-agent/shared'
import type {
  ResolveApprovalPortInput,
  RouterSessionContext,
  RuntimeDispatchPort,
  TrustedDispatchInput,
} from './runtime-dispatch-port.js'
import {
  readRuntimeDiscovery,
  defaultRuntimeDiscoveryPath,
  RuntimeDiscoveryError,
} from './runtime-discovery.js'
import { raceWithTimeout, resolveWorkerJobTimeoutMs } from './worker-events.js'

export interface RemoteRuntimeDispatchDeps {
  baseUrl?: string
  token?: string
  discoveryPath?: string
  fetchImpl?: typeof fetch
}

interface RuntimeEndpoint {
  baseUrl: string
  token: string
  ownerEpoch?: string
}

function publicRuntimeError(code: string, message: string): Error {
  const err = new RuntimeDiscoveryError(code, message)
  return err
}

function sanitizeError(err: unknown): Error {
  const raw = err instanceof Error ? err.message : String(err)
  // Never surface bearer tokens or Authorization headers.
  const scrubbed = raw
    .replace(/Bearer\s+[A-Za-z0-9._\-+=/]+/gi, 'Bearer [redacted]')
    .replace(/token[=:]\s*[A-Za-z0-9._\-+=/]+/gi, 'token=[redacted]')
  if (/ECONNREFUSED|ENOTFOUND|fetch failed|connect failed|network/i.test(scrubbed)) {
    return publicRuntimeError(
      'SWARMDESK_AGENT_RUNTIME_UNAVAILABLE',
      'SWARMDESK_AGENT_RUNTIME_UNAVAILABLE: main runtime is unreachable',
    )
  }
  if (/401|403|auth/i.test(scrubbed)) {
    return publicRuntimeError(
      'RUNTIME_AUTH_FAILED',
      'RUNTIME_AUTH_FAILED: internal runtime auth failed',
    )
  }
  return publicRuntimeError(
    'SWARMDESK_AGENT_RUNTIME_UNAVAILABLE',
    'SWARMDESK_AGENT_RUNTIME_UNAVAILABLE: main runtime request failed',
  )
}

function resolveEndpoint(deps: RemoteRuntimeDispatchDeps): RuntimeEndpoint {
  if (deps.baseUrl && deps.token) {
    return { baseUrl: deps.baseUrl.replace(/\/$/, ''), token: deps.token }
  }
  const discovery = readRuntimeDiscovery(deps.discoveryPath ?? defaultRuntimeDiscoveryPath())
  if (!discovery) {
    throw publicRuntimeError(
      'SWARMDESK_AGENT_RUNTIME_UNAVAILABLE',
      'SWARMDESK_AGENT_RUNTIME_UNAVAILABLE: runtime discovery not found',
    )
  }
  return {
    baseUrl: deps.baseUrl?.replace(/\/$/, '') ?? `http://127.0.0.1:${discovery.port}`,
    token: deps.token ?? discovery.token,
    ownerEpoch: discovery.ownerEpoch ?? `${discovery.pid}:${discovery.startedAt}`,
  }
}

function interruptedEventStream(jobId: string, status?: string): RuntimeDiscoveryError {
  const suffix = status ? ` (durable status: ${status})` : ''
  return publicRuntimeError(
    'RUNTIME_EVENT_STREAM_INTERRUPTED',
    `RUNTIME_EVENT_STREAM_INTERRUPTED: lost terminal event stream for job ${jobId}${suffix}`,
  ) as RuntimeDiscoveryError
}

function isInterruptedEventStream(error: unknown): error is RuntimeDiscoveryError {
  return error instanceof RuntimeDiscoveryError && error.code === 'RUNTIME_EVENT_STREAM_INTERRUPTED'
}

function jobToTerminalEvent(job: WorkerJob, jobId: string): WorkerRunEvent | null {
  if (
    job.status !== 'succeeded' &&
    job.status !== 'failed' &&
    job.status !== 'cancelled' &&
    job.status !== 'timed_out'
  ) {
    return null
  }
  if (job.status === 'succeeded') {
    return {
      type: 'completed',
      jobId,
      output: job.output ?? '',
      truncated: false,
      workerName: job.workerName,
      role: job.role,
    }
  }
  return {
    type:
      job.status === 'cancelled'
        ? 'cancelled'
        : job.status === 'timed_out'
          ? 'timed_out'
          : 'failed',
    jobId,
    output: job.output,
    error: job.error ?? job.message,
    errorCode: job.errorCode,
    truncated: false,
    workerName: job.workerName,
    role: job.role,
  }
}

export function createRemoteRuntimeDispatchPort(
  deps: RemoteRuntimeDispatchDeps = {},
): RuntimeDispatchPort {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch.bind(globalThis)

  async function requestJson<T>(
    method: string,
    path: string,
    body?: unknown,
    options?: { timeoutMs?: number },
  ): Promise<T> {
    let endpoint: RuntimeEndpoint
    try {
      endpoint = resolveEndpoint(deps)
    } catch (e) {
      throw e instanceof RuntimeDiscoveryError ? e : sanitizeError(e)
    }
    const abort = new AbortController()
    const timeoutMs = Math.max(1, Math.floor(options?.timeoutMs ?? 15_000))
    try {
      return await raceWithTimeout(
        (async () => {
          const res = await fetchImpl(`${endpoint.baseUrl}${path}`, {
            method,
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${endpoint.token}`,
            },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: abort.signal,
          })
          if (res.status === 401 || res.status === 403) {
            throw publicRuntimeError(
              'RUNTIME_AUTH_FAILED',
              'RUNTIME_AUTH_FAILED: internal runtime auth failed',
            )
          }
          if (!res.ok) {
            throw publicRuntimeError(
              'SWARMDESK_AGENT_RUNTIME_UNAVAILABLE',
              'SWARMDESK_AGENT_RUNTIME_UNAVAILABLE: main runtime request failed',
            )
          }
          return (await res.json()) as T
        })(),
        timeoutMs,
        () => {
          abort.abort()
          return publicRuntimeError(
            'SWARMDESK_AGENT_RUNTIME_UNAVAILABLE',
            'SWARMDESK_AGENT_RUNTIME_UNAVAILABLE: main runtime request timed out',
          )
        },
      )
    } catch (e) {
      if (e instanceof RuntimeDiscoveryError) throw e
      throw sanitizeError(e)
    } finally {
      abort.abort()
    }
  }

  async function reconcileAfterEventDeadline(jobId: string): Promise<WorkerRunEvent> {
    let status: string | undefined
    try {
      const data = await requestJson<{ job: WorkerJob | null }>(
        'GET',
        `/internal/runtime/jobs/${encodeURIComponent(jobId)}`,
        undefined,
        { timeoutMs: 2_000 },
      )
      const terminal = data.job ? jobToTerminalEvent(data.job, jobId) : null
      if (terminal) return terminal
      status = data.job?.status ?? 'missing'
    } catch (error) {
      if (error instanceof RuntimeDiscoveryError && error.code === 'RUNTIME_AUTH_FAILED')
        throw error
      status = 'unknown'
    }
    throw interruptedEventStream(jobId, status)
  }

  return {
    async resolveSessionContext(memoryThreadId: string): Promise<RouterSessionContext | null> {
      const q = encodeURIComponent(memoryThreadId)
      const data = await requestJson<{ context: RouterSessionContext | null }>(
        'GET',
        `/internal/runtime/session-by-thread?memoryThreadId=${q}`,
      )
      return data.context ?? null
    },

    async dispatch(input: TrustedDispatchInput): Promise<WorkerJob> {
      const data = await requestJson<{ job: WorkerJob }>('POST', '/internal/runtime/dispatch', {
        context: input.context,
        workerId: input.workerId,
        workerIdOrKind: input.workerIdOrKind,
        role: input.role,
        task: input.task,
        cwd: input.cwd,
        source: input.source,
        wait: false,
      })
      return data.job
    },

    async *events(
      jobId: string,
      signal?: AbortSignal,
      options?: { afterSequence?: number },
    ): AsyncIterable<WorkerRunEvent> {
      // Retain last cursor across reconnect attempts (network/401/owner switch).
      // ownerEpoch changes ⇒ reset sequence so we do not skip events from a new owner.
      let cursor =
        options?.afterSequence != null && Number.isFinite(options.afterSequence)
          ? options.afterSequence
          : 0
      let ownerEpoch: string | null = null
      const deadlineMs = resolveWorkerJobTimeoutMs()
      const startedAt = Date.now()
      const deadlineAt = startedAt + deadlineMs
      let authFailures = 0
      for (let attempt = 0; ; attempt++) {
        if (signal?.aborted) return
        if (Date.now() >= deadlineAt) {
          yield await reconcileAfterEventDeadline(jobId)
          return
        }
        let endpoint: RuntimeEndpoint
        try {
          endpoint = resolveEndpoint(deps)
        } catch (e) {
          throw e instanceof RuntimeDiscoveryError ? e : sanitizeError(e)
        }
        // Discovery identity is known before the request, so reset the high-water
        // cursor before asking a replacement owner for its journal.
        if (endpoint.ownerEpoch) {
          if (ownerEpoch && ownerEpoch !== endpoint.ownerEpoch) cursor = 0
          ownerEpoch = endpoint.ownerEpoch
        }
        const qs = `?afterSequence=${encodeURIComponent(String(cursor))}`
        let res: Response
        const streamAbort = new AbortController()
        const streamSignal = signal
          ? AbortSignal.any([signal, streamAbort.signal])
          : streamAbort.signal
        try {
          res = await raceWithTimeout(
            fetchImpl(
              `${endpoint.baseUrl}/internal/runtime/events/${encodeURIComponent(jobId)}${qs}`,
              {
                method: 'GET',
                headers: {
                  Accept: 'application/x-ndjson',
                  Authorization: `Bearer ${endpoint.token}`,
                  ...(cursor > 0 ? { 'Last-Event-ID': String(cursor) } : {}),
                },
                signal: streamSignal,
              },
            ),
            Math.max(1, deadlineAt - Date.now()),
            () => {
              streamAbort.abort()
              return interruptedEventStream(jobId)
            },
          )
        } catch (e) {
          streamAbort.abort()
          if (signal?.aborted) return
          if (isInterruptedEventStream(e)) {
            yield await reconcileAfterEventDeadline(jobId)
            return
          }
          await new Promise((r) => setTimeout(r, Math.min(2000, 100 * 2 ** attempt)))
          continue
        }
        if (res.status === 401 || res.status === 403) {
          streamAbort.abort()
          authFailures += 1
          if (authFailures >= 3) {
            throw publicRuntimeError(
              'RUNTIME_AUTH_FAILED',
              'RUNTIME_AUTH_FAILED: internal runtime auth failed',
            )
          }
          await new Promise((r) => setTimeout(r, Math.min(2000, 100 * 2 ** attempt)))
          continue
        }
        authFailures = 0
        if (res.status === 404) {
          streamAbort.abort()
          // Owner switch / unknown stream: reconcile durable state before retrying.
          try {
            const data = await requestJson<{ job: WorkerJob | null }>(
              'GET',
              `/internal/runtime/jobs/${encodeURIComponent(jobId)}`,
            )
            const terminal = data.job ? jobToTerminalEvent(data.job, jobId) : null
            if (terminal) {
              yield terminal
              return
            }
            if (!data.job) throw interruptedEventStream(jobId, 'missing')
          } catch (e) {
            if (e instanceof RuntimeDiscoveryError) throw e
            throw interruptedEventStream(jobId, 'unknown')
          }
          cursor = 0
          await new Promise((r) => setTimeout(r, Math.min(2000, 100 * 2 ** attempt)))
          continue
        }
        if (!res.ok || !res.body) {
          streamAbort.abort()
          await new Promise((r) => setTimeout(r, Math.min(2000, 100 * 2 ** attempt)))
          continue
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let sawTerminal = false
        let ownerChangedInStream = false
        try {
          while (true) {
            let read: Awaited<ReturnType<typeof reader.read>>
            try {
              read = await raceWithTimeout(
                reader.read(),
                Math.max(1, deadlineAt - Date.now()),
                () => {
                  streamAbort.abort()
                  return interruptedEventStream(jobId)
                },
              )
            } catch (error) {
              if (signal?.aborted) return
              if (isInterruptedEventStream(error)) {
                void reader.cancel().catch(() => {})
                yield await reconcileAfterEventDeadline(jobId)
                return
              }
              throw error
            }
            const { done, value } = read
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            let nl: number
            while ((nl = buffer.indexOf('\n')) >= 0) {
              const line = buffer.slice(0, nl).trim()
              buffer = buffer.slice(nl + 1)
              if (!line) continue
              let event: WorkerRunEvent | null = null
              try {
                const parsed = JSON.parse(line) as
                  | WorkerRunEvent
                  | {
                      emitSequence?: number
                      event?: WorkerRunEvent
                      gap?: boolean
                      retainedFrom?: number
                      retainedTo?: number
                      ownerEpoch?: string
                    }
                if (parsed && typeof parsed === 'object' && 'ownerEpoch' in parsed) {
                  const epoch = (parsed as { ownerEpoch?: string }).ownerEpoch
                  if (typeof epoch === 'string' && epoch) {
                    if (ownerEpoch && ownerEpoch !== epoch) {
                      // New owner process — sequences restart; do not skip with old cursor
                      cursor = 0
                      ownerChangedInStream = true
                    }
                    ownerEpoch = epoch
                  }
                }
                if (ownerChangedInStream) {
                  void reader.cancel().catch(() => {})
                  break
                }
                // Gap: journal truncated — advance cursor to retained range and continue
                if (
                  parsed &&
                  typeof parsed === 'object' &&
                  'gap' in parsed &&
                  (parsed as { gap?: boolean }).gap === true
                ) {
                  const retainedFrom = (parsed as { retainedFrom?: number }).retainedFrom
                  if (typeof retainedFrom === 'number' && Number.isFinite(retainedFrom)) {
                    // Next event expected at retainedFrom; set cursor so we accept from there
                    cursor = Math.max(cursor, retainedFrom - 1)
                  }
                  // Do not yield a fake event — consumer reconciles via getJob if needed
                  continue
                }
                // Support envelope { emitSequence, event } and legacy bare event
                if (
                  parsed &&
                  typeof parsed === 'object' &&
                  'event' in parsed &&
                  parsed.event &&
                  typeof parsed.event === 'object' &&
                  'type' in parsed.event
                ) {
                  event = parsed.event
                  if (
                    typeof parsed.emitSequence === 'number' &&
                    Number.isFinite(parsed.emitSequence)
                  ) {
                    cursor = parsed.emitSequence
                  }
                } else if (parsed && typeof parsed === 'object' && 'type' in parsed) {
                  event = parsed as WorkerRunEvent
                }
              } catch {
                continue
              }
              if (!event) continue
              yield event
              if (isTerminalWorkerEvent(event)) {
                sawTerminal = true
                return
              }
            }
            if (ownerChangedInStream) break
          }
        } finally {
          streamAbort.abort()
          try {
            reader.releaseLock()
          } catch {
            /* ok */
          }
        }
        if (sawTerminal) return
        if (ownerChangedInStream) continue
        // Stream ended without terminal — reconcile durable job, then backoff reconnect
        try {
          const data = await requestJson<{ job: WorkerJob | null }>(
            'GET',
            `/internal/runtime/jobs/${encodeURIComponent(jobId)}`,
          )
          const terminal = data.job ? jobToTerminalEvent(data.job, jobId) : null
          if (terminal) {
            yield terminal
            return
          }
          // Job still open: if owner epoch reset, try from 0 once
          if (data.job && cursor > 0 && attempt >= 2 && attempt % 3 === 0) {
            cursor = 0
          }
        } catch (error) {
          // A rotated/invalid capability is not a transient stream failure. Do
          // not hide it behind reconnect retries until the overall job deadline.
          if (error instanceof RuntimeDiscoveryError && error.code === 'RUNTIME_AUTH_FAILED') {
            throw error
          }
          /* transient runtime unavailability: retry stream */
        }
        await new Promise((r) => setTimeout(r, Math.min(2000, 100 * 2 ** attempt)))
      }
    },

    async cancel(jobId: string): Promise<void> {
      await requestJson('POST', '/internal/runtime/cancel', { jobId })
    },

    async getJob(jobId: string): Promise<WorkerJob | null> {
      const data = await requestJson<{ job: WorkerJob | null }>(
        'GET',
        `/internal/runtime/jobs/${encodeURIComponent(jobId)}`,
      )
      return data.job ?? null
    },

    async listJobs(filter?: { sessionId?: string; limit?: number }): Promise<WorkerJob[]> {
      const params = new URLSearchParams()
      if (filter?.sessionId) params.set('sessionId', filter.sessionId)
      if (filter?.limit != null) params.set('limit', String(filter.limit))
      const qs = params.toString()
      const data = await requestJson<{ jobs: WorkerJob[] }>(
        'GET',
        `/internal/runtime/jobs${qs ? `?${qs}` : ''}`,
      )
      return data.jobs ?? []
    },

    async resolveApproval(input: ResolveApprovalPortInput): Promise<void> {
      await requestJson('POST', '/internal/runtime/approvals/resolve', {
        approvalId: input.approvalId,
        optionId: input.optionId,
        decision: input.decision,
        surface: input.surface ?? 'panel',
      })
    },
  }
}
