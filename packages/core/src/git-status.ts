import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const execFileAsync = promisify(execFile)

export interface GitChangedFile {
  path: string
  /** Combined short status e.g. M, A, D, ??, MM */
  status: string
  /** Index status (first porcelain column) */
  index: string
  /** Worktree status (second porcelain column) */
  worktree: string
}

export interface GitStatusResult {
  ok: boolean
  isRepo: boolean
  rootPath: string
  branch?: string
  files: GitChangedFile[]
  insertions: number
  deletions: number
  error?: string
}

/**
 * Parse `git status --porcelain` (v1) output into structured file rows.
 */
export function parseGitStatusPorcelain(output: string): GitChangedFile[] {
  const lines = output.split(/\r?\n/).filter((l) => l.length > 0)
  const files: GitChangedFile[] = []

  for (const line of lines) {
    if (line.length < 3) continue
    const index = line[0] === ' ' ? ' ' : line[0]!
    const worktree = line[1] === ' ' ? ' ' : line[1]!
    let rest = line.slice(3)

    // rename: "R  old -> new" or "R  old -> new"
    if (rest.includes(' -> ')) {
      const parts = rest.split(' -> ')
      rest = parts[parts.length - 1]!.trim()
    }

    // Untracked: "?? path"
    const status =
      index === '?' && worktree === '?'
        ? '??'
        : `${index === ' ' ? '' : index}${worktree === ' ' ? '' : worktree}`.trim() ||
          index + worktree

    files.push({
      path: rest,
      status: status.trim() || 'M',
      index,
      worktree,
    })
  }

  return files
}

/**
 * Parse combined numstat lines: "added\tdeleted\tpath"
 */
export function parseGitNumstat(output: string): { insertions: number; deletions: number } {
  let insertions = 0
  let deletions = 0
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue
    const [a, d] = line.split('\t')
    if (a === undefined || d === undefined) continue
    if (a !== '-') insertions += Number(a) || 0
    if (d !== '-') deletions += Number(d) || 0
  }
  return { insertions, deletions }
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
    const err = e as {
      code?: number
      stdout?: string
      stderr?: string
      message?: string
    }
    return {
      stdout: String(err.stdout ?? ''),
      stderr: String(err.stderr ?? err.message ?? ''),
      code: typeof err.code === 'number' ? err.code : 1,
    }
  }
}

/**
 * Real git status for a project root. Returns structured error when not a repo / git missing.
 */
export async function getGitStatus(rootPath: string): Promise<GitStatusResult> {
  const root = rootPath.trim()
  if (!root || !existsSync(root)) {
    return {
      ok: false,
      isRepo: false,
      rootPath: root,
      files: [],
      insertions: 0,
      deletions: 0,
      error: `Path does not exist: ${root}`,
    }
  }

  const rev = await runGit(root, ['rev-parse', '--is-inside-work-tree'])
  if (rev.code !== 0 || !rev.stdout.trim().includes('true')) {
    return {
      ok: false,
      isRepo: false,
      rootPath: root,
      files: [],
      insertions: 0,
      deletions: 0,
      error: rev.stderr.trim() || 'Not a git repository',
    }
  }

  const [statusRes, branchRes, unstaged, staged] = await Promise.all([
    runGit(root, ['status', '--porcelain']),
    runGit(root, ['rev-parse', '--abbrev-ref', 'HEAD']),
    runGit(root, ['diff', '--numstat']),
    runGit(root, ['diff', '--cached', '--numstat']),
  ])

  if (statusRes.code !== 0) {
    return {
      ok: false,
      isRepo: true,
      rootPath: root,
      branch: branchRes.stdout.trim() || undefined,
      files: [],
      insertions: 0,
      deletions: 0,
      error: statusRes.stderr.trim() || 'git status failed',
    }
  }

  const files = parseGitStatusPorcelain(statusRes.stdout)
  const a = parseGitNumstat(unstaged.stdout)
  const b = parseGitNumstat(staged.stdout)

  return {
    ok: true,
    isRepo: true,
    rootPath: root,
    branch: branchRes.stdout.trim() || undefined,
    files,
    insertions: a.insertions + b.insertions,
    deletions: a.deletions + b.deletions,
  }
}

/** Convenience: check .git exists without invoking git (fast fail). */
export function looksLikeGitRepo(rootPath: string): boolean {
  return existsSync(join(rootPath, '.git'))
}
