import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  matchNpmRegistryPreset,
  NPM_REGISTRY_PRESETS,
  normalizeNpmRegistryUrl,
  validateNpmRegistryDraft,
} from './npm-registry-url.js'

describe('validateNpmRegistryDraft', () => {
  it('allows empty for system default', () => {
    assert.deepEqual(validateNpmRegistryDraft(''), { ok: true, value: undefined })
    assert.deepEqual(validateNpmRegistryDraft('   '), { ok: true, value: undefined })
  })

  it('requires https:// and rejects spaces', () => {
    assert.equal(validateNpmRegistryDraft('http://registry.npmmirror.com').ok, false)
    assert.equal(
      validateNpmRegistryDraft('https://registry.npmmirror.com/path with space').ok,
      false,
    )
    assert.equal(validateNpmRegistryDraft(' https://registry.npmmirror.com').ok, false)
  })

  it('accepts clean https URLs', () => {
    assert.deepEqual(validateNpmRegistryDraft('https://registry.npmmirror.com'), {
      ok: true,
      value: 'https://registry.npmmirror.com',
    })
    assert.deepEqual(validateNpmRegistryDraft('https://registry.npmmirror.com/'), {
      ok: true,
      value: 'https://registry.npmmirror.com',
    })
  })
})

describe('npm registry presets', () => {
  it('covers system default plus mainland China and overseas mirrors', () => {
    const ids = NPM_REGISTRY_PRESETS.map((p) => p.id)
    assert.ok(ids.includes('system'))
    assert.ok(ids.includes('npmjs'))
    assert.ok(ids.includes('npmmirror'))
    assert.ok(ids.includes('huawei'))
    assert.ok(ids.includes('tencent'))
    assert.ok(ids.includes('yarn'))
    assert.ok(NPM_REGISTRY_PRESETS.some((p) => p.region === 'cn'))
    assert.ok(NPM_REGISTRY_PRESETS.some((p) => p.region === 'global' && p.url))
  })

  it('all non-empty preset URLs pass validation', () => {
    for (const preset of NPM_REGISTRY_PRESETS) {
      if (!preset.url) continue
      const result = validateNpmRegistryDraft(preset.url)
      assert.equal(result.ok, true, preset.id)
    }
  })

  it('matches drafts to presets (trailing slash tolerant)', () => {
    assert.equal(matchNpmRegistryPreset(''), 'system')
    assert.equal(matchNpmRegistryPreset('https://registry.npmjs.org/'), 'npmjs')
    assert.equal(matchNpmRegistryPreset('https://registry.npmmirror.com'), 'npmmirror')
    assert.equal(matchNpmRegistryPreset('https://example.com/custom'), null)
  })

  it('normalizes root trailing slash', () => {
    assert.equal(
      normalizeNpmRegistryUrl('https://registry.npmjs.org/'),
      'https://registry.npmjs.org',
    )
  })
})
