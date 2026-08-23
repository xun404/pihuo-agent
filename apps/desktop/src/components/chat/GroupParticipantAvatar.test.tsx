import React from 'react'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { DiscussionSpeakerAvatar } from './GroupParticipantAvatar.js'

describe('DiscussionSpeakerAvatar', () => {
  it('keeps Leader and user icons separate from the Worker execution badge', () => {
    const leader = renderToStaticMarkup(
      <DiscussionSpeakerAvatar participant="leader" title="Leader" />,
    )
    const user = renderToStaticMarkup(<DiscussionSpeakerAvatar participant="user" title="You" />)
    const worker = renderToStaticMarkup(
      <DiscussionSpeakerAvatar
        participant="worker"
        role="review"
        title="Quality review"
        worker={{ kind: 'codex', name: 'Codex CLI' }}
      />,
    )

    assert.match(leader, /data-discussion-speaker="leader"/u)
    assert.doesNotMatch(leader, /discussion-message-agent-badge/u)
    assert.match(user, /data-discussion-speaker="user"/u)
    assert.doesNotMatch(user, /discussion-message-agent-badge/u)
    assert.match(worker, /data-discussion-speaker="worker"/u)
    assert.match(worker, /data-role="review"/u)
    assert.match(worker, /discussion-message-agent-badge/u)
    assert.match(worker, /data-agent-kind="codex"/u)
  })
})
