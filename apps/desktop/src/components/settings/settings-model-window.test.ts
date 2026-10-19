import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  formatModelContextLabel,
  MODEL_ROW_STRIDE_PX,
  modelListWindow,
} from './settings-model-window.js'

describe('modelListWindow', () => {
  it('returns an empty slice for no models', () => {
    assert.deepEqual(
      modelListWindow({ count: 0, scrollTop: 0, viewportHeight: 700, listOffset: 0 }),
      { start: 0, end: 0 },
    )
  })

  it('keeps the first viewport of a large catalog on screen with overscan', () => {
    const win = modelListWindow({
      count: 93,
      scrollTop: 0,
      viewportHeight: 700,
      listOffset: 0,
      rowStride: MODEL_ROW_STRIDE_PX,
      overscan: 4,
    })
    assert.equal(win.start, 0)
    assert.ok(win.end < 93)
    assert.ok(win.end <= 10 + 8)
  })

  it('shifts the slice when the main pane has scrolled past the list origin', () => {
    const win = modelListWindow({
      count: 93,
      scrollTop: 1400,
      viewportHeight: 700,
      listOffset: 280,
      rowStride: 70,
      overscan: 4,
    })
    assert.ok(win.start > 0)
    assert.ok(win.end < 93)
    assert.ok(win.end - win.start <= 10 + 8)
  })
})

describe('formatModelContextLabel', () => {
  it('formats thousand and million windows and ignores junk', () => {
    assert.equal(formatModelContextLabel(128_000), '128k')
    assert.equal(formatModelContextLabel(1_000_000), '1M')
    assert.equal(formatModelContextLabel(0), null)
    assert.equal(formatModelContextLabel(undefined), null)
  })
})
