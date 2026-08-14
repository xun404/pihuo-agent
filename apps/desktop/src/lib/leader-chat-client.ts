import type {
  FollowUpRequestMeta,
  LeaderChatEvent,
  LeaderChatStartBody,
  LeaderThinkingIntensity,
  LeaderWorkMode,
} from '@pihuo-agent/shared'
import { chatRunStreamUrl } from './chat-run-api'
import { clearDesktopToken, ensureDesktopToken } from './api'

export type LeaderChatSendInput = {
  threadId: string
  text: string
  followUp: FollowUpRequestMeta
  model: string
  thinking?: LeaderThinkingIntensity
  workMode?: LeaderWorkMode
  signal?: AbortSignal
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await ensureDesktopToken()
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (token) {
    headers.Authorization = `Bearer ${token}`
    headers['X-PiHuo-Agent-Desktop-Token'] = token
  }
  return headers
}

export function leaderChatUrl(threadId: string): string {
  return `/chat/leader/${encodeURIComponent(threadId)}`
}

export async function startLeaderChatRequest(
  input: LeaderChatSendInput,
): Promise<Response> {
  const headers = await authHeaders()
  const body: LeaderChatStartBody = {
    text: input.text,
    followUp: input.followUp,
    model: input.model,
    ...(input.thinking ? { thinking: input.thinking } : {}),
    ...(input.workMode ? { workMode: input.workMode } : {}),
  }
  let response = await fetch(absoluteUrl(leaderChatUrl(input.threadId)), {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: input.signal,
  })
  if (response.status === 401) {
    clearDesktopToken()
    const retryHeaders = await authHeaders()
    response = await fetch(absoluteUrl(leaderChatUrl(input.threadId)), {
      method: 'POST',
      headers: retryHeaders,
      body: JSON.stringify(body),
      signal: input.signal,
    })
  }
  return response
}

export async function resumeLeaderChatRequest(
  threadId: string,
  clientRunId: string,
): Promise<Response> {
  const headers = await authHeaders()
  return fetch(absoluteUrl(chatRunStreamUrl(threadId, clientRunId, 'leader')), { headers })
}

export async function* readLeaderChatSse(
  response: Response,
): AsyncGenerator<LeaderChatEvent> {
  if (!response.body) return
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const chunks = buffer.split('\n\n')
    buffer = chunks.pop() ?? ''
    for (const chunk of chunks) {
      const line = chunk
        .split('\n')
        .map((item) => item.trim())
        .find((item) => item.startsWith('data:'))
      if (!line) continue
      const data = line.slice(5).trim()
      if (!data || data === '[DONE]') continue
      try {
        yield JSON.parse(data) as LeaderChatEvent
      } catch {
        /* ignore malformed */
      }
    }
  }
}

function absoluteUrl(path: string): string {
  if (path.startsWith('http')) return path
  const base =
    (typeof window !== 'undefined' && window.routerAgents?.apiBase) ||
    import.meta.env?.VITE_API_URL ||
    import.meta.env?.VITE_MASTRA_URL ||
    'http://127.0.0.1:4111'
  return `${base}${path}`
}
