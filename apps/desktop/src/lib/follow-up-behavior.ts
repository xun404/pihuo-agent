/**
 * Global preference for what a composer does while its thread has an active
 * leader run. Kept intentionally parallel to send-shortcut.ts so Settings and
 * all mounted ChatPanels observe one renderer-local change immediately.
 */

export type FollowUpBehavior = 'queue' | 'steer'

export const DEFAULT_FOLLOW_UP_BEHAVIOR: FollowUpBehavior = 'queue'
export const FOLLOW_UP_BEHAVIOR_STORAGE_KEY = 'swarmdesk-agent.followUpBehavior'
export const FOLLOW_UP_BEHAVIOR_EVENT = 'swarmdesk-agent:follow-up-behavior'

export function isFollowUpBehavior(value: unknown): value is FollowUpBehavior {
  return value === 'queue' || value === 'steer'
}

export function loadFollowUpBehavior(): FollowUpBehavior {
  try {
    const value = localStorage.getItem(FOLLOW_UP_BEHAVIOR_STORAGE_KEY)
    if (isFollowUpBehavior(value)) return value
  } catch {
    // Renderer storage can be unavailable in tests / privacy-restricted views.
  }
  return DEFAULT_FOLLOW_UP_BEHAVIOR
}

export function saveFollowUpBehavior(value: FollowUpBehavior): void {
  try {
    localStorage.setItem(FOLLOW_UP_BEHAVIOR_STORAGE_KEY, value)
  } catch {
    // A preference write must not prevent composing a message.
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(FOLLOW_UP_BEHAVIOR_EVENT, { detail: value }))
  }
}
