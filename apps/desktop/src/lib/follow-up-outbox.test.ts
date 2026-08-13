import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import {
  addFollowUpOutboxItem,
  clearFollowUpOutboxForTest,
  FOLLOW_UP_OUTBOX_PER_THREAD_LIMIT,
  FOLLOW_UP_OUTBOX_STORAGE_KEY,
  listFollowUpOutbox,
  moveFollowUpOutboxItemToFront,
  removeFollowUpOutboxItem,
  updateFollowUpOutboxItem,
  type FollowUpOutboxItem,
} from './follow-up-outbox.js'

class MemoryStorage {
  #values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.#values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.#values.set(key, value)
  }

  removeItem(key: string): void {
    this.#values.delete(key)
  }

  clear(): void {
    this.#values.clear()
  }
}

const storage = new MemoryStorage()
;(globalThis as Record<string, unknown>).localStorage = storage

function item(index: number, patch: Partial<FollowUpOutboxItem> = {}): FollowUpOutboxItem {
  const suffix = String(index).padStart(12, '0')
  return {
    deliveryId: `00000000-0000-4000-8000-${suffix}`,
    clientRunId: `00000000-0000-4000-9000-${suffix}`,
    content: `message ${index}`,
    createdAt: index,
    source: 'queue',
    attempt: 0,
    nextAttemptAt: null,
    state: 'queued',
    ...patch,
  }
}

afterEach(() => {
  clearFollowUpOutboxForTest()
  storage.clear()
})

describe('follow-up outbox', () => {
  it('keeps FIFO entries, supports return/remove, and enforces the per-thread limit', () => {
    const threadId = 'thread-a'
    assert.deepEqual(addFollowUpOutboxItem(threadId, item(1)), { ok: true })
    assert.deepEqual(addFollowUpOutboxItem(threadId, item(2)), { ok: true })
    moveFollowUpOutboxItemToFront(threadId, item(2).deliveryId)
    assert.deepEqual(
      listFollowUpOutbox(threadId).map((entry) => entry.deliveryId),
      [item(2).deliveryId, item(1).deliveryId],
    )
    assert.equal(removeFollowUpOutboxItem(threadId, item(2).deliveryId)?.content, 'message 2')

    for (let index = 3; index <= FOLLOW_UP_OUTBOX_PER_THREAD_LIMIT + 1; index += 1) {
      assert.deepEqual(addFollowUpOutboxItem(threadId, item(index)), { ok: true })
    }
    assert.equal(listFollowUpOutbox(threadId).length, FOLLOW_UP_OUTBOX_PER_THREAD_LIMIT)
    assert.deepEqual(addFollowUpOutboxItem(threadId, item(99)), { ok: false, reason: 'capacity' })
  })

  it('round-trips persisted values and turns process-local dispatch into unknown after reload', () => {
    const threadId = 'thread-b'
    addFollowUpOutboxItem(threadId, item(3, { state: 'dispatching' }))
    updateFollowUpOutboxItem(threadId, item(3).deliveryId, { attempt: 2, nextAttemptAt: 4_000 })
    assert.match(storage.getItem(FOLLOW_UP_OUTBOX_STORAGE_KEY) ?? '', /000000000003/u)

    clearFollowUpOutboxForTest()
    const [restored] = listFollowUpOutbox(threadId)
    assert.ok(restored)
    assert.equal(restored.state, 'unknown')
    assert.equal(restored.attempt, 2)
    assert.equal(restored.nextAttemptAt, 4_000)
  })

  it('drops only corrupt threads while retaining valid persisted threads', () => {
    storage.setItem(
      FOLLOW_UP_OUTBOX_STORAGE_KEY,
      JSON.stringify({
        valid: [item(4)],
        corrupt: [{ deliveryId: 'too-short', content: '' }],
      }),
    )
    clearFollowUpOutboxForTest()

    assert.equal(listFollowUpOutbox('valid').length, 1)
    assert.equal(listFollowUpOutbox('corrupt').length, 0)
  })

  it('continues in memory when storage writes fail', () => {
    const throwingStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota')
      },
    }
    ;(globalThis as Record<string, unknown>).localStorage = throwingStorage
    clearFollowUpOutboxForTest()

    assert.deepEqual(addFollowUpOutboxItem('memory-only', item(5)), { ok: true })
    assert.equal(listFollowUpOutbox('memory-only')[0]?.content, 'message 5')
    ;(globalThis as Record<string, unknown>).localStorage = storage
  })
})
