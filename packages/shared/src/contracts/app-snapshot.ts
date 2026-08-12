import type { ApprovalItem } from './approvals.js'
import type { WorkerJob } from './chat-jobs.js'
import type { Locale, Project, Session } from './session.js'
import type { TeamMember, TeamTemplate } from './team.js'
import type { WorkerRegistration } from './worker.js'

export interface AppSnapshot {
  projects: Project[]
  sessions: Session[]
  workers: WorkerRegistration[]
  teamMembers: TeamMember[]
  teamTemplates: TeamTemplate[]
  approvals: ApprovalItem[]
  /** Recent worker jobs (dispatch history + in-flight) */
  jobs?: WorkerJob[]
  activeProjectId: string | null
  activeSessionId: string | null
  /** UI locale preference persisted with app state */
  locale?: Locale
  /**
   * Monotonic revision for client race protection.
   * Clients should ignore snapshots with revision <= last applied.
   */
  revision?: number
}
