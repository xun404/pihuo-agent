import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { highlightLine, languageFromPath } from './diff-syntax-highlight.js'

describe('languageFromPath', () => {
  it('maps common extensions', () => {
    assert.equal(languageFromPath('a/b.java'), 'java')
    assert.equal(languageFromPath('x.ts'), 'ts')
    assert.equal(languageFromPath('x.unknown'), 'text')
  })
})

describe('highlightLine', () => {
  it('tokenizes keywords, types, strings, numbers', () => {
    const tokens = highlightLine('Map<String, Integer> x = 1; // c')
    const types = tokens.map((t) => t.type)
    assert.ok(types.includes('type'))
    assert.ok(types.includes('number'))
    assert.ok(types.includes('comment'))
  })

  it('keeps full text when joined', () => {
    const src = '  public void foo(String s) {'
    const tokens = highlightLine(src)
    assert.equal(tokens.map((t) => t.text).join(''), src)
  })
})
