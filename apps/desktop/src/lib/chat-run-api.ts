import type {
  ChatRunAbortDecision,
  ChatRunAbortIntent,
  ChatRunStatus,
} from '@swarmdesk-agent/shared'
import { chatUrl, encodePathSegment, request } from './api'

export function getChatRunStatus(
  threadId: string,
  opts?: { clientRunId?: string; agentId?: string; signal?: AbortSignal },
): Promise<ChatRunStatus> {
  const query = new URLSearchParams()
  if (opts?.clientRunId) query.set('clientRunId', opts.clientRunId)
  const suffix = query.size > 0 ? `?${query.toString()}` : ''
  return request<ChatRunStatus>(
    `/chat/${encodePathSegment(opts?.agentId ?? 'swarmdesk-leader')}/${encodePathSegment(threadId)}/run${suffix}`,
    { signal: opts?.signal },
    false,
    10_000,
  )
}

export function chatRunStreamUrl(
  threadId: string,
  clientRunId: string,
  agentId = 'swarmdesk-leader',
): string {
  const query = new URLSearchParams({ clientRunId })
  return `${chatUrl(agentId)}/${encodePathSegment(threadId)}/stream?${query.toString()}`
}

/** A waiting result deliberately leaves the caller's termination barrier intact. */
export function abortChatRun(
  threadId: string,
  clientRunId: string,
  intent: ChatRunAbortIntent = 'stop',
  agentId = 'swarmdesk-leader',
): Promise<ChatRunAbortDecision> {
  return request<ChatRunAbortDecision>(
    `/chat/${encodePathSegment(agentId)}/${encodePathSegment(threadId)}/abort`,
    {
      method: 'POST',
      body: JSON.stringify({ clientRunId, intent }),
    },
    false,
    15_000,
  )
}
