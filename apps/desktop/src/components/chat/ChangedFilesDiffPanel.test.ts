import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { expandedPathsForInitialPath, scopeForInitialPath } from './ChangedFilesDiffPanel.js'

describe('ChangedFilesDiffPanel initial file', () => {
  const files = [
    { path: 'src/working.ts', status: ' M', index: ' ', worktree: 'M' },
    { path: 'src/staged.ts', status: 'M ', index: 'M', worktree: ' ' },
  ]

  it('expands the file selected from the compact changed-files list', () => {
    assert.deepEqual([...expandedPathsForInitialPath('src/working.ts')], ['src/working.ts'])
    assert.deepEqual([...expandedPathsForInitialPath(null)], [])
  })

  it('uses the scope that contains a selected staged-only file', () => {
    assert.equal(scopeForInitialPath(files, 'src/working.ts'), 'working')
    assert.equal(scopeForInitialPath(files, 'src/staged.ts'), 'staged')
  })
})
