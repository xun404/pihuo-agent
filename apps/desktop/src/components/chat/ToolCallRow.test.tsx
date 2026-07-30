import React from 'react'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { ToolCallRow } from './ToolCallRow.js'

(globalThis as typeof globalThis & { React: typeof React }).React = React

function render(
  overrides: Partial<React.ComponentProps<typeof ToolCallRow>> = {},
): string {
  return renderToStaticMarkup(
    <ToolCallRow
      name="getActiveContextTool"
      input={{}}
      output={{
        project: { id: 'proj_tmp', name: 'tmp', rootPath: '/Users/xun/workspace/tmp' },
        session: { id: 'sess_tmp', title: 'New session', status: 'running' },
      }}
      durationSec={0.4}
      running={false}
      open
      onToggle={() => {}}
      errorLabel="Error"
      {...overrides}
    />,
  )
}

describe('ToolCallRow expanded content', () => {
  it('renders object output as readable fields without exposing JSON syntax', () => {
    const html = render()

    assert.doesNotMatch(html, /tool-row-block-input/u)
    assert.match(html, /tool-field-group/u)
    assert.match(html, />project</u)
    assert.match(html, />session</u)
    assert.match(html, /tool-field-key[^>]*>rootPath</u)
    assert.match(html, /rootPath/u)
    assert.match(html, /\/Users\/xun\/workspace\/tmp/u)
    assert.doesNotMatch(html, /&quot;project&quot;/u)
    assert.doesNotMatch(html, /<pre[^>]*>\s*\{/u)
    assert.match(html, /tool-row-status is-success/u)
    assert.match(html, />✓<\/span><span>done<\/span>/u)
  })

  it('keeps command input and plain text output in compact text blocks', () => {
    const html = render({ input: { command: 'pwd' }, output: { stdout: '/tmp' } })

    assert.match(html, /tool-row-block tool-row-block-input/u)
    assert.match(html, />pwd<\/pre>/u)
    assert.match(html, /tool-row-block tool-row-block-output/u)
    assert.match(html, />\/tmp<\/pre>/u)
  })

  it('renders an error block without a success status', () => {
    const html = render({ output: undefined, errorText: 'permission denied' })

    assert.match(html, /tool-row-block tool-row-block-error/u)
    assert.match(html, /permission denied/u)
    assert.doesNotMatch(html, /tool-row-status is-success/u)
  })

  it('does not expose disclosure behavior without any detail', () => {
    const html = render({ input: undefined, output: undefined, open: false })

    assert.doesNotMatch(html, /role="button"/u)
    assert.doesNotMatch(html, /aria-expanded/u)
    assert.doesNotMatch(html, /tool-row-collapse/u)
  })
})
