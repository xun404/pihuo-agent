import type { MutableRefObject } from 'react'
import { DefaultChatTransport } from 'ai'
import type { LeaderMode, Project, Session } from '@swarmdesk-agent/shared'
import type { PendingNewSession } from '../../hooks/useAppState'
import { chatRunStreamUrl } from '../../lib/chat-run-api'
import { chatUrl, clearDesktopToken, ensureDesktopToken } from '../../lib/api'
import { CoordinatedChatTransport } from '../../lib/coordinated-chat-transport'
import type { FollowUpCoordinator } from '../../lib/follow-up-coordinator'
import type { ThinkingIntensity } from '../../lib/settings'
import { enrichLastUserMessageForWire } from '../../lib/user-message-display'

type CreateSession = (
  title: string | undefined,
  mode?: LeaderMode,
  explicitProjectId?: string,
  memoryThreadId?: string,
) => Promise<Session>

type LeaderChatTransportOptions = {
  threadId: string
  resourceId: string
  projectRef: MutableRefObject<Project | null>
  sessionRef: MutableRefObject<Session>
  pendingNewSessionRef: MutableRefObject<PendingNewSession | null | undefined>
  createSessionRef: MutableRefObject<CreateSession | undefined>
  clearPendingSessionRef: MutableRefObject<(() => void) | undefined>
  selectedModelRef: MutableRefObject<string>
  thinkingIntensityRef: MutableRefObject<ThinkingIntensity>
  localeRef: MutableRefObject<string>
  coordinatorRef: MutableRefObject<FollowUpCoordinator | null>
}

/**
 * Builds the token-aware leader transport while keeping ChatPanel focused on
 * UI binding. Mutable refs intentionally keep a live session/model context
 * without rebuilding the transport during every composer update.
 */
export function createLeaderChatTransport(options: LeaderChatTransportOptions) {
  const inner = new DefaultChatTransport({
    api: chatUrl('swarmdesk-leader'),
    prepareSendMessagesRequest: async ({ messages, body }) => {
      const last = messages[messages.length - 1]
      const project = options.projectRef.current
      let session = options.sessionRef.current
      const pending = options.pendingNewSessionRef.current
      const createSession = options.createSessionRef.current
      const clearPendingSession = options.clearPendingSessionRef.current

      if (pending && createSession) {
        try {
          const created = await createSession(
            undefined,
            pending.mode,
            pending.projectId,
            pending.memoryThreadId,
          )
          session = created
          options.sessionRef.current = created
          clearPendingSession?.()
        } catch (error) {
          console.error('[ChatPanel] lazy session creation failed', error)
          throw error
        }
      }

      const wireLast = enrichLastUserMessageForWire(last as never, {
        locale: options.localeRef.current,
        mode: 'build',
        projectName: project?.name,
        projectPath: project?.rootPath,
        sessionTitle: session?.title,
        model: options.selectedModelRef.current || undefined,
        thinking: options.thinkingIntensityRef.current,
      })
      const token = await ensureDesktopToken()
      const headers: Record<string, string> = {}
      if (token) {
        headers.Authorization = `Bearer ${token}`
        headers['X-SwarmDesk-Agent-Desktop-Token'] = token
      }
      return {
        headers,
        body: {
          ...body,
          messages: wireLast ? [wireLast] : [],
          memory: {
            thread: options.threadId,
            resource: options.resourceId,
          },
          model: options.selectedModelRef.current || undefined,
          thinkingIntensity: options.thinkingIntensityRef.current,
        },
      }
    },
    prepareReconnectToStreamRequest: async () => {
      const token = await ensureDesktopToken()
      const headers: Record<string, string> = {}
      if (token) {
        headers.Authorization = `Bearer ${token}`
        headers['X-SwarmDesk-Agent-Desktop-Token'] = token
      }
      const clientRunId = options.coordinatorRef.current?.snapshot.activeClientRunId
      return {
        headers,
        ...(clientRunId ? { api: chatRunStreamUrl(options.threadId, clientRunId) } : {}),
      }
    },
    fetch: async (input, init) => {
      const doFetch = (headers: HeadersInit | undefined) =>
        globalThis.fetch(input, { ...init, headers })
      let response = await doFetch(init?.headers)
      if (response.status !== 401) return response
      clearDesktopToken()
      const replacementToken = await ensureDesktopToken(true)
      if (!replacementToken) return response
      const headers = new Headers(init?.headers)
      headers.set('Authorization', `Bearer ${replacementToken}`)
      headers.set('X-SwarmDesk-Agent-Desktop-Token', replacementToken)
      response = await doFetch(headers)
      return response
    },
  })
  return new CoordinatedChatTransport(inner, {
    accepted: (meta) => options.coordinatorRef.current?.transportAccepted(meta),
    initialFailure: (meta, error) =>
      options.coordinatorRef.current?.transportInitialFailure(meta, error),
  })
}
