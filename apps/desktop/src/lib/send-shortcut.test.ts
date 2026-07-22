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

  it('ignores Enter during IME composition (the regression guard)', () => {
    const enter = { key: 'Enter', shiftKey: false, metaKey: false, ctrlKey: false, keyCode: 13 }
    // Parent reports active composition (compositionstart fired, no end yet).
    assert.equal(isComposerSendKey(enter, 'enter', true), false)
    // Event's own isComposing flag set (some browsers report it correctly).
    assert.equal(isComposerSendKey({ ...enter, isComposing: true }, 'enter', false), false)
    // keyCode 229 fallback: key swallowed by IME.
    assert.equal(isComposerSendKey({ ...enter, keyCode: 229 }, 'enter', false), false)
  })

  it('still sends on bare Enter after composition has ended', () => {
    const enter = { key: 'Enter', shiftKey: false, metaKey: false, ctrlKey: false, keyCode: 13 }
    assert.equal(isComposerSendKey(enter, 'enter', false), true)
  })
})
