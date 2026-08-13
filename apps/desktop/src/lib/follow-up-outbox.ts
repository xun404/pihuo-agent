import { isChatRunIdentifier, type FollowUpSource } from '@swarmdesk-agent/shared'

export type FollowUpOutboxItemState = 'queued' | 'dispatching' | 'unknown' | 'retry_wait'

export type FollowUpOutboxItem = {
  deliveryId: string
  clientRunId: string
  content: string
  createdAt: number
  source: FollowUpSource
  attempt: number
  nextAttemptAt: number | null
  state: FollowUpOutboxItemState
}

export const FOLLOW_UP_OUTBOX_STORAGE_KEY = 'swarmdesk-agent.followUpOutbox.v2'
export const FOLLOW_UP_OUTBOX_PER_THREAD_LIMIT = 20

type PersistedOutbox = Record<string, FollowUpOutboxItem[]>
type Listener = () => void

let loaded = false
const outbox = new Map<string, FollowUpOutboxItem[]>()
const listeners = new Map<string, Set<Listener>>()

function cloneItem(item: FollowUpOutboxItem): FollowUpOutboxItem {
  return { ...item }
}

function isSource(value: unknown): value is FollowUpSource {
  return value === 'direct' || value === 'queue' || value === 'steer' || value === 'budget_continue'
}

function isItem(value: unknown): value is FollowUpOutboxItem {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return (
    isChatRunIdentifier(item.deliveryId) &&
    isChatRunIdentifier(item.clientRunId) &&
    typeof item.content === 'string' &&
    item.content.trim().length > 0 &&
    typeof item.createdAt === 'number' &&
    Number.isFinite(item.createdAt) &&
    isSource(item.source) &&
    typeof item.attempt === 'number' &&
    Number.isInteger(item.attempt) &&
    item.attempt >= 0 &&
    (item.nextAttemptAt === null ||
      (typeof item.nextAttemptAt === 'number' && Number.isFinite(item.nextAttemptAt))) &&
    (item.state === 'queued' ||
      item.state === 'dispatching' ||
      item.state === 'unknown' ||
      item.state === 'retry_wait')
  )
}

function loadOnce(): void {
  if (loaded) return
  loaded = true
  try {
    const raw = localStorage.getItem(FOLLOW_UP_OUTBOX_STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return
    for (const [threadId, candidate] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(candidate) || !threadId.trim()) continue
      const validated = candidate.filter(isItem).slice(0, FOLLOW_UP_OUTBOX_PER_THREAD_LIMIT)
      if (validated.length > 0) {
        // Dispatch state is process-local. A renderer reload must reconcile it
        // before sending again, so restore it as unknown rather than in-flight.
        outbox.set(
          threadId,
          validated.map((item) => ({
            ...item,
            state: item.state === 'dispatching' ? 'unknown' : item.state,
          })),
        )
      }
    }
  } catch {
    // Corrupt / unavailable storage falls back to this renderer's memory map.
  }
}

function persist(): void {
  try {
    const value: PersistedOutbox = {}
    for (const [threadId, items] of outbox) {
      if (items.length > 0) value[threadId] = items.map(cloneItem)
    }
    localStorage.setItem(FOLLOW_UP_OUTBOX_STORAGE_KEY, JSON.stringify(value))
  } catch {
    // Keep the in-memory queue usable when quota/privacy rejects a write.
  }
}

function emit(threadId: string): void {
  for (const listener of listeners.get(threadId) ?? []) listener()
}

function update(
  threadId: string,
  updater: (items: FollowUpOutboxItem[]) => FollowUpOutboxItem[],
): void {
  loadOnce()
  const current = outbox.get(threadId) ?? []
  const next = updater(current.map(cloneItem))
  if (next.length > 0) outbox.set(threadId, next)
  else outbox.delete(threadId)
  persist()
  emit(threadId)
}

export function listFollowUpOutbox(threadId: string): FollowUpOutboxItem[] {
  loadOnce()
  return (outbox.get(threadId) ?? []).map(cloneItem)
}

export function subscribeFollowUpOutbox(threadId: string, listener: Listener): () => void {
  loadOnce()
  const bucket = listeners.get(threadId) ?? new Set<Listener>()
  bucket.add(listener)
  listeners.set(threadId, bucket)
  return () => {
    bucket.delete(listener)
    if (bucket.size === 0) listeners.delete(threadId)
  }
}

export function addFollowUpOutboxItem(
  threadId: string,
  item: FollowUpOutboxItem,
): { ok: true } | { ok: false; reason: 'capacity' } {
  let result: { ok: true } | { ok: false; reason: 'capacity' } = { ok: true }
  update(threadId, (items) => {
    if (items.some((candidate) => candidate.deliveryId === item.deliveryId)) return items
    if (items.length >= FOLLOW_UP_OUTBOX_PER_THREAD_LIMIT) {
      result = { ok: false, reason: 'capacity' }
      return items
    }
    return [...items, cloneItem(item)]
  })
  return result
}

export function updateFollowUpOutboxItem(
  threadId: string,
  deliveryId: string,
  patch: Partial<Omit<FollowUpOutboxItem, 'deliveryId' | 'createdAt' | 'content'>>,
): void {
  update(threadId, (items) =>
    items.map((item) => (item.deliveryId === deliveryId ? { ...item, ...patch } : item)),
  )
}

export function removeFollowUpOutboxItem(
  threadId: string,
  deliveryId: string,
): FollowUpOutboxItem | undefined {
  let removed: FollowUpOutboxItem | undefined
  update(threadId, (items) =>
    items.filter((item) => {
      if (item.deliveryId !== deliveryId) return true
      removed = item
      return false
    }),
  )
  return removed ? cloneItem(removed) : undefined
}

export function moveFollowUpOutboxItemToFront(threadId: string, deliveryId: string): void {
  update(threadId, (items) => {
    const index = items.findIndex((item) => item.deliveryId === deliveryId)
    if (index <= 0) return items
    const [item] = items.splice(index, 1)
    return item ? [item, ...items] : items
  })
}

export function clearFollowUpOutboxForTest(): void {
  outbox.clear()
  loaded = false
  listeners.clear()
}
