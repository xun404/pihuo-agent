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
import type { AcpSpawnConfig } from './acp-config.js'
import { extractModelOptions, type ModelOptionsResult } from './acp-model-options.js'
import { readContainedText, writeContainedText } from './acp-filesystem.js'

export interface AcpSessionConfig {
  spawn: AcpSpawnConfig
  timeoutMs?: number
  signal?: AbortSignal
}

export interface AcpSessionCallbacks {
  onPermissionRequest?: (request: {
    title: string
    options: { optionId: string; name: string }[]
  }) => Promise<{ outcome: 'selected' | 'cancelled'; optionId?: string }>
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

type ErrorCode = 'SPAWN' | 'INITIALIZE' | 'SESSION_NEW' | 'PROMPT' | 'PROCESS_EXIT' | 'TIMEOUT' | 'CANCEL'

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
    try { proc.kill(signal) } catch {}
  }
}

export async function withAcpSession<T>(
  config: AcpSessionConfig,
  callbacks: AcpSessionCallbacks,
  operation: (handle: AcpSessionHandle) => Promise<T>,
): Promise<T> {
  const signal = config.signal
  if (signal?.aborted) {
    throw new AcpSessionError('CANCEL', 'Aborted before ACP session started')
  }

  const cwd = config.spawn.cwd
  const proc = spawn(config.spawn.command, [...(config.spawn.args ?? [])], {
    cwd,
    env: { ...config.spawn.env },
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: true,
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

  async function cleanupSession(): Promise<void> {
    if (disposed) return
    disposed = true
    for (const t of cleanupTimers) clearTimeout(t)
    cleanupTimers.length = 0

    if (proc.exitCode === null && proc.signalCode === null) {
      const killed = new Promise<void>((resolve) => {
        proc.once('exit', () => resolve())
      })
      try {
        proc.kill('SIGTERM')
        await Promise.race([killed, new Promise<void>((r) => setTimeout(r, 2000))])
      } catch {}
    }
    if (proc.exitCode === null && proc.signalCode === null) {
      try { killProcessGroup(proc, 'SIGKILL') } catch {}
    }
  }

  let sessionResult: T | undefined

  try {
    const input = Writable.toWeb(proc.stdin!)
    const output = Readable.toWeb(proc.stdout!) as ReadableStream<Uint8Array>
    const stream = ndJsonStream(input, output)

    const app = client({ name: `router-agents-${config.spawn.workerId}` })
      .onRequest(methods.client.session.requestPermission, async (ctx) => {
        if (!callbacks.onPermissionRequest) {
          return { outcome: { outcome: 'cancelled' as const } }
        }
        const result = await callbacks.onPermissionRequest({
          title: ctx.params.toolCall.title ?? 'Permission required',
          options: (ctx.params.options ?? []).map((o) => ({
            optionId: o.optionId ?? '',
            name: o.name ?? '',
          })),
        })
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
        const r = readContainedText(cwd, ctx.params.path)
        if (!r.ok) throw new Error(r.error)
        return { content: r.content }
      })
      .onRequest(methods.client.fs.writeTextFile, async (ctx) => {
        const r = writeContainedText(cwd, ctx.params.path, ctx.params.content)
        if (!r.ok) throw new Error(r.error)
        return {}
      })

    sessionResult = await app.connectWith(stream, async (ctx) => {
      await ctx.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
        },
      })

      const session = await ctx.buildSession(cwd).start()

      // Wire abort signal: send ACP session/cancel first, then TERM/KILL
      if (signal) {
        let handlerFired = false
        const abortHandler = () => {
          if (handlerFired) return
          handlerFired = true
          // Best-effort ACP cancel notification
          try {
            ctx.notify(methods.agent.session.cancel, {
              sessionId: session.sessionId,
            }).catch(() => {})
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
          const resp = await ctx.request(methods.agent.session.setConfigOption, {
            sessionId: session.sessionId,
            configId: id,
            value,
          }) as { configOptions: SessionConfigOption[] }
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

    return sessionResult
  } catch (e) {
    if (e instanceof AcpSessionError) throw e

    if (signal?.aborted) {
      throw new AcpSessionError('CANCEL', 'ACP session cancelled', e)
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
