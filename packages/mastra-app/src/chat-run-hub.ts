import type { ServerResponse } from 'node:http'

/**
 * In-memory per-thread chat run hub.
 *
 * Decouples the Mastra UI-message stream from any single HTTP connection:
 * the hub drains the agent stream unconditionally (so a run always completes
 * even if every client disconnects), buffers SSE-encoded chunks, and fans out
 * to any number of attached subscribers. A reloaded frontend re-attaches via
 * GET /chat/:agentId/:chatId/stream and receives a full replay followed by
 * live chunks — this is the server half of the AI SDK `resumeStream()` flow.
 *
 * Hub lifetime: created when a run starts, kept for a short grace period after
 * the stream ends (so a client that disconnected right before the finish can
 * still replay the tail), then evicted. Single-process desktop server only —
 * nothing here survives an API restart (neither does the in-process run).
 */

export interface ChatRunHub {
  readonly chatId: string
  /** True once the source stream ended (normally, errored, or aborted). */
  readonly done: boolean
  /** Number of buffered SSE lines (including the trailing [DONE] when done). */
  readonly bufferedLines: number
  abort(): void
}

interface HubState {
  chatId: string
  lines: string[]
  done: boolean
  subscribers: Set<ServerResponse>
  abortController: AbortController
  evictTimer: ReturnType<typeof setTimeout> | null
}

const hubs = new Map<string, HubState>()

const DEFAULT_GRACE_PERIOD_MS = 120_000
const DONE_LINE = 'data: [DONE]\n\n'

/** SSE response headers — mirror the AI SDK UI_MESSAGE_STREAM_HEADERS contract. */
export const CHAT_RUN_SSE_HEADERS: Record<string, string> = {
  'content-type': 'text/event-stream',
  'cache-control': 'no-cache',
  connection: 'keep-alive',
  'x-vercel-ai-ui-message-stream': 'v1',
  'x-accel-buffering': 'no',
}

function safeWrite(res: ServerResponse, line: string): void {
  try {
    res.write(line)
  } catch {
    // Socket died between close event and write — the close listener detaches it.
  }
}

function finalize(state: HubState, gracePeriodMs: number): void {
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
  // Never hold the process (or a unit test) open for an eviction timer.
  state.evictTimer.unref?.()
}

async function drain(state: HubState, stream: ReadableStream<unknown>, gracePeriodMs: number) {
  const reader = stream.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const line = `data: ${JSON.stringify(value)}\n\n`
      state.lines.push(line)
      for (const res of state.subscribers) safeWrite(res, line)
    }
  } catch (err) {
    // User-initiated abort ends the run quietly; genuine failures surface as an
    // SSE error chunk so attached clients take their onError path instead of
    // hanging on a silent stream end.
    if (!state.abortController.signal.aborted) {
      const errorText = err instanceof Error ? err.message : String(err)
      const line = `data: ${JSON.stringify({ type: 'error', errorText })}\n\n`
      state.lines.push(line)
      for (const res of state.subscribers) safeWrite(res, line)
    }
  } finally {
    reader.releaseLock()
    finalize(state, gracePeriodMs)
  }
}

/**
 * Register a freshly-started agent stream under `chatId` and begin draining it
 * immediately (independent of any attached HTTP client). Re-registering the
 * same chatId aborts and replaces the previous run (defensive — the UI blocks
 * concurrent sends on one thread).
 */
export function registerChatRun(
  chatId: string,
  stream: ReadableStream<unknown>,
  abortController: AbortController,
  opts?: { gracePeriodMs?: number },
): ChatRunHub {
  const gracePeriodMs = opts?.gracePeriodMs ?? DEFAULT_GRACE_PERIOD_MS
  const previous = hubs.get(chatId)
  if (previous && !previous.done) previous.abortController.abort()
  const state: HubState = {
    chatId,
    lines: [],
    done: false,
    subscribers: new Set(),
    abortController,
    evictTimer: null,
  }
  hubs.set(chatId, state)
  void drain(state, stream, gracePeriodMs)
  return {
    chatId,
    get done() {
      return state.done
    },
    get bufferedLines() {
      return state.lines.length
    },
    abort() {
      state.abortController.abort()
    },
  }
}

export function getChatRun(chatId: string): ChatRunHub | undefined {
  const state = hubs.get(chatId)
  if (!state) return undefined
  return {
    chatId,
    get done() {
      return state.done
    },
    get bufferedLines() {
      return state.lines.length
    },
    abort() {
      state.abortController.abort()
    },
  }
}

/**
 * Attach an HTTP response to the hub: write SSE headers, replay the buffer,
 * then stream live chunks. A finished hub still attaches (replay ends with
 * [DONE] and the response closes) — this covers the race where the run ends
 * between the client's history load and its resume request.
 *
 * `res.on('close')` only detaches the subscriber; it NEVER cancels the source
 * stream — a page reload must not kill the run.
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

/** Signal the run's AbortController. Returns false when no such run exists. */
export function abortChatRun(chatId: string): boolean {
  const state = hubs.get(chatId)
  if (!state) return false
  state.abortController.abort()
  return true
}

export function _resetChatRunHubsForTest(): void {
  for (const state of hubs.values()) {
    if (state.evictTimer) clearTimeout(state.evictTimer)
    if (!state.done) state.abortController.abort()
  }
  hubs.clear()
}
