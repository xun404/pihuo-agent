import { spawn, type ChildProcess } from 'node:child_process'
import { Writable, Readable } from 'node:stream'
import {
  client,
  ndJsonStream,
  methods,
  PROTOCOL_VERSION,
  type ClientApp,
  type ClientContext,
  type ActiveSession,
  type SessionConfigOption,
} from '@agentclientprotocol/sdk'
import type { ApprovalOption, ApprovalOptionKind } from '@swarmdesk-agent/shared'
import type { AcpSpawnConfig } from './acp-config.js'
import { extractModelOptions, type ModelOptionsResult } from './acp-model-options.js'
import { readAcpTextFile, writeAcpTextFileWithPermission } from './acp-filesystem.js'

export interface AcpSessionConfig {
  spawn: AcpSpawnConfig
  timeoutMs?: number
  signal?: AbortSignal
}

export interface AcpPermissionRequest {
  source: 'agent' | 'client_fs'
  toolCallId?: string
  kind?: string
  title?: string
  locations?: { path: string; line?: number }[]
  options: ApprovalOption[]
}

const APPROVAL_OPTION_KINDS = new Set<ApprovalOptionKind>([
  'allow_once',
  'allow_always',
  'reject_once',
  'reject_always',
])

export class InvalidAcpApprovalOptionsError extends Error {
  readonly code = 'invalid_approval_options'

  constructor() {
    super('Invalid approval options received from ACP agent')
    this.name = 'InvalidAcpApprovalOptionsError'
  }
}

function parseApprovalOptions(value: unknown): ApprovalOption[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new InvalidAcpApprovalOptionsError()
  }

  const seen = new Set<string>()
  return value.map((candidate) => {
    if (!candidate || typeof candidate !== 'object') {
      throw new InvalidAcpApprovalOptionsError()
    }
    const raw = candidate as Record<string, unknown>
    const optionId = typeof raw.optionId === 'string' ? raw.optionId.trim() : ''
    const name = typeof raw.name === 'string' ? raw.name.trim() : ''
    const kind = raw.kind
    if (
      !optionId ||
      !name ||
      typeof kind !== 'string' ||
      !APPROVAL_OPTION_KINDS.has(kind as ApprovalOptionKind) ||
      seen.has(optionId)
    ) {
      throw new InvalidAcpApprovalOptionsError()
    }
    seen.add(optionId)
    return { optionId, name, kind: kind as ApprovalOptionKind }
  })
}

function isValidLineNumber(line: unknown): line is number {
  return typeof line === 'number' && Number.isFinite(line) && line >= 0 && Number.isInteger(line)
}

export function mapPermissionRequest(params: {
  sessionId: string
  toolCall: {
    toolCallId: string
    kind?: string | null
    title?: string | null
    locations?: Array<{ path: string; line?: number | null }> | null
  }
  options?: Array<{ optionId?: string; name?: string; kind?: string }> | null
}): AcpPermissionRequest {
  const toolCall = params.toolCall ?? {}
  const kind =
    toolCall.kind && typeof toolCall.kind === 'string' && toolCall.kind.length > 0
      ? toolCall.kind
      : 'other'
  const title =
    toolCall.title && typeof toolCall.title === 'string' && toolCall.title.length > 0
      ? toolCall.title
      : 'Permission required'

  let locations: { path: string; line?: number }[] | undefined
  if (Array.isArray(toolCall.locations)) {
    const filtered = toolCall.locations
      .filter((l) => l && typeof l.path === 'string' && l.path.length > 0)
      .map((l) => {
        const entry: { path: string; line?: number } = { path: l.path }
        if (isValidLineNumber(l.line)) entry.line = l.line
        return entry
      })
    locations = filtered.length > 0 ? filtered : []
  } else {
    locations = []
  }

  const opts = parseApprovalOptions(params.options)

  return {
    source: 'agent',
    toolCallId: toolCall.toolCallId ?? undefined,
    kind,
    title,
    locations,
    options: opts,
  }
}

export interface AcpSessionCallbacks {
  onPermissionRequest?: (
    request: AcpPermissionRequest,
  ) => Promise<{ outcome: 'selected' | 'cancelled'; optionId?: string }>
}

export interface AcpSessionHandle {
  sessionId: string
  configOptions: SessionConfigOption[]
  modelOptions: ModelOptionsResult
  prompt: (task: string) => Promise<AcpPromptResult>
  setConfigOption: (id: string, value: string) => Promise<SessionConfigOption[]>
  cancel: () => Promise<void>
}

export interface AcpPromptResult {
  ok: boolean
  output?: string
  stopReason?: string
  error?: string
}

type ErrorCode =
  'SPAWN' | 'INITIALIZE' | 'SESSION_NEW' | 'PROMPT' | 'PROCESS_EXIT' | 'TIMEOUT' | 'CANCEL'

export class AcpSessionError extends Error {
  code: ErrorCode
  causeObj?: unknown

  constructor(code: ErrorCode, message: string, cause?: unknown) {
    super(message)
    this.name = 'AcpSessionError'
    this.code = code
    this.causeObj = cause
  }
}

const STDERR_MAX_BYTES = 8000

function killProcessGroup(proc: ChildProcess, signal: NodeJS.Signals) {
  try {
    if (proc.pid) {
      process.kill(-proc.pid, signal)
    }
  } catch {
    try {
      proc.kill(signal)
    } catch {}
  }
}

export async function withAcpSession<T>(
  config: AcpSessionConfig,
  callbacks: AcpSessionCallbacks,
  operation: (handle: AcpSessionHandle) => Promise<T>,
): Promise<T> {
  const externalSignal = config.signal
  if (externalSignal?.aborted) {
    throw new AcpSessionError('CANCEL', 'Aborted before ACP session started')
  }

  const lifecycleAborter = new AbortController()
  const signal = lifecycleAborter.signal
  let timedOut = false
  let timeoutTimer: ReturnType<typeof setTimeout> | undefined
  let externalAbortCleanup: (() => void) | undefined
  let cancellationCleanup: (() => void) | undefined

  if (externalSignal) {
    const forwardAbort = () => lifecycleAborter.abort(externalSignal.reason)
    externalSignal.addEventListener('abort', forwardAbort, { once: true })
    externalAbortCleanup = () => externalSignal.removeEventListener('abort', forwardAbort)
    if (externalSignal.aborted) forwardAbort()
  }

  const rawTimeoutMs = config.timeoutMs
  const timeoutMs =
    typeof rawTimeoutMs === 'number' && Number.isFinite(rawTimeoutMs) && rawTimeoutMs > 0
      ? Math.max(1, Math.floor(rawTimeoutMs))
      : undefined
  if (timeoutMs !== undefined) {
    timeoutTimer = setTimeout(() => {
      timedOut = true
      lifecycleAborter.abort()
    }, timeoutMs)
    timeoutTimer.unref?.()
  }

  const cancellationFailure = new Promise<never>((_resolve, reject) => {
    const rejectCancellation = () =>
      reject(
        new AcpSessionError(
          timedOut ? 'TIMEOUT' : 'CANCEL',
          timedOut
            ? `${config.spawn.workerName}: ACP session timed out after ${timeoutMs}ms`
            : 'ACP session cancelled',
        ),
      )
    signal.addEventListener('abort', rejectCancellation, { once: true })
    cancellationCleanup = () => signal.removeEventListener('abort', rejectCancellation)
    if (signal.aborted) rejectCancellation()
  })

  const cwd = config.spawn.cwd
  let proc: ChildProcess
  try {
    proc = spawn(config.spawn.command, [...(config.spawn.args ?? [])], {
      cwd,
      env: { ...config.spawn.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
    })
  } catch (error) {
    cancellationCleanup?.()
    externalAbortCleanup?.()
    if (timeoutTimer) clearTimeout(timeoutTimer)
    throw new AcpSessionError(
      'SPAWN',
      `${config.spawn.workerName}: failed to start ACP process`,
      error,
    )
  }
  const spawnFailure = new Promise<never>((_resolve, reject) => {
    proc.once('error', (error) => {
      reject(
        new AcpSessionError(
          'SPAWN',
          `${config.spawn.workerName}: failed to start ACP process`,
          error,
        ),
      )
    })
  })

  const stderrChunks: string[] = []
  proc.stderr?.on('data', (chunk: Buffer) => {
    const s = chunk.toString('utf8')
    if (stderrChunks.join('').length < STDERR_MAX_BYTES) {
      stderrChunks.push(s.slice(0, STDERR_MAX_BYTES - stderrChunks.join('').length))
    }
  })

  let disposed = false
  const cleanupTimers: ReturnType<typeof setTimeout>[] = []
  let abortCleanup: (() => void) | undefined

  async function cleanupSession(): Promise<void> {
    if (disposed) return
    disposed = true
    abortCleanup?.()
    abortCleanup = undefined
    cancellationCleanup?.()
    cancellationCleanup = undefined
    externalAbortCleanup?.()
    externalAbortCleanup = undefined
    if (timeoutTimer) clearTimeout(timeoutTimer)
    timeoutTimer = undefined
    for (const t of cleanupTimers) clearTimeout(t)
    cleanupTimers.length = 0

    if (proc.exitCode === null && proc.signalCode === null) {
      const killed = new Promise<void>((resolve) => {
        proc.once('exit', () => resolve())
      })
      try {
        killProcessGroup(proc, 'SIGTERM')
        await Promise.race([killed, new Promise<void>((r) => setTimeout(r, 2000))])
      } catch {}
    }
    // The detached group can retain grandchildren after its leader exits.
    // A final group kill is safe/best-effort even when the direct child is gone.
    try {
      killProcessGroup(proc, 'SIGKILL')
    } catch {}
  }

  let sessionResult: T | undefined

  try {
    const input = Writable.toWeb(proc.stdin!)
    const output = Readable.toWeb(proc.stdout!) as ReadableStream<Uint8Array>
    const stream = ndJsonStream(input, output)

    let activeSessionId: string | undefined
    const app = client({ name: `swarmdesk-agent-${config.spawn.workerId}` })
      .onRequest(methods.client.session.requestPermission, async (ctx) => {
        if (!callbacks.onPermissionRequest) {
          return { outcome: { outcome: 'cancelled' as const } }
        }
        const result = await callbacks.onPermissionRequest(mapPermissionRequest(ctx.params))
        if (result.outcome === 'cancelled' || !result.optionId) {
          return { outcome: { outcome: 'cancelled' as const } }
        }
        return {
          outcome: {
            outcome: 'selected' as const,
            optionId: result.optionId,
          },
        }
      })
      .onRequest(methods.client.fs.readTextFile, async (ctx) => {
        if (activeSessionId && ctx.params.sessionId !== activeSessionId) {
          throw new Error('Filesystem request session mismatch')
        }
        const r = readAcpTextFile(cwd, ctx.params.path)
        if (!r.ok) throw new Error(r.error)
        return { content: r.content }
      })
      .onRequest(methods.client.fs.writeTextFile, async (ctx) => {
        if (activeSessionId && ctx.params.sessionId !== activeSessionId) {
          throw new Error('Filesystem request session mismatch')
        }
        const r = await writeAcpTextFileWithPermission({
          projectRoot: cwd,
          target: ctx.params.path,
          content: ctx.params.content,
          signal,
          requestPermission: callbacks.onPermissionRequest,
        })
        if (!r.ok) throw new Error(r.error)
        return {}
      })

    const connected = app.connectWith(stream, async (ctx) => {
      await ctx.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
        },
      })

      const session = await ctx.buildSession(cwd).start()
      activeSessionId = session.sessionId

      // Wire abort signal: send ACP session/cancel first, then TERM/KILL
      if (signal) {
        let handlerFired = false
        const abortHandler = () => {
          if (handlerFired) return
          handlerFired = true
          // Best-effort ACP cancel notification
          try {
            ctx
              .notify(methods.agent.session.cancel, {
                sessionId: session.sessionId,
              })
              .catch(() => {})
          } catch {}
          // Grace period then terminate process group
          const t = setTimeout(() => {
            killProcessGroup(proc, 'SIGTERM')
            const t2 = setTimeout(() => killProcessGroup(proc, 'SIGKILL'), 2000)
            cleanupTimers.push(t2)
          }, 2000)
          cleanupTimers.push(t)
        }
        signal.addEventListener('abort', abortHandler, { once: true })
        abortCleanup = () => signal.removeEventListener('abort', abortHandler)
        if (signal.aborted) abortHandler()
      }

      const response = session.newSessionResponse
      const modelOptions = extractModelOptions(response.configOptions ?? [])

      const handle: AcpSessionHandle = {
        sessionId: session.sessionId,
        configOptions: response.configOptions ?? [],
        modelOptions,

        prompt: async (task: string): Promise<AcpPromptResult> => {
          if (disposed) return { ok: false, error: 'Session disposed' }
          try {
            void session.prompt(task)
            let output = ''
            for (;;) {
              const msg = await session.nextUpdate()
              if (msg.kind === 'stop') {
                const ok = msg.stopReason === 'end_turn'
                return {
                  ok,
                  output,
                  stopReason: msg.stopReason,
                  error: ok ? undefined : `Agent stopped: ${msg.stopReason}`,
                }
              }
              if (msg.kind === 'session_update') {
                const update = msg.update
                if (update.sessionUpdate === 'agent_message_chunk') {
                  if (update.content?.type === 'text') {
                    output += update.content.text
                  }
                }
              }
            }
          } catch (e) {
            return {
              ok: false,
              error: e instanceof Error ? e.message : String(e),
            }
          }
        },

        setConfigOption: async (id: string, value: string) => {
          const resp = (await ctx.request(methods.agent.session.setConfigOption, {
            sessionId: session.sessionId,
            configId: id,
            value,
          })) as { configOptions: SessionConfigOption[] }
          return resp.configOptions
        },

        cancel: async () => {
          try {
            await ctx.notify(methods.agent.session.cancel, {
              sessionId: session.sessionId,
            })
          } catch {}
        },
      }

      return operation(handle)
    })
    sessionResult = await Promise.race([connected, spawnFailure, cancellationFailure])

    return sessionResult
  } catch (e) {
    if (e instanceof AcpSessionError) throw e

    if (signal.aborted) {
      throw new AcpSessionError(
        timedOut ? 'TIMEOUT' : 'CANCEL',
        timedOut
          ? `${config.spawn.workerName}: ACP session timed out after ${timeoutMs}ms`
          : 'ACP session cancelled',
        e,
      )
    }

    throw new AcpSessionError(
      'PROMPT',
      `${config.spawn.workerName}: ${e instanceof Error ? e.message : String(e)}`,
      e,
    )
  } finally {
    await cleanupSession()
  }
}
