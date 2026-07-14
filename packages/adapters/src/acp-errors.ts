/**
 * User-facing ACP error helpers (Model is disabled, etc.)
 */

/** True when the CLI rejected the model (disabled / not found / not available). */
export function isModelDisabledError(message: string | undefined | null): boolean {
  if (!message) return false
  return /Model is disabled|model is disabled|model not found|model.*not available|is disabled|disabled model|no available model/i.test(
    message,
  )
}

export interface FormatWorkerModelErrorOpts {
  workerName: string
  kind?: string
  /** Pinned worker model (if any) */
  model?: string | null
  rawError: string
}

/**
 * Turn raw ACP failures into an action-oriented message.
 * Emphasizes selecting a model in the Workers panel when the default is disabled.
 */
export function formatWorkerModelError(opts: FormatWorkerModelErrorOpts): string {
  const raw = (opts.rawError || '').trim()
  // Already decorated (e.g. runner → scheduler)
  if (/【模型不可用】/.test(raw)) return raw
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
    opts.kind === 'opencode'
      ? 'OpenCode 的 CLI 默认模型常被禁用；'
      : '当前使用 CLI 默认模型；'

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
  }>,
): string {
  const lines = workers
    .filter((w) => w.enabled !== false)
    .map((w) => {
      const model = w.model?.trim() || '(default — may be disabled)'
      const n = w.availableModels?.length ?? 0
      const need =
        w.kind === 'opencode' && !w.model?.trim()
          ? ' ⚠ needs model selection'
          : ''
      const catalog =
        n > 0
          ? ` | catalog: ${w.availableModels!
              .slice(0, 8)
              .map((m) => m.modelId)
              .join(', ')}${n > 8 ? ` (+${n - 8})` : ''}`
          : ''
      return `- ${w.name} (${w.kind}): model=${model}${need}${catalog}`
    })
  return lines.length ? lines.join('\n') : '(no enabled workers)'
}
