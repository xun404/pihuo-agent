import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { failReasonFromOpenDirectoryResult, pathFromOpenDirectoryResult } from './native-dialogs.js'

describe('pathFromOpenDirectoryResult', () => {
  it('returns null for empty / canceled', () => {
    assert.equal(pathFromOpenDirectoryResult(null), null)
    assert.equal(pathFromOpenDirectoryResult(undefined), null)
    assert.equal(pathFromOpenDirectoryResult(''), null)
    assert.equal(pathFromOpenDirectoryResult('   '), null)
    assert.equal(pathFromOpenDirectoryResult([]), null)
    assert.equal(pathFromOpenDirectoryResult({ filePaths: [] }), null)
    assert.equal(pathFromOpenDirectoryResult({ ok: false, reason: 'canceled_or_empty' }), null)
  })

  it('accepts plain string paths from dialog IPC', () => {
    assert.equal(pathFromOpenDirectoryResult('/Users/me/proj'), '/Users/me/proj')
    assert.equal(pathFromOpenDirectoryResult('  /tmp/foo  '), '/tmp/foo')
  })

  it('accepts structured { ok: true, path } from main process', () => {
    assert.equal(
      pathFromOpenDirectoryResult({ ok: true, path: '/Users/me/pihuo-agent' }),
      '/Users/me/pihuo-agent',
    )
  })

  it('accepts filePaths array (Electron OpenDialogReturnValue shape)', () => {
    assert.equal(
      pathFromOpenDirectoryResult({ canceled: false, filePaths: ['/Users/me/app'] }),
      '/Users/me/app',
    )
    assert.equal(pathFromOpenDirectoryResult(['/a', '/b']), '/a')
  })

  it('accepts path / filePath fields', () => {
    assert.equal(pathFromOpenDirectoryResult({ path: '/x/y' }), '/x/y')
    assert.equal(pathFromOpenDirectoryResult({ filePath: '/z' }), '/z')
  })
})

describe('failReasonFromOpenDirectoryResult', () => {
  it('reads reason from structured failure', () => {
    assert.equal(
      failReasonFromOpenDirectoryResult({ ok: false, reason: 'canceled_or_empty' }),
      'canceled_or_empty',
    )
  })
})
