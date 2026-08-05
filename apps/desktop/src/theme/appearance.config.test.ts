import assert from 'node:assert/strict'
import test from 'node:test'
import { createAppearanceVariables } from './appearance.config'
import { DEFAULT_LIGHT_THEME_ID, getBuiltinColorTheme, type ColorTheme } from './theme.config'

const mono = getBuiltinColorTheme('mono-plus-light')
const openchamberLight = getBuiltinColorTheme('openchamber-light')
const dark = getBuiltinColorTheme('mono-plus-dark')

test('generates deterministic built-in color theme variants', () => {
  const monoVars = createAppearanceVariables('light', mono)
  const openchamberVars = createAppearanceVariables('light', openchamberLight)
  const darkVars = createAppearanceVariables('dark', dark)

  assert.equal(monoVars['--bg-main'], '#FFFFFF')
  assert.equal(openchamberVars['--bg-main'], '#fdfcfa')
  assert.equal(darkVars['--bg-main'], '#000000')
  assert.notEqual(monoVars['--accent'], openchamberVars['--accent'])
})

test('maps Mono Plus source colors, syntax, and typography', () => {
  const vars = createAppearanceVariables('light', mono)
  assert.equal(vars['--bg-page'], '#F0F0F0')
  assert.equal(vars['--bg-main'], '#FFFFFF')
  assert.equal(vars['--bg-surface'], '#FAFAFA')
  assert.equal(vars['--border'], '#e3e3e3')
  assert.equal(vars['--bg-hover'], '#00000010')
  assert.equal(vars['--bg-active'], '#00000015')
  assert.equal(vars['--accent'], '#4a6a9e')
  assert.equal(vars['--green'], '#5a7a5a')
  assert.equal(vars['--danger'], '#8a5a5a')
  assert.equal(vars['--diff-syn-keyword'], '#6a5a4a')
  assert.equal(vars['--diff-syn-type'], '#6a5040')
  assert.equal(vars['--diff-syn-string'], '#4a6a7a')
  assert.equal(vars['--diff-syn-number'], '#7a5a4a')
  assert.equal(vars['--diff-syn-comment'], '#8c8c8c')
  assert.equal(vars['--diff-syn-fn'], '#4a6a9e')
  assert.equal(vars['--diff-syn-punct'], '#6a5a4a')
  assert.equal(
    vars['--font'],
    'ui-monospace, "SFMono-Regular", "Menlo", "Cascadia Mono", "Segoe UI Mono", monospace',
  )
  assert.equal(vars['--mono'], vars['--font'])
  // Wireframe may set --font == mono, but --font-sans stays the readable UI/CJK stack.
  assert.match(vars['--font-sans'] ?? '', /PingFang SC|system-ui|sans-serif/u)
  assert.notEqual(vars['--font-sans'], vars['--mono'])
  assert.notEqual(
    vars['--bg-main'],
    createAppearanceVariables('light', openchamberLight)['--bg-main'],
  )
  assert.notEqual(
    vars['--accent'],
    createAppearanceVariables('light', openchamberLight)['--accent'],
  )
})

test('keeps appearance geometry shared while allowing theme font defaults', () => {
  const monoVars = createAppearanceVariables('light', mono)
  const openchamberVars = createAppearanceVariables('light', openchamberLight)
  assert.notEqual(monoVars['--font'], openchamberVars['--font'])
  assert.notEqual(monoVars['--mono'], openchamberVars['--mono'])
  assert.equal(monoVars['--sp-4'], openchamberVars['--sp-4'])
  assert.equal(monoVars['--r-md'], openchamberVars['--r-md'])
  assert.equal(monoVars['--font-mono'], 'var(--mono)')
  assert.equal(monoVars['--bg-elevated'], 'var(--bg-surface)')
})

test('dark output is isolated from the selected light theme', () => {
  assert.deepEqual(createAppearanceVariables('dark', dark), createAppearanceVariables('dark', dark))
  assert.notEqual(
    createAppearanceVariables('dark', dark)['--bg-main'],
    createAppearanceVariables('light', mono)['--bg-main'],
  )
})

test('variables use custom-property keys and never stringify undefined', () => {
  for (const [resolved, theme] of [
    ['light', mono],
    ['light', openchamberLight],
    ['dark', dark],
  ] as const) {
    const vars = createAppearanceVariables(resolved, theme)
    assert.ok(Object.keys(vars).length > 60)
    for (const [key, value] of Object.entries(vars)) {
      assert.match(key, /^--[a-z0-9-]+$/u)
      assert.notEqual(value, undefined)
      assert.equal(value.includes('undefined'), false)
    }
  }
})

test('falls back to Mono Plus for an invalid runtime theme id', () => {
  assert.deepEqual(
    createAppearanceVariables('light', 'invalid-theme-id'),
    createAppearanceVariables('light', getBuiltinColorTheme(DEFAULT_LIGHT_THEME_ID)),
  )
})

test('never applies a builtin variant to the opposite resolved mode', () => {
  assert.deepEqual(
    createAppearanceVariables('light', 'aura-dark'),
    createAppearanceVariables('light', getBuiltinColorTheme(DEFAULT_LIGHT_THEME_ID)),
  )
  assert.deepEqual(
    createAppearanceVariables('dark', 'aura-light'),
    createAppearanceVariables('dark', getBuiltinColorTheme('mono-plus-dark')),
  )
})

// Keep the type contract exercised when custom themes are passed by callers.
test('accepts normalized custom themes as appearance inputs', () => {
  const custom: ColorTheme = { ...mono, id: 'custom-light', name: 'Custom Light', source: 'custom' }
  assert.equal(createAppearanceVariables('light', custom)['--accent'], mono.colors.accent)
})
