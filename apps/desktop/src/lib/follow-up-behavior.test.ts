import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import {
  DEFAULT_FOLLOW_UP_BEHAVIOR,
  FOLLOW_UP_BEHAVIOR_EVENT,
  FOLLOW_UP_BEHAVIOR_STORAGE_KEY,
  loadFollowUpBehavior,
  saveFollowUpBehavior,
} from './follow-up-behavior.js'

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
const globals = globalThis as typeof globalThis & { window?: EventTarget }

beforeEachStorage()

function beforeEachStorage(): void {
  ;(globalThis as Record<string, unknown>).localStorage = storage
}

afterEach(() => {
  storage.clear()
  delete globals.window
})

describe('follow-up behavior preference', () => {
  it('defaults invalid or absent storage to queue', () => {
    assert.equal(loadFollowUpBehavior(), DEFAULT_FOLLOW_UP_BEHAVIOR)
    storage.setItem(FOLLOW_UP_BEHAVIOR_STORAGE_KEY, 'immediate')
    assert.equal(loadFollowUpBehavior(), 'queue')
  })

  it('persists a valid value and notifies same-renderer listeners', () => {
    const windowTarget = new EventTarget()
    globals.window = windowTarget
    let detail: unknown
    windowTarget.addEventListener(FOLLOW_UP_BEHAVIOR_EVENT, (event) => {
      detail = (event as CustomEvent).detail
    })

    saveFollowUpBehavior('steer')

    assert.equal(storage.getItem(FOLLOW_UP_BEHAVIOR_STORAGE_KEY), 'steer')
    assert.equal(loadFollowUpBehavior(), 'steer')
    assert.equal(detail, 'steer')
  })
})
