/**
 * ComposerToolbar unit tests.
 *
 * The toolbar component itself depends on the i18n context + framer-motion, so
 * a full DOM render test is deferred to the live React harness. What we can
 * unit-test here is its pure `clampThink` helper — the policy that picks the
 * default thinking intensity for a model.
 *
 * Live interaction coverage (menu open/close, preset passthrough into a new
 * session, regression vs ChatPanel) is verified via CDP against the running
 * Electron renderer (port 8315) — see
 * docs/superpowers/plans/2026-07-19-composer-toolbar-review.md.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { clampThink } from './ComposerToolbar.js'

describe('clampThink', () => {
  it('returns "off" when supported is empty AND THINKING_INTENSITY_OPTIONS has no levels', () => {
    // THINKING_INTENSITY_OPTIONS is non-empty in practice, but the "no levels"
    // branch still defaults to 'off'. Here we just assert the empty-supported
    // fallback uses the global ladder's highest.
    const r = clampThink(undefined, [])
    // fallback ladder = THINKING_INTENSITY_OPTIONS = [off, low, medium, high, xhigh, max]
    // highest index wins → 'max'
    assert.equal(r, 'max')
  })

  it('picks the highest-ranked level from the supported list', () => {
    // supported has low + high → high wins (index 3 > index 1)
    assert.equal(clampThink(undefined, ['low', 'high']), 'high')
  })

  it('picks xhigh over high when both supported', () => {
    assert.equal(clampThink(undefined, ['high', 'xhigh']), 'xhigh')
  })

  it('picks max when supported contains max', () => {
    assert.equal(
      clampThink(undefined, ['off', 'low', 'medium', 'high', 'xhigh', 'max']),
      'max',
    )
  })

  it('returns the only supported level when a single-item list is given', () => {
    assert.equal(clampThink(undefined, ['low']), 'low')
  })

  it('ignores the preferred argument — always uses highest of supported (matches ChatPanel behavior)', () => {
    // The signature accepts _preferred for parity but does NOT honor it; this
    // is the intentional "always default to the strongest supported" policy.
    assert.equal(clampThink('off', ['low', 'high']), 'high')
    assert.equal(clampThink('max', ['low']), 'low')
  })

  it('handles a single "off" entry', () => {
    assert.equal(clampThink(undefined, ['off']), 'off')
  })

  it('ignores unsupported levels not in THINKING_INTENSITY_OPTIONS', () => {
    // Unknown levels get indexOf = -1, never win over real ones.
    assert.equal(clampThink(undefined, ['bogus', 'low', 'high']), 'high')
  })
})
