import { useCallback, useEffect, useState } from 'react'
import {
  FOLLOW_UP_BEHAVIOR_EVENT,
  FOLLOW_UP_BEHAVIOR_STORAGE_KEY,
  loadFollowUpBehavior,
  saveFollowUpBehavior,
  type FollowUpBehavior,
} from '../lib/follow-up-behavior'

/** Reactive global follow-up behavior shared by Settings and every ChatPanel. */
export function useFollowUpBehavior() {
  const [followUpBehavior, setFollowUpBehaviorState] = useState<FollowUpBehavior>(() =>
    typeof window === 'undefined' ? 'queue' : loadFollowUpBehavior(),
  )

  useEffect(() => {
    const onChange = (event: Event) => {
      const value = (event as CustomEvent<FollowUpBehavior>).detail
      setFollowUpBehaviorState(
        value === 'queue' || value === 'steer' ? value : loadFollowUpBehavior(),
      )
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key === FOLLOW_UP_BEHAVIOR_STORAGE_KEY) {
        setFollowUpBehaviorState(loadFollowUpBehavior())
      }
    }
    window.addEventListener(FOLLOW_UP_BEHAVIOR_EVENT, onChange)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(FOLLOW_UP_BEHAVIOR_EVENT, onChange)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  const setFollowUpBehavior = useCallback((value: FollowUpBehavior) => {
    saveFollowUpBehavior(value)
    setFollowUpBehaviorState(value)
  }, [])

  return { followUpBehavior, setFollowUpBehavior }
}
