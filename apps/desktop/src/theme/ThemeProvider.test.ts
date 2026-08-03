import assert from 'node:assert/strict'
import test from 'node:test'
import { builtinColorThemes } from './theme.config'
import {
  migrateStoredDarkTheme,
  migrateStoredLightTheme,
  shouldFallbackThemeSelection,
} from './ThemeProvider'

test('migrates legacy palette storage to Mono Plus theme ids', () => {
  assert.equal(migrateStoredLightTheme('classic'), 'mono-plus-light')
  assert.equal(migrateStoredLightTheme('mono-plus'), 'mono-plus-light')
  assert.equal(migrateStoredLightTheme('warm'), 'mono-plus-light')
  assert.equal(migrateStoredLightTheme(''), 'mono-plus-light')
  assert.equal(migrateStoredLightTheme('custom-light'), 'custom-light')
})

test('migrates invalid and legacy dark storage to Mono Plus Dark', () => {
  assert.equal(migrateStoredDarkTheme('custom-dark'), 'custom-dark')
  assert.equal(migrateStoredDarkTheme('dark'), 'mono-plus-dark')
  assert.equal(migrateStoredDarkTheme(''), 'mono-plus-dark')
  assert.equal(migrateStoredDarkTheme(null), 'mono-plus-dark')
})

test('does not invalidate persisted selections until the theme registry succeeds', () => {
  assert.equal(
    shouldFallbackThemeSelection(false, builtinColorThemes, 'missing-light', 'light'),
    false,
  )
  assert.equal(
    shouldFallbackThemeSelection(true, builtinColorThemes, 'missing-light', 'light'),
    true,
  )
  assert.equal(
    shouldFallbackThemeSelection(true, builtinColorThemes, 'mono-plus-light', 'light'),
    false,
  )
})
