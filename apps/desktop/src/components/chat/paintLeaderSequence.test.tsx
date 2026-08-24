import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  isLeaderTextNode,
  paintLeaderSequence,
  partitionTrailingBubbles,
} from './paintLeaderSequence.js'

;(globalThis as typeof globalThis & { React: typeof React }).React = React

describe('paintLeaderSequence', () => {
  it('wraps adjacent text nodes in one bubble without concatenating strings', () => {
    const markup = renderToStaticMarkup(
      <>
        {paintLeaderSequence([
          <div className="sup-text md-content" key="a">
            first
          </div>,
          <div className="sup-text md-content" key="b">
            second
          </div>,
        ])}
      </>,
    )
    assert.equal((markup.match(/class="bubble"/g) ?? []).length, 1)
    assert.match(markup, /class="bubble"[^>]*>[\s\S]*first[\s\S]*second/u)
    assert.match(markup, /class="sup-text md-content"[^>]*>first</u)
    assert.match(markup, /class="sup-text md-content"[^>]*>second</u)
  })

  it('keeps tools outside bubbles and splits text around them', () => {
    const markup = renderToStaticMarkup(
      <>
        {paintLeaderSequence([
          <div className="sup-text md-content" key="a">
            先确认任务边界。
          </div>,
          <div className="chat-tool-worker-stack" key="t">
            bash
          </div>,
          <div className="sup-text md-content" key="b">
            接着等待 Worker 返回。
          </div>,
        ])}
      </>,
    )
    assert.equal((markup.match(/class="bubble"/g) ?? []).length, 2)
    assert.match(
      markup,
      /<\/div><div class="chat-tool-worker-stack">bash<\/div><div class="bubble">/u,
    )
    assert.ok(
      markup.indexOf('先确认任务边界。') < markup.indexOf('bash') &&
        markup.indexOf('bash') < markup.indexOf('接着等待 Worker 返回。'),
    )
  })

  it('places pending dots in their own bubble after flushing text', () => {
    const markup = renderToStaticMarkup(
      <>
        {paintLeaderSequence(
          [
            <div className="thinking-block" key="r">
              thinking
            </div>,
          ],
          <div className="msg-pending">...</div>,
        )}
      </>,
    )
    assert.match(markup, /thinking[\s\S]*class="bubble"[^>]*>[\s\S]*msg-pending/u)
    assert.doesNotMatch(markup, /class="bubble"[^>]*>[\s\S]*thinking/u)
  })

  it('does not treat worker cards as text', () => {
    assert.equal(isLeaderTextNode(<div className="worker-run">card</div>), false)
    assert.equal(isLeaderTextNode(<div className="sup-text">hi</div>), true)
  })

  it('peels trailing bubbles away from process siblings', () => {
    const painted = paintLeaderSequence([
      <div className="thinking-block" key="r">
        thinking
      </div>,
      <div className="sup-text md-content" key="a">
        hi
      </div>,
    ])
    const { head, bubbles } = partitionTrailingBubbles(painted)
    assert.equal(head.length, 1)
    assert.equal(bubbles.length, 1)
  })
})
