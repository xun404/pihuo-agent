import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildToolTerminalView,
  toolCommandFull,
  toolCommandPreview,
  toolOutputText,
  toolStructuredFields,
} from './tool-terminal-display'

test('toolCommandPreview collapses whitespace and prefers command-ish keys', () => {
  assert.equal(toolCommandPreview({ command: 'git  status\n --short' }), 'git status --short')
  assert.equal(toolCommandPreview({ cmd: 'ls -la' }), 'ls -la')
  assert.equal(toolCommandPreview({ path: '/tmp/x' }), '/tmp/x')
  assert.equal(toolCommandPreview('echo  hi'), 'echo hi')
  assert.equal(toolCommandPreview(null), '')
  assert.equal(toolCommandPreview({ args: ['a', 'b', 'c'] }), 'a b c')
})

test('toolCommandPreview falls back to a readable first field without JSON', () => {
  const out = toolCommandPreview({ foo: 'bar' })
  assert.equal(out, 'foo: bar')
  const long = toolCommandPreview({ data: 'x'.repeat(500) })
  assert.ok(long.length <= 160)
  assert.ok(long.endsWith('…'))
})

test('toolCommandFull preserves multi-line commands', () => {
  assert.equal(
    toolCommandFull({ command: 'git add -A\ngit commit -m "x"' }),
    'git add -A\ngit commit -m "x"',
  )
  assert.equal(toolCommandFull('  ls  '), 'ls')
})

test('toolOutputText prefers common text fields', () => {
  assert.equal(toolOutputText({ output: 'hello' }), 'hello')
  assert.equal(toolOutputText({ stdout: 'out', stderr: 'err' }), 'out')
  assert.equal(toolOutputText({ text: 't' }), 't')
  assert.equal(toolOutputText('plain'), 'plain')
  assert.equal(toolOutputText(null), '')
})

test('toolOutputText handles MCP-style content arrays', () => {
  const out = toolOutputText({
    content: [
      { type: 'text', text: 'line1' },
      { type: 'text', text: 'line2' },
    ],
  })
  assert.equal(out, 'line1\nline2')
})

test('toolOutputText leaves unknown records for structured display', () => {
  const out = toolOutputText({ weird: 1 })
  assert.equal(out, '')
})

test('toolStructuredFields builds readable one-level groups', () => {
  assert.deepEqual(
    toolStructuredFields({
      project: { name: 'tmp', rootPath: '/Users/xun/workspace/tmp' },
      ready: true,
      tags: ['one', 'two'],
    }),
    [
      {
        key: 'project',
        children: [
          { key: 'name', value: 'tmp' },
          { key: 'rootPath', value: '/Users/xun/workspace/tmp' },
        ],
      },
      { key: 'ready', value: 'true' },
      { key: 'tags', value: 'one, two' },
    ],
  )
  assert.deepEqual(toolStructuredFields({}), [])
})

test('buildToolTerminalView combines command/stdout/stderr', () => {
  const v = buildToolTerminalView({ command: 'mvn test' }, { output: 'BUILD SUCCESS' }, undefined)
  assert.deepEqual(v, {
    command: 'mvn test',
    stdout: 'BUILD SUCCESS',
    stderr: '',
    inputFields: [],
    outputFields: [],
  })

  const err = buildToolTerminalView({ command: 'x' }, null, 'boom')
  assert.equal(err.stderr, 'boom')
})
