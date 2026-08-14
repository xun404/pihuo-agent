import { useCallback, useMemo, useSyncExternalStore } from 'react'
import type { FollowUpRequestMeta, LeaderThinkingIntensity, LeaderWorkMode } from '@pihuo-agent/shared'
import { LeaderChatStore } from '../lib/leader-chat-store'

const stores = new Map<string, LeaderChatStore>()

export function getLeaderChatStore(threadId: string): LeaderChatStore {
  const existing = stores.get(threadId)
  if (existing) return existing
  const created = new LeaderChatStore(threadId)
  stores.set(threadId, created)
  return created
}

export function useLeaderChat(threadId: string) {
  const store = useMemo(() => getLeaderChatStore(threadId), [threadId])
  const snapshot = useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store,
    () => store,
  )
  const send = useCallback(
    (input: {
      text: string
      followUp: FollowUpRequestMeta
      model: string
      thinking?: LeaderThinkingIntensity
      workMode?: LeaderWorkMode
      onAccepted?: (followUp: FollowUpRequestMeta) => void
    }) => store.send(input),
    [store],
  )
  return {
    store,
    messages: snapshot.viewMessages,
    rawMessages: snapshot.messages,
    status: snapshot.status,
    error: snapshot.error,
    send,
    stop: () => store.stop(),
    setMessages: (messages: Parameters<LeaderChatStore['setMessages']>[0]) =>
      store.setMessages(messages),
    clearError: () => store.clearError(),
    resume: (clientRunId: string) => store.resume(clientRunId),
  }
}
