import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  isChatRunAbortIntent,
  isChatRunIdentifier,
  isFollowUpRequestMeta,
  type ChatRunAbortIntent,
  type FollowUpRequestMeta,
  type Project,
  type Session,
} from '@pihuo-agent/shared'
import { ChatRunCoordinator } from './chat-run-coordinator.js'
import {
  requestChatRunAbort,
  subscribeToChatRun,
  type StartReservedChatRunResult,
} from './chat-run-routes.js'
import { match } from './http/route-match.js'
import { isProjectMemoryEnabled, resolveProjectMemoryOptions } from './project-memory.js'

export type LeaderChatScope =
  | {
      ok: true
      threadId: string
      resourceId: string
      sessionId: string
      routerSession: Session | null
      routerProject: Project | null
      projectMemoryOptions: ReturnType<typeof resolveProjectMemoryOptions>
    }
  | {
      ok: false
      status: number
      error: string
      code: string
    }

type LeaderChatScopeStore = {
  getActive: () => { session?: Session | null; project?: Project | null }
  listSessions: () => Session[]
  listProjects: () => Project[]
}

/** Resolve the trusted Session / Project tuple shared by every chat endpoint. */
export function createResolveLeaderChatScope(store: LeaderChatScopeStore) {
  return (params: Record<string, unknown>): LeaderChatScope => {
    const active = store.getActive()
    const clientMemory = (params.memory ?? null) as {
      thread?: string | { id?: string }
      resource?: string
    } | null
    const threadFromClient =
      typeof clientMemory?.thread === 'string'
        ? clientMemory.thread
        : clientMemory?.thread && typeof clientMemory.thread === 'object'
          ? clientMemory.thread.id
          : undefined
    const resourceFromClient =
      typeof clientMemory?.resource === 'string' ? clientMemory.resource : undefined
    const threadId =
      threadFromClient ||
      active.session?.memoryThreadId ||
      active.session?.id ||
      'router-default-thread'
    const routerSession =
      store
        .listSessions()
        .find((session) => session.memoryThreadId === threadId || session.id === threadId) ??
      (active.session?.memoryThreadId === threadId || active.session?.id === threadId
        ? active.session
        : null)
    const resourceId =
      routerSession?.projectId ||
      active.project?.id ||
      active.session?.projectId ||
      'router-default-resource'
    if (resourceFromClient && resourceFromClient !== resourceId) {
      return {
        ok: false,
        status: 403,
        error: 'resourceId does not match session project',
        code: 'PIHUO_AGENT_RESOURCE_MISMATCH',
      }
    }
    const routerProject = routerSession
      ? (store.listProjects().find((project) => project.id === routerSession.projectId) ?? null)
      : (active.project ?? null)
    return {
      ok: true,
      threadId,
      resourceId,
      sessionId: routerSession?.id ?? threadId,
      routerSession,
      routerProject,
      projectMemoryOptions: resolveProjectMemoryOptions(isProjectMemoryEnabled(routerProject)),
    }
  }
}

export function followUpFromParams(
  params: Record<string, unknown>,
): { ok: true; followUp: FollowUpRequestMeta } | { ok: false; error: string; code: string } {
  const followUp = params.followUp
  if (!isFollowUpRequestMeta(followUp)) {
    return {
      ok: false,
      error: 'followUp delivery metadata is required',
      code: 'CHAT_FOLLOW_UP_METADATA_REQUIRED',
    }
  }
  const messages = Array.isArray(params.messages) ? params.messages : []
  const last = messages[messages.length - 1] as { id?: unknown; role?: unknown } | undefined
  if (last?.role !== 'user' || last.id !== followUp.deliveryId) {
    return {
      ok: false,
      error: 'followUp.deliveryId must match the final user message id',
      code: 'CHAT_FOLLOW_UP_DELIVERY_MISMATCH',
    }
  }
  return { ok: true, followUp }
}

type ChatRunProtocolRouteOptions = {
  method: string
  path: string
  url: URL
  req: IncomingMessage
  res: ServerResponse
  coordinator: ChatRunCoordinator
  resolveScope: (params: Record<string, unknown>) => LeaderChatScope
  corsFor: () => Record<string, string>
  send: (res: ServerResponse, status: number, body: unknown) => void
  readJson: (req: IncomingMessage) => Promise<unknown>
  abortWaitMs: number
}

/**
 * Handle the token-bound status, stream resume, and structured abort routes.
 * Desktop auth is deliberately performed by the owner before this function.
 */
export async function handleChatRunProtocolRoute(
  input: ChatRunProtocolRouteOptions,
): Promise<boolean> {
  const statusMatch = match(input.path, '/chat/:agentId/:chatId/run')
  if (input.method === 'GET' && statusMatch) {
    const scope = input.resolveScope({ memory: { thread: statusMatch.chatId! } })
    if (!scope.ok) {
      input.send(input.res, scope.status, { error: scope.error, code: scope.code })
      return true
    }
    const clientRunId = input.url.searchParams.get('clientRunId')?.trim() || undefined
    if (clientRunId && !isChatRunIdentifier(clientRunId)) {
      input.send(input.res, 400, {
        error: 'clientRunId must be a UUID',
        code: 'CHAT_RUN_TOKEN_INVALID',
      })
      return true
    }
    input.send(
      input.res,
      200,
      input.coordinator.status(scope.threadId, scope.sessionId, clientRunId),
    )
    return true
  }

  const streamMatch = match(input.path, '/chat/:agentId/:chatId/stream')
  if (input.method === 'GET' && streamMatch) {
    const clientRunId = input.url.searchParams.get('clientRunId')?.trim()
    if (!clientRunId) {
      input.send(input.res, 400, {
        error: 'clientRunId is required to resume a chat stream',
        code: 'CHAT_RUN_TOKEN_REQUIRED',
      })
      return true
    }
    if (!isChatRunIdentifier(clientRunId)) {
      input.send(input.res, 400, {
        error: 'clientRunId must be a UUID',
        code: 'CHAT_RUN_TOKEN_INVALID',
      })
      return true
    }
    const scope = input.resolveScope({ memory: { thread: streamMatch.chatId! } })
    if (!scope.ok) {
      input.send(input.res, scope.status, { error: scope.error, code: scope.code })
      return true
    }
    const subscribed = await subscribeToChatRun({
      registry: input.coordinator,
      threadId: scope.threadId,
      clientRunId,
      response: input.res,
      extraHeaders: input.corsFor(),
    })
    if (!subscribed) {
      input.res.writeHead(204, input.corsFor())
      input.res.end()
    }
    return true
  }

  const abortMatch = match(input.path, '/chat/:agentId/:chatId/abort')
  if (input.method !== 'POST' || !abortMatch) return false
  const body = (await input.readJson(input.req)) as {
    clientRunId?: unknown
    intent?: unknown
  }
  if (!isChatRunIdentifier(body.clientRunId) || !isChatRunAbortIntent(body.intent)) {
    input.send(input.res, 400, {
      error: 'clientRunId and a valid stop/steer intent are required',
      code: 'CHAT_RUN_ABORT_INPUT_INVALID',
    })
    return true
  }
  const scope = input.resolveScope({ memory: { thread: abortMatch.chatId! } })
  if (!scope.ok) {
    input.send(input.res, scope.status, { error: scope.error, code: scope.code })
    return true
  }
  const decision = await requestChatRunAbort({
    registry: input.coordinator,
    threadId: scope.threadId,
    sessionId: scope.sessionId,
    clientRunId: body.clientRunId,
    intent: body.intent as ChatRunAbortIntent,
    waitMs: input.abortWaitMs,
  })
  input.send(input.res, 200, decision)
  return true
}

/** Serialize admission outcomes without letting a POST attach to another token. */
export async function finishChatRunStart(input: {
  result: StartReservedChatRunResult
  coordinator: ChatRunCoordinator
  threadId: string
  followUp: FollowUpRequestMeta
  response: ServerResponse
  corsFor: () => Record<string, string>
  send: (res: ServerResponse, status: number, body: unknown) => void
}): Promise<void> {
  if (input.result.kind === 'active') {
    input.send(input.response, 409, {
      code: 'CHAT_RUN_ACTIVE',
      error: 'A leader run is already active for this thread',
      status: input.result.status,
    })
    return
  }
  if (input.result.kind === 'busy') {
    input.send(input.response, 409, {
      code: 'CHAT_THREAD_BUSY',
      error: 'A worker job is still open for this thread',
      status: input.result.status,
    })
    return
  }
  if (input.result.kind === 'aborted') {
    input.send(input.response, 409, {
      code: 'CHAT_RUN_ABORTED',
      error: 'The chat run was stopped before startup completed',
      status: input.result.status,
    })
    return
  }
  if (input.result.kind === 'failed') throw input.result.error

  const subscribed = await subscribeToChatRun({
    registry: input.coordinator,
    threadId: input.threadId,
    clientRunId: input.followUp.clientRunId,
    response: input.response,
    extraHeaders: input.corsFor(),
  })
  if (!subscribed) {
    input.send(input.response, 409, {
      code: 'CHAT_RUN_TERMINAL',
      error: 'The requested chat run could not be resumed',
      status: input.result.status,
    })
  }
}
