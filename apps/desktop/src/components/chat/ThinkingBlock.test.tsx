import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { ThinkingBlock } from './ThinkingBlock.js'

;(globalThis as typeof globalThis & { React: typeof React }).React = React

describe('ThinkingBlock summary', () => {
  it('shows live label while streaming and keeps body expanded hooks', () => {
    const html = renderToStaticMarkup(
      <ThinkingBlock
        text="step one"
        streaming
        open
        onToggle={() => undefined}
        streamingLabel="思考中"
        doneLabel="已思考"
        doneLabelFor={(time) => `已思考 ${time}`}
        locale="zh"
      />,
    )
    assert.match(html, /class="thinking-block live is-open"/u)
    assert.match(html, /思考中/u)
    assert.doesNotMatch(html, /已思考/u)
    assert.match(html, /thinking-block-body live/u)
  })

  it('collapses by default after complete and shows done label without body preview', () => {
    const html = renderToStaticMarkup(
      <ThinkingBlock
        text={'line one that would have been preview\nline two'}
        streaming={false}
        open={false}
        onToggle={() => undefined}
        streamingLabel="思考中"
        doneLabel="已思考"
        doneLabelFor={(time) => `已思考 ${time}`}
        locale="zh"
      />,
    )
    assert.match(html, /class="thinking-block"/u)
    assert.doesNotMatch(html, /is-open/u)
    assert.match(html, /已思考/u)
    // Collapsed: no preview of first reasoning line in the summary row
    assert.doesNotMatch(html, /line one that would have been preview/u)
  })

  it('renders expanded body when user re-opens a completed thought', () => {
    const html = renderToStaticMarkup(
      <ThinkingBlock
        text="full reasoning body"
        streaming={false}
        open
        onToggle={() => undefined}
        streamingLabel="思考中"
        doneLabel="已思考"
        doneLabelFor={(time) => `已思考 ${time}`}
        locale="zh"
      />,
    )
    assert.match(html, /is-open/u)
    assert.match(html, /full reasoning body/u)
  })
})
