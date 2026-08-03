import assert from 'node:assert/strict'
import test from 'node:test'
import monoPlus from './themes/mono-plus-light.json'
import monoPlusDark from './themes/mono-plus-dark.json'
import { bundledThemeJson } from './themes'
import {
  DEFAULT_DARK_THEME_ID,
  DEFAULT_LIGHT_THEME_ID,
  builtinColorThemes,
  findThemeById,
  findBuiltinColorTheme,
  getBuiltinColorTheme,
  mergeAvailableColorThemes,
  normalizeBundledTheme,
  normalizeColorTheme,
  normalizeCustomThemes,
  sortThemesForDisplay,
} from './theme.config'

test('built-in registry contains only the 42 OpenChamber themes', () => {
  assert.equal(builtinColorThemes.length, 42)
  assert.equal(new Set(builtinColorThemes.map((theme) => theme.id)).size, 42)
  assert.equal(builtinColorThemes[0]?.id, 'mono-plus-light')
  assert.equal(builtinColorThemes.filter((theme) => theme.variant === 'light').length, 21)
  assert.equal(builtinColorThemes.filter((theme) => theme.variant === 'dark').length, 21)
  assert.equal(findThemeById(builtinColorThemes, 'classic', 'light'), undefined)
  assert.equal(findBuiltinColorTheme('warm'), undefined)
  assert.equal(findBuiltinColorTheme('dark'), undefined)
  assert.equal(DEFAULT_LIGHT_THEME_ID, 'mono-plus-light')
  assert.equal(DEFAULT_DARK_THEME_ID, 'mono-plus-dark')
  assert.throws(() => getBuiltinColorTheme('missing-theme'), /Unknown built-in color theme/u)
})

test('every bundled OpenChamber JSON source normalizes with its metadata', () => {
  assert.equal(bundledThemeJson.length, 42)
  const normalized = bundledThemeJson.map((raw) => normalizeBundledTheme(raw))
  assert.equal(normalized.every(Boolean), true)
  assert.deepEqual(
    new Set(normalized.map((theme) => theme?.id)),
    new Set(bundledThemeJson.map((raw) => raw.metadata.id)),
  )
  assert.ok(normalized.every((theme) => theme?.source === 'builtin'))
})

test('normalizes valid OpenChamber themes and rejects malformed payloads', () => {
  const custom = structuredClone(monoPlus) as Record<string, unknown>
  const metadata = custom.metadata as Record<string, unknown>
  metadata.id = 'custom-light'
  metadata.name = 'Custom Light'
  const colors = custom.colors as Record<string, unknown>
  const primary = colors.primary as Record<string, unknown>
  primary.base = '#123456'

  const normalized = normalizeColorTheme(custom)
  assert.equal(normalized?.id, 'custom-light')
  assert.equal(normalized?.variant, 'light')
  assert.equal(normalized?.colors.accent, '#123456')
  assert.equal(normalizeColorTheme({ metadata: { id: 'bad', variant: 'light' } }), null)
})

test('custom themes override matching built-ins and support unique ids', () => {
  const override = normalizeColorTheme({
    ...structuredClone(monoPlus),
    metadata: { ...monoPlus.metadata, id: 'aura-light', name: 'Custom Aura' },
  })!
  const unique = normalizeColorTheme({
    ...structuredClone(monoPlus),
    metadata: { ...monoPlus.metadata, id: 'custom-light', name: 'Custom Light' },
  })!
  const merged = mergeAvailableColorThemes([override, unique])
  assert.equal(merged[0]?.name, 'Custom Aura')
  assert.equal(findThemeById(merged, 'aura-light', 'light')?.source, 'custom')
  assert.equal(findThemeById(merged, 'custom-light', 'light')?.source, 'custom')
  assert.equal(findThemeById(merged, 'mono-plus-dark', 'dark')?.source, 'builtin')
})

test('sorts light and dark theme displays by name with deterministic ID ties', () => {
  const makeTheme = (source: typeof monoPlus, id: string, name: string) =>
    normalizeColorTheme({
      ...structuredClone(source),
      metadata: { ...source.metadata, id, name },
    })!

  const lightThemes = [
    makeTheme(monoPlus, 'zulu-light', 'Beta'),
    makeTheme(monoPlus, 'm-light', 'Alpha'),
    makeTheme(monoPlus, 'a-light', 'ALPHA'),
    makeTheme(monoPlus, 'gamma-light', 'Gamma'),
    makeTheme(monoPlus, 'alpha-light', 'alpha'),
  ]
  const darkThemes = [
    makeTheme(monoPlusDark, 'zeta-dark', 'Aether'),
    makeTheme(monoPlusDark, 'omega-dark', 'Omega'),
    makeTheme(monoPlusDark, 'a-dark', 'aether'),
  ]

  assert.deepEqual(
    sortThemesForDisplay(lightThemes).map((theme) => theme.id),
    ['a-light', 'alpha-light', 'm-light', 'zulu-light', 'gamma-light'],
  )
  assert.deepEqual(
    sortThemesForDisplay(darkThemes).map((theme) => theme.id),
    ['a-dark', 'zeta-dark', 'omega-dark'],
  )
  assert.deepEqual(
    lightThemes.map((theme) => theme.id),
    ['zulu-light', 'm-light', 'a-light', 'gamma-light', 'alpha-light'],
  )
})

test('normalizes only valid custom files', () => {
  const themes = normalizeCustomThemes([
    { filename: 'valid.json', raw: monoPlus },
    { filename: 'invalid.json', raw: { nope: true } },
  ])
  assert.equal(themes.length, 1)
  assert.equal(themes[0]?.id, 'mono-plus-light')
})
