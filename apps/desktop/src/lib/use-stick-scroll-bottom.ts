import { useLayoutEffect, useRef } from 'react'

/**
 * Keep an overflow container pinned to its bottom while `active`.
 * Used for streaming thinking / tool / worker bodies that scroll internally
 * so the live tail stays visible (mirrors chat followTail behavior).
 */
export function useStickScrollBottom(active: boolean, growthKey: string | number) {
  const ref = useRef<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    if (!active) return
    const el = ref.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [active, growthKey])
  return ref
}
