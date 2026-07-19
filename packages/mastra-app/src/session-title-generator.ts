/**
 * First-task auto-naming for Router sessions (delayed naming).
 *
 * After the Leader's first chat completion for a session, the chat handler calls
 * {@link generateSessionTitle} with the first user message; the returned title
 * is written via `store.autoTitleSession` (which is a no-op for user-renamed
 * sessions). Generation reuses the same leader model + custom-provider wiring
 * as the main chat so there is zero new configuration surface.
 *
 * Design notes:
 * - Uses a dedicated, tool-less, memory-less {@link Agent} instance so a title
 *   request can never trigger worker dispatch or pollute thread history.
 * - Failures are swallowed → title stays as the placeholder and the user can
 *   rename manually; auto-naming must never break the main chat flow.
 */
import { Agent } from '@mastra/core/agent'
import { RequestContext } from '@mastra/core/request-context'
import type { ChatMessage } from './session-title-generator.types.js'
import { resolveLeaderModelConfig } from './agents/leader-agent.js'

const TITLE_MAX_CHARS = 80

/** Max chars of the user message fed to the model (keeps prompt tiny + cheap). */
const USER_TEXT_BUDGET = 2000

const titleAgent = new Agent({
  id: 'router-session-titler',
  name: 'Session Titler',
  description:
    'Tiny helper agent that summarizes the first user task of a Router session into a short title. Has no tools and no memory; never delegates.',
  // Same per-request model wiring as the leader (custom providers + secrets apply).
  model: ({ requestContext }) => resolveLeaderModelConfig(requestContext),
  instructions:
    'You summarize a developer task into a concise session title. Reply with the title only: 4-8 words, no quotes, no trailing period, no preamble.',
})

/**
 * Extract the first user-side text from a chat message list in the loose shape
 * the AI SDK `useChat` client sends (`role` + `content` string OR `parts[]`).
 * Returns the trimmed text, or null if no usable user text is present.
 *
 * Pure + side-effect free so it can be unit tested without any LLM.
 */
export function extractFirstUserText(messages: unknown): string | null {
  if (!Array.isArray(messages)) return null
  for (const raw of messages) {
    if (!raw || typeof raw !== 'object') continue
    const msg = raw as ChatMessage
    if (msg.role !== 'user') continue
    const text = readMessageText(msg)
    const trimmed = text.trim()
    if (trimmed) return trimmed
  }
  return null
}

function readMessageText(msg: ChatMessage): string {
  if (typeof msg.content === 'string') return msg.content
  if (Array.isArray(msg.parts)) {
    return msg.parts
      .map((part) =>
        part && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string'
          ? part.text.trim()
          : '',
      )
      .filter((chunk) => chunk.length > 0)
      .join('\n')
      .trim()
  }
  return ''
}

/**
 * Generate a short session title for the first user task. Returns null on any
 * failure or empty input — callers must treat null as "leave the title alone".
 *
 * `requestContext` should be the SAME context built for the chat run, so the
 * leader model / per-request picker / custom providers all resolve identically.
 */
export async function generateSessionTitle(opts: {
  firstUserText: string
  requestContext: RequestContext
  signal?: AbortSignal
}): Promise<string | null> {
  const trimmedInput = opts.firstUserText.trim()
  if (!trimmedInput) return null
  const snippet = trimmedInput.slice(0, USER_TEXT_BUDGET)
  try {
    const result = await titleAgent.generate(
      [
        {
          role: 'system',
          content:
            'Summarize the user task below into a concise session title. Rules: 4-8 words; plain text only; no quotes; no trailing period; no prefix like "Title:".',
        },
        { role: 'user', content: snippet },
      ],
      {
        requestContext: opts.requestContext,
        // Hard cap so a chatty model can't run away; titles don't need tools.
        temperature: 0.2,
        abortSignal: opts.signal,
      } as never,
    )
    return cleanTitle(result?.text)
  } catch (e) {
    console.error('[session-title] generation failed', e instanceof Error ? e.message : e)
    return null
  }
}

/** Normalize LLM output into a clean, length-capped title. */
export function cleanTitle(raw: string | null | undefined): string | null {
  if (!raw) return null
  const stripped = raw
    // Strip surrounding quotes / fancy quotes
    .replace(/^["'“”«»]+|["'“”«»]+$/g, '')
    // Strip a leading "Title:" style prefix
    .replace(/^(title|标题)\s*[:：]\s*/i, '')
    .trim()
    // Collapse internal newlines/extra whitespace
    .replace(/\s+/g, ' ')
    // Drop a trailing period
    .replace(/[.。]$/, '')
    .trim()
  if (!stripped) return null
  return stripped.length > TITLE_MAX_CHARS ? stripped.slice(0, TITLE_MAX_CHARS) : stripped
}
