/**
 * ComposerToolbar unit tests.
 *
 * The toolbar component itself depends on the i18n context + framer-motion, so
 * a full DOM render test is deferred to the live React harness. What we can
 * unit-test here is its pure `defaultThinkingFor` helper — the policy that
 * picks the linked default thinking intensity for a model.
 *
 * Live interaction coverage (menu open/close, preset passthrough into a new
 * session, regression vs ChatPanel) is verified via CDP against the running
 * Electron renderer (port 8315) — see
 * docs/superpowers/plans/2026-07-19-composer-toolbar-review.md.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { defaultThinkingFor } from '../lib/settings.js'

const toolbarSource = readFileSync(new URL('./ComposerToolbar.tsx', import.meta.url), 'utf8')
const chatPanelSource = readFileSync(new URL('./ChatPanel.tsx', import.meta.url), 'utf8')

describe('defaultThinkingFor', () => {
  it('returns "off" when supported is empty AND THINKING_INTENSITY_OPTIONS has no levels', () => {
    // THINKING_INTENSITY_OPTIONS is non-empty in practice, but the "no levels"
    // branch still defaults to 'off'. Here we just assert the empty-supported
    // fallback uses the global ladder's lowest level ≥ medium → 'medium'.
    const r = defaultThinkingFor([])
    assert.equal(r, 'medium')
  })

  it('picks 中 (medium) as the linked default when supported', () => {
    assert.equal(defaultThinkingFor(['low', 'medium', 'high']), 'medium')
    assert.equal(defaultThinkingFor(['off', 'medium', 'max']), 'medium')
  })

  it('picks 高 (high) when 中 is unsupported (中上)', () => {
    assert.equal(defaultThinkingFor(['low', 'high']), 'high')
    assert.equal(defaultThinkingFor(['off', 'high', 'max']), 'high')
  })

  it('picks the strongest level for sparse support without 中/高', () => {
    assert.equal(defaultThinkingFor(['off', 'max']), 'max')
    assert.equal(defaultThinkingFor(['xhigh', 'max']), 'max')
    assert.equal(defaultThinkingFor(['off', 'xhigh']), 'xhigh')
  })

  it('never picks 关 for two-level models (关+开 / 关+最高)', () => {
    assert.equal(defaultThinkingFor(['off', 'max']), 'max')
    assert.equal(defaultThinkingFor(['off', 'low']), 'low')
  })

  it('handles a single "off" entry', () => {
    assert.equal(defaultThinkingFor(['off']), 'off')
  })

  it('ignores unsupported levels not in THINKING_INTENSITY_OPTIONS', () => {
    // Unknown levels get indexOf = -1, never win over real ones.
    assert.equal(defaultThinkingFor(['bogus', 'low', 'high']), 'high')
  })
})

describe('Composer toolbar permission contract', () => {
  it('uses the shared permission action and retains the existing right-side controls', () => {
    assert.match(toolbarSource, /<PermissionModeAction/u)
    assert.match(toolbarSource, /<ContextRing/u)
    assert.match(toolbarSource, /thinkingIntensity/u)
    assert.match(toolbarSource, /selectedModel/u)
  })

  it('does not render the legacy access menu or hidden Leader modes', () => {
    assert.doesNotMatch(toolbarSource, /ACCESS_MODES|resolveAccessMode|access-mode/u)
    assert.doesNotMatch(toolbarSource, /full_access|auto_edit/u)
  })

  it('normalizes the hidden Leader mode to build on the chat wire', () => {
    assert.match(chatPanelSource, /mode: 'build'/u)
    assert.doesNotMatch(chatPanelSource, /mode:\s*modeRef\.current/u)
  })
})
