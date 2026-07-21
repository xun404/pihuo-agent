import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isComposerSendKey, isSendShortcut } from './send-shortcut.js'

describe('send-shortcut', () => {
  it('accepts known modes only', () => {
    assert.equal(isSendShortcut('enter'), true)
    assert.equal(isSendShortcut('mod-enter'), true)
    assert.equal(isSendShortcut('tab'), false)
  })

  it('enter mode: bare Enter sends, Shift+Enter does not', () => {
    assert.equal(
      isComposerSendKey({ key: 'Enter', shiftKey: false, metaKey: false, ctrlKey: false }, 'enter'),
      true,
    )
    assert.equal(
      isComposerSendKey({ key: 'Enter', shiftKey: true, metaKey: false, ctrlKey: false }, 'enter'),
      false,
    )
  })

  it('mod-enter mode: only ⌘/Ctrl+Enter sends', () => {
    assert.equal(
      isComposerSendKey(
        { key: 'Enter', shiftKey: false, metaKey: false, ctrlKey: false },
        'mod-enter',
      ),
      false,
    )
    assert.equal(
      isComposerSendKey(
        { key: 'Enter', shiftKey: false, metaKey: true, ctrlKey: false },
        'mod-enter',
      ),
      true,
    )
    assert.equal(
      isComposerSendKey(
        { key: 'Enter', shiftKey: false, metaKey: false, ctrlKey: true },
        'mod-enter',
      ),
      true,
    )
  })
})
