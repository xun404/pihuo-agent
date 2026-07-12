import type { WorkerModelOption, WorkerRegistration } from '@router-agents/shared'
import type { AcpSpawnConfig } from './acp-config.js'
import { probeWorkerHealth } from './health.js'
import { resolveWorkerCwd } from './presets.js'

/**
 * Probe whether the worker command looks runnable (binary on PATH / npx present).
 * Uses the shared health probe (presence/version) — does not authenticate remote CLIs.
 */
export async function defaultCanRunAcp(
  config: AcpSpawnConfig,
  timeoutMs = 3000,
): Promise<boolean> {
  const report = await probeWorkerHealth(
    {
      name: config.workerName,
      kind: config.kind,
      command: config.command,
      args: config.args,
      env: config.env,
    },
    {
      level: 'presence',
      timeoutMs,
      cwd: config.cwd,
      env: config.env,
    },
  )
  return report.status === 'healthy'
}

export interface RunAcpTaskOptions {
  /**
   * When set, used instead of spawning ACP (tests / dry-run).
   */
  execute?: (
    config: AcpSpawnConfig,
    task: string,
  ) => Promise<{ ok: boolean; output?: string; error?: string }>
  /**
   * Permission callback — maps to approval queue in the app layer.
   */
  onPermissionRequest?: (request: {
    title: string
    options: { optionId: string; name: string }[]
  }) => Promise<{ outcome: 'selected' | 'cancelled'; optionId?: string }>
}

/**
 * Live ACP path: dynamically imports `@mastra/acp` createACPTool and executes one task.
 * Passes optional `model` for session/set_model after session creation.
 */
export async function runAcpTask(
  config: AcpSpawnConfig,
  task: string,
  options: RunAcpTaskOptions = {},
): Promise<{ ok: boolean; output?: string; error?: string }> {
  if (options.execute) {
    return options.execute(config, task)
  }

  try {
    const acp = await import('@mastra/acp')
    const createACPTool =
      (acp as unknown as {
        createACPTool?: (opts: Record<string, unknown>) => {
          execute?: (input: { task: string }) => Promise<unknown>
        }
      }).createACPTool

    if (typeof createACPTool !== 'function') {
      return {
        ok: false,
        error:
          '@mastra/acp loaded but createACPTool is missing. Upgrade @mastra/acp or check package exports.',
      }
    }

    const tool = createACPTool({
      id: `acp-${config.workerId}`,
      description: `ACP worker ${config.workerName}`,
      command: config.command,
      args: config.args,
      cwd: config.cwd,
      env: config.env,
      persistSession: false,
      ...(config.model ? { model: config.model } : {}),
      onPermissionRequest: options.onPermissionRequest
        ? async (request: {
            title?: string
            options?: { optionId: string; name: string }[]
          }) => {
            const res = await options.onPermissionRequest!({
              title: request.title ?? 'Permission required',
              options: request.options ?? [],
            })
            if (res.outcome === 'cancelled' || !res.optionId) {
              return { outcome: { outcome: 'cancelled' as const } }
            }
            return {
              outcome: {
                outcome: 'selected' as const,
                optionId: res.optionId,
              },
            }
          }
        : undefined,
    })

    if (typeof tool.execute !== 'function') {
      return {
        ok: false,
        error: 'createACPTool() did not return an executable tool',
      }
    }

    const raw = await tool.execute({ task })
    const output =
      typeof raw === 'string'
        ? raw
        : raw && typeof raw === 'object' && 'output' in (raw as object)
          ? String((raw as { output: unknown }).output)
          : JSON.stringify(raw)

    return { ok: true, output }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return {
      ok: false,
      error: `ACP run via @mastra/acp failed: ${msg}`,
    }
  }
}

export interface ListAcpModelsResult {
  ok: boolean
  models: WorkerModelOption[]
  error?: string
}

/**
 * Spawn ACP agent briefly and list selectable models via getAvailableModels().
 * @see https://mastra.ai — AcpAgent.getAvailableModels
 */
export async function listAcpModels(
  worker: Pick<WorkerRegistration, 'id' | 'name' | 'command' | 'args' | 'env' | 'kind'>,
  opts?: { cwd?: string; timeoutMs?: number },
): Promise<ListAcpModelsResult> {
  const timeoutMs =
    opts?.timeoutMs ??
    (Number(process.env.WORKER_MODELS_TIMEOUT_MS) || 90_000)
  const cwd = opts?.cwd ?? resolveWorkerCwd(undefined)

  try {
    const acp = await import('@mastra/acp')
    const AcpAgent = (
      acp as unknown as {
        AcpAgent?: new (opts: Record<string, unknown>) => {
          getAvailableModels: () => Promise<
            Array<{ modelId?: string; name?: string; description?: string | null }>
          >
        }
      }
    ).AcpAgent

    if (typeof AcpAgent !== 'function') {
      return {
        ok: false,
        models: [],
        error: '@mastra/acp AcpAgent is not available',
      }
    }

    const agent = new AcpAgent({
      id: `models-${worker.id}`,
      name: worker.name,
      description: `List models for ${worker.name}`,
      command: worker.command,
      args: worker.args,
      cwd,
      env: { ...process.env, ...worker.env },
      persistSession: false,
    })

    let timedOut = false
    const listPromise = agent.getAvailableModels().then((models) => {
      // Ignore late resolution after timeout so callers don't double-apply success
      if (timedOut) return [] as typeof models
      return models
    })
    const models = await Promise.race([
      listPromise,
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          timedOut = true
          reject(
            new Error(
              `ACP 拉取模型超时（${Math.round(timeoutMs / 1000)}s）。进程可能仍在启动/下载；可稍后重试，或手动填写 model id。`,
            ),
          )
        }, timeoutMs)
      }),
    ])

    const normalized: WorkerModelOption[] = (models ?? [])
      .map((m) => ({
        modelId: String(m.modelId ?? '').trim(),
        name: String(m.name ?? m.modelId ?? '').trim() || String(m.modelId ?? ''),
        description: m.description ? String(m.description) : undefined,
      }))
      .filter((m) => m.modelId)

    if (normalized.length === 0) {
      return {
        ok: false,
        models: [],
        error: 'ACP 未返回可用模型列表（agent 可能不暴露 models）',
      }
    }

    return { ok: true, models: normalized }
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e)
    // Normalize English timeout from older callers
    const error = /timed out after \d+ms/i.test(raw)
      ? `ACP 拉取模型超时。命令在 PATH 上可用，但 ACP 会话未能在时限内列出模型。`
      : raw
    return {
      ok: false,
      models: [],
      error,
    }
  }
}
