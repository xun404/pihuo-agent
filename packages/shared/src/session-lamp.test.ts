import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  SESSION_LAMP_ACTIVE_TTL_MS,
  SESSION_LAMP_ERROR_GRACE_MS,
  sessionHasUnreadLamp,
  sessionLampClass,
  sessionLampTimes,
  type Session,
} from './index.js'

const T0 = Date.parse('2026-01-01T00:00:00.000Z')
const iso = (ms: number) => new Date(ms).toISOString()

function makeSession(patch: Partial<Session> = {}): Session {
  return {
    id: 's1',
    projectId: 'p1',
    title: 'S',
    status: 'idle',
    mode: 'build',
    activeWorkerIds: [],
    memoryThreadId: 'm1',
    approvalPolicy: 'manual',
    createdAt: iso(T0 - 100_000),
    updatedAt: iso(T0 - 100_000),
    ...patch,
  }
}

describe('sessionLampClass', () => {
  it('documents the lamp timing constants', () => {
    assert.equal(SESSION_LAMP_ERROR_GRACE_MS, 3_000)
    assert.equal(SESSION_LAMP_ACTIVE_TTL_MS, 60_000)
  })

  it('approve outranks everything, including unread errors', () => {
    const s = makeSession({
      status: 'needs_approval',
      lastErrorAt: iso(T0),
      lastReadAt: iso(T0 - 1_000),
    })
    assert.equal(sessionLampClass(s, true, T0), 'approve')
  })

  it('run when busy (optimistic) or status running, outranking unread lamps', () => {
    const base = {
      lastErrorAt: iso(T0 - 500),
      lastReplyAt: iso(T0 - 500),
      lastReadAt: iso(T0 - 10_000),
    }
    assert.equal(sessionLampClass(makeSession({ ...base, status: 'running' }), false, T0), 'run')
    assert.equal(sessionLampClass(makeSession(base), true, T0), 'run')
  })

  it('error while the error event is unread', () => {
    const s = makeSession({ lastErrorAt: iso(T0), lastReadAt: iso(T0 - 1) })
    assert.equal(sessionLampClass(s, false, T0), 'error')
  })

  it('error falls back to legacy lastChatErrorAt when lastErrorAt is absent', () => {
    const s = makeSession({ lastChatErrorAt: iso(T0), lastReadAt: iso(T0 - 1) })
    assert.equal(sessionLampClass(s, false, T0), 'error')
    assert.equal(sessionLampTimes(s).errAt, T0)
  })

  it('error lingers for the 3s grace after being read, then goes out', () => {
    const s = makeSession({ lastErrorAt: iso(T0 - 10_000), lastReadAt: iso(T0) })
    assert.equal(sessionLampClass(s, false, T0 + SESSION_LAMP_ERROR_GRACE_MS - 1), 'error')
    assert.equal(sessionLampClass(s, false, T0 + SESSION_LAMP_ERROR_GRACE_MS), 'idle')
  })

  it('done while the completion event is unread (reply or job finish)', () => {
    const byReply = makeSession({ lastReplyAt: iso(T0), lastReadAt: iso(T0 - 1) })
    assert.equal(sessionLampClass(byReply, false, T0), 'done')
    const byJob = makeSession({ lastFinishedAt: iso(T0), lastReadAt: iso(T0 - 1) })
    assert.equal(sessionLampClass(byJob, false, T0), 'done')
  })

  it('done goes out immediately once read (no grace)', () => {
    const s = makeSession({ lastReplyAt: iso(T0), lastReadAt: iso(T0) })
    assert.equal(sessionLampClass(s, false, T0), 'idle')
  })

  it('done uses the newest of lastReplyAt / lastFinishedAt', () => {
    const s = makeSession({
      lastReplyAt: iso(T0 - 5_000),
      lastFinishedAt: iso(T0),
      lastReadAt: iso(T0 - 1_000),
    })
    assert.equal(sessionLampTimes(s).doneAt, T0)
    assert.equal(sessionLampClass(s, false, T0), 'done')
  })

  it('error outranks done when both are unread', () => {
    const s = makeSession({
      lastErrorAt: iso(T0 - 100),
      lastReplyAt: iso(T0),
      lastReadAt: iso(T0 - 10_000),
    })
    assert.equal(sessionLampClass(s, false, T0), 'error')
  })

  it('idle when there is nothing to report', () => {
    assert.equal(sessionLampClass(makeSession(), false, T0), 'idle')
  })

  it('tolerates missing/garbage timestamps', () => {
    const s = makeSession({ lastErrorAt: 'not-a-date', lastReadAt: undefined })
    assert.equal(sessionLampClass(s, false, T0), 'idle')
  })
})

describe('sessionHasUnreadLamp', () => {
  it('true when an error or done event is newer than the watermark', () => {
    assert.equal(
      sessionHasUnreadLamp(makeSession({ lastErrorAt: iso(T0), lastReadAt: iso(T0 - 1) })),
      true,
    )
    assert.equal(
      sessionHasUnreadLamp(makeSession({ lastFinishedAt: iso(T0), lastReadAt: iso(T0 - 1) })),
      true,
    )
  })

  it('false once everything is read (in-grace error does not count)', () => {
    const s = makeSession({ lastErrorAt: iso(T0), lastReplyAt: iso(T0), lastReadAt: iso(T0) })
    assert.equal(sessionHasUnreadLamp(s), false)
  })
})
