/**
 * Composer send-key preference (Settings → General).
 * - `enter`: Enter sends; Shift+Enter inserts a newline (default)
 * - `mod-enter`: ⌘/Ctrl+Enter sends; plain Enter inserts a newline (legacy)
 */

export type SendShortcut = 'enter' | 'mod-enter'

export const DEFAULT_SEND_SHORTCUT: SendShortcut = 'enter'

export const SEND_SHORTCUT_STORAGE_KEY = 'swarmdesk-agent.sendShortcut'
export const SEND_SHORTCUT_EVENT = 'swarmdesk-agent:send-shortcut'

export function isSendShortcut(value: unknown): value is SendShortcut {
  return value === 'enter' || value === 'mod-enter'
}

export function loadSendShortcut(): SendShortcut {
  try {
    const raw = localStorage.getItem(SEND_SHORTCUT_STORAGE_KEY)
    if (isSendShortcut(raw)) return raw
  } catch {
    /* localStorage unavailable */
  }
  return DEFAULT_SEND_SHORTCUT
}

export function saveSendShortcut(mode: SendShortcut): void {
  try {
    localStorage.setItem(SEND_SHORTCUT_STORAGE_KEY, mode)
  } catch {
    /* ignore */
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(SEND_SHORTCUT_EVENT, { detail: mode }))
  }
}

/**
 * True when this keyboard event should submit the composer.
 *
 * `composing` is the parent's own composition state (tracked from
 * `compositionstart`/`compositionend`). It is preferred over the event's
 * `isComposing` flag because Chromium's `isComposing` is unreliable for some
 * IMEs (notably Chinese Pinyin in Electron): the final Enter that confirms a
 * candidate can arrive with `isComposing === false`, which would both commit
 * the candidate AND fire send. We also fall back to `keyCode === 229` — the
 * long-standing signal that a key was swallowed by an IME.
 */
export function isComposerSendKey(
  event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'metaKey' | 'ctrlKey' | 'keyCode'> & {
    isComposing?: boolean
  },
  mode: SendShortcut = loadSendShortcut(),
  composing = false,
): boolean {
  if (event.key !== 'Enter') return false
  // Ignore Enter during IME composition (e.g. Chinese input method).
  if (composing || event.isComposing || event.keyCode === 229) return false
  if (mode === 'enter') {
    // Shift+Enter keeps newline; bare Enter sends.
    return !event.shiftKey
  }
  return event.metaKey || event.ctrlKey
}
