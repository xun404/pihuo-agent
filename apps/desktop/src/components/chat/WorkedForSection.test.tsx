import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { WorkedForSection } from './WorkedForSection.js'

;(globalThis as typeof globalThis & { React: typeof React }).React = React

describe('WorkedForSection', () => {
  it('renders collapsed summary with label and no body content', () => {
    const html = renderToStaticMarkup(
      <WorkedForSection open={false} onToggle={() => undefined} label="已处理 7m 53s">
        <div className="process-secret">hidden process</div>
      </WorkedForSection>,
    )
    assert.match(html, /class="worked-for"/u)
    assert.match(html, /已处理 7m 53s/u)
    assert.match(html, /aria-expanded="false"/u)
    assert.match(html, /worked-for-rule/u)
    assert.doesNotMatch(html, /process-secret/u)
  })

  it('renders body when expanded', () => {
    const html = renderToStaticMarkup(
      <WorkedForSection open onToggle={() => undefined} label="已处理 12s">
        <div className="process-visible">tool row</div>
      </WorkedForSection>,
    )
    assert.match(html, /class="worked-for is-open"/u)
    assert.match(html, /aria-expanded="true"/u)
    assert.match(html, /process-visible/u)
    assert.match(html, /tool row/u)
  })
})
