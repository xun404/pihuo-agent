/**
 * Thinking / reasoning intensity for Leader model calls.
 * Mapped onto provider-specific options (OpenAI reasoningEffort, Anthropic
 * thinking budget, Google thinkingConfig, etc.).
 *
 * @see https://mastra.ai/models — providerOptions / reasoningEffort
 */

export const THINKING_INTENSITIES = ['off', 'low', 'medium', 'high', 'max'] as const

export type ThinkingIntensity = (typeof THINKING_INTENSITIES)[number]

export const DEFAULT_THINKING_INTENSITY: ThinkingIntensity = 'medium'

export function isThinkingIntensity(v: unknown): v is ThinkingIntensity {
  return typeof v === 'string' && (THINKING_INTENSITIES as readonly string[]).includes(v)
}

export function normalizeThinkingIntensity(raw: unknown): ThinkingIntensity {
  if (isThinkingIntensity(raw)) return raw
  return DEFAULT_THINKING_INTENSITY
}

/** OpenAI-compatible reasoningEffort values */
function openaiEffort(level: ThinkingIntensity): string {
  switch (level) {
    case 'off':
      return 'none'
    case 'low':
      return 'low'
    case 'medium':
      return 'medium'
    case 'high':
      return 'high'
    case 'max':
      return 'xhigh'
  }
}

/** Anthropic extended-thinking budget tokens */
function anthropicBudget(level: ThinkingIntensity): number | null {
  switch (level) {
    case 'off':
      return null
    case 'low':
      return 2_000
    case 'medium':
      return 8_000
    case 'high':
      return 16_000
    case 'max':
      return 32_000
  }
}

/** Google Gemini thinkingBudget tokens */
function googleBudget(level: ThinkingIntensity): number {
  switch (level) {
    case 'off':
      return 0
    case 'low':
      return 1_024
    case 'medium':
      return 8_192
    case 'high':
      return 16_384
    case 'max':
      return 24_576
  }
}

/**
 * Build Mastra / AI SDK `providerOptions` for the given intensity.
 * Includes common providers so model-router gateways pick the right branch.
 */
export function thinkingIntensityToProviderOptions(
  level: ThinkingIntensity,
): Record<string, Record<string, unknown>> {
  const effort = openaiEffort(level)
  const anthBudget = anthropicBudget(level)
  const googBudget = googleBudget(level)

  const openaiLike = { reasoningEffort: effort }

  const anthropic =
    anthBudget == null
      ? { thinking: { type: 'disabled' as const } }
      : {
          thinking: {
            type: 'enabled' as const,
            budgetTokens: anthBudget,
          },
        }

  const google = {
    thinkingConfig: {
      thinkingBudget: googBudget,
      includeThoughts: level !== 'off',
    },
  }

  return {
    openai: openaiLike,
    // OpenAI-compatible gateways / models.dev often honor the openai key
    // when the underlying model is o-series / reasoning-capable.
    anthropic,
    google,
    // xAI Grok reasoning-ish models often accept openai-compatible fields
    xai: openaiLike,
    deepseek: openaiLike,
    openrouter: openaiLike,
    groq: openaiLike,
    // OpenCode Zen / Go go through models.dev with openai-compatible SDKs
    opencode: openaiLike,
    'opencode-go': openaiLike,
  }
}
