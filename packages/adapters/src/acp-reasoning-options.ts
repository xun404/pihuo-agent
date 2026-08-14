import type { SessionConfigOption } from '@agentclientprotocol/sdk'
import type { WorkerReasoningSelector } from '@pihuo-agent/shared'
import { withAcpSession } from './acp-session.js'
import { extractModelOptions } from './acp-model-options.js'
import { buildEffectiveWorkerEnv } from './worker-env.js'
import { resolveWorkerCwd } from './presets.js'
import type { WorkerRegistration } from '@pihuo-agent/shared'

const REASONING_CATEGORY = 'thought_level'

const KNOWN_REASONING_IDS: Record<string, boolean> = {
  reasoning_effort: true,
  effort: true,
}

interface FlattenedOption {
  value: string
  name: string
  description?: string
}

function flattenOptions(rawOptions: readonly unknown[]): FlattenedOption[] {
  const result: FlattenedOption[] = []
  for (const item of rawOptions) {
    if (!item || typeof item !== 'object') continue
    const candidate = item as Record<string, unknown>
    if ('group' in candidate) {
      const childOptions = (candidate.options as unknown[]) ?? []
      for (const child of childOptions) {
        if (child && typeof child === 'object' && 'value' in child) {
          const c = child as Record<string, unknown>
          result.push({
            value: String(c.value ?? ''),
            name: String(c.name ?? c.value ?? ''),
            description: typeof c.description === 'string' ? c.description : undefined,
          })
        }
      }
    } else if ('value' in candidate) {
      result.push({
        value: String(candidate.value),
        name: String(candidate.name ?? candidate.value),
        description: typeof candidate.description === 'string' ? candidate.description : undefined,
      })
    }
  }
  return result
}

export function extractReasoningSelector(
  options: readonly SessionConfigOption[] | null | undefined,
): WorkerReasoningSelector | undefined {
  if (!options || options.length === 0) return undefined

  // Phase 1: category "thought_level" takes priority
  let candidate: SessionConfigOption | undefined
  for (const opt of options) {
    if (
      opt.category === REASONING_CATEGORY &&
      (opt as any).type === 'select' &&
      Array.isArray((opt as any).options)
    ) {
      candidate = opt
      break
    }
  }

  // Phase 2: fallback to known reasoning IDs when no category match
  if (!candidate) {
    for (const opt of options) {
      if (
        KNOWN_REASONING_IDS[opt.id] &&
        (opt as any).type === 'select' &&
        Array.isArray((opt as any).options)
      ) {
        candidate = opt
        break
      }
    }
  }

  if (!candidate) return undefined

  const flattened = flattenOptions((candidate as any).options as readonly unknown[])

  if (flattened.length === 0) return undefined

  const currentValue =
    typeof (candidate as any).currentValue === 'string'
      ? ((candidate as any).currentValue as string)
      : undefined

  return {
    configId: candidate.id,
    currentValue,
    options: flattened,
  }
}

export interface ListAcpReasoningOptionsResult {
  ok: boolean
  supported: boolean
  selector?: WorkerReasoningSelector
  error?: string
}

export async function listAcpReasoningOptions(
  worker: Pick<WorkerRegistration, 'id' | 'name' | 'command' | 'args' | 'env' | 'kind'>,
  model?: string,
  opts?: { cwd?: string; timeoutMs?: number },
): Promise<ListAcpReasoningOptionsResult> {
  const cwd = opts?.cwd ?? resolveWorkerCwd(undefined)
  const timeoutMs = opts?.timeoutMs ?? 60_000

  try {
    const env = buildEffectiveWorkerEnv({
      ambientEnv: process.env,
      workerEnv: worker.env,
      model,
    })

    const result = await withAcpSession(
      {
        spawn: {
          command: worker.command,
          args: [...(worker.args ?? [])],
          cwd,
          env,
          workerId: worker.id,
          workerName: worker.name,
          kind: worker.kind,
          primaryRole: 'general',
          roles: ['general'],
        },
        timeoutMs,
      },
      {},
      async (handle) => {
        let currentOptions = handle.configOptions

        if (model?.trim()) {
          const modelOptions = extractModelOptions(currentOptions)
          if (!modelOptions.ok) {
            throw new Error(`Cannot discover model options: ${modelOptions.error}`)
          }
          const modelOption = modelOptions.models.find((m) => m.modelId === model)
          if (!modelOption) {
            throw new Error(`Model "${model}" is not available in current configOptions`)
          }
          const modelOptId = currentOptions.find(
            (o) =>
              o.type === 'select' &&
              'options' in o &&
              Array.isArray(o.options) &&
              o.options.some((ov) => {
                if ('group' in ov) {
                  return ov.options.some((s) => s.value === model)
                }
                return 'value' in ov && ov.value === model
              }),
          )?.id
          if (!modelOptId) {
            throw new Error(`Cannot find config option id for model "${model}"`)
          }
          currentOptions = await handle.setConfigOption(modelOptId, model)
        }

        const selector = extractReasoningSelector(currentOptions)
        return { supported: selector !== undefined, selector }
      },
    )

    return {
      ok: true,
      supported: result.supported,
      selector: result.selector,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return {
      ok: false,
      supported: false,
      error: msg,
    }
  }
}
