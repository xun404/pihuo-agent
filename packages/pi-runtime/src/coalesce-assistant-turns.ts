/**
 * Coalesce consecutive assistant messages in a turn into a single UI message.
 *
 * Root cause: Mastra's TaskSignalProvider signal drain rotates the response
 * messageId on each pending signal, splitting a single leader turn (one user
 * message → one assistant reply) into multiple stored assistant messages.
 * This function reverses that split on recall so the frontend sees one bubble
 * per turn (matching how AI SDK `useChat` already accumulates the live stream
 * into one in-memory message).
 *
 * Rules:
 * - Consecutive assistant messages between user messages belong to one turn.
 * - The first assistant message of the turn is cloned and extended; its id,
 *   role, and all other own properties are preserved.
 * - Parts from subsequent assistant messages are appended to the first.
 * - Metadata from subsequent messages is merged shallowly (last writer wins).
 * - User messages and messages from other roles are passed through unchanged.
 * - An assistant message with only a `data-leader-step-budget` part is merged
 *   into the turn normally (its part and metadata are preserved) so budget
 *   scanning (`findLatestActionableBudget`, which stops at a user boundary)
 *   keeps working.
 */
export function coalesceAssistantTurns<T extends { id: string; role: string; parts?: unknown[] }>(
  messages: T[],
): T[] {
  if (messages.length === 0) return messages

  const result: T[] = []
  /** Pending assistant message being accumulated for the current turn, or null. */
  let pending: T | null = null

  const flush = () => {
    if (pending) {
      result.push(pending)
      pending = null
    }
  }

  for (const msg of messages) {
    if (msg.role !== 'assistant') {
      // A user message (or any non-assistant role) ends the current turn.
      flush()
      result.push(msg)
      continue
    }

    const parts = Array.isArray(msg.parts) ? msg.parts : []
    const metadata = (msg as T & { metadata?: Record<string, unknown> }).metadata

    if (pending === null) {
      // First assistant message of this turn — clone it and (re)seed parts/metadata.
      pending = { ...msg, parts: [...parts], metadata: metadata ? { ...metadata } : undefined }
    } else {
      // Subsequent assistant message in the same turn — merge into pending.
      const acc = pending as T & { parts: unknown[]; metadata?: Record<string, unknown> }
      acc.parts.push(...parts)
      // Shallow merge metadata (last writer wins); skip undefined values.
      if (metadata) {
        acc.metadata = { ...(acc.metadata ?? {}), ...metadata }
      }
    }
  }

  flush()
  return result
}
