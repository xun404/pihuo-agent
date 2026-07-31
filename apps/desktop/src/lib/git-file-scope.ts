/**
 * Classify git porcelain files into working / staged scopes.
 */
export type GitFileRow = {
  path: string
  status: string
  index: string
  worktree: string
  insertions?: number
  deletions?: number
}

export type DiffFileScope = 'working' | 'staged' | 'turn'

/** Unstaged worktree changes (incl. untracked). */
export function isWorkingChange(file: GitFileRow): boolean {
  const wt = file.worktree ?? ''
  const idx = file.index ?? ''
  if (file.status === '??' || idx === '?' || wt === '?') return true
  // worktree column has a non-space change letter
  return wt !== '' && wt !== ' '
}

/** Staged index changes (not untracked). */
export function isStagedChange(file: GitFileRow): boolean {
  const idx = file.index ?? ''
  if (!idx || idx === ' ' || idx === '?') return false
  return true
}

export function filterFilesByScope(files: GitFileRow[], scope: DiffFileScope): GitFileRow[] {
  if (scope === 'turn') return []
  if (scope === 'staged') return files.filter(isStagedChange)
  // working: prefer worktree-dirty files; include pure staged? No — "已更改" = working
  return files.filter(isWorkingChange)
}

export function countScopes(files: GitFileRow[]): {
  working: number
  staged: number
  turn: number
} {
  return {
    working: files.filter(isWorkingChange).length,
    staged: files.filter(isStagedChange).length,
    turn: 0,
  }
}
