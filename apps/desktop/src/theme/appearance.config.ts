/**
 * Shared appearance tokens for the desktop renderer.
 *
 * Color themes live in ./theme.config.ts. This module owns the reusable
 * typography, spacing, radius, control, layout, motion, and alias tokens and
 * composes them with the selected normalized color theme at render time.
 */

import {
  DEFAULT_DARK_THEME_ID,
  DEFAULT_LIGHT_THEME_ID,
  findBuiltinColorTheme,
  getBuiltinColorTheme,
  type ColorTheme,
  type ColorThemeId,
} from './theme.config'

export type ResolvedTheme = 'light' | 'dark'
export type AppearanceTheme = ColorTheme

type CssValue = string | number

interface FontTokens {
  sans: string
  mono: string
}

interface TypographyTokens {
  fonts: FontTokens
  sizes: {
    '2xs': CssValue
    xs: CssValue
    sm: CssValue
    base: CssValue
    md: CssValue
    lg: CssValue
    xl: CssValue
    '2xl': CssValue
    display: CssValue
  }
  weights: {
    regular: CssValue
    medium: CssValue
    semibold: CssValue
    bold: CssValue
  }
  lineHeights: {
    tight: CssValue
    snug: CssValue
    body: CssValue
    relaxed: CssValue
  }
  letterSpacing: {
    tight: CssValue
    display: CssValue
    label: CssValue
  }
}

interface RadiusTokens {
  xs: CssValue
  sm: CssValue
  md: CssValue
  lg: CssValue
  xl: CssValue
  '2xl': CssValue
  pill: CssValue
}

interface SpacingTokens {
  1: CssValue
  2: CssValue
  3: CssValue
  4: CssValue
  5: CssValue
  6: CssValue
  8: CssValue
  10: CssValue
}

interface ControlTokens {
  'h-xs': CssValue
  'h-sm': CssValue
  'h-md': CssValue
  'h-lg': CssValue
  icon: CssValue
  'icon-sm': CssValue
  'icon-lg': CssValue
}

interface LayoutTokens {
  'sidebar-w': CssValue
  'drawer-w': CssValue
  'settings-nav-w': CssValue
  'provider-rail-w': CssValue
  'content-max': CssValue
  'messages-max': CssValue
}

interface MotionTokens {
  durations: {
    instant: CssValue
    fast: CssValue
    base: CssValue
    slow: CssValue
  }
  easings: {
    out: string
    spring: string
    inout: string
    'ra-logo': string
    'toast-in': string
    'toast-out': string
    stream: string
  }
}

export interface AppearanceConfig {
  typography: TypographyTokens
  radius: RadiusTokens
  spacing: SpacingTokens
  controls: ControlTokens
  layout: LayoutTokens
  scrollbar: {
    size: CssValue
  }
  motion: MotionTokens
  /** Values retained for older CSS rules while canonical names evolve. */
  aliases: Record<string, string>
}

export const appearanceConfig = {
  typography: {
    fonts: {
      sans: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, 'PingFang SC', 'Microsoft YaHei', sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji'",
      mono: "ui-monospace, 'SF Mono', 'Menlo', 'Cascadia Code', 'JetBrains Mono', 'Consolas', monospace",
    },
    sizes: {
      '2xs': '11px',
      xs: '12px',
      sm: '13px',
      base: '14px',
      md: '15px',
      lg: '16px',
      xl: '20px',
      '2xl': '22px',
      display: '26px',
    },
    weights: {
      regular: 400,
      medium: 500,
      semibold: 600,
      bold: 700,
    },
    lineHeights: {
      tight: 1.3,
      snug: 1.4,
      body: 1.5,
      relaxed: 1.55,
    },
    letterSpacing: {
      tight: '-0.02em',
      display: '-0.03em',
      label: '0.02em',
    },
  },
  radius: {
    xs: '4px',
    sm: '8px',
    md: '10px',
    lg: '14px',
    xl: '16px',
    '2xl': '20px',
    pill: '999px',
  },
  spacing: {
    1: '4px',
    2: '8px',
    3: '12px',
    4: '16px',
    5: '20px',
    6: '24px',
    8: '32px',
    10: '40px',
  },
  controls: {
    'h-xs': '24px',
    'h-sm': '28px',
    'h-md': '32px',
    'h-lg': '36px',
    icon: '16px',
    'icon-sm': '14px',
    'icon-lg': '20px',
  },
  layout: {
    'sidebar-w': '232px',
    'drawer-w': '300px',
    'settings-nav-w': '232px',
    'provider-rail-w': '176px',
    'content-max': '720px',
    'messages-max': '800px',
  },
  scrollbar: {
    size: '8px',
  },
  motion: {
    durations: {
      instant: '80ms',
      fast: '140ms',
      base: '200ms',
      slow: '320ms',
    },
    easings: {
      out: 'cubic-bezier(0.32, 0.72, 0, 1)',
      spring: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
      inout: 'cubic-bezier(0.4, 0, 0.2, 1)',
      'ra-logo': 'cubic-bezier(0.22, 1, 0.36, 1)',
      'toast-in': 'cubic-bezier(0.175, 0.885, 0.32, 1)',
      'toast-out': 'cubic-bezier(0.4, 0, 1, 1)',
      stream: 'cubic-bezier(0.16, 1, 0.3, 1)',
    },
  },
  aliases: {
    ink: 'var(--text-1)',
    muted: 'var(--text-3)',
    'muted-2': 'var(--text-2)',
    line: 'var(--border)',
    'line-soft': 'var(--border-soft)',
    sidebar: 'var(--bg-sidebar)',
    main: 'var(--bg-main)',
    surface: 'var(--bg-surface)',
    hover: 'var(--bg-hover)',
    active: 'var(--bg-active)',
    r: 'var(--r-md)',
    'r-control': 'var(--r-md)',
    'shadow-card': 'var(--shadow-md)',
    'font-mono': 'var(--mono)',
    'bg-elevated': 'var(--bg-surface)',
    'lh-normal': 'var(--lh-body)',
    'shadow-popover': 'var(--shadow-composer)',
  },
} satisfies AppearanceConfig

function addValues(target: Record<string, string>, prefix: string, values: object) {
  for (const [name, value] of Object.entries(values as Record<string, CssValue>)) {
    target[`--${prefix ? `${prefix}-` : ''}${name}`] = String(value)
  }
}

function themeFor(resolved: ResolvedTheme, theme: AppearanceTheme | ColorThemeId): AppearanceTheme {
  if (typeof theme !== 'string') return theme
  const builtin = findBuiltinColorTheme(theme.trim().toLowerCase())
  if (builtin?.variant === resolved) return builtin
  return getBuiltinColorTheme(resolved === 'dark' ? DEFAULT_DARK_THEME_ID : DEFAULT_LIGHT_THEME_ID)
}

/** Build the complete set of CSS variables for a resolved normalized theme. */
export function createAppearanceVariables(
  resolved: ResolvedTheme,
  theme: AppearanceTheme | ColorThemeId,
): Record<string, string> {
  const selected = themeFor(resolved, theme)
  const vars: Record<string, string> = {}

  addValues(vars, '', selected.colors)
  const fonts = { ...appearanceConfig.typography.fonts, ...(selected.fonts ?? {}) }
  vars['--font'] = fonts.sans
  vars['--mono'] = fonts.mono
  addValues(vars, 'fs', appearanceConfig.typography.sizes)
  addValues(vars, 'fw', appearanceConfig.typography.weights)
  addValues(vars, 'lh', appearanceConfig.typography.lineHeights)
  addValues(vars, 'ls', appearanceConfig.typography.letterSpacing)
  addValues(vars, 'r', appearanceConfig.radius)
  addValues(vars, 'sp', appearanceConfig.spacing)
  addValues(vars, '', appearanceConfig.controls)
  addValues(vars, '', appearanceConfig.layout)
  vars['--scrollbar-size'] = String(appearanceConfig.scrollbar.size)
  addValues(vars, 'dur', appearanceConfig.motion.durations)
  addValues(vars, 'ease', appearanceConfig.motion.easings)
  for (const [name, value] of Object.entries(appearanceConfig.aliases)) {
    vars[`--${name}`] = value
  }
  return vars
}

const appliedVariableKeys = new WeakMap<HTMLElement, Set<string>>()

/** Apply variables synchronously and remove keys left by a previous config. */
export function applyAppearanceVariables(
  resolved: ResolvedTheme,
  theme: AppearanceTheme | ColorThemeId,
  target?: HTMLElement,
): Record<string, string> {
  const vars = createAppearanceVariables(resolved, theme)
  if (typeof document === 'undefined') return vars

  const root = target ?? document.documentElement
  const previousKeys = appliedVariableKeys.get(root) ?? new Set<string>()
  const nextKeys = new Set(Object.keys(vars))
  for (const key of previousKeys) {
    if (!nextKeys.has(key)) root.style.removeProperty(key)
  }
  for (const [key, value] of Object.entries(vars)) root.style.setProperty(key, value)
  appliedVariableKeys.set(root, nextKeys)
  return vars
}

export const getAppearanceVariables = createAppearanceVariables
export const applyAppearanceToDocument = applyAppearanceVariables
