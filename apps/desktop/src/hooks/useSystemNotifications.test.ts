import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  getWatermarks,
  setWatermarks,
  getNotifiedApprovalIds,
  setNotifiedApprovalIds,
} from './useSystemNotifications.js'

// Node 22 (this toolchain: v22.22.1) has no global localStorage, so the
// helpers get an in-memory Storage mock.
class MemoryStorage implements Storage {
  private readonly store = new Map<string, string>()

  get length(): number {
    return this.store.size
  }

  clear(): void {
    this.store.clear()
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null
  }

  key(index: number): string | null {
    return [...this.store.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.store.delete(key)
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value))
  }
}

;(globalThis as Record<string, unknown>).localStorage = new MemoryStorage()

test('watermark persistence round-trips through localStorage', () => {
  const key = 'pihuo-agent:notification-watermarks'
  localStorage.removeItem(key)
  assert.deepEqual(getWatermarks(), {})
  setWatermarks({ s1: '2026-08-08T10:00:00.000Z' })
  assert.deepEqual(getWatermarks(), { s1: '2026-08-08T10:00:00.000Z' })
  localStorage.removeItem(key)
})

test('notified approval ids round-trip through localStorage', () => {
  const key = 'pihuo-agent:notification-approvals'
  localStorage.removeItem(key)
  assert.deepEqual(getNotifiedApprovalIds(), [])
  setNotifiedApprovalIds(['a1', 'a2'])
  assert.deepEqual(getNotifiedApprovalIds(), ['a1', 'a2'])
  localStorage.removeItem(key)
})
