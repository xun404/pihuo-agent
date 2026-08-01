import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { validateNpmRegistryDraft } from './npm-registry-url.js'

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
