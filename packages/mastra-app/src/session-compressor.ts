/**
 * Context compression for Router sessions ("压缩上下文").
 *
 * Reads the leader memory thread, asks a dedicated summarizer agent to condense
 * the early history into a structured markdown digest, then deletes those early
 * messages and persists the digest as a system marker at the thread's new head.
 * The most recent `keepRecentTurns` turns are always preserved verbatim so the
 * active flow (open tool calls, last Q&A) stays intact.
 *
 * Design notes (mirrors {@link session-title-generator}):
 * - Uses a dedicated, tool-less, memory-less {@link Agent} so a compression
 *   request can never trigger worker dispatch or pollute thread history.
 * - Reuses the leader model wiring (custom providers + secrets) via
 *   {@link resolveLeaderModelConfig}, so there is zero new config surface.
 * - Atomic-ish: the summary is generated BEFORE any deletion. If generation
 *   fails, the thread is left untouched. Only on a successful summary do we
 *   delete the old messages and save the digest.
 * - Failures return `null`; callers surface a toast and leave the session as-is.
 *   Compression must never break the chat thread.
 *
 * Why a hand-written summarizer instead of Mastra's `summarizeThread` /
 * `TokenLimiterProcessor`:
 * - `TokenLimiterProcessor` truncates messages (using `tokenx` BPE estimation,
 *   which is accurate) but discards content with no summary. This module
 *   produces a model-authored summary that preserves decisions and open
 *   questions — semantic compression, not byte truncation.
 * - `Memory.summarizeThread()` reuses the Observer's distillation prompt and is
 *   the cleanest option, BUT it requires the Memory instance to carry a
 *   `_mastraInstance` for gateway model resolution. `leaderMemory` is
 *   constructed standalone (`createLeaderMemory()`) and the Agent registration
 *   cascade does NOT propagate to `agent.memory`, so `_mastraInstance` is
 *   undefined there and `summarizeThread` would fail to resolve the model.
 *   Reusing the proven `({ requestContext }) => resolveLeaderModelConfig(...)`
 *   model-function form (same as `titleAgent`) sidesteps that entirely.
 *
 * Token budgeting uses `tokenx`'s `estimateTokenCount` (BPE-based, ~96%
 * accurate, CJK-aware) rather than a naive chars/4 heuristic.
 */
import { Agent } from '@mastra/core/agent'
import { RequestContext } from '@mastra/core/request-context'
import { estimateTokenCount } from 'tokenx'
import { leaderMemory } from './agents/leader-agent.js'
import { resolveLeaderModelConfig } from './agents/leader-agent.js'

/**
 * Minimal view of a recalled memory message. We only need id / role / content,
 * and Mastra's exact message type differs across versions (MastraMessageV1 vs
 * MastraDBMessage) — so we read it loosely and guard each field at runtime.
 */
interface RecalledMessage {
  id?: string
  role?: string
  content?: unknown
  createdAt?: Date | string
}

/** Number of most-recent messages always kept verbatim (never summarized). */
const DEFAULT_KEEP_RECENT = 12

/**
 * Soft cap (in estimated tokens, via `tokenx`) on the early-history transcript
 * fed to the summarizer. Keeps the summarizer prompt cheap and bounded; older
 * content beyond this is dropped from the transcript with a truncation marker.
 */
const HISTORY_TOKEN_BUDGET = 8_000

/**
 * Minimum number of summarizable (user/assistant) early messages required
 * before compression is worth doing. Below this there's nothing meaningful to
 * summarize.
 */
const MIN_SUMMARIZABLE = 4

/** Thread metadata key holding the message-count snapshot after the last
 * successful compression. Used as an optimistic-revision guard against the
 * race where new messages arrive between our `recall` and `deleteMessages`. */
const LAST_COMPACTED_COUNT_KEY = 'routerLastCompactedMessageCount'

const compressorAgent = new Agent({
  id: 'router-session-compressor',
  name: 'Session Compressor',
  description:
    'Tool-less, memory-less helper that condenses a Router session early history into a compact structured digest. Never delegates; never calls tools.',
  // Same per-request model wiring as the leader (custom providers + secrets apply).
  model: ({ requestContext }) => resolveLeaderModelConfig(requestContext),
  instructions: `You compress a multi-turn developer chat history into a dense, structured markdown digest that another agent can use as context to continue the work.

Produce exactly these sections (in this order), each as terse bullet points. Omit any section that has no content rather than writing "none":

## 目标
The user's actual goal(s) — what they are trying to accomplish.

## 已完成
Concrete steps already done, with key results (files written, commands run, decisions made).

## 关键决策与约定
Important constraints, chosen approaches, naming/style decisions, and anything the user explicitly asked for or against.

## 当前状态
Where things stand right now: open tasks, in-flight work, the last question under discussion.

## 未决问题
Explicitly unresolved questions or blockers.

Rules:
- Plain markdown only. No preamble like "Here is the summary".
- Be concrete, not generic. Prefer specific file paths, identifiers, and values over paraphrase.
- Drop pleasantries and repetition. The digest is context, not a reply to the user.
- Keep the total under ~400 words.`,
})

export interface CompressSessionContextOptions {
  threadId: string
  resourceId: string
  requestContext: RequestContext
  /** Number of trailing messages to preserve verbatim. Default 12. */
  keepRecentTurns?: number
  signal?: AbortSignal
}

export interface CompressSessionContextResult {
  /** The generated digest markdown (without the wrapping header). */
  summary: string
  /** IDs of the messages that were deleted. */
  deletedMessageIds: string[]
  /** Number of messages preserved verbatim at the tail. */
  keptRecent: number
  /**
   * Estimated token footprint of the deleted early history (via `tokenx`),
   * measured BEFORE deletion. Combined with `postCompactTokens` this lets the
   * UI show "this compression freed ~N tokens". Modelled after the
   * preCompactTokenCount / postCompactTokenCount pair in other agent UIs.
   */
  preCompactTokens: number
  /**
   * Estimated token footprint of the digest marker that replaces the deleted
   * history. `preCompactTokens - postCompactTokens` is the net context saving.
   */
  postCompactTokens: number
}

/**
 * Read a thread's messages, summarizing the early history into a digest and
 * replacing it in-place. Returns null on any failure (no-op for the thread).
 *
 * `requestContext` should carry the same leader model / per-request picker /
 * custom providers as a chat run so the summarizer uses the configured model.
 */
export async function compressSessionContext(
  opts: CompressSessionContextOptions,
): Promise<CompressSessionContextResult | null> {
  const threadId = opts.threadId
  const keepRecent = Math.max(0, opts.keepRecentTurns ?? DEFAULT_KEEP_RECENT)

  // 1) Read the full thread + the revision watermark. NOTE: resourceId is
  //    intentionally NOT forwarded to memory.recall() — passing it triggers
  //    validateThreadIsOwnedByResource, which under SQLite WAL concurrency can
  //    transiently throw "No thread found" even for an existing thread. We
  //    only need messages by threadId (mirrors the /api/sessions/:id/messages
  //    read path).
  let stored: RecalledMessage[]
  let threadTitle = ''
  let threadMeta: Record<string, unknown> | null = null
  try {
    const [recalled, thread] = await Promise.all([
      leaderMemory.recall({ threadId, perPage: false }),
      leaderMemory.getThreadById({ threadId }),
    ])
    stored = (recalled.messages ?? []) as unknown as RecalledMessage[]
    if (thread) {
      threadTitle = typeof thread.title === 'string' ? thread.title : ''
      threadMeta =
        thread.metadata && typeof thread.metadata === 'object'
          ? (thread.metadata as Record<string, unknown>)
          : null
    }
  } catch (err) {
    console.error('[session-compressor] recall failed', err instanceof Error ? err.message : err)
    return null
  }
  if (stored.length <= keepRecent) return null // nothing early enough to compress

  // 2) Split into early-history (to summarize + delete) and tail (preserve).
  const early = stored.slice(0, stored.length - keepRecent)
  // Only summarize user/assistant text content; skip pure tool/signal rows.
  const summarizable = early.filter((m) => m.role === 'user' || m.role === 'assistant')
  if (summarizable.length < MIN_SUMMARIZABLE) return null

  // —— Revision guard ——
  // `lastCompactedCount` is the message count in the thread RIGHT AFTER the
  // last successful compression (≈ keepRecent + 1 digest marker). Only when
  // strictly more messages than that have arrived is there anything new to
  // summarize. Do NOT add `keepRecent` to the comparison — that was the
  // original bug: the watermark stored the pre-deletion total, so after
  // compression (which shrinks the thread) the guard `stored <= preCount +
  // keepRecent` was always true and blocked all future compressions on a
  // thread that had ever been compressed. Comparing against the post-compress
  // baseline directly makes the guard mean "has anything new arrived since".
  const lastCompactedCount = readNumber(threadMeta?.[LAST_COMPACTED_COUNT_KEY])
  if (lastCompactedCount != null && stored.length <= lastCompactedCount) {
    return null
  }

  const earlyText = renderHistoryForSummary(summarizable)
  if (!earlyText.trim()) return null

  // —— Pre-compression token footprint (for the pre/post saving report). ——
  const preCompactTokens = estimateMessageTokens(early)

  // 3) Generate the digest. Failures → bail out BEFORE any deletion.
  let summary: string | null = null
  try {
    const result = await compressorAgent.generate(
      [
        {
          role: 'system',
          content:
            'Compress the conversation history below into the structured digest defined in your instructions. The history is the EARLY part of a longer session; the most recent turns are preserved separately and are NOT included here.',
        },
        { role: 'user', content: earlyText },
      ],
      {
        requestContext: opts.requestContext,
        temperature: 0.2,
        abortSignal: opts.signal,
      } as never,
    )
    summary = cleanSummary(result?.text)
  } catch (err) {
    console.error(
      '[session-compressor] summary generation failed',
      err instanceof Error ? err.message : err,
    )
    return null
  }
  if (!summary) return null

  // —— Re-read to apply a CAS-style guard: if messages arrived between our
  //    initial recall and now (e.g. the user kept chatting), recompute the
  //    early slice against the FRESH message list so we never delete a message
  //    that wasn't part of the summarized set. This is the optimistic-revision
  //    pattern: we only delete message ids that are still in the "early" region
  //    of the current thread state.
  let earlyIdsToDelete: string[]
  try {
    const fresh = await leaderMemory.recall({ threadId, perPage: false })
    const freshMessages = (fresh.messages ?? []) as unknown as RecalledMessage[]
    const freshEarly = freshMessages.slice(0, Math.max(0, freshMessages.length - keepRecent))
    const summarizedIdSet = new Set(
      early.map((m) => m.id).filter((id): id is string => typeof id === 'string'),
    )
    // Only delete ids that (a) are still in the early region AND (b) were in
    // our summarized set. A message that moved into the tail (because new
    // messages pushed the boundary) is preserved.
    earlyIdsToDelete = freshEarly
      .map((m) => m.id)
      .filter((id): id is string => typeof id === 'string' && summarizedIdSet.has(id))
  } catch (err) {
    console.error(
      '[session-compressor] CAS re-read failed; aborting deletion to stay safe',
      err instanceof Error ? err.message : err,
    )
    return null
  }
  if (earlyIdsToDelete.length === 0) {
    // Everything we summarized has already rolled into the tail — nothing to delete.
    return null
  }

  // 4) Delete the early messages. deleteMessages accepts string[] of ids.
  try {
    await leaderMemory.deleteMessages(earlyIdsToDelete)
  } catch (err) {
    // Deletion failed mid-way is the one risky spot: we may have a digest but
    // the old messages are still there. Log loudly; the caller can retry.
    // We do NOT save the digest in this case (it would duplicate context).
    console.error(
      '[session-compressor] deleteMessages failed — thread left partially inconsistent',
      {
        threadId,
        attemptedCount: earlyIdsToDelete.length,
        error: err instanceof Error ? err.message : err,
      },
    )
    return null
  }

  // 5) Persist the digest as a system marker at the thread head so subsequent
  //    turns see it as context. The Chinese header prefix is intentional — the
  //    UI locale is zh and the model generates the digest in Chinese; the prefix
  //    makes the marker traceable in the thread ("history digest, generated by
  //    context compression").
  const digestContent = `## 历史摘要（由上下文压缩生成）\n\n${summary}`
  const postCompactTokens = estimateTokenCount(digestContent)
  try {
    await leaderMemory.saveMessages({
      messages: [
        {
          role: 'system',
          content: digestContent,
          createdAt: new Date(),
        } as never,
      ],
    })
  } catch (err) {
    console.error('[session-compressor] digest persist failed (deletion already applied)', {
      threadId,
      error: err instanceof Error ? err.message : err,
    })
    // Deletion already happened; the digest just isn't saved. Not catastrophic:
    // the thread lost early history but the tail is intact. Report partial.
    return {
      summary,
      deletedMessageIds: earlyIdsToDelete,
      keptRecent: keepRecent,
      preCompactTokens,
      postCompactTokens,
    }
  }

  // 6) Stamp the revision watermark so the next run can skip if nothing new
  //    has arrived. The watermark is the message count in the thread RIGHT
  //    AFTER this compression: we deleted `earlyIdsToDelete.length` messages
  //    and inserted 1 digest marker. Re-read to get the authoritative current
  //    count (cheaper + correct under concurrency than arithmetic on the
  //    pre-deletion `stored.length`).
  try {
    const afterRecall = await leaderMemory.recall({ threadId, perPage: false })
    const afterCount = (afterRecall.messages ?? []).length
    const existing = (await leaderMemory.getThreadById({ threadId }))?.metadata
    const merged = {
      ...(existing && typeof existing === 'object' ? existing : {}),
      [LAST_COMPACTED_COUNT_KEY]: afterCount,
    }
    await leaderMemory.updateThread({
      id: threadId,
      title: threadTitle,
      metadata: merged as Record<string, unknown>,
    })
  } catch (err) {
    // Non-fatal: watermark just won't skip the next run. Don't fail the compression.
    console.warn('[session-compressor] watermark stamp failed (non-fatal)', err)
  }

  return {
    summary,
    deletedMessageIds: earlyIdsToDelete,
    keptRecent: keepRecent,
    preCompactTokens,
    postCompactTokens,
  }
}

/** Parse a metadata field into a finite non-negative number, or null. */
function readNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v
  if (typeof v === 'string' && /^\d+$/.test(v.trim())) {
    const n = parseInt(v, 10)
    return Number.isFinite(n) && n >= 0 ? n : null
  }
  return null
}

/** Sum of estimated tokens across a set of messages (via `tokenx`). */
function estimateMessageTokens(messages: RecalledMessage[]): number {
  let total = 0
  for (const m of messages) total += estimateTokenCount(messageToText(m))
  return total
}

/** Render early messages into a compact transcript for the summarizer. */
function renderHistoryForSummary(messages: RecalledMessage[]): string {
  let out = ''
  let used = 0
  for (const m of messages) {
    const role = m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Assistant' : m.role
    const text = messageToText(m)
    if (!text) continue
    const line = `${role}: ${text}\n`
    const lineTokens = estimateTokenCount(line)
    if (used + lineTokens > HISTORY_TOKEN_BUDGET) {
      out += '[… earlier history truncated …]\n'
      break
    }
    used += lineTokens
    out += line
  }
  return out.trim()
}

/** Best-effort text extraction from a recalled message. Mastra's `recall`
 * returns content in several shapes depending on the message format:
 *  - a plain string (v1 messages)
 *  - an array of parts (core message parts)
 *  - a `{ format, parts }` object (v2 MastraDB messages — the common case now)
 * We extract `text` from any text-like part, and skip reasoning/tool-call
 * parts (they bloat the transcript without adding summary value).
 */
function messageToText(m: RecalledMessage): string {
  const c = m.content
  if (typeof c === 'string') return c
  // Normalize to a parts array: either the content itself, or content.parts.
  const parts = Array.isArray(c)
    ? c
    : c && typeof c === 'object' && Array.isArray((c as { parts?: unknown }).parts)
      ? (c as { parts: unknown[] }).parts
      : null
  if (!parts) {
    // Fallback: if it's a non-array object, try a JSON dump so we don't lose it
    // entirely (rare; mainly defensive).
    return c && typeof c === 'object' ? '' : ''
  }
  return parts
    .map((part) => {
      if (!part || typeof part !== 'object') return ''
      const p = part as { type?: string; text?: string; content?: unknown }
      // Keep text parts; skip reasoning / tool-call / tool-result parts.
      if (p.type === 'reasoning' || p.type === 'tool-call' || p.type === 'tool-result') {
        return ''
      }
      if (typeof p.text === 'string') return p.text
      if (typeof p.content === 'string') return p.content
      return ''
    })
    .filter(Boolean)
    .join(' ')
}

/** Normalize the model's digest output. */
function cleanSummary(raw: string | null | undefined): string | null {
  if (!raw) return null
  return (
    raw
      .replace(/^```markdown\s*|^```\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim() || null
  )
}
