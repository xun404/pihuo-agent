import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { languageFromClassName } from './md-code-lang.js'

describe('languageFromClassName', () => {
  it('extracts language-xxx', () => {
    assert.equal(languageFromClassName('language-java'), 'java')
    assert.equal(languageFromClassName('language-ts'), 'ts')
    assert.equal(languageFromClassName('language-c++'), 'c++')
  })
  it('handles missing / empty', () => {
    assert.equal(languageFromClassName(undefined), '')
    assert.equal(languageFromClassName(''), '')
    assert.equal(languageFromClassName('not-a-lang'), '')
  })
})
