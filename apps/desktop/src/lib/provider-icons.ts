/**
 * Provider brand icons (emoji / monogram) for settings grid.
 * Covers built-in catalog ids + generic custom fallback.
 */

export type ProviderIcon = {
  /** Short glyph shown in the card */
  glyph: string
  /** Background tint class suffix or inline color */
  color: string
}

const ICONS: Record<string, ProviderIcon> = {
  openai: { glyph: '◈', color: '#10a37f' },
  anthropic: { glyph: '✱', color: '#d4a27f' },
  google: { glyph: 'G', color: '#4285f4' },
  xai: { glyph: '𝕏', color: '#e8e8e8' },
  deepseek: { glyph: '🐋', color: '#4d6bfe' },
  mistral: { glyph: 'M', color: '#ff7000' },
  groq: { glyph: '⚡', color: '#f55036' },
  openrouter: { glyph: '⇄', color: '#6566f1' },
  azure: { glyph: '☁', color: '#0078d4' },
  'amazon-bedrock': { glyph: '▲', color: '#ff9900' },
  cohere: { glyph: 'C', color: '#39594d' },
  cerebras: { glyph: '◆', color: '#f15a29' },
  fireworks: { glyph: '✦', color: '#7c3aed' },
  together: { glyph: '◎', color: '#0f6fff' },
  perplexity: { glyph: 'P', color: '#22b8cf' },
  ollama: { glyph: '🦙', color: '#ffffff' },
  alibaba: { glyph: '☁', color: '#ff6a00' },
  moonshotai: { glyph: '🌙', color: '#1a1a2e' },
  zhipuai: { glyph: '智', color: '#3859ff' },
  siliconflow: { glyph: '◇', color: '#7c3aed' },
  nvidia: { glyph: 'N', color: '#76b900' },
  'cloudflare-workers-ai': { glyph: 'CF', color: '#f6821f' },
  huggingface: { glyph: '🤗', color: '#ffd21e' },
}

export function getProviderIcon(providerId: string): ProviderIcon {
  if (ICONS[providerId]) return ICONS[providerId]!
  // monogram from id
  const g = providerId.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || '?'
  return { glyph: g, color: '#6b7280' }
}
