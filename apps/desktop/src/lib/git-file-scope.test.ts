import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  countScopes,
  filterFilesByScope,
  isStagedChange,
  isWorkingChange,
  type GitFileRow,
} from './git-file-scope.js'

const f = (partial: Partial<GitFileRow> & Pick<GitFileRow, 'path'>): GitFileRow => ({
  status: partial.status ?? 'M',
  index: partial.index ?? ' ',
  worktree: partial.worktree ?? ' ',
  path: partial.path,
})

describe('git-file-scope', () => {
  it('classifies unstaged modified as working', () => {
    const file = f({ path: 'a.ts', index: ' ', worktree: 'M', status: 'M' })
    assert.equal(isWorkingChange(file), true)
    assert.equal(isStagedChange(file), false)
  })

  it('classifies staged modified as staged', () => {
    const file = f({ path: 'a.ts', index: 'M', worktree: ' ', status: 'M' })
    assert.equal(isWorkingChange(file), false)
    assert.equal(isStagedChange(file), true)
  })

  it('classifies MM as both', () => {
    const file = f({ path: 'a.ts', index: 'M', worktree: 'M', status: 'MM' })
    assert.equal(isWorkingChange(file), true)
    assert.equal(isStagedChange(file), true)
  })

  it('classifies untracked as working only', () => {
    const file = f({ path: 'n.ts', index: '?', worktree: '?', status: '??' })
    assert.equal(isWorkingChange(file), true)
    assert.equal(isStagedChange(file), false)
  })

  it('filters and counts', () => {
    const files = [
      f({ path: 'w.ts', index: ' ', worktree: 'M' }),
      f({ path: 's.ts', index: 'A', worktree: ' ' }),
      f({ path: 'b.ts', index: 'M', worktree: 'M' }),
    ]
    assert.equal(filterFilesByScope(files, 'working').length, 2)
    assert.equal(filterFilesByScope(files, 'staged').length, 2)
    assert.equal(filterFilesByScope(files, 'turn').length, 0)
    assert.deepEqual(countScopes(files), { working: 2, staged: 2, turn: 0 })
  })
})
