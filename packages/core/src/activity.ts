import { createId } from './id.js'

export type ActivityKind =
  'system' | 'project' | 'session' | 'worker' | 'dispatch' | 'job' | 'approval' | 'chat'

export interface ActivityEvent {
  id: string
  at: string
  kind: ActivityKind
  message: string
  meta?: Record<string, unknown>
}

/**
 * In-memory ring buffer of recent activity for the Activity panel.
 */
export class ActivityLog {
  private events: ActivityEvent[] = []
  private max: number

  constructor(max = 200) {
    this.max = max
  }

  append(kind: ActivityKind, message: string, meta?: Record<string, unknown>): ActivityEvent {
    const event: ActivityEvent = {
      id: createId('act'),
      at: new Date().toISOString(),
      kind,
      message,
      meta,
    }
    this.events.unshift(event)
    if (this.events.length > this.max) {
      this.events.length = this.max
    }
    return event
  }

  list(limit = 50): ActivityEvent[] {
    return this.events.slice(0, limit)
  }

  clear(): void {
    this.events = []
  }
}

/** Process-wide activity feed used by API + desktop */
export const globalActivityLog = new ActivityLog()
