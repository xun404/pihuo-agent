import { THINKING_INTENSITY_OPTIONS, defaultThinkingFor, type ThinkingIntensity } from './settings'

/** Per-model chat preference, kept in the renderer profile across app restarts. */
export const MODEL_THINKING_MEMORY_STORAGE_KEY = 'pihuo-agent.model-thinking-memory'

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

export type ModelThinkingMemory = Record<string, ThinkingIntensity>

function isThinkingIntensity(value: unknown): value is ThinkingIntensity {
  return (
    typeof value === 'string' && (THINKING_INTENSITY_OPTIONS as readonly string[]).includes(value)
  )
}

function rendererStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** Parse defensively so a malformed old preference never blocks the composer. */
export function parseModelThinkingMemory(raw: string | null): ModelThinkingMemory {
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const memory: ModelThinkingMemory = {}
    for (const [modelId, intensity] of Object.entries(parsed)) {
      if (modelId.trim() && isThinkingIntensity(intensity)) memory[modelId] = intensity
    }
    return memory
  } catch {
    return {}
  }
}

export function loadModelThinkingMemory(
  storage: StorageLike | null = rendererStorage(),
): ModelThinkingMemory {
  if (!storage) return {}
  try {
    return parseModelThinkingMemory(storage.getItem(MODEL_THINKING_MEMORY_STORAGE_KEY))
  } catch {
    return {}
  }
}

/** Save only explicit user choices; automatic model defaults do not become sticky. */
export function rememberModelThinkingIntensity(
  modelId: string,
  intensity: ThinkingIntensity,
  storage: StorageLike | null = rendererStorage(),
): void {
  const key = modelId.trim()
  if (!key || !isThinkingIntensity(intensity) || !storage) return
  try {
    storage.setItem(
      MODEL_THINKING_MEMORY_STORAGE_KEY,
      JSON.stringify({ ...loadModelThinkingMemory(storage), [key]: intensity }),
    )
  } catch {
    // Preferences are a convenience; an unavailable storage must not block chat.
  }
}

/**
 * Prefer the last explicit setting for this exact model.  A saved intensity is
 * used only while the model still supports it; otherwise we preserve the
 * existing linked-default policy.
 */
export function resolveModelThinkingIntensity(
  modelId: string,
  supported: readonly ThinkingIntensity[],
  options: {
    preferred?: ThinkingIntensity
    memory?: ModelThinkingMemory
  } = {},
): ThinkingIntensity {
  const allowed =
    supported.length > 0 ? [...supported] : ([...THINKING_INTENSITY_OPTIONS] as ThinkingIntensity[])
  const usable = (value: ThinkingIntensity | undefined): value is ThinkingIntensity =>
    value != null && allowed.includes(value)

  if (usable(options.preferred)) return options.preferred
  const remembered = (options.memory ?? loadModelThinkingMemory())[modelId.trim()]
  if (usable(remembered)) return remembered
  return defaultThinkingFor(allowed)
}
