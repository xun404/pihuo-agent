import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseUnifiedDiff, toSideBySideRows } from './parse-unified-diff.js'

describe('parseUnifiedDiff', () => {
  it('parses add/del/ctx with line numbers', () => {
    const patch = [
      'diff --git a/a.ts b/a.ts',
      '--- a/a.ts',
      '+++ b/a.ts',
      '@@ -1,3 +1,3 @@',
      ' keep',
      '-old',
      '+new',
    ].join('\n')
    const lines = parseUnifiedDiff(patch)
    const body = lines.filter((l) => l.kind === 'add' || l.kind === 'del' || l.kind === 'ctx')
    assert.equal(body.length, 3)
    assert.equal(body[0]!.kind, 'ctx')
    assert.equal(body[1]!.kind, 'del')
    assert.equal(body[1]!.content, 'old')
    assert.equal(body[2]!.kind, 'add')
    assert.equal(body[2]!.content, 'new')
  })

  it('empty patch → empty list', () => {
    assert.deepEqual(parseUnifiedDiff(''), [])
  })

  it('toSideBySideRows pairs del/add', () => {
    const lines = parseUnifiedDiff(
      ['@@ -1,2 +1,2 @@', ' same', '-old', '+new'].join('\n'),
    )
    const rows = toSideBySideRows(lines)
    const body = rows.filter((r) => !r.full)
    assert.equal(body.length, 2)
    assert.equal(body[0]!.left.kind, 'ctx')
    assert.equal(body[1]!.left.kind, 'del')
    assert.equal(body[1]!.right.kind, 'add')
    assert.equal(body[1]!.left.content, 'old')
    assert.equal(body[1]!.right.content, 'new')
  })
})
