import assert from 'node:assert/strict'
import test from 'node:test'
import { bundledThemeJson } from './theme/themes'
import { resolveBuiltinThemeForBootstrap } from './theme-bootstrap'

test('cold-start bootstrap resolves every bundled theme by id and variant', () => {
  for (const raw of bundledThemeJson) {
    const resolved = raw.metadata.variant as 'light' | 'dark'
    const theme = resolveBuiltinThemeForBootstrap(raw.metadata.id, resolved)
    assert.equal(theme.id, raw.metadata.id)
    assert.equal(theme.variant, resolved)
    assert.equal(theme.source, 'builtin')
  }
})

test('cold-start bootstrap never applies a wrong-variant stored theme', () => {
  assert.equal(resolveBuiltinThemeForBootstrap('aura-dark', 'light').id, 'mono-plus-light')
  assert.equal(resolveBuiltinThemeForBootstrap('aura-light', 'dark').id, 'mono-plus-dark')
  assert.equal(resolveBuiltinThemeForBootstrap('dark', 'dark').id, 'mono-plus-dark')
  assert.equal(resolveBuiltinThemeForBootstrap('missing-theme', 'light').id, 'mono-plus-light')
  assert.equal(resolveBuiltinThemeForBootstrap('missing-theme', 'dark').id, 'mono-plus-dark')
})
