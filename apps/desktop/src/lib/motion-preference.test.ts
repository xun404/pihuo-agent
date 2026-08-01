import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isMotionPreference,
  motionDatasetValue,
  resolveReduceMotion,
} from './motion-preference.js'

test('isMotionPreference accepts only system/on/off', () => {
  assert.equal(isMotionPreference('system'), true)
  assert.equal(isMotionPreference('on'), true)
  assert.equal(isMotionPreference('off'), true)
  assert.equal(isMotionPreference('full'), false)
  assert.equal(isMotionPreference(null), false)
})

test('resolveReduceMotion: off always reduces, on never reduces', () => {
  assert.equal(resolveReduceMotion('off', false), true)
  assert.equal(resolveReduceMotion('off', true), true)
  assert.equal(resolveReduceMotion('on', false), false)
  assert.equal(resolveReduceMotion('on', true), false)
})

test('resolveReduceMotion: system follows OS flag', () => {
  assert.equal(resolveReduceMotion('system', true), true)
  assert.equal(resolveReduceMotion('system', false), false)
})

test('motionDatasetValue maps reduce flag to data-motion token', () => {
  assert.equal(motionDatasetValue(true), 'reduce')
  assert.equal(motionDatasetValue(false), 'full')
})
