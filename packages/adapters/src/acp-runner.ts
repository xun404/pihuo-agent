import type { WorkerModelOption, WorkerRegistration } from '@router-agents/shared'
import type { AcpSpawnConfig } from './acp-config.js'
import { formatWorkerModelError } from './acp-errors.js'
import { probeWorkerHealth } from './health.js'
import { resolveWorkerCwd } from './presets.js'
import { prepareOpenCodeAcpEnv, OPENCODE_ZEN_FREE_MODELS } from './opencode-acp-env.js'
import { withAcpSession, type AcpPromptResult, type AcpPermissionRequest } from './acp-session.js'
import { computeShortlistedModels, type ShortlistEntry } from './acp-model-shortlist.js'
import { buildProviderEvidenceMap, type ProviderEvidence } from './model-eligibility.js'
import { rmSync } from 'node:fs'
import { buildEffectiveWorkerEnv } from './worker-env.js'

export const DEFAULT_WORKER_MODELS_TIMEOUT_MS = 90_000
export const MAX_WORKER_MODELS_TIMEOUT_MS = 300_000

export function resolveWorkerModelsTimeoutMs(
  raw: string | number | undefined = process.env.WORKER_MODELS_TIMEOUT_MS,
): number {
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_WORKER_MODELS_TIMEOUT_MS
  return Math.min(Math.floor(parsed), MAX_WORKER_MODELS_TIMEOUT_MS)
}

export async function defaultCanRunAcp(config: AcpSpawnConfig, timeoutMs = 3000): Promise<boolean> {
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
    },
  )
  return report.status === 'healthy'
}

export interface RunAcpTaskOptions {
  execute?: (
    config: AcpSpawnConfig,
    task: string,
  ) => Promise<{ ok: boolean; output?: string; error?: string }>
  onPermissionRequest?: (
    request: AcpPermissionRequest,
  ) => Promise<{ outcome: 'selected' | 'cancelled'; optionId?: string }>
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
    const effectiveEnv = buildEffectiveWorkerEnv({
      ambientEnv: process.env,
      workerEnv: config.env,
      model: config.model,
    })
    let spawnConfig = { ...config, env: effectiveEnv }
    let modelUsed: string | undefined
    const effectivePinned = config.model?.trim() || undefined

    if (config.kind === 'opencode') {
      const candidates = config.availableModels?.length ? config.availableModels : undefined
      const providers = candidates
        ? buildProviderEvidenceMap({
            modelIds: candidates.map((m) => m.modelId),
            env: effectiveEnv,
            zenFreeAllowlist: [...OPENCODE_ZEN_FREE_MODELS],
          })
        : undefined
      const prep = prepareOpenCodeAcpEnv({
        baseEnv: effectiveEnv,
        model: config.model,
        candidates,
        providers,
        zenFreeAllowlist: [...OPENCODE_ZEN_FREE_MODELS],
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
          const validOption = handle.modelOptions.models.find((m) => m.modelId === effectivePinned)
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
      try {
        rmSync(isolatedHome, { recursive: true, force: true })
      } catch {}
    }
  }
}

export interface ListAcpModelsResult {
  ok: boolean
  /** Full ACP candidate set */
  models: WorkerModelOption[]
  error?: string
  shortlist?: ShortlistEntry[]
  /** Shortlist as WorkerModelOption (for availableModels) */
  shortlistModels?: WorkerModelOption[]
  searchIndex?: WorkerModelOption[]
  openRouterModels?: WorkerModelOption[]
  remainingModels?: WorkerModelOption[]
  totalModelCount?: number
  providers?: Record<string, ProviderEvidence>
}

export async function listAcpModels(
  worker: Pick<WorkerRegistration, 'id' | 'name' | 'command' | 'args' | 'env' | 'kind' | 'model'>,
  opts?: { cwd?: string; timeoutMs?: number },
): Promise<ListAcpModelsResult> {
  const timeoutMs = resolveWorkerModelsTimeoutMs(opts?.timeoutMs)
  const cwd = opts?.cwd ?? resolveWorkerCwd(undefined)

  try {
    let env: Record<string, string>

    // Discovery still needs provider keys for that worker, but never full Leader env
    const { buildEffectiveWorkerEnv } = await import('./worker-env.js')
    env = buildEffectiveWorkerEnv({
      ambientEnv: process.env,
      workerEnv: worker.env,
      model: worker.model,
      // Model list needs provider auth for this worker's configured providers
      extraAmbientKeys: [
        'HTTP_PROXY',
        'HTTPS_PROXY',
        'http_proxy',
        'https_proxy',
        'NO_PROXY',
        'no_proxy',
        'SSL_CERT_FILE',
        'SSL_CERT_DIR',
        'NODE_EXTRA_CA_CERTS',
      ],
    })
    // For discovery, also allow keys listed on worker.env or known provider keys already
    // in process.env that worker registration intends (OPENCODE_API_KEY etc. via model).

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
    const timer = setTimeout(() => aborter.abort(), timeoutMs)

    try {
      const models = await withAcpSession(
        { spawn: spawnConfig, signal: aborter.signal },
        {},
        async (handle) => {
          if (!handle.modelOptions.ok || handle.modelOptions.models.length === 0) {
            throw new Error(handle.modelOptions.error ?? 'No models found in configOptions')
          }
          return handle.modelOptions.models.map((m) => ({
            modelId: m.modelId,
            name: m.name,
            description: m.description,
          }))
        },
      )

      // OpenCode: provider-prefix eligibility + auth/disabled evidence.
      // Claude/Codex/etc: ACP options are already executable candidates — shortlist = all.
      if (worker.kind === 'opencode') {
        // Worker env overlays ambient so XDG_*/HOME from worker registration win for evidence.
        const shortlistResult = computeShortlistedModels({
          allModels: models,
          pinnedModel: worker.model ?? undefined,
          zenFreeModels: [...OPENCODE_ZEN_FREE_MODELS],
          opencodeEnv: {
            ...(process.env as Record<string, string>),
            ...worker.env,
          } as Record<string, string>,
          useOpenCodeEvidence: true,
          realHome: worker.env?.HOME || process.env.HOME || undefined,
        })

        const shortlistModels: WorkerModelOption[] = shortlistResult.shortlist.map((e) => ({
          modelId: e.modelId,
          name: e.name,
          description: e.description,
          group: 'shortlist' as const,
        }))

        return {
          ok: true,
          models,
          shortlist: shortlistResult.shortlist,
          shortlistModels,
          searchIndex: shortlistResult.searchIndex,
          openRouterModels: shortlistResult.openRouterModels,
          remainingModels: shortlistResult.remainingModels,
          totalModelCount: shortlistResult.totalModelCount,
          providers: shortlistResult.providers,
        }
      }

      // Generic ACP: treat all configOptions as shortlist + searchIndex (no OpenCode prefix rules)
      const generic: WorkerModelOption[] = models.map((m) => ({
        ...m,
        group: 'shortlist' as const,
      }))
      return {
        ok: true,
        models,
        shortlistModels: generic,
        searchIndex: generic,
        totalModelCount: models.length,
        providers: Object.fromEntries(
          models.map((m) => {
            const i = m.modelId.indexOf('/')
            const pid = i > 0 ? m.modelId.slice(0, i) : m.modelId
            return [pid, 'authenticated' as const]
          }),
        ),
      }
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
