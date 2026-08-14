import type { ServerResponse } from 'node:http'
import type { ChatRunTerminal } from '@pihuo-agent/shared'

/**
 * Buffered SSE fan-out for one already-admitted chat run.
 *
 * Admission and ownership live in chat-run-coordinator.ts. This module is
 * deliberately ignorant of thread ids: its key is the immutable clientRunId.
 * In particular, registering a second live stream under a key is an error;
 * it must never abort and replace a different run.
 */

export interface ChatRunHub {
  /** Historical name retained for callers/tests; value is the clientRunId. */
  readonly chatId: string
  readonly done: boolean
  readonly bufferedLines: number
}

export type ChatRunHubDone = {
  terminal: ChatRunTerminal
  error?: unknown
}

interface HubState {
  chatId: string
  lines: string[]
  done: boolean
  subscribers: Set<ServerResponse>
  abortController: AbortController
  evictTimer: ReturnType<typeof setTimeout> | null
  onChunk?: (chunk: unknown) => void
  onDone?: (result: ChatRunHubDone) => void
}

const hubs = new Map<string, HubState>()

const DEFAULT_GRACE_PERIOD_MS = 120_000
const DONE_LINE = 'data: [DONE]\n\n'

/** SSE response headers for the PiHuo leader event stream. */
export const CHAT_RUN_SSE_HEADERS: Record<string, string> = {
  'content-type': 'text/event-stream',
  'cache-control': 'no-cache',
  connection: 'keep-alive',
  'x-accel-buffering': 'no',
}

function safeWrite(res: ServerResponse, line: string): void {
  try {
    res.write(line)
  } catch {
    // Socket died between close event and write — close listener detaches it.
  }
}

function finalize(state: HubState, gracePeriodMs: number, result: ChatRunHubDone): void {
  if (state.done) return
  state.done = true
  state.lines.push(DONE_LINE)
  for (const res of state.subscribers) {
    safeWrite(res, DONE_LINE)
    try {
      res.end()
    } catch {
      // already closed
    }
  }
  state.subscribers.clear()
  state.evictTimer = setTimeout(() => {
    if (hubs.get(state.chatId) === state) hubs.delete(state.chatId)
  }, gracePeriodMs)
  state.evictTimer.unref?.()
  try {
    state.onDone?.(result)
  } catch (err) {
    // Lifecycle accounting must never turn a completed stream into an
    // unhandled exception. The coordinator owns error reporting.
    console.error('[chat-run-hub] onDone callback failed', err)
  }
}

async function drain(
  state: HubState,
  stream: ReadableStream<unknown>,
  gracePeriodMs: number,
): Promise<void> {
  const reader = stream.getReader()
  let terminal: ChatRunTerminal = 'completed'
  let failure: unknown
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      try {
        state.onChunk?.(value)
      } catch (err) {
        // A phase observer is advisory. Keep draining the leader stream even
        // if it has a bug, rather than leaving a reserved run hung forever.
        console.error('[chat-run-hub] onChunk callback failed', err)
      }
      const line = `data: ${JSON.stringify(value)}\n\n`
      state.lines.push(line)
      for (const res of state.subscribers) safeWrite(res, line)
    }
  } catch (err) {
    failure = err
    terminal = state.abortController.signal.aborted ? 'aborted' : 'failed'
    if (!state.abortController.signal.aborted) {
      const errorText = err instanceof Error ? err.message : String(err)
      const line = `data: ${JSON.stringify({ type: 'error', errorText })}\n\n`
      state.lines.push(line)
      for (const res of state.subscribers) safeWrite(res, line)
    }
  } finally {
    reader.releaseLock()
    if (state.abortController.signal.aborted) terminal = 'aborted'
    finalize(state, gracePeriodMs, {
      terminal,
      ...(failure === undefined ? {} : { error: failure }),
    })
  }
}

export function registerChatRun(
  clientRunId: string,
  stream: ReadableStream<unknown>,
  abortController: AbortController,
  opts?: {
    gracePeriodMs?: number
    onChunk?: (chunk: unknown) => void
    onDone?: (result: ChatRunHubDone) => void
  },
): ChatRunHub {
  const gracePeriodMs = opts?.gracePeriodMs ?? DEFAULT_GRACE_PERIOD_MS
  const previous = hubs.get(clientRunId)
  if (previous && !previous.done) {
    throw new Error(`CHAT_RUN_HUB_ALREADY_REGISTERED:${clientRunId}`)
  }
  if (previous?.evictTimer) clearTimeout(previous.evictTimer)
  const state: HubState = {
    chatId: clientRunId,
    lines: [],
    done: false,
    subscribers: new Set(),
    abortController,
    evictTimer: null,
    onChunk: opts?.onChunk,
    onDone: opts?.onDone,
  }
  hubs.set(clientRunId, state)
  void drain(state, stream, gracePeriodMs)
  return makeHub(state)
}

function makeHub(state: HubState): ChatRunHub {
  return {
    chatId: state.chatId,
    get done() {
      return state.done
    },
    get bufferedLines() {
      return state.lines.length
    },
  }
}

export function getChatRun(clientRunId: string): ChatRunHub | undefined {
  const state = hubs.get(clientRunId)
  return state ? makeHub(state) : undefined
}

/**
 * Attach an HTTP response to a token-specific run. Client disconnects detach
 * only this subscriber and never cancel the source stream.
 */
export function attachChatRunSubscriber(
  hub: ChatRunHub,
  res: ServerResponse,
  extraHeaders?: Record<string, string>,
): void {
  const state = hubs.get(hub.chatId)
  if (!state) {
    res.writeHead(204, extraHeaders)
    res.end()
    return
  }
  res.writeHead(200, { ...CHAT_RUN_SSE_HEADERS, ...extraHeaders })
  for (const line of state.lines) safeWrite(res, line)
  if (state.done) {
    try {
      res.end()
    } catch {
      // already closed
    }
    return
  }
  state.subscribers.add(res)
  res.on('close', () => {
    state.subscribers.delete(res)
  })
}

export function _resetChatRunHubsForTest(): void {
  for (const state of hubs.values()) {
    if (state.evictTimer) clearTimeout(state.evictTimer)
    if (!state.done) state.abortController.abort()
  }
  hubs.clear()
}
