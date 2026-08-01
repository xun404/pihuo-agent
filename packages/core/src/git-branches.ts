/**
 * Git branch operations: list / switch / create / commit-and-switch.
 *
 * Mirrors git-status.ts style — pure `git` CLI via execFile, no IPC, no git library.
 * Switch uses `git switch --no-guess` (matches zcode semantics: remote-only branches
 * are not auto-created). Error stderr is classified into structured issue codes.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'

const execFileAsync = promisify(execFile)

export interface BranchInfo {
  name: string
  isCurrent: boolean
  upstreamName?: string
  commitHash?: string
  commitTimestampMs?: number
}

export interface BranchListResult {
  ok: boolean
  isRepo: boolean
  headRefType: 'branch' | 'detached'
  currentBranchName: string | null
  branches: BranchInfo[]
  dirtyFileCount: number
  error?: string
}

export type BranchSwitchIssueCode =
  | 'tracked-changes-would-be-overwritten'
  | 'untracked-changes-would-be-overwritten'
  | 'conflicts-present'
  | 'operation-in-progress'
  | 'branch-in-other-worktree'
  | 'target-branch-not-found'
  | 'request-failed'

export interface BranchSwitchIssue {
  code: BranchSwitchIssueCode
  message: string
  paths?: string[]
}

export interface BranchSwitchResult {
  ok: boolean
  action: 'switch' | 'create'
  branchName: string
  didChange: boolean
  issues: BranchSwitchIssue[]
  /** Current branch after the operation, if known. */
  currentBranchName?: string
  error?: string
}

async function runGit(
  cwd: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    })
    return { stdout: String(stdout), stderr: String(stderr), code: 0 }
  } catch (e: unknown) {
    const err = e as { code?: number; stdout?: string; stderr?: string; message?: string }
    return {
      stdout: String(err.stdout ?? ''),
      stderr: String(err.stderr ?? err.message ?? ''),
      code: typeof err.code === 'number' ? err.code : 1,
    }
  }
}

/**
 * Parse `git for-each-ref refs/heads
 *   --format=%(refname:short)%00%(upstream:short)%00%(objectname)%00%(committerdate:unix)`.
 * Fields separated by NUL (\u0000), records by newline.
 *
 * Sort order: current first → commitTimestampMs desc → name asc.
 */
export function parseBranchForEachRef(
  output: string,
  currentBranchName: string | null,
): BranchInfo[] {
  const out: BranchInfo[] = []
  for (const line of output.split(/\r?\n/)) {
    if (!line || !line.trim()) continue
    const parts = line.split('\u0000')
    const name = (parts[0] ?? '').trim()
    if (!name) continue
    const upstreamRaw = (parts[1] ?? '').trim()
    const hash = (parts[2] ?? '').trim()
    const tsRaw = (parts[3] ?? '').trim()
    const ts = Number(tsRaw)
    out.push({
      name,
      isCurrent: name === currentBranchName,
      upstreamName: upstreamRaw || undefined,
      commitHash: hash || undefined,
      commitTimestampMs: Number.isFinite(ts) && ts > 0 ? ts * 1000 : undefined,
    })
  }
  out.sort((a, b) => {
    if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1
    if (a.commitTimestampMs && b.commitTimestampMs) {
      if (a.commitTimestampMs !== b.commitTimestampMs) {
        return b.commitTimestampMs - a.commitTimestampMs
      }
    } else if (a.commitTimestampMs && !b.commitTimestampMs) {
      return -1
    } else if (!a.commitTimestampMs && b.commitTimestampMs) {
      return 1
    }
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
  })
  return out
}

/**
 * Extract indented file paths that follow a "would be overwritten by checkout:" header.
 */
function extractOverwritePaths(stderr: string): string[] | undefined {
  const m = stderr.match(
    /would be overwritten by checkout:\r?\n([\s\S]*?)(?:\r?\n\r?\n|\r?\nPlease|\r?\nAborting|$)/i,
  )
  if (!m || !m[1]) return undefined
  const paths = m[1]
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^Please/i.test(l) && !/^Aborting/i.test(l))
  return paths.length > 0 ? paths : undefined
}

/**
 * Map a `git switch` stderr to a structured issue code. Returns null when stderr is empty.
 */
export function classifySwitchError(stderr: string): BranchSwitchIssue | null {
  const s = stderr.trim()
  if (!s) return null

  if (/would be overwritten by checkout/i.test(s) && /local changes/i.test(s)) {
    return {
      code: 'tracked-changes-would-be-overwritten',
      message: '本地已跟踪的改动会被覆盖',
      paths: extractOverwritePaths(s),
    }
  }
  if (/untracked working tree files would be overwritten/i.test(s)) {
    return {
      code: 'untracked-changes-would-be-overwritten',
      message: '未跟踪的工作区文件会被覆盖',
      paths: extractOverwritePaths(s),
    }
  }
  if (/you need to resolve your current index first/i.test(s)) {
    return { code: 'conflicts-present', message: '当前存在未解决的冲突' }
  }
  if (/Another git process seems to be running/i.test(s)) {
    return { code: 'operation-in-progress', message: '另一个 git 进程正在运行' }
  }
  if (/is already checked out at/i.test(s)) {
    const m = s.match(/is already checked out at '?([^'\n]+)'?/i)
    return {
      code: 'branch-in-other-worktree',
      message: m ? `该分支已在其它 worktree 检出：${m[1]}` : '该分支已在其它 worktree 检出',
    }
  }
  if (/did not match any file\(s\) known to git/i.test(s)) {
    return { code: 'target-branch-not-found', message: '目标分支不存在' }
  }
  if (/invalid reference:/i.test(s)) {
    // `git switch --no-gguess <missing>` → "fatal: invalid reference: <name>"
    return { code: 'target-branch-not-found', message: '目标分支不存在' }
  }
  return { code: 'request-failed', message: s.split('\n')[0]!.slice(0, 200) }
}

/**
 * List local branches for a repo root.
 */
export async function listLocalBranches(rootPath: string): Promise<BranchListResult> {
  const root = rootPath.trim()
  if (!root || !existsSync(root)) {
    return {
      ok: false,
      isRepo: false,
      headRefType: 'branch',
      currentBranchName: null,
      branches: [],
      dirtyFileCount: 0,
      error: `Path does not exist: ${root}`,
    }
  }
  const rev = await runGit(root, ['rev-parse', '--is-inside-work-tree'])
  if (rev.code !== 0 || !rev.stdout.trim().includes('true')) {
    return {
      ok: false,
      isRepo: false,
      headRefType: 'branch',
      currentBranchName: null,
      branches: [],
      dirtyFileCount: 0,
      error: rev.stderr.trim() || 'Not a git repository',
    }
  }

  const [headRes, forEachRef, statusRes] = await Promise.all([
    runGit(root, ['rev-parse', '--abbrev-ref', 'HEAD']),
    runGit(root, [
      'for-each-ref',
      'refs/heads',
      '--format=%(refname:short)%00%(upstream:short)%00%(objectname)%00%(committerdate:unix)',
    ]),
    runGit(root, ['status', '--porcelain']),
  ])

  const currentBranch = headRes.stdout.trim()
  const headRefType: 'branch' | 'detached' =
    currentBranch === '' || currentBranch === 'HEAD' ? 'detached' : 'branch'
  const currentName = headRefType === 'detached' ? null : currentBranch

  const branches = parseBranchForEachRef(forEachRef.stdout, currentName)
  const dirtyFileCount = statusRes.stdout.split(/\r?\n/).filter((l) => l.length > 0).length

  return {
    ok: true,
    isRepo: true,
    headRefType,
    currentBranchName: currentName,
    branches,
    dirtyFileCount,
  }
}

/**
 * Run `git switch --no-guess <target>` and classify the outcome.
 */
async function runSwitch(
  rootPath: string,
  targetBranchName: string,
  action: 'switch' | 'create',
): Promise<BranchSwitchResult> {
  const root = rootPath.trim()
  if (!root || !existsSync(root)) {
    return {
      ok: false,
      action,
      branchName: targetBranchName,
      didChange: false,
      issues: [],
      error: `Path does not exist: ${root}`,
    }
  }

  // Pre-check: already on target?
  const headRes = await runGit(root, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const current = headRes.stdout.trim()
  if (current === targetBranchName) {
    return {
      ok: true,
      action,
      branchName: targetBranchName,
      didChange: false,
      issues: [],
      currentBranchName: current,
    }
  }

  const res = await runGit(root, ['switch', '--no-guess', targetBranchName])
  if (res.code === 0) {
    return {
      ok: true,
      action,
      branchName: targetBranchName,
      didChange: true,
      issues: [],
      currentBranchName: targetBranchName,
    }
  }
  const issue = classifySwitchError(res.stderr)
  return {
    ok: false,
    action,
    branchName: targetBranchName,
    didChange: false,
    issues: issue ? [issue] : [],
    error: res.stderr.trim() || 'git switch failed',
  }
}

/**
 * Switch to an existing local branch with `git switch --no-guess`.
 */
export async function switchBranch(
  rootPath: string,
  targetBranchName: string,
): Promise<BranchSwitchResult> {
  return runSwitch(rootPath, targetBranchName, 'switch')
}

/**
 * Create a new branch from startPoint (or HEAD) and switch to it.
 */
export async function createBranchAndSwitch(
  rootPath: string,
  branchName: string,
  startPoint?: string,
): Promise<BranchSwitchResult> {
  const root = rootPath.trim()
  if (!root || !existsSync(root)) {
    return {
      ok: false,
      action: 'create',
      branchName,
      didChange: false,
      issues: [],
      error: `Path does not exist: ${root}`,
    }
  }
  const createArgs = ['branch', branchName]
  if (startPoint && startPoint.trim()) createArgs.push(startPoint.trim())
  const create = await runGit(root, createArgs)
  if (create.code !== 0) {
    return {
      ok: false,
      action: 'create',
      branchName,
      didChange: false,
      issues: [{ code: 'request-failed', message: create.stderr.trim() || 'git branch failed' }],
    }
  }
  return runSwitch(root, branchName, 'create')
}

/**
 * Stage all changes, commit with message, then switch.
 * Used by the commit-and-switch assist flow when a switch is blocked by tracked dirty files.
 */
export async function commitAndSwitch(
  rootPath: string,
  targetBranchName: string,
  message: string,
): Promise<BranchSwitchResult> {
  const root = rootPath.trim()
  if (!root || !existsSync(root)) {
    return {
      ok: false,
      action: 'switch',
      branchName: targetBranchName,
      didChange: false,
      issues: [],
      error: `Path does not exist: ${root}`,
    }
  }
  const add = await runGit(root, ['add', '-A'])
  if (add.code !== 0) {
    return {
      ok: false,
      action: 'switch',
      branchName: targetBranchName,
      didChange: false,
      issues: [{ code: 'request-failed', message: add.stderr.trim() || 'git add failed' }],
    }
  }
  const commit = await runGit(root, ['commit', '-m', message])
  if (commit.code !== 0) {
    // "nothing to commit" is acceptable — proceed to switch
    if (!/nothing to commit|no changes added/i.test(commit.stdout + commit.stderr)) {
      return {
        ok: false,
        action: 'switch',
        branchName: targetBranchName,
        didChange: false,
        issues: [{ code: 'request-failed', message: commit.stderr.trim() || 'git commit failed' }],
      }
    }
  }
  return runSwitch(rootPath, targetBranchName, 'switch')
}
