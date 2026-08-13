/**
 * Persist the incoming user turn to Mastra memory at request time.
 *
 * Mastra's agent.stream() path only persists input+output together at run
 * finish (MessageHistory output processor), so a frontend reload mid-run
 * loads a history that is missing the in-flight user message — the chat then
 * shows the assistant reply with no question above it until the run ends.
 *
 * Saving the same UIMessage ids up front is safe: MessageList preserves
 * incoming UIMessage ids, and @mastra/libsql saveMessages is an upsert
 * (ON CONFLICT(id) DO UPDATE), so Mastra's finish-save updates the same rows
 * instead of duplicating them.
 */

/** Minimal slice of @mastra/memory's Memory API used here. */
export interface UserTurnMemoryStore {
  getThreadById(input: { threadId: string }): Promise<unknown>
  createThread(input: { threadId: string; resourceId: string }): Promise<unknown>
  saveMessages(input: { messages: Record<string, unknown>[] }): Promise<unknown>
}

/**
 * Convert AI SDK UIMessages to MastraDBMessage-shaped rows (format 2 content),
 * keeping only well-formed user messages.
 */
export function buildUserTurnDbMessages(input: {
  messages: unknown
  threadId: string
  resourceId: string
  now?: Date
}): Record<string, unknown>[] {
  const list = Array.isArray(input.messages) ? input.messages : []
  const now = input.now ?? new Date()
  const out: Record<string, unknown>[] = []
  for (const candidate of list) {
    if (!candidate || typeof candidate !== 'object') continue
    const msg = candidate as { id?: unknown; role?: unknown; parts?: unknown }
    if (msg.role !== 'user' || typeof msg.id !== 'string' || msg.id.length === 0) continue
    out.push({
      id: msg.id,
      role: 'user',
      createdAt: now,
      threadId: input.threadId,
      resourceId: input.resourceId,
      content: { format: 2, parts: Array.isArray(msg.parts) ? msg.parts : [] },
    })
  }
  return out
}

/** Build a durable assistant data marker for Leader footer metadata. */
export function buildLeaderRunMetaDbMessage(input: {
  runId: string
  threadId: string
  resourceId: string
  model: string
  thinking?: string
  startedAt: Date
  completedAt: Date
}): Record<string, unknown> {
  return {
    id: `leader-run-meta:${input.runId}`,
    role: 'assistant',
    createdAt: input.completedAt,
    threadId: input.threadId,
    resourceId: input.resourceId,
    content: {
      format: 2,
      parts: [
        {
          type: 'data-leader-run-meta',
          data: {
            runId: input.runId,
            startedAt: input.startedAt.toISOString(),
            completedAt: input.completedAt.toISOString(),
            model: input.model,
            ...(input.thinking ? { thinking: input.thinking } : {}),
          },
        },
      ],
    },
  }
}

/**
 * Ensure the memory thread exists, then persist the user turn.
 * Returns how many user messages were saved. Throws on storage failure —
 * callers choose the failure policy. Follow-up run admission treats a failure
 * as a terminal startup error, so it never runs an unpersisted delivery.
 */
export async function persistUserTurnUpFront(
  memory: UserTurnMemoryStore,
  input: { messages: unknown; threadId: string; resourceId: string },
): Promise<number> {
  const rows = buildUserTurnDbMessages(input)
  if (rows.length === 0) return 0
  const existing = await memory.getThreadById({ threadId: input.threadId })
  if (!existing) {
    await memory.createThread({ threadId: input.threadId, resourceId: input.resourceId })
  }
  await memory.saveMessages({ messages: rows })
  return rows.length
}
