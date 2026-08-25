import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  filterMentionCandidates,
  insertMention,
  mentionQueryAt,
  splitMentions,
} from './im-mentions.js'

describe('im-mentions', () => {
  it('detects an @ query at the caret', () => {
    assert.deepEqual(mentionQueryAt('请 @Op', 5), { start: 2, query: 'Op' })
    assert.equal(mentionQueryAt('请看这里', 4), null)
  })

  it('inserts a mention over the active query', () => {
    const next = insertMention('请 @Op', 5, 'OpenCode')
    assert.equal(next.text, '请 @OpenCode ')
  })

  it('splits visible @Name tokens in the message body', () => {
    const parts = splitMentions('请 @OpenCode 看一下登录页。', ['OpenCode', 'Leader'])
    assert.deepEqual(parts, [
      { type: 'text', value: '请 ' },
      { type: 'mention', value: 'OpenCode' },
      { type: 'text', value: ' 看一下登录页。' },
    ])
  })

  it('filters candidates by name', () => {
    const found = filterMentionCandidates(
      [
        { id: 'leader', name: 'Leader', subtitle: '编排' },
        { id: 'm1', name: 'OpenCode', subtitle: 'general' },
      ],
      'open',
    )
    assert.equal(found.length, 1)
    assert.equal(found[0]?.name, 'OpenCode')
  })
})
