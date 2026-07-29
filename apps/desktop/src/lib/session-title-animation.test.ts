import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { shouldAnimateSessionTitleTransition } from './session-title-animation.js'

describe('shouldAnimateSessionTitleTransition', () => {
  it('animates only a placeholder-to-real-title update in the same session', () => {
    assert.equal(
      shouldAnimateSessionTitleTransition(
        { id: 'session-1', title: 'New session' },
        { id: 'session-1', title: 'Review ACP reasoning', titleSource: 'auto' },
      ),
      true,
    )
  })

  it('does not animate a user rename from the placeholder', () => {
    assert.equal(
      shouldAnimateSessionTitleTransition(
        { id: 'session-1', title: 'New session', titleSource: 'auto' },
        { id: 'session-1', title: 'My title', titleSource: 'user' },
      ),
      false,
    )
  })

  it('does not animate when navigating from an untitled session to an existing titled session', () => {
    assert.equal(
      shouldAnimateSessionTitleTransition(
        { id: 'session-1', title: 'New session' },
        { id: 'session-2', title: 'Existing title' },
      ),
      false,
    )
  })
})
