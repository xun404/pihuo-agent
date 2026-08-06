/**
 * Color themes are deliberately separate from appearance tokens.
 *
 * This module owns the OpenChamber-compatible color shape, the built-in
 * registry, and the renderer-side validator for user themes. Appearance
 * (font, spacing, radius, motion, etc.) consumes the normalized theme below
 * but never owns color literals.
 */

import { bundledThemeJson } from './themes'

export type ColorThemeVariant = 'light' | 'dark'
/** IDs are metadata-driven; these aliases document the product defaults. */
export type BuiltInThemeId = string
export type ColorThemeId = string
export type CssTokenValue = string | number

export type TypographySizeToken =
  '2xs' | 'xs' | 'sm' | 'base' | 'md' | 'lg' | 'xl' | '2xl' | 'display'
export type TypographyWeightToken = 'regular' | 'medium' | 'semibold' | 'bold'
export type TypographyLineHeightToken = 'tight' | 'snug' | 'body' | 'relaxed'
export type TypographyLetterSpacingToken = 'tight' | 'display' | 'label'
export type ChatTypographyToken =
  | 'body-size'
  | 'body-line-height'
  | 'user-line-height'
  | 'heading-h1-size'
  | 'heading-h2-size'
  | 'heading-line-height'
  | 'heading-tight'
  | 'heading-snug'
  | 'code-size'
  | 'code-line-height'
  | 'process-size'
  | 'process-line-height'
  | 'process-summary-line-height'
  | 'meta-size'
  | 'micro-size'
  | 'tiny-size'
  | 'badge-size'
  | 'preview-index-size'
  | 'preview-index-spacing'
  | 'preview-question-size'
  | 'preview-answer-size'
  | 'preview-running-size'
  | 'preview-line-height'

export interface ThemeTypographyOverrides {
  sizes?: Partial<Record<TypographySizeToken, CssTokenValue>>
  weights?: Partial<Record<TypographyWeightToken, CssTokenValue>>
  lineHeights?: Partial<Record<TypographyLineHeightToken, CssTokenValue>>
  letterSpacing?: Partial<Record<TypographyLetterSpacingToken, CssTokenValue>>
  chat?: Partial<Record<ChatTypographyToken, CssTokenValue>>
}

export type ThemeColorMap = Record<string, string>

export interface ColorTokens {
  'text-1': string
  'text-2': string
  'text-3': string
  'text-4': string
  'text-inv': string
  'bg-page': string
  'bg-sidebar': string
  'bg-main': string
  'bg-surface': string
  'bg-hover': string
  'bg-active': string
  'bg-input': string
  border: string
  'border-soft': string
  accent: string
  'accent-soft': string
  blue: string
  'blue-soft': string
  green: string
  'green-soft': string
  purple: string
  warn: string
  'warn-soft': string
  danger: string
  'danger-soft': string
  'diff-syn-keyword': string
  'diff-syn-type': string
  'diff-syn-string': string
  'diff-syn-number': string
  'diff-syn-comment': string
  'diff-syn-fn': string
  'diff-syn-punct': string
  'send-bg': string
  'claude-bg': string
  'claude-fg': string
  'codex-bg': string
  'codex-fg': string
  'opencode-bg': string
  'opencode-fg': string
  'openai-bg': string
  'anthropic-bg': string
  'anthropic-fg': string
  'scrollbar-thumb': string
  'scrollbar-thumb-hover': string
  'shadow-xs': string
  'shadow-sm': string
  'shadow-md': string
  'shadow-lg': string
  'shadow-composer': string
}

export interface ThemeFontDefaults {
  sans: string
  mono: string
  heading?: string
  /** Optional readable prose face; defaults to the canonical CJK sans stack. */
  prose?: string
}

export interface ColorTheme {
  id: ColorThemeId
  name: string
  description?: string
  version?: string
  variant: ColorThemeVariant
  colors: ColorTokens
  /** Optional source defaults consumed by appearance.config.ts. */
  fonts?: ThemeFontDefaults
  typography?: ThemeTypographyOverrides
  /** Source-specific colors preserved as CSS namespaces for Chat consumers. */
  chatColors?: ThemeColorMap
  markdownColors?: ThemeColorMap
  toolsColors?: ThemeColorMap
  source: 'builtin' | 'custom'
}

export interface ThemeFileInput {
  filename: string
  raw: unknown
}

export const DEFAULT_LIGHT_THEME_ID: BuiltInThemeId = 'mono-plus-light'
export const DEFAULT_DARK_THEME_ID: BuiltInThemeId = 'mono-plus-dark'

/** The source schema subset needed by the desktop adapter. */
export interface OpenChamberThemeJson {
  metadata: {
    id: string
    name: string
    description?: string
    version?: string
    variant: string
    tags?: string[]
  }
  colors: {
    primary: {
      base: string
      hover?: string
      active?: string
      foreground?: string
      muted?: string
      emphasis?: string
    }
    surface: {
      background: string
      foreground: string
      muted: string
      mutedForeground: string
      elevated: string
      elevatedForeground?: string
      overlay?: string
      subtle: string
    }
    interactive: {
      border: string
      borderHover?: string
      borderFocus?: string
      selection?: string
      selectionForeground?: string
      focus?: string
      focusRing?: string
      cursor?: string
      hover: string
      active: string
    }
    status: {
      error: string
      errorForeground?: string
      errorBackground: string
      errorBorder?: string
      warning: string
      warningForeground?: string
      warningBackground: string
      warningBorder?: string
      success: string
      successForeground?: string
      successBackground: string
      successBorder?: string
      info: string
      infoForeground?: string
      infoBackground: string
      infoBorder?: string
    }
    pr?: Record<string, string>
    syntax: {
      base: {
        background: string
        foreground: string
        comment: string
        keyword: string
        string: string
        number: string
        function: string
        variable?: string
        type: string
        operator: string
      }
      tokens?: Record<string, string>
      highlights?: Record<string, string>
    }
    markdown?: Record<string, string>
    chat?: Record<string, string>
    tools?: Record<string, unknown>
  }
  config?: {
    fonts?: ThemeFontDefaults
    typography?: Record<string, unknown>
    transitions?: Record<string, string>
  }
}

/** Neutral light fallback used only when adapting an incomplete source file. */
const lightFallbackColors = {
  'text-1': '#2c2522',
  'text-2': '#5c534c',
  'text-3': '#8a8178',
  'text-4': '#b3aaa0',
  'text-inv': '#ffffff',
  'bg-page': '#e8e2d9',
  'bg-sidebar': '#f3efe9',
  'bg-main': '#f7f4ef',
  'bg-surface': '#fffcf8',
  'bg-hover': 'rgba(80, 50, 20, 0.05)',
  'bg-active': 'rgba(80, 50, 20, 0.09)',
  'bg-input': '#f3efe8',
  border: 'rgba(60, 40, 20, 0.1)',
  'border-soft': 'rgba(60, 40, 20, 0.06)',
  accent: '#8a8178',
  'accent-soft': 'rgba(80, 50, 20, 0.05)',
  blue: '#6a7e9e',
  'blue-soft': 'rgba(106, 126, 158, 0.1)',
  green: '#6a8e6a',
  'green-soft': 'rgba(106, 142, 106, 0.12)',
  purple: '#8a7a9a',
  warn: '#9e8a6a',
  'warn-soft': 'rgba(158, 138, 106, 0.12)',
  danger: '#9e6a6a',
  'danger-soft': 'rgba(158, 106, 106, 0.1)',
  'diff-syn-keyword': '#8a7a9a',
  'diff-syn-type': '#6a8a9a',
  'diff-syn-string': '#7a8e6a',
  'diff-syn-number': '#9a8068',
  'diff-syn-comment': 'var(--text-3)',
  'diff-syn-fn': '#6a7e9e',
  'diff-syn-punct': 'var(--text-2)',
  'send-bg': '#2a2d34',
  'claude-bg': '#f0e6dc',
  'claude-fg': '#c96442',
  'codex-bg': '#10a37f',
  'codex-fg': '#ffffff',
  'opencode-bg': '#211e1e',
  'opencode-fg': '#f1ecec',
  'openai-bg': '#10a37f',
  'anthropic-bg': '#f0e6dc',
  'anthropic-fg': '#c96442',
  'scrollbar-thumb': 'rgba(20, 30, 50, 0.14)',
  'scrollbar-thumb-hover': 'rgba(20, 30, 50, 0.24)',
  'shadow-xs': '0 1px 2px rgba(20, 30, 50, 0.05)',
  'shadow-sm': '0 1px 3px rgba(20, 30, 50, 0.06)',
  'shadow-md': '0 1px 2px rgba(20, 30, 50, 0.04), 0 8px 24px rgba(20, 30, 50, 0.06)',
  'shadow-lg': '0 0 0 1px rgba(20, 30, 50, 0.06), 0 20px 48px rgba(20, 30, 50, 0.12)',
  'shadow-composer': '0 4px 8px rgba(20, 30, 50, 0.03), 0 16px 40px rgba(20, 30, 50, 0.08)',
} satisfies ColorTokens

/** Neutral dark fallback used only when adapting an incomplete source file. */
const darkFallbackColors = {
  ...lightFallbackColors,
  'text-1': '#e8e4de',
  'text-2': '#a8a29a',
  'text-3': '#8a847c',
  'text-4': '#6b665e',
  'bg-page': '#12100e',
  'bg-sidebar': '#1d1a18',
  'bg-main': '#171515',
  'bg-surface': '#211d1a',
  'bg-hover': 'rgba(255, 255, 255, 0.05)',
  'bg-active': 'rgba(255, 255, 255, 0.1)',
  'bg-input': '#1d1a18',
  border: 'rgba(255, 255, 255, 0.1)',
  'border-soft': 'rgba(255, 255, 255, 0.06)',
  'blue-soft': 'rgba(106, 126, 158, 0.14)',
  'green-soft': 'rgba(106, 142, 106, 0.14)',
  'warn-soft': 'rgba(158, 138, 106, 0.14)',
  'danger-soft': 'rgba(158, 106, 106, 0.14)',
  'diff-syn-keyword': '#bda2e8',
  'diff-syn-type': '#8ab8cc',
  'diff-syn-string': '#9cb88c',
  'diff-syn-number': '#d4b69a',
  'diff-syn-comment': 'color-mix(in srgb, var(--text-3) 90%, #b0a8a0)',
  'diff-syn-fn': '#a2bee8',
  'diff-syn-punct': 'var(--text-3)',
  'shadow-md': '0 8px 28px rgba(0, 0, 0, 0.35)',
  'shadow-composer': '0 16px 40px rgba(0, 0, 0, 0.4)',
  'send-bg': '#8a8178',
  'claude-bg': 'rgba(201, 100, 66, 0.22)',
  'claude-fg': '#e8a588',
  'codex-bg': '#0d8a6a',
  'opencode-bg': '#f1ecec',
  'opencode-fg': '#211e1e',
  'scrollbar-thumb': 'rgba(255, 255, 255, 0.16)',
  'scrollbar-thumb-hover': 'rgba(255, 255, 255, 0.28)',
} satisfies ColorTokens

/**
 * Normalize every bundled JSON source once at module load.  The JSON list is
 * the source of truth; no bundled color object is duplicated here.
 */
const bundledColorThemes = bundledThemeJson.flatMap((raw) => {
  const theme = normalizeBundledTheme(raw)
  return theme ? [theme] : []
})

const bundledDefaultFirst = bundledColorThemes.find((theme) => theme.id === DEFAULT_LIGHT_THEME_ID)

export const builtinColorThemes: readonly ColorTheme[] = [
  ...(bundledDefaultFirst
    ? [bundledDefaultFirst, ...bundledColorThemes.filter((theme) => theme !== bundledDefaultFirst)]
    : bundledColorThemes),
]

export function findBuiltinColorTheme(id: string): ColorTheme | undefined {
  return builtinColorThemes.find((theme) => theme.id === id)
}

export function getBuiltinColorTheme(id: BuiltInThemeId): ColorTheme {
  const theme = findBuiltinColorTheme(id)
  if (!theme) throw new Error(`Unknown built-in color theme: ${id}`)
  return theme
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function sourceString(value: unknown, fallback: string): string {
  return nonEmptyString(value) ? value : fallback
}

const typographySizeKeys = [
  '2xs',
  'xs',
  'sm',
  'base',
  'md',
  'lg',
  'xl',
  '2xl',
  'display',
] as const satisfies readonly TypographySizeToken[]

const typographyWeightKeys = [
  'regular',
  'medium',
  'semibold',
  'bold',
] as const satisfies readonly TypographyWeightToken[]

const typographyLineHeightKeys = [
  'tight',
  'snug',
  'body',
  'relaxed',
] as const satisfies readonly TypographyLineHeightToken[]

const typographyLetterSpacingKeys = [
  'tight',
  'display',
  'label',
] as const satisfies readonly TypographyLetterSpacingToken[]

const chatTypographyKeys = [
  'body-size',
  'body-line-height',
  'user-line-height',
  'heading-h1-size',
  'heading-h2-size',
  'heading-line-height',
  'heading-tight',
  'heading-snug',
  'code-size',
  'code-line-height',
  'process-size',
  'process-line-height',
  'process-summary-line-height',
  'meta-size',
  'micro-size',
  'tiny-size',
  'badge-size',
  'preview-index-size',
  'preview-index-spacing',
  'preview-question-size',
  'preview-answer-size',
  'preview-running-size',
  'preview-line-height',
] as const satisfies readonly ChatTypographyToken[]

function cssTokenValue(value: unknown): CssTokenValue | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return nonEmptyString(value) ? value.trim() : undefined
}

function normalizeTokenGroup<T extends string>(
  value: unknown,
  keys: readonly T[],
): Partial<Record<T, CssTokenValue>> | undefined {
  if (!isRecord(value)) return undefined
  const result: Partial<Record<T, CssTokenValue>> = {}
  for (const key of keys) {
    const normalized = cssTokenValue(value[key])
    if (normalized !== undefined) result[key] = normalized
  }
  return Object.keys(result).length > 0 ? result : undefined
}

function normalizeTypography(value: unknown): ThemeTypographyOverrides | undefined {
  if (!isRecord(value)) return undefined
  const sizes = normalizeTokenGroup(value.sizes, typographySizeKeys)
  const weights = normalizeTokenGroup(value.weights, typographyWeightKeys)
  const lineHeights = normalizeTokenGroup(value.lineHeights, typographyLineHeightKeys)
  const letterSpacing = normalizeTokenGroup(value.letterSpacing, typographyLetterSpacingKeys)
  const chat = normalizeTokenGroup(value.chat, chatTypographyKeys)
  if (!sizes && !weights && !lineHeights && !letterSpacing && !chat) return undefined
  return { sizes, weights, lineHeights, letterSpacing, chat }
}

function kebabCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/gu, '$1-$2')
    .replace(/([a-zA-Z])(\d)/gu, '$1-$2')
    .replace(/[_\s]+/gu, '-')
    .replace(/[^a-zA-Z0-9-]/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^-|-$/gu, '')
    .toLowerCase()
}

function normalizeColorLeaves(value: unknown, prefix = ''): ThemeColorMap | undefined {
  if (!isRecord(value)) return undefined
  const result: ThemeColorMap = {}
  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = kebabCase(rawKey)
    if (!key) continue
    const name = prefix ? `${prefix}-${key}` : key
    if (nonEmptyString(rawValue)) {
      result[name] = rawValue.trim()
      continue
    }
    const nested = normalizeColorLeaves(rawValue, name)
    if (nested) Object.assign(result, nested)
  }
  return Object.keys(result).length > 0 ? result : undefined
}

function themeId(value: unknown): string | null {
  if (!nonEmptyString(value)) return null
  const id = value.trim().toLowerCase()
  return /^[a-z0-9][a-z0-9._-]{0,63}$/.test(id) ? id : null
}

function nestedRecord(root: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = root[key]
  return isRecord(value) ? value : null
}

/** Map an OpenChamber source colors object onto the desktop token contract. */
export function adaptOpenChamberColors(
  source: OpenChamberThemeJson['colors'],
  fallback: ColorTokens,
): ColorTokens {
  const primary = source.primary
  const surface = source.surface
  const interactive = source.interactive
  const status = source.status
  const syntax = source.syntax.base
  const pr = source.pr ?? {}
  return {
    ...fallback,
    'text-1': sourceString(surface.foreground, fallback['text-1']),
    'text-2': sourceString(surface.mutedForeground, fallback['text-2']),
    'text-3': sourceString(syntax.comment, fallback['text-3']),
    'text-4': sourceString(source.syntax.highlights?.lineNumber, fallback['text-4']),
    'text-inv': sourceString(primary.foreground, fallback['text-inv']),
    'bg-page': sourceString(surface.subtle, fallback['bg-page']),
    'bg-sidebar': sourceString(surface.muted, fallback['bg-sidebar']),
    'bg-main': sourceString(surface.background, fallback['bg-main']),
    'bg-surface': sourceString(surface.elevated, fallback['bg-surface']),
    'bg-hover': sourceString(interactive.hover, fallback['bg-hover']),
    'bg-active': sourceString(interactive.active, fallback['bg-active']),
    'bg-input': sourceString(syntax.background, fallback['bg-input']),
    border: sourceString(interactive.border, fallback.border),
    'border-soft': sourceString(interactive.border, fallback['border-soft']),
    accent: sourceString(primary.base, fallback.accent),
    'accent-soft': sourceString(interactive.selection, fallback['accent-soft']),
    blue: sourceString(primary.base, fallback.blue),
    'blue-soft': sourceString(status.infoBackground, fallback['blue-soft']),
    green: sourceString(status.success, fallback.green),
    'green-soft': sourceString(status.successBackground, fallback['green-soft']),
    purple: sourceString(pr.merged, fallback.purple),
    warn: sourceString(status.warning, fallback.warn),
    'warn-soft': sourceString(status.warningBackground, fallback['warn-soft']),
    danger: sourceString(status.error, fallback.danger),
    'danger-soft': sourceString(status.errorBackground, fallback['danger-soft']),
    'diff-syn-keyword': sourceString(syntax.keyword, fallback['diff-syn-keyword']),
    'diff-syn-type': sourceString(syntax.type, fallback['diff-syn-type']),
    'diff-syn-string': sourceString(syntax.string, fallback['diff-syn-string']),
    'diff-syn-number': sourceString(syntax.number, fallback['diff-syn-number']),
    'diff-syn-comment': sourceString(syntax.comment, fallback['diff-syn-comment']),
    'diff-syn-fn': sourceString(syntax.function, fallback['diff-syn-fn']),
    'diff-syn-punct': sourceString(syntax.operator, fallback['diff-syn-punct']),
    'send-bg': sourceString(primary.base, fallback['send-bg']),
  }
}

function normalizeOpenChamberTheme(
  raw: Record<string, unknown>,
  origin: ColorTheme['source'],
): ColorTheme | null {
  const metadata = nestedRecord(raw, 'metadata')
  const colors = nestedRecord(raw, 'colors')
  if (!metadata || !colors) return null
  const id = themeId(metadata.id)
  const variant =
    metadata.variant === 'dark' || metadata.variant === 'light' ? metadata.variant : null
  if (!id || !variant || !nonEmptyString(metadata.name)) return null

  const primary = nestedRecord(colors, 'primary')
  const surface = nestedRecord(colors, 'surface')
  const interactive = nestedRecord(colors, 'interactive')
  const status = nestedRecord(colors, 'status')
  const syntax = nestedRecord(colors, 'syntax')
  const base = syntax ? nestedRecord(syntax, 'base') : null
  if (!primary || !surface || !interactive || !status || !base) return null

  const required = [
    [surface, ['background', 'foreground', 'muted', 'mutedForeground', 'elevated', 'subtle']],
    [interactive, ['border', 'hover', 'active']],
    [primary, ['base']],
    [
      status,
      [
        'error',
        'errorBackground',
        'warning',
        'warningBackground',
        'success',
        'successBackground',
        'info',
        'infoBackground',
      ],
    ],
    [
      base,
      [
        'background',
        'foreground',
        'comment',
        'keyword',
        'string',
        'number',
        'function',
        'type',
        'operator',
      ],
    ],
  ] as const
  if (required.some(([record, keys]) => keys.some((key) => !nonEmptyString(record[key]))))
    return null

  const source = raw as unknown as OpenChamberThemeJson
  const fallback = variant === 'dark' ? darkFallbackColors : lightFallbackColors
  const config = nestedRecord(raw, 'config')
  const fontsRecord = config ? nestedRecord(config, 'fonts') : null
  const fonts =
    fontsRecord && nonEmptyString(fontsRecord.sans) && nonEmptyString(fontsRecord.mono)
      ? {
          sans: fontsRecord.sans,
          mono: fontsRecord.mono,
          ...(nonEmptyString(fontsRecord.heading) ? { heading: fontsRecord.heading } : {}),
          ...(nonEmptyString(fontsRecord.prose) ? { prose: fontsRecord.prose } : {}),
        }
      : undefined
  const typography = normalizeTypography(config?.typography)

  return {
    id,
    name: metadata.name.trim(),
    description: nonEmptyString(metadata.description) ? metadata.description : undefined,
    version: nonEmptyString(metadata.version) ? metadata.version : undefined,
    variant,
    colors: adaptOpenChamberColors(source.colors, fallback),
    fonts,
    typography,
    chatColors: normalizeColorLeaves(colors.chat),
    markdownColors: normalizeColorLeaves(colors.markdown),
    toolsColors: normalizeColorLeaves(colors.tools),
    source: origin,
  }
}

/** Normalize one loader result. Invalid files are rejected without throwing. */
export function normalizeColorTheme(raw: unknown): ColorTheme | null {
  if (!isRecord(raw)) return null
  return normalizeOpenChamberTheme(raw, 'custom')
}

/** Normalize a bundled source while preserving its built-in provenance. */
export function normalizeBundledTheme(raw: unknown): ColorTheme | null {
  if (!isRecord(raw)) return null
  return normalizeOpenChamberTheme(raw, 'builtin')
}

export function normalizeCustomThemes(files: readonly ThemeFileInput[]): ColorTheme[] {
  const themes: ColorTheme[] = []
  for (const file of files) {
    const normalized = normalizeColorTheme(file.raw)
    if (normalized) themes.push(normalized)
  }
  return themes
}

/** Custom themes override built-ins with the same id and appear first. */
export function mergeAvailableColorThemes(custom: readonly ColorTheme[]): ColorTheme[] {
  const seen = new Set<string>()
  const uniqueCustom = custom.filter((theme) => {
    const key = `${theme.variant}:${theme.id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return [
    ...uniqueCustom,
    ...builtinColorThemes.filter((theme) => !seen.has(`${theme.variant}:${theme.id}`)),
  ]
}

function compareThemeSortText(left: string, right: string): number {
  const leftFolded = left.trim().toLowerCase()
  const rightFolded = right.trim().toLowerCase()
  if (leftFolded < rightFolded) return -1
  if (leftFolded > rightFolded) return 1
  return 0
}

/** Return a display-only copy sorted by name, with deterministic ID ties. */
export function sortThemesForDisplay(themes: readonly ColorTheme[]): ColorTheme[] {
  return themes
    .map((theme, index) => ({ theme, index }))
    .sort((left, right) => {
      const byName = compareThemeSortText(left.theme.name, right.theme.name)
      if (byName !== 0) return byName

      const byId = compareThemeSortText(left.theme.id, right.theme.id)
      return byId !== 0 ? byId : left.index - right.index
    })
    .map(({ theme }) => theme)
}

export function findThemeById(
  themes: readonly ColorTheme[],
  id: string,
  variant: ColorThemeVariant,
): ColorTheme | undefined {
  return themes.find((theme) => theme.id === id && theme.variant === variant)
}

export function fallbackThemeId(variant: ColorThemeVariant): BuiltInThemeId {
  return variant === 'dark' ? DEFAULT_DARK_THEME_ID : DEFAULT_LIGHT_THEME_ID
}
