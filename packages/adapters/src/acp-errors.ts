/**
 * User-facing ACP error helpers (Model is disabled, stable error codes, etc.)
 */

/** True when the CLI rejected the model (disabled / not found / not available). */
export function isModelDisabledError(message: string | undefined | null): boolean {
  if (!message) return false
  return /Model is disabled|model is disabled|model not found|model.*not available|is disabled|disabled model|no available model/i.test(
    message,
  )
}

export type PublicErrorLocale = 'zh' | 'en'

/** Stable public error codes used by Worker model pin / runtime / Leader surfaces. */
export type PublicErrorCode =
  | 'MODEL_CATALOG_STALE'
  | 'MODEL_PROVIDER_UNAVAILABLE'
  | 'MODEL_SELECTION_UNVERIFIED'
  | 'MODEL_REFRESH_FAILED'
  | 'MODEL_NOT_IN_CANDIDATES'
  | 'MODEL_OPENROUTER_SEARCH_ONLY'
  | 'RUNTIME_OWNER_EXISTS'
  | 'ROUTER_RUNTIME_UNAVAILABLE'
  | 'ROUTER_SESSION_BINDING_REQUIRED'
  | 'RUNTIME_AUTH_FAILED'

const PUBLIC_ERROR_MESSAGES: Record<PublicErrorCode, { zh: string; en: string }> = {
  MODEL_CATALOG_STALE: {
    zh: '模型目录已过期，请刷新后重试',
    en: 'Model catalog is stale; refresh and retry',
  },
  MODEL_PROVIDER_UNAVAILABLE: {
    zh: '模型供应商当前不可用',
    en: 'Model provider is currently unavailable',
  },
  MODEL_SELECTION_UNVERIFIED: {
    zh: '无法验证该模型，请从列表选择或刷新目录',
    en: 'Model selection could not be verified; pick from the list or refresh',
  },
  MODEL_REFRESH_FAILED: {
    zh: '模型列表刷新失败，请稍后重试',
    en: 'Failed to refresh model list; try again later',
  },
  MODEL_NOT_IN_CANDIDATES: {
    zh: '所选模型不在可用列表中',
    en: 'Selected model is not in the available list',
  },
  MODEL_OPENROUTER_SEARCH_ONLY: {
    zh: '该 OpenRouter 模型仅支持搜索，请先展开搜索再选择',
    en: 'This OpenRouter model is search-only; search then select',
  },
  RUNTIME_OWNER_EXISTS: {
    zh: '运行时已被其他进程占用',
    en: 'Runtime is already owned by another process',
  },
  ROUTER_RUNTIME_UNAVAILABLE: {
    zh: 'Router 运行时不可用',
    en: 'Router runtime is unavailable',
  },
  ROUTER_SESSION_BINDING_REQUIRED: {
    zh: '需要绑定 Router 会话后才能继续',
    en: 'Router session binding is required',
  },
  RUNTIME_AUTH_FAILED: {
    zh: '运行时鉴权失败，请检查密钥配置',
    en: 'Runtime authentication failed; check API keys',
  },
}

function normalizeErrorCode(code: string | undefined | null): PublicErrorCode | null {
  if (!code) return null
  const key = code.trim().toUpperCase() as PublicErrorCode
  return key in PUBLIC_ERROR_MESSAGES ? key : null
}

/**
 * Map stable error codes to short public messages (zh/en).
 * Returns undefined when the code is unknown.
 */
export function publicErrorMessage(
  code: string | undefined | null,
  locale: PublicErrorLocale = 'zh',
): string | undefined {
  const key = normalizeErrorCode(code)
  if (!key) return undefined
  return PUBLIC_ERROR_MESSAGES[key][locale]
}

/**
 * Prefer public message for known codes; otherwise fall back to raw text.
 */
export function formatPublicError(
  code: string | undefined | null,
  fallback?: string | null,
  locale: PublicErrorLocale = 'zh',
): string {
  return publicErrorMessage(code, locale) ?? (fallback?.trim() || code || 'Error')
}

export interface FormatWorkerModelErrorOpts {
  workerName: string
  kind?: string
  /** Pinned worker model (if any) */
  model?: string | null
  rawError: string
  /** Stable machine code when available */
  errorCode?: string | null
  locale?: PublicErrorLocale
}

/**
 * Turn raw ACP failures into an action-oriented message.
 * Emphasizes selecting a model in the Workers panel when the default is disabled.
 * Prefer stable errorCode public copy when present.
 */
export function formatWorkerModelError(opts: FormatWorkerModelErrorOpts): string {
  const locale = opts.locale ?? 'zh'
  const raw = (opts.rawError || '').trim()
  // Already decorated (e.g. runner → scheduler)
  if (/【模型不可用】/.test(raw) || /\[model unavailable\]/i.test(raw)) return raw

  const fromCode = publicErrorMessage(opts.errorCode, locale)
  if (fromCode) {
    const name = opts.workerName || 'Worker'
    const pin = opts.model?.trim()
    if (locale === 'en') {
      return pin
        ? `[model unavailable] ${name} model "${pin}": ${fromCode}. Open Workers and pick a listed model.`
        : `[model unavailable] ${name}: ${fromCode}. Open Workers → select a model (do not leave Default).`
    }
    return pin
      ? `【模型不可用】${name} 配置的模型「${pin}」：${fromCode}。请在右侧 Workers 面板更换为列表中的可用模型后重试。`
      : `【模型不可用】${name}：${fromCode}。请打开右侧 Workers → 选择可用模型（勿用「默认」）后再派发任务。`
  }

  if (!isModelDisabledError(raw)) return raw || 'ACP failed'

  const name = opts.workerName || 'Worker'
  const pin = opts.model?.trim()
  const shortRaw = raw.length > 160 ? `${raw.slice(0, 160)}…` : raw

  if (pin) {
    return (
      `【模型不可用】${name} 配置的模型「${pin}」当前不可用（${shortRaw}）。` +
      `请在右侧 Workers 面板更换为列表中的可用模型后重试。`
    )
  }

  const opencodeHint =
    opts.kind === 'opencode' ? 'OpenCode 的 CLI 默认模型常被禁用；' : '当前使用 CLI 默认模型；'

  return (
    `【模型不可用】${name}：${opencodeHint}` +
    `默认模型不可用（${shortRaw}）。` +
    `请打开右侧 Workers → 选择可用模型（勿用「默认」）后再派发任务。`
  )
}

/** Compact one-line summary for leader/tool context. */
export function summarizeWorkerModels(
  workers: Array<{
    name: string
    kind: string
    enabled?: boolean
    model?: string | null
    availableModels?: Array<{ modelId: string; name?: string }> | null
    modelsState?: string | null
    modelCatalogState?: string | null
    needsModelSelection?: boolean
  }>,
): string {
  const lines = workers
    .filter((w) => w.enabled !== false)
    .map((w) => {
      const model = w.model?.trim() || '(default — may be disabled)'
      const n = w.availableModels?.length ?? 0
      const need =
        w.needsModelSelection === true || (w.kind === 'opencode' && !w.model?.trim())
          ? ' ⚠ needs model selection'
          : ''
      const state =
        w.modelCatalogState || w.modelsState
          ? ` | state=${w.modelCatalogState ?? w.modelsState}`
          : ''
      const catalog =
        n > 0
          ? ` | catalog: ${w
              .availableModels!.slice(0, 8)
              .map((m) => m.modelId)
              .join(', ')}${n > 8 ? ` (+${n - 8})` : ''}`
          : ''
      return `- ${w.name} (${w.kind}): model=${model}${need}${state}${catalog}`
    })
  return lines.length ? lines.join('\n') : '(no enabled workers)'
}
