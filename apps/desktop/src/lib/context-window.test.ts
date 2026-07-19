import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { formatTokenCountDisplay, parseContextWindow } from './context-window'

describe('parseContextWindow', () => {
  it('parses plain integers', () => {
    assert.equal(parseContextWindow('128000'), 128000)
  })

  it('parses K/M shorthand', () => {
    assert.equal(parseContextWindow('20K'), 20_000)
    assert.equal(parseContextWindow('128k'), 128_000)
    assert.equal(parseContextWindow('1M'), 1_000_000)
    assert.equal(parseContextWindow('1.5M'), 1_500_000)
  })

  it('returns undefined for empty/invalid', () => {
    assert.equal(parseContextWindow(''), undefined)
    assert.equal(parseContextWindow('abc'), undefined)
  })
})

describe('formatTokenCountDisplay', () => {
  it('formats zh 万/亿', () => {
    assert.equal(formatTokenCountDisplay(16_000, 'zh'), '1.6万')
    assert.equal(formatTokenCountDisplay(1_000_000, 'zh'), '100万')
    assert.equal(formatTokenCountDisplay(128_000, 'zh'), '12.8万')
  })

  it('formats en K/M', () => {
    assert.equal(formatTokenCountDisplay(16_000, 'en'), '16K')
    assert.equal(formatTokenCountDisplay(1_000_000, 'en'), '1M')
  })
})
