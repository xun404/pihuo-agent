import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  claimNotification,
  normalizeNotificationPayload,
  __clearClaimsForTest,
  type NativeNotificationPayload,
} from './notification-service.js'

beforeEach(() => __clearClaimsForTest())

test('normalizeNotificationPayload: requires non-empty id and title', () => {
  assert.equal(normalizeNotificationPayload(null), null)
  assert.equal(normalizeNotificationPayload({}), null)
  assert.equal(normalizeNotificationPayload({ id: ' ', title: 'x' }), null)
  assert.equal(normalizeNotificationPayload({ id: 'x', title: '' }), null)
})

test('normalizeNotificationPayload: trims and keeps optional fields', () => {
  const result = normalizeNotificationPayload({
    id: ' ready-s1 ',
    title: ' Done ',
    body: ' hi ',
    sessionId: 's1',
  })
  assert.deepEqual(result, { id: 'ready-s1', title: 'Done', body: 'hi', sessionId: 's1' })
})

test('normalizeNotificationPayload: drops empty sessionId', () => {
  const result = normalizeNotificationPayload({ id: 'a', title: 't', sessionId: ' ' })
  assert.equal(result?.sessionId, undefined)
})

test('claimNotification: dedupes same id within TTL', () => {
  assert.equal(claimNotification('k1'), true)
  assert.equal(claimNotification('k1'), false)
  assert.equal(claimNotification('k2'), true)
})

test('claimNotification: empty id is never blocked', () => {
  assert.equal(claimNotification(''), true)
  assert.equal(claimNotification(''), true)
})

test('NativeNotificationPayload type shape', () => {
  const payload: NativeNotificationPayload = { id: 'i', title: 't', body: 'b', sessionId: 's' }
  assert.equal(payload.id, 'i')
})
