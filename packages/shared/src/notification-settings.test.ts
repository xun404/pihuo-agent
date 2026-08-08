import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  isNotificationMode,
  type NotificationSettings,
} from './notification-settings.js'

test('defaults: disabled, hidden-only, all events on', () => {
  assert.equal(DEFAULT_NOTIFICATION_SETTINGS.enabled, false)
  assert.equal(DEFAULT_NOTIFICATION_SETTINGS.mode, 'hidden-only')
  assert.equal(DEFAULT_NOTIFICATION_SETTINGS.onCompletion, true)
  assert.equal(DEFAULT_NOTIFICATION_SETTINGS.onError, true)
  assert.equal(DEFAULT_NOTIFICATION_SETTINGS.onApproval, true)
})

test('isNotificationMode accepts only the two modes', () => {
  assert.equal(isNotificationMode('always'), true)
  assert.equal(isNotificationMode('hidden-only'), true)
  assert.equal(isNotificationMode('never'), false)
  assert.equal(isNotificationMode(undefined), false)
  assert.equal(isNotificationMode(null), false)
})

test('type is structurally complete', () => {
  const settings: NotificationSettings = { ...DEFAULT_NOTIFICATION_SETTINGS }
  assert.deepEqual(settings, DEFAULT_NOTIFICATION_SETTINGS)
})
