import { useCallback, useEffect, useState } from 'react'
import {
  loadSendShortcut,
  saveSendShortcut,
  SEND_SHORTCUT_EVENT,
  type SendShortcut,
} from '../lib/send-shortcut'

/** Reactive send-key preference shared across Settings and composers. */
export function useSendShortcut() {
  const [sendShortcut, setSendShortcutState] = useState<SendShortcut>(() =>
    typeof window === 'undefined' ? 'enter' : loadSendShortcut(),
  )

  useEffect(() => {
    const onChange = (ev: Event) => {
      const detail = (ev as CustomEvent<SendShortcut>).detail
      if (detail === 'enter' || detail === 'mod-enter') setSendShortcutState(detail)
      else setSendShortcutState(loadSendShortcut())
    }
    const onStorage = (ev: StorageEvent) => {
      if (ev.key === 'swarmdesk-agent.sendShortcut') setSendShortcutState(loadSendShortcut())
    }
    window.addEventListener(SEND_SHORTCUT_EVENT, onChange)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(SEND_SHORTCUT_EVENT, onChange)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  const setSendShortcut = useCallback((mode: SendShortcut) => {
    saveSendShortcut(mode)
    setSendShortcutState(mode)
  }, [])

  return { sendShortcut, setSendShortcut }
}
