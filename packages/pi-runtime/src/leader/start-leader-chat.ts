import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  parseLeaderChatStartBody,
  type LeaderChatEvent,
  type WorkerRunEvent,
} from '@pihuo-agent/shared'
import {
  applySecretsToEnv,
  DEFAULT_LEADER_MODEL,
  globalActivityLog,
  hasAnyApiKey,
  loadSettings,
  normalizeLeaderModelForMastra,
  normalizeMastraModelId,
  resolveApiKeyEnvsForModel,
} from '@pihuo-agent/core'
import { ChatRunCoordinator } from '../chat-run-coordinator.js'
import { finishChatRunStart } from '../chat-run-http.js'
import { startReservedChatRun } from '../chat-run-routes.js'
import { isProjectMemoryEnabled, projectMemoryPrompt } from '../project-memory.js'
import { normalizePromptSettings } from '@pihuo-agent/shared'
import { shouldMarkRoleReviewPrompted } from '../role-review-prompt.js'
import { createLeaderEventStream } from './leader-chat-stream.js'
import { getLeaderSession, getOrCreateLeaderSession } from './leader-session-pool.js'
import type { LeaderRunContext } from './tool-context.js'
import type { LeaderChatScope } from '../chat-run-http.js'

export async function startLeaderChat(input: {
  threadId: string
  req: IncomingMessage
  res: ServerResponse
  body: unknown
  coordinator: ChatRunCoordinator
  resolveScope: (params: Record<string, unknown>) => LeaderChatScope
  corsFor: () => Record<string, string>
  send: (res: ServerResponse, status: number, body: unknown) => void
  store: {
    listTeamMembers: (sessionId: string) => unknown[]
    markSessionReply: (sessionId: string) => void
    markSessionRoleReviewPrompted: (sessionId: string) => void
    markSessionUsage: (
      sessionId: string,
      delta: {
        inputTokens: number
        cachedInputTokens: number
        outputTokens: number
        lastInputTokens: number
      },
    ) => void
  }
}): Promise<void> {
  const parsed = parseLeaderChatStartBody(input.body)
  if (!parsed.ok) {
    input.send(input.res, 400, { error: parsed.error, code: parsed.code })
    return
  }
  const body = parsed.body
  const scope = input.resolveScope({ memory: { thread: input.threadId } })
  if (!scope.ok) {
    input.send(input.res, scope.status, { error: scope.error, code: scope.code })
    return
  }

  const settings = loadSettings()
  const leaderModel = normalizeLeaderModelForMastra(
    normalizeMastraModelId(body.model || settings.leaderModel || DEFAULT_LEADER_MODEL),
    settings.customProviders,
  )
  applySecretsToEnv(process.env)
  const keyInfo = resolveApiKeyEnvsForModel(leaderModel, settings.customProviders)
  if (keyInfo && !hasAnyApiKey(keyInfo.envKeys, process.env)) {
    input.send(input.res, 400, {
      code: 'MISSING_API_KEY',
      error: `Missing API key for ${leaderModel}`,
      providerId: keyInfo.providerId,
      envKey: keyInfo.envKeys[0],
    })
    return
  }

  const existing = getLeaderSession(scope.threadId)
  if (body.followUp.source === 'steer' && existing?.isStreaming) {
    await existing.steer(body.text)
    const status = input.coordinator.status(scope.threadId, scope.sessionId)
    if (!status.clientRunId) {
      input.send(input.res, 409, {
        code: 'CHAT_RUN_ACTIVE',
        error: 'Steer accepted but no active run token is available',
        status,
      })
      return
    }
    await finishChatRunStart({
      result: { kind: 'duplicate', status },
      coordinator: input.coordinator,
      threadId: scope.threadId,
      followUp: { ...body.followUp, clientRunId: status.clientRunId },
      response: input.res,
      corsFor: input.corsFor,
      send: input.send,
    })
    return
  }

  let extraEmit: ((event: LeaderChatEvent) => void) | null = null
  const pendingExtras: LeaderChatEvent[] = []
  const run: LeaderRunContext = {
    routerSessionId: scope.routerSession?.id ?? scope.sessionId,
    routerProjectId: scope.routerProject?.id ?? scope.resourceId,
    routerProjectRoot: scope.routerProject?.rootPath,
    memoryThreadId: scope.threadId,
    writer: {
      custom: async ({ data }) => {
        const event: LeaderChatEvent = { type: 'worker_run', event: data as WorkerRunEvent }
        if (extraEmit) extraEmit(event)
        else pendingExtras.push(event)
      },
    },
  }

  const prompts = normalizePromptSettings(settings.prompts)
  const memoryNote = projectMemoryPrompt(
    scope.resourceId,
    isProjectMemoryEnabled(scope.routerProject),
  )
  const handle = await getOrCreateLeaderSession({
    threadId: scope.threadId,
    workMode: body.workMode ?? scope.routerSession?.workMode,
    modelId: leaderModel,
    thinking: body.thinking,
    projectRoot: scope.routerProject?.rootPath,
    run,
    instructionOptions: {
      roleReviewPending: scope.routerSession?.roleReviewState === 'pending',
      bootstrappedRoleCount: scope.routerSession
        ? input.store.listTeamMembers(scope.routerSession.id).length
        : 0,
      leaderPrompt: `${prompts.leader ?? ''}${memoryNote}`,
      sessionTitle: scope.routerSession?.title,
      sessionTitleSource: scope.routerSession?.titleSource,
    },
  })

  const startResult = await startReservedChatRun({
    registry: input.coordinator,
    threadId: scope.threadId,
    sessionId: scope.sessionId,
    followUp: body.followUp,
    persistUserTurn: async () => {
      globalActivityLog.append('chat', `Chat → leader`, {
        threadId: scope.threadId,
        model: leaderModel,
      })
    },
    createStream: async (lease) => {
      const inner = createLeaderEventStream({
        session: handle.session,
        text: body.text,
        mode: 'prompt',
        abortSignal: lease.abortSignal,
        systemPrompt: handle.session.agent.state.systemPrompt,
      })
      return new ReadableStream<LeaderChatEvent>({
        async start(controller) {
          extraEmit = (event) => controller.enqueue(event)
          for (const extra of pendingExtras) controller.enqueue(extra)
          pendingExtras.length = 0
          const reader = inner.getReader()
          try {
            for (;;) {
              const { done, value } = await reader.read()
              if (done) break
              controller.enqueue(value)
              if (value.type === 'agent_end' && scope.routerSession) {
                input.store.markSessionReply(scope.routerSession.id)
                if (
                  shouldMarkRoleReviewPrompted({
                    roleReviewPending: scope.routerSession.roleReviewState === 'pending',
                    finishReason: 'stop',
                  })
                ) {
                  input.store.markSessionRoleReviewPrompted(scope.routerSession.id)
                }
              }
              if (value.type === 'usage' && scope.routerSession) {
                input.store.markSessionUsage(scope.routerSession.id, {
                  inputTokens: value.inputTokens,
                  cachedInputTokens: value.cachedInputTokens ?? 0,
                  outputTokens: value.outputTokens,
                  lastInputTokens: value.inputTokens,
                })
              }
            }
          } finally {
            extraEmit = null
            reader.releaseLock()
            controller.close()
          }
        },
      })
    },
  })

  await finishChatRunStart({
    result: startResult,
    coordinator: input.coordinator,
    threadId: scope.threadId,
    followUp: body.followUp,
    response: input.res,
    corsFor: input.corsFor,
    send: input.send,
  })
}
