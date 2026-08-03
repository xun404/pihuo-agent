import type { DangerZoneAction } from '../lib/api'

export interface DangerZoneStats {
  projects: number
  workers: number
  workerSessions: number
  crews: number
  chatSessions: number
}

export type DangerImpactId =
  | 'settings-basic'
  | 'settings-prompts'
  | 'settings-models-keys'
  | 'workers'
  | 'workerSessions'
  | 'crews'
  | 'chatSessions'
  | 'projects'
  | 'cache'

/** The only entities/categories each action can affect. */
export const DANGER_ACTION_IMPACT_IDS: Record<DangerZoneAction, readonly DangerImpactId[]> = {
  'reset-settings': ['settings-basic', 'settings-prompts', 'settings-models-keys'],
  'clear-workers-and-crews': ['workers', 'workerSessions', 'crews'],
  'clear-sessions': ['chatSessions', 'workerSessions'],
  'clear-cache': ['cache'],
  'reset-all': [
    'settings-basic',
    'settings-prompts',
    'settings-models-keys',
    'workers',
    'workerSessions',
    'crews',
    'chatSessions',
    'projects',
    'cache',
  ],
}

export const DANGER_IMPACT_STAT_KEYS: Partial<Record<DangerImpactId, keyof DangerZoneStats>> = {
  workers: 'workers',
  workerSessions: 'workerSessions',
  crews: 'crews',
  chatSessions: 'chatSessions',
  projects: 'projects',
}

export type DangerZoneToggleIntent = 'close' | 'warn'

/** Every expansion from the collapsed state must show the risk warning first. */
export function resolveDangerZoneToggleIntent(open: boolean): DangerZoneToggleIntent {
  if (open) return 'close'
  return 'warn'
}

/** Leave the danger zone collapsed whenever the user navigates away from General. */
export function shouldCollapseDangerZoneForTab(tab: string): boolean {
  return tab !== 'general'
}
