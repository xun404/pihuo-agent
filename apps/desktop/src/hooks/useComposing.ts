import { useCallback, useRef } from 'react'

/**
 * Tracks whether the user is mid-IME composition (e.g. Chinese Pinyin).
 *
 * We cannot rely on `KeyboardEvent.isComposing` alone: under some Chromium /
 * Electron + IME combinations, the Enter that confirms an IME candidate fires
 * its `keydown` with `isComposing === false`, so relying on it would let that
 * same Enter also submit the message. Pair this ref with `isComposerSendKey`.
 *
 * We use a ref (not state) so the flag is updated synchronously between events
 * and never lags a React re-render. Attach `onCompositionStart` /
 * `onCompositionEnd` to the same element whose `onKeyDown` you guard, and pass
 * the returned `composing` getter into `isComposerSendKey(... , mode, composing)`.
 */
export function useComposing(): {
  composing: () => boolean
  onCompositionStart: () => void
  onCompositionEnd: () => void
} {
  const ref = useRef(false)
  const onCompositionStart = useCallback(() => {
    ref.current = true
  }, [])
  const onCompositionEnd = useCallback(() => {
    ref.current = false
  }, [])
  return { composing: () => ref.current, onCompositionStart, onCompositionEnd }
}
