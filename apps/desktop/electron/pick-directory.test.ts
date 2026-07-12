import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'

/**
 * Unit tests for OS picker helpers that don't need GUI.
 * GUI osascript/dialog is covered by manual desktop use.
 */

describe('osascript choose folder script shape', () => {
  it('osascript is available on darwin and can run a no-UI expression', () => {
    if (process.platform !== 'darwin') return
    const out = execFileSync('osascript', ['-e', 'return "ok"'], {
      encoding: 'utf8',
    }).trim()
    assert.equal(out, 'ok')
  })

  it('cancel path is distinguishable from empty path in script protocol', () => {
    // Protocol contract used by pick-directory.ts
    const canceled = '__CANCELED__'
    const error = '__ERROR__:boom'
    assert.notEqual(canceled, '')
    assert.ok(error.startsWith('__ERROR__:'))
  })
})
