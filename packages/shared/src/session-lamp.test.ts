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
  it('applies approve > run > error > done priority with grace/unread rules', () => {
    assert.equal(SESSION_LAMP_ERROR_GRACE_MS, 3_000)
    assert.equal(SESSION_LAMP_ACTIVE_TTL_MS, 60_000)

    assert.equal(
      sessionLampClass(
        makeSession({
          status: 'needs_approval',
          lastErrorAt: iso(T0),
          lastReadAt: iso(T0 - 1_000),
        }),
        true,
        T0,
      ),
      'approve',
    )

    const unreadBase = {
      lastErrorAt: iso(T0 - 500),
      lastReplyAt: iso(T0 - 500),
      lastReadAt: iso(T0 - 10_000),
    }
    assert.equal(sessionLampClass(makeSession({ ...unreadBase, status: 'running' }), false, T0), 'run')
    assert.equal(sessionLampClass(makeSession(unreadBase), true, T0), 'run')

    assert.equal(
      sessionLampClass(makeSession({ lastErrorAt: iso(T0), lastReadAt: iso(T0 - 1) }), false, T0),
      'error',
    )
    const legacy = makeSession({ lastChatErrorAt: iso(T0), lastReadAt: iso(T0 - 1) })
    assert.equal(sessionLampClass(legacy, false, T0), 'error')
    assert.equal(sessionLampTimes(legacy).errAt, T0)

    const grace = makeSession({ lastErrorAt: iso(T0 - 10_000), lastReadAt: iso(T0) })
    assert.equal(sessionLampClass(grace, false, T0 + SESSION_LAMP_ERROR_GRACE_MS - 1), 'error')
    assert.equal(sessionLampClass(grace, false, T0 + SESSION_LAMP_ERROR_GRACE_MS), 'idle')

    assert.equal(
      sessionLampClass(makeSession({ lastReplyAt: iso(T0), lastReadAt: iso(T0 - 1) }), false, T0),
      'done',
    )
    assert.equal(
      sessionLampClass(makeSession({ lastFinishedAt: iso(T0), lastReadAt: iso(T0 - 1) }), false, T0),
      'done',
    )
    assert.equal(
      sessionLampClass(makeSession({ lastReplyAt: iso(T0), lastReadAt: iso(T0) }), false, T0),
      'idle',
    )

    const newestDone = makeSession({
      lastReplyAt: iso(T0 - 5_000),
      lastFinishedAt: iso(T0),
      lastReadAt: iso(T0 - 1_000),
    })
    assert.equal(sessionLampTimes(newestDone).doneAt, T0)
    assert.equal(sessionLampClass(newestDone, false, T0), 'done')

    assert.equal(
      sessionLampClass(
        makeSession({
          lastErrorAt: iso(T0 - 100),
          lastReplyAt: iso(T0),
          lastReadAt: iso(T0 - 10_000),
        }),
        false,
        T0,
      ),
      'error',
    )
    assert.equal(sessionLampClass(makeSession(), false, T0), 'idle')
    assert.equal(
      sessionLampClass(makeSession({ lastErrorAt: 'not-a-date', lastReadAt: undefined }), false, T0),
      'idle',
    )
  })
})

describe('sessionHasUnreadLamp', () => {
  it('tracks unread error/done versus read watermark', () => {
    assert.equal(
      sessionHasUnreadLamp(makeSession({ lastErrorAt: iso(T0), lastReadAt: iso(T0 - 1) })),
      true,
    )
    assert.equal(
      sessionHasUnreadLamp(makeSession({ lastFinishedAt: iso(T0), lastReadAt: iso(T0 - 1) })),
      true,
    )
    assert.equal(
      sessionHasUnreadLamp(
        makeSession({ lastErrorAt: iso(T0), lastReplyAt: iso(T0), lastReadAt: iso(T0) }),
      ),
      false,
    )
  })
})
