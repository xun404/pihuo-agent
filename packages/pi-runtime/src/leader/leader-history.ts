import { existsSync } from 'node:fs'
import { SessionManager, sessionEntryToContextMessages } from '@earendil-works/pi-coding-agent'
import type { LeaderChatMessage } from '@pihuo-agent/shared'
import { snapshotLeaderMessages } from './pi-messages.js'
import { getLeaderSession } from './leader-session-pool.js'
import { leaderSessionPath } from './create-leader-session.js'

export function loadLeaderHistory(threadId: string): LeaderChatMessage[] {
  const live = getLeaderSession(threadId)
  if (live) return snapshotLeaderMessages(live.messages)
  const path = leaderSessionPath(threadId)
  if (!existsSync(path)) return []
  const manager = SessionManager.open(path)
  const entries = manager.buildContextEntries()
  const messages = entries.flatMap((entry) => sessionEntryToContextMessages(entry))
  return snapshotLeaderMessages(messages)
}
