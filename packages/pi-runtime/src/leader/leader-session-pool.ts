import { unlinkSync } from 'node:fs'
import type { AgentSession } from '@earendil-works/pi-coding-agent'
import type { LeaderThinkingIntensity, LeaderWorkMode } from '@pihuo-agent/shared'
import {
  createLeaderSession,
  leaderSessionPath,
  type CreateLeaderSessionInput,
  type LeaderSessionHandle,
} from './create-leader-session.js'
import type { LeaderRunContext } from './tool-context.js'

const handles = new Map<string, LeaderSessionHandle>()

export async function getOrCreateLeaderSession(
  input: CreateLeaderSessionInput,
): Promise<LeaderSessionHandle> {
  const existing = handles.get(input.threadId)
  if (existing) {
    if (input.modelId && existing.modelId !== input.modelId) {
      const resolved = await import('./leader-model.js').then((mod) =>
        mod.resolveLeaderPiModel(input.modelId),
      )
      await existing.session.setModel(resolved.model)
      existing.modelId = resolved.modelId
    }
    if (input.thinking) existing.session.setThinkingLevel(input.thinking)
    if (input.workMode && input.workMode !== existing.workMode) {
      await disposeLeaderSession(input.threadId)
      const created = await createLeaderSession(input)
      handles.set(input.threadId, created)
      return created
    }
    return existing
  }
  const created = await createLeaderSession(input)
  handles.set(input.threadId, created)
  return created
}

export function getLeaderSession(threadId: string): AgentSession | undefined {
  return handles.get(threadId)?.session
}

export async function disposeLeaderSession(threadId: string): Promise<void> {
  const handle = handles.get(threadId)
  if (!handle) return
  handles.delete(threadId)
  handle.session.dispose()
}

export function deleteLeaderSessionFile(threadId: string): void {
  try {
    unlinkSync(leaderSessionPath(threadId))
  } catch {
    /* missing is fine */
  }
}

export async function disposeAndDeleteLeaderSession(threadId: string): Promise<void> {
  await disposeLeaderSession(threadId)
  deleteLeaderSessionFile(threadId)
}

export function buildRunContext(
  input: Omit<LeaderRunContext, 'writer'> & { writer?: LeaderRunContext['writer'] },
): LeaderRunContext {
  return input
}

export type { LeaderWorkMode, LeaderThinkingIntensity }
