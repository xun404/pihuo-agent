import { getLeaderSession } from './leader/leader-session-pool.js'

export async function compressSessionContext(input: { threadId: string }) {
  const session = getLeaderSession(input.threadId)
  if (!session) return null
  const result = await session.compact()
  if (!result) return null
  return {
    summary: result.summary,
    deletedMessageIds: [] as string[],
    keptRecent: 0,
    preCompactTokens: result.tokensBefore,
    postCompactTokens: result.estimatedTokensAfter ?? result.tokensBefore,
  }
}
