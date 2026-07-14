import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { setRecordKey } from './chat-state.js'

describe('setRecordKey', () => {
  it('returns same record when value unchanged', () => {
    const r = { a: true }
    const r2 = setRecordKey(r, 'a', true)
    assert.strictEqual(r2, r)
  })

  it('returns new record when value changes', () => {
    const r = { a: true }
    const r2 = setRecordKey(r, 'a', false)
    assert.notStrictEqual(r2, r)
    assert.strictEqual(r2.a, false)
  })

  it('adds new key when not present', () => {
    const r: Record<string, boolean> = { a: true }
    const r2 = setRecordKey(r, 'b', false)
    assert.notStrictEqual(r2, r)
    assert.strictEqual(r2.b, false)
  })
})
