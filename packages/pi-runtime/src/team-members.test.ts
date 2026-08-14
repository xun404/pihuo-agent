import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assertTeamMemberModelAccepted } from './team-members.js'

test('role model validation skips inheritance and rejects an unavailable explicit override', () => {
  let calls = 0
  const evaluate = () => {
    calls += 1
    return { ok: false, errorCode: 'MODEL_UNAVAILABLE', error: 'not advertised' }
  }

  assert.doesNotThrow(() =>
    assertTeamMemberModelAccepted('worker-1', undefined, '/project', evaluate),
  )
  assert.equal(calls, 0)
  assert.throws(
    () => assertTeamMemberModelAccepted('worker-1', 'missing-model', '/project', evaluate),
    /MODEL_UNAVAILABLE: not advertised/u,
  )
  assert.equal(calls, 1)
})
