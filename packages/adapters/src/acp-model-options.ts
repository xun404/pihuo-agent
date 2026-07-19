import type { SessionConfigOption } from '@agentclientprotocol/sdk'

export interface ModelOption {
  modelId: string
  name: string
  description?: string
  currentValue?: string
}

export interface ModelOptionsResult {
  ok: boolean
  models: ModelOption[]
  currentModelId?: string
  error?: string
}

const MODEL_CATEGORIES = new Set(['model', 'model_config'])
const MODEL_ID_GUESS: Record<string, boolean> = { model: true }

function isModelConfig(opt: SessionConfigOption): boolean {
  if (opt.category && MODEL_CATEGORIES.has(opt.category)) return true
  if (MODEL_ID_GUESS[opt.id]) return true
  if (/^model/i.test(opt.id)) return true
  return false
}

function isSelectOption(opt: SessionConfigOption): opt is SessionConfigOption & { type: 'select' } {
  return opt.type === 'select' && 'options' in opt && 'currentValue' in opt
}

export function extractModelOptions(
  configOptions: SessionConfigOption[] | null | undefined,
): ModelOptionsResult {
  if (!configOptions || configOptions.length === 0) {
    return {
      ok: false,
      models: [],
      error: 'ACP agent did not declare any configOptions',
    }
  }

  const modelOpts = configOptions.filter(isModelConfig)

  if (modelOpts.length === 0) {
    return {
      ok: false,
      models: [],
      error: 'No model-like configOption found in session configOptions',
    }
  }

  const seen = new Set<string>()
  const models: ModelOption[] = []
  let currentModelId: string | undefined

  for (const opt of modelOpts) {
    if (!isSelectOption(opt)) continue
    const groups = opt.options ?? []
    for (const item of Array.isArray(groups) ? groups : []) {
      if ('group' in item) {
        for (const sub of item.options) {
          if (sub.value && !seen.has(sub.value)) {
            seen.add(sub.value)
            models.push({
              modelId: sub.value,
              name: sub.name || sub.value,
              description: sub.description ?? undefined,
            })
          }
        }
      } else if ('value' in item) {
        if (item.value && !seen.has(item.value)) {
          seen.add(item.value)
          models.push({
            modelId: item.value,
            name: item.name || item.value,
            description: item.description ?? undefined,
          })
        }
      }
    }
    if (opt.currentValue) {
      for (const m of models) {
        if (m.modelId === opt.currentValue) {
          m.currentValue = opt.currentValue
          break
        }
      }
      if (!currentModelId) currentModelId = opt.currentValue
    }
  }

  if (models.length === 0) {
    return {
      ok: false,
      models: [],
      currentModelId,
      error: 'Model config option found but no selectable values declared',
    }
  }

  return { ok: true, models, currentModelId }
}
