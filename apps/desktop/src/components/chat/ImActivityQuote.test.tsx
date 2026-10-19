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
    assert.match(html, /aria-expanded="false"/u)
    assert.match(html, /已思考 · 2 个工具/u)
    assert.doesNotMatch(html, /im-activity-detail/u)
    assert.doesNotMatch(html, /secret reasoning chain/u)
    assert.doesNotMatch(html, /is-open/u)
  })

  it('shows only the latest three activity rows while running', () => {
    const html = renderToStaticMarkup(
      <ImActivityQuote label="Activity" running earlierLabel={(count) => `${count} earlier`}>
        {[1, 2, 3, 4, 5].map((index) => (
          <div key={index}>record-{index}</div>
        ))}
      </ImActivityQuote>,
    )
    assert.match(html, /2 earlier/u)
    assert.doesNotMatch(html, /record-1|record-2/u)
    assert.match(html, /record-3[\s\S]*record-4[\s\S]*record-5/u)
    assert.match(html, /aria-expanded="false"/u)
    assert.match(html, /aria-hidden="false"/u)
  })

  it('keeps a manually expanded completed trail open with every row', () => {
    const html = renderToStaticMarkup(
      <ImActivityQuote label="Activity" open>
        {[1, 2, 3, 4, 5].map((index) => (
          <div key={index}>record-{index}</div>
        ))}
      </ImActivityQuote>,
    )
    assert.match(html, /record-1[\s\S]*record-5/u)
    assert.match(html, /aria-expanded="true"/u)
    assert.match(html, /aria-controls="[^"]+"/u)
  })
})
