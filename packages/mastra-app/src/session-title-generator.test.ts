import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { cleanTitle, extractFirstUserText } from './session-title-generator.js'

describe('extractFirstUserText', () => {
  it('returns null for non-array input', () => {
    assert.equal(extractFirstUserText(undefined), null)
    assert.equal(extractFirstUserText(null), null)
    assert.equal(extractFirstUserText('not an array'), null)
  })

  it('returns null when there is no user message', () => {
    assert.equal(extractFirstUserText([]), null)
    assert.equal(
      extractFirstUserText([
        { role: 'system', content: 'sys' },
        { role: 'assistant', content: 'hi' },
      ]),
      null,
    )
  })

  it('extracts text from the first user message (content string)', () => {
    const out = extractFirstUserText([
      { role: 'system', content: 'sys' },
      { role: 'user', content: '  Implement the sidebar status dot  ' },
    ])
    assert.equal(out, 'Implement the sidebar status dot')
  })

  it('extracts text from parts[] and ignores non-text parts', () => {
    const out = extractFirstUserText([
      {
        role: 'user',
        parts: [
          { type: 'image', image: 'data:...' },
          { type: 'text', text: '  Review this PR  ' },
          { type: 'text', text: 'Second chunk' },
        ],
      },
    ])
    assert.equal(out, 'Review this PR\nSecond chunk')
  })

  it('skips a user message with empty/whitespace text, returns next user msg', () => {
    const out = extractFirstUserText([
      { role: 'user', content: '   ' },
      { role: 'user', content: 'real task' },
    ])
    assert.equal(out, 'real task')
  })

  it('ignores non-object entries gracefully', () => {
    const out = extractFirstUserText([null, 42, 'stray', { role: 'user', content: 'ok' }])
    assert.equal(out, 'ok')
  })
})

describe('cleanTitle', () => {
  it('returns null for empty / whitespace', () => {
    assert.equal(cleanTitle(''), null)
    assert.equal(cleanTitle('   '), null)
    assert.equal(cleanTitle(null), null)
    assert.equal(cleanTitle(undefined), null)
  })

  it('strips surrounding quotes (straight and fancy)', () => {
    assert.equal(cleanTitle('"Implement sidebar"'), 'Implement sidebar')
    assert.equal(cleanTitle('“Review PR”'), 'Review PR')
    assert.equal(cleanTitle("'Fix bug'"), 'Fix bug')
  })

  it('strips a "Title:" / "标题:" prefix', () => {
    assert.equal(cleanTitle('Title: Implement sidebar'), 'Implement sidebar')
    assert.equal(cleanTitle('标题：修复 bug'), '修复 bug')
  })

  it('drops a trailing period (west + cjk)', () => {
    assert.equal(cleanTitle('Implement sidebar.'), 'Implement sidebar')
    assert.equal(cleanTitle('修复 bug。'), '修复 bug')
  })

  it('collapses internal whitespace + newlines', () => {
    assert.equal(cleanTitle('Fix\n\nthe   bug'), 'Fix the bug')
  })

  it('caps length at 80 chars', () => {
    const long = 'x'.repeat(120)
    const out = cleanTitle(long)!
    assert.equal(out.length, 80)
  })
})
