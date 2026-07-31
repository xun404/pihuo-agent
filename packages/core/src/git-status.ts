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
  /** Line additions (from numstat; 0 if unknown / binary / untracked without count). */
  insertions?: number
  /** Line deletions (from numstat). */
  deletions?: number
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
 * (or "added\tdeleted\told => new" for renames)
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

/** Per-path numstat map. Binary files (`-\t-`) contribute 0/0. */
export function parseGitNumstatByPath(
  output: string,
): Map<string, { insertions: number; deletions: number }> {
  const map = new Map<string, { insertions: number; deletions: number }>()
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue
    const parts = line.split('\t')
    if (parts.length < 3) continue
    const a = parts[0]!
    const d = parts[1]!
    let path = parts.slice(2).join('\t').trim()
    // rename: "old => new" or "old -> new"
    if (path.includes(' => ')) {
      path = path.split(' => ').pop()!.trim()
    } else if (path.includes(' -> ')) {
      path = path.split(' -> ').pop()!.trim()
    }
    if (!path) continue
    const insertions = a === '-' ? 0 : Number(a) || 0
    const deletions = d === '-' ? 0 : Number(d) || 0
    const prev = map.get(path)
    if (prev) {
      prev.insertions += insertions
      prev.deletions += deletions
    } else {
      map.set(path, { insertions, deletions })
    }
  }
  return map
}

function mergeNumstatMaps(
  ...maps: Map<string, { insertions: number; deletions: number }>[]
): Map<string, { insertions: number; deletions: number }> {
  const out = new Map<string, { insertions: number; deletions: number }>()
  for (const m of maps) {
    for (const [path, stat] of m) {
      const prev = out.get(path)
      if (prev) {
        prev.insertions += stat.insertions
        prev.deletions += stat.deletions
      } else {
        out.set(path, { insertions: stat.insertions, deletions: stat.deletions })
      }
    }
  }
  return out
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
  const byPath = mergeNumstatMaps(
    parseGitNumstatByPath(unstaged.stdout),
    parseGitNumstatByPath(staged.stdout),
  )
  const filesWithStats = files.map((f) => {
    const s = byPath.get(f.path)
    return {
      ...f,
      insertions: s?.insertions ?? 0,
      deletions: s?.deletions ?? 0,
    }
  })

  return {
    ok: true,
    isRepo: true,
    rootPath: root,
    branch: branchRes.stdout.trim() || undefined,
    files: filesWithStats,
    insertions: a.insertions + b.insertions,
    deletions: a.deletions + b.deletions,
  }
}

/** Convenience: check .git exists without invoking git (fast fail). */
export function looksLikeGitRepo(rootPath: string): boolean {
  return existsSync(join(rootPath, '.git'))
}

export interface GitFileDiffResult {
  ok: boolean
  path: string
  /** true = index vs HEAD; false = worktree vs index (default). */
  staged: boolean
  isBinary: boolean
  isUntracked: boolean
  /** Unified diff patch (may be empty for pure renames / binary). */
  patch: string
  insertions: number
  deletions: number
  error?: string
}

/**
 * Resolve a path relative to the repo root; reject traversal / absolute escapes.
 */
export function resolveRepoRelativePath(
  rootPath: string,
  filePath: string,
): { ok: true; relative: string } | { ok: false; error: string } {
  const root = rootPath.trim()
  const raw = (filePath || '').trim().replace(/\\/g, '/')
  if (!raw) return { ok: false, error: 'path required' }
  if (raw.startsWith('/') || /^[A-Za-z]:\//.test(raw)) {
    // Absolute paths only accepted when they sit under root
    const normalizedRoot = root.replace(/\\/g, '/').replace(/\/+$/, '')
    const abs = raw.replace(/\/+$/, '')
    if (!abs.startsWith(normalizedRoot + '/') && abs !== normalizedRoot) {
      return { ok: false, error: 'path outside repository' }
    }
    const relative = abs.slice(normalizedRoot.length).replace(/^\//, '')
    if (!relative || relative.split('/').includes('..')) {
      return { ok: false, error: 'invalid path' }
    }
    return { ok: true, relative }
  }
  if (raw.split('/').includes('..')) return { ok: false, error: 'invalid path' }
  return { ok: true, relative: raw.replace(/^\.\//, '') }
}

function countPatchStats(patch: string): { insertions: number; deletions: number } {
  let insertions = 0
  let deletions = 0
  for (const line of patch.split(/\r?\n/)) {
    if (line.startsWith('+++') || line.startsWith('---')) continue
    if (line.startsWith('+')) insertions++
    else if (line.startsWith('-')) deletions++
  }
  return { insertions, deletions }
}

/**
 * Unified diff for a single path. Untracked files are rendered as a full add patch.
 * @param opts.contextLines - git `-U` context (default 3). Use a large value for full-file view.
 */
export async function getGitFileDiff(
  rootPath: string,
  filePath: string,
  opts?: { staged?: boolean; contextLines?: number },
): Promise<GitFileDiffResult> {
  const staged = opts?.staged === true
  const contextLines =
    typeof opts?.contextLines === 'number' && opts.contextLines >= 0
      ? Math.min(Math.floor(opts.contextLines), 1_000_000)
      : 3
  const resolved = resolveRepoRelativePath(rootPath, filePath)
  if (!resolved.ok) {
    return {
      ok: false,
      path: filePath,
      staged,
      isBinary: false,
      isUntracked: false,
      patch: '',
      insertions: 0,
      deletions: 0,
      error: resolved.error,
    }
  }
  const relative = resolved.relative
  const root = rootPath.trim()

  const rev = await runGit(root, ['rev-parse', '--is-inside-work-tree'])
  if (rev.code !== 0 || !rev.stdout.trim().includes('true')) {
    return {
      ok: false,
      path: relative,
      staged,
      isBinary: false,
      isUntracked: false,
      patch: '',
      insertions: 0,
      deletions: 0,
      error: rev.stderr.trim() || 'Not a git repository',
    }
  }

  // Detect untracked
  const check = await runGit(root, ['ls-files', '--error-unmatch', '--', relative])
  const isUntracked = check.code !== 0
  const contextArg = `-U${contextLines}`

  let patch = ''
  let isBinary = false

  if (isUntracked && !staged) {
    // Full-file add: git diff --no-index exits 1 when files differ — capture stdout.
    const diff = await runGit(root, [
      'diff',
      contextArg,
      '--no-index',
      '--',
      '/dev/null',
      relative,
    ])
    patch = diff.stdout
    if (!patch && existsSync(join(root, relative))) {
      // Fallback: read file and synthesize a simple add patch
      try {
        const { readFileSync } = await import('node:fs')
        const body = readFileSync(join(root, relative), 'utf8')
        const lines = body.split(/\r?\n/)
        const bodyLines = lines.map((l) => `+${l}`).join('\n')
        patch = [
          `diff --git a/${relative} b/${relative}`,
          'new file mode 100644',
          '--- /dev/null',
          `+++ b/${relative}`,
          `@@ -0,0 +1,${Math.max(lines.length, 1)} @@`,
          bodyLines,
        ].join('\n')
      } catch {
        patch = ''
      }
    }
  } else {
    const args = staged
      ? ['diff', '--cached', contextArg, '--', relative]
      : ['diff', contextArg, '--', relative]
    const diff = await runGit(root, args)
    patch = diff.stdout
    // Binary files: git prints "Binary files ... differ"
    if (/^Binary files /m.test(patch) || /GIT binary patch/i.test(patch)) {
      isBinary = true
    }
  }

  const stats = countPatchStats(patch)
  return {
    ok: true,
    path: relative,
    staged,
    isBinary,
    isUntracked,
    patch,
    insertions: stats.insertions,
    deletions: stats.deletions,
  }
}
