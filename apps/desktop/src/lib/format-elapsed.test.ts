import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { formatElapsedHms, formatElapsedSeconds } from './format-elapsed.js'

describe('formatElapsedSeconds', () => {
  it('uses 0.1s steps under 10s', () => {
    assert.equal(formatElapsedSeconds(0), '0.0s')
    assert.equal(formatElapsedSeconds(0.14), '0.1s')
    assert.equal(formatElapsedSeconds(3.29), '3.2s')
    assert.equal(formatElapsedSeconds(9.99), '9.9s')
  })

  it('uses 1s steps at and above 10s', () => {
    assert.equal(formatElapsedSeconds(10), '10s')
    assert.equal(formatElapsedSeconds(10.9), '10s')
    assert.equal(formatElapsedSeconds(65.2), '65s')
  })
})

describe('formatElapsedHms', () => {
  it('formats short durations under 1 minute (zh)', () => {
    assert.equal(formatElapsedHms(3.29, 'zh'), '3.2秒')
    assert.equal(formatElapsedHms(45.2, 'zh'), '45秒')
  })

  it('formats minutes and hours (zh)', () => {
    assert.equal(formatElapsedHms(135, 'zh'), '2分15秒')
    assert.equal(formatElapsedHms(3723, 'zh'), '1时2分3秒')
  })

  it('formats en units', () => {
    assert.equal(formatElapsedHms(3.29, 'en'), '3.2s')
    assert.equal(formatElapsedHms(135, 'en'), '2m 15s')
    assert.equal(formatElapsedHms(3723, 'en'), '1h 2m 3s')
  })
})
