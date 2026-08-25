import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ImActivityQuote } from './ImActivityQuote.js'

;(globalThis as typeof globalThis & { React: typeof React }).React = React

describe('ImActivityQuote', () => {
  it('stays collapsed and does not render process details by default', () => {
    const html = renderToStaticMarkup(
      <ImActivityQuote label="已思考 · 2 个工具">
        <div className="thinking-block is-open">secret reasoning chain</div>
      </ImActivityQuote>,
    )
    assert.match(html, /im-activity-quote/u)
    assert.match(html, /已思考 · 2 个工具/u)
    assert.doesNotMatch(html, /im-activity-detail/u)
    assert.doesNotMatch(html, /secret reasoning chain/u)
    assert.doesNotMatch(html, /is-open/u)
  })
})
