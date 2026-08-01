import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { cleanTitle, extractFirstUserText } from './session-title-generator.js'

describe('extractFirstUserText', () => {
  it('extracts the first non-empty user text from content or parts', () => {
    assert.equal(extractFirstUserText(undefined), null)
    assert.equal(extractFirstUserText(null), null)
    assert.equal(extractFirstUserText('not an array'), null)
    assert.equal(extractFirstUserText([]), null)
    assert.equal(
      extractFirstUserText([
        { role: 'system', content: 'sys' },
        { role: 'assistant', content: 'hi' },
      ]),
      null,
    )
    assert.equal(
      extractFirstUserText([
        { role: 'system', content: 'sys' },
        { role: 'user', content: '  Implement the sidebar status dot  ' },
      ]),
      'Implement the sidebar status dot',
    )
    assert.equal(
      extractFirstUserText([
        {
          role: 'user',
          parts: [
            { type: 'image', image: 'data:...' },
            { type: 'text', text: '  Review this PR  ' },
            { type: 'text', text: 'Second chunk' },
          ],
        },
      ]),
      'Review this PR\nSecond chunk',
    )
    assert.equal(
      extractFirstUserText([
        { role: 'user', content: '   ' },
        { role: 'user', content: 'real task' },
      ]),
      'real task',
    )
    assert.equal(
      extractFirstUserText([null, 42, 'stray', { role: 'user', content: 'ok' }]),
      'ok',
    )
  })
})

describe('cleanTitle', () => {
  it('normalizes quotes, prefixes, whitespace, trailing punctuation, and length', () => {
    assert.equal(cleanTitle(''), null)
    assert.equal(cleanTitle('   '), null)
    assert.equal(cleanTitle(null), null)
    assert.equal(cleanTitle(undefined), null)
    assert.equal(cleanTitle('"Implement sidebar"'), 'Implement sidebar')
    assert.equal(cleanTitle('“Review PR”'), 'Review PR')
    assert.equal(cleanTitle("'Fix bug'"), 'Fix bug')
    assert.equal(cleanTitle('Title: Implement sidebar'), 'Implement sidebar')
    assert.equal(cleanTitle('标题：修复 bug'), '修复 bug')
    assert.equal(cleanTitle('Implement sidebar.'), 'Implement sidebar')
    assert.equal(cleanTitle('修复 bug。'), '修复 bug')
    assert.equal(cleanTitle('Fix\n\nthe   bug'), 'Fix the bug')
    assert.equal(cleanTitle('x'.repeat(120))!.length, 80)
  })
})
