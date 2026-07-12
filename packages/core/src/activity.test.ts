import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { ActivityLog } from './activity.js'
import { getSharedStore } from './shared-store.js'

describe('ActivityLog', () => {
  it('prepends events and respects max', () => {
    const log = new ActivityLog(3)
    log.append('system', 'a')
    log.append('project', 'b')
    log.append('session', 'c')
    log.append('dispatch', 'd')
    const list = log.list()
    assert.equal(list.length, 3)
    assert.equal(list[0]!.message, 'd')
    assert.equal(list[2]!.message, 'b')
  })
})

describe('getSharedStore', () => {
  it('returns the same instance', () => {
    const a = getSharedStore()
    const b = getSharedStore()
    assert.equal(a, b)
  })
})
