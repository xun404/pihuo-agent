import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { normalizeNpmRegistry, parseNpmRegistryInput } from './npm-registry.js'

describe('normalizeNpmRegistry', () => {
  it('treats blank as system default', () => {
    assert.equal(normalizeNpmRegistry(undefined), undefined)
    assert.equal(normalizeNpmRegistry(null), undefined)
    assert.equal(normalizeNpmRegistry(''), undefined)
    assert.equal(normalizeNpmRegistry('   '), undefined)
  })

  it('accepts https registry URLs and strips a root trailing slash', () => {
    assert.equal(
      normalizeNpmRegistry('https://registry.npmmirror.com/'),
      'https://registry.npmmirror.com',
    )
    assert.equal(normalizeNpmRegistry('https://registry.npmjs.org'), 'https://registry.npmjs.org')
  })

  it('rejects non-https, whitespace, and invalid URLs', () => {
    assert.throws(() => normalizeNpmRegistry('http://registry.npmmirror.com'), /https/)
    assert.throws(
      () => normalizeNpmRegistry('https://registry.npmmirror.com/has space'),
      /whitespace/,
    )
    assert.throws(() => normalizeNpmRegistry('ftp://example.com'), /https/)
    assert.throws(() => normalizeNpmRegistry('not-a-url'), /https:\/\//)
    assert.throws(() => normalizeNpmRegistry(123), /must be a string/)
  })

  it('parseNpmRegistryInput matches normalize', () => {
    assert.equal(
      parseNpmRegistryInput('https://registry.npmmirror.com'),
      'https://registry.npmmirror.com',
    )
    assert.equal(parseNpmRegistryInput(''), undefined)
  })
})
