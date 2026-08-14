import { isPlaceholderSessionTitle } from '@pihuo-agent/shared'

export interface SessionTitleSnapshot {
  id: string
  title: string
  titleSource?: 'auto' | 'user'
}

export function shouldAnimateSessionTitleTransition(
  previous: SessionTitleSnapshot,
  next: SessionTitleSnapshot,
): boolean {
  return (
    previous.id === next.id &&
    next.titleSource !== 'user' &&
    isPlaceholderSessionTitle(previous.title) &&
    !isPlaceholderSessionTitle(next.title)
  )
}
