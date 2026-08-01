import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { MotionConfig } from 'framer-motion'
import {
  applyMotionDataset,
  getSystemPrefersReducedMotion,
  loadMotionPreference,
  MOTION_PREFERENCE_EVENT,
  MOTION_PREFERENCE_STORAGE_KEY,
  resolveReduceMotion,
  saveMotionPreference,
  type MotionPreference,
} from '../lib/motion-preference'

interface MotionPreferenceContextValue {
  /** User setting: system | on | off */
  preference: MotionPreference
  setPreference: (mode: MotionPreference) => void
  /** Resolved: true when animations should be minimized */
  reduceMotion: boolean
}

const MotionPreferenceContext = createContext<MotionPreferenceContextValue | null>(null)

interface Props {
  children: ReactNode
}

export function MotionPreferenceProvider({ children }: Props) {
  const [preference, setPreferenceState] = useState<MotionPreference>(() =>
    typeof window === 'undefined' ? 'system' : loadMotionPreference(),
  )
  const [systemReduce, setSystemReduce] = useState(() =>
    typeof window === 'undefined' ? false : getSystemPrefersReducedMotion(),
  )

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setSystemReduce(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    const onPref = (ev: Event) => {
      const detail = (ev as CustomEvent<MotionPreference>).detail
      if (detail === 'system' || detail === 'on' || detail === 'off') {
        setPreferenceState(detail)
      } else {
        setPreferenceState(loadMotionPreference())
      }
    }
    const onStorage = (ev: StorageEvent) => {
      if (ev.key === MOTION_PREFERENCE_STORAGE_KEY) {
        setPreferenceState(loadMotionPreference())
      }
    }
    window.addEventListener(MOTION_PREFERENCE_EVENT, onPref)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(MOTION_PREFERENCE_EVENT, onPref)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  const reduceMotion = resolveReduceMotion(preference, systemReduce)

  useLayoutEffect(() => {
    applyMotionDataset(reduceMotion)
  }, [reduceMotion])

  const setPreference = useCallback((mode: MotionPreference) => {
    saveMotionPreference(mode)
    setPreferenceState(mode)
    // Apply CSS hook in the same turn so "off" kills motion before next paint.
    applyMotionDataset(resolveReduceMotion(mode, getSystemPrefersReducedMotion()))
  }, [])

  const value = useMemo(
    () => ({ preference, setPreference, reduceMotion }),
    [preference, setPreference, reduceMotion],
  )

  // Framer notes:
  // - reducedMotion "always" only skips *positional* keys (x/y/scale); opacity still runs.
  // - skipAnimations + transition duration 0 is required for a real "off" that feels instant.
  // - When "on", explicitly pass skipAnimations={false} and a non-zero default transition so
  //   toggling off→on does not leave a stuck duration:0 from the previous config merge.
  // - useReducedMotion() only reads the OS and ignores MotionConfig — use this context instead.
  const framerReduced = preference === 'off' ? 'always' : preference === 'on' ? 'never' : 'user'

  return (
    <MotionPreferenceContext.Provider value={value}>
      <MotionConfig
        reducedMotion={framerReduced}
        skipAnimations={reduceMotion}
        transition={reduceMotion ? { duration: 0 } : { duration: 0.2 }}
      >
        {children}
      </MotionConfig>
    </MotionPreferenceContext.Provider>
  )
}

export function useMotionPreference(): MotionPreferenceContextValue {
  const ctx = useContext(MotionPreferenceContext)
  if (!ctx) {
    throw new Error('useMotionPreference must be used within MotionPreferenceProvider')
  }
  return ctx
}
