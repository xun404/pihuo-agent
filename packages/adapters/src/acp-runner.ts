import type { WorkerModelOption, WorkerRegistration } from '@router-agents/shared'
import type { AcpSpawnConfig } from './acp-config.js'
import { formatWorkerModelError, isModelDisabledError } from './acp-errors.js'
import { probeWorkerHealth } from './health.js'
import { resolveWorkerCwd } from './presets.js'
import { prepareOpenCodeAcpEnv, OPENCODE_SAFE_DEFAULT_MODEL } from './opencode-acp-env.js'
import { withAcpSession, type AcpSessionHandle, type AcpPromptResult } from './acp-session.js'
import { rmSync } from 'node:fs'

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
  execute?: (
    config: AcpSpawnConfig,
    task: string,
  ) => Promise<{ ok: boolean; output?: string; error?: string }>
  onPermissionRequest?: (request: {
    title: string
    options: { optionId: string; name: string }[]
  }) => Promise<{ outcome: 'selected' | 'cancelled'; optionId?: string }>
  signal?: AbortSignal
}

export async function runAcpTask(
  config: AcpSpawnConfig,
  task: string,
  options: RunAcpTaskOptions = {},
): Promise<{ ok: boolean; output?: string; error?: string; modelUsed?: string }> {
  if (options.execute) {
    return options.execute(config, task)
  }

  let isolatedHome: string | undefined

  try {
    let spawnConfig = config
    let modelUsed: string | undefined
    let effectivePinned = config.model?.trim() || undefined

    if (config.kind === 'opencode') {
      const prep = prepareOpenCodeAcpEnv({
        baseEnv: { ...process.env, ...config.env },
        model: config.model,
      })
      console.info(`[acp] ${config.workerName}: ${prep.hint}`)
      isolatedHome = prep.isolatedHome
      spawnConfig = {
        ...config,
        command: config.command,
        args: config.args?.length ? [...config.args] : ['acp'],
        env: prep.env as Record<string, string>,
      }
    }

    const result = await withAcpSession(
      { spawn: spawnConfig, signal: options.signal },
      {
        onPermissionRequest: options.onPermissionRequest,
      },
      async (handle) => {
        if (effectivePinned) {
          const validOption = handle.modelOptions.models.find(
            (m) => m.modelId === effectivePinned,
          )
          if (!validOption) {
            throw new Error(
              `Model "${effectivePinned}" is not in the agent's available config options`,
            )
          }

          try {
            const modelOptId =
              handle.configOptions.find(
                (o) =>
                  o.type === 'select' &&
                  'options' in o &&
                  Array.isArray(o.options) &&
                  o.options.some((ov) => {
                    if ('group' in ov) {
                      return ov.options.some((s) => s.value === effectivePinned)
                    }
                    return 'value' in ov && ov.value === effectivePinned
                  }),
              )?.id ?? ''
            if (!modelOptId) {
              throw new Error(`Cannot find config option id for model "${effectivePinned}"`)
            }
            await handle.setConfigOption(modelOptId, effectivePinned)
            modelUsed = effectivePinned
          } catch (e) {
            throw new Error(
              `Failed to set model "${effectivePinned}": ${e instanceof Error ? e.message : e}`,
            )
          }
        }

        const promptResult: AcpPromptResult = await handle.prompt(task)
        modelUsed = modelUsed ?? handle.modelOptions.currentModelId

        return promptResult
      },
    )

    if (!result.ok && result.error) {
      return {
        ok: false,
        output: result.output,
        modelUsed,
        error: formatWorkerModelError({
          workerName: config.workerName,
          kind: config.kind,
          model: config.model ?? modelUsed,
          rawError: result.error,
        }),
      }
    }

    return { ...result, modelUsed }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return {
      ok: false,
      error: formatWorkerModelError({
        workerName: config.workerName,
        kind: config.kind,
        model: config.model,
        rawError: `ACP run failed: ${msg}`,
      }),
    }
  } finally {
    if (isolatedHome) {
      try { rmSync(isolatedHome, { recursive: true, force: true }) } catch {}
    }
  }
}

export interface ListAcpModelsResult {
  ok: boolean
  models: WorkerModelOption[]
  error?: string
}

export async function listAcpModels(
  worker: Pick<
    WorkerRegistration,
    'id' | 'name' | 'command' | 'args' | 'env' | 'kind' | 'model'
  >,
  opts?: { cwd?: string; timeoutMs?: number },
): Promise<ListAcpModelsResult> {
  const timeoutMs =
    opts?.timeoutMs ??
    (Number(process.env.WORKER_MODELS_TIMEOUT_MS) || 90_000)
  const cwd = opts?.cwd ?? resolveWorkerCwd(undefined)

  try {
    let env: Record<string, string>

    if (worker.kind === 'opencode') {
      // Model discovery uses real HOME so all user-configured providers appear
      env = { ...process.env, ...worker.env } as Record<string, string>
    } else {
      env = { ...process.env, ...worker.env } as Record<string, string>
    }

    const spawnConfig: AcpSpawnConfig = {
      command: worker.command,
      args: [...(worker.args ?? [])],
      cwd,
      env,
      workerId: worker.id,
      workerName: worker.name,
      kind: worker.kind,
      primaryRole: 'general',
      roles: ['general'],
    }

    const aborter = new AbortController()
    const timer = setTimeout(() => aborter.abort(), Math.min(timeoutMs, 60000))

    try {
      const models = await withAcpSession(
        { spawn: spawnConfig, signal: aborter.signal },
        {},
        async (handle) => {
          if (!handle.modelOptions.ok || handle.modelOptions.models.length === 0) {
            throw new Error(
              handle.modelOptions.error ?? 'No models found in configOptions',
            )
          }
          return handle.modelOptions.models.map((m) => ({
            modelId: m.modelId,
            name: m.name,
            description: m.description,
          }))
        },
      )

      return { ok: true, models }
    } finally {
      clearTimeout(timer)
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return {
      ok: false,
      models: [],
      error: msg,
    }
  }
}
