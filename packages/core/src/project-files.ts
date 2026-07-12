import { readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

export interface FileEntry {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileEntry[]
}

export interface ListProjectFilesOptions {
  maxDepth?: number
  maxEntries?: number
  /** Skip common noise dirs */
  ignore?: string[]
}

export interface ListProjectFilesResult {
  ok: boolean
  rootPath: string
  entries: FileEntry[]
  truncated: boolean
  error?: string
}

const DEFAULT_IGNORE = new Set([
  'node_modules',
  '.git',
  'dist',
  'dist-electron',
  '.data',
  'coverage',
  '.turbo',
  'out',
])

/**
 * Bounded recursive directory listing under project root (sync, pure fs).
 */
export function listProjectFiles(
  rootPath: string,
  opts: ListProjectFilesOptions = {},
): ListProjectFilesResult {
  const root = rootPath.trim()
  const maxDepth = opts.maxDepth ?? 3
  const maxEntries = opts.maxEntries ?? 500
  const ignore = new Set([...(opts.ignore ?? []), ...DEFAULT_IGNORE])

  if (!root) {
    return { ok: false, rootPath: root, entries: [], truncated: false, error: 'rootPath required' }
  }

  let rootStat
  try {
    rootStat = statSync(root)
  } catch (e) {
    return {
      ok: false,
      rootPath: root,
      entries: [],
      truncated: false,
      error: e instanceof Error ? e.message : String(e),
    }
  }

  if (!rootStat.isDirectory()) {
    return {
      ok: false,
      rootPath: root,
      entries: [],
      truncated: false,
      error: 'rootPath is not a directory',
    }
  }

  let count = 0
  let truncated = false

  function walk(dir: string, depth: number): FileEntry[] {
    if (truncated || count >= maxEntries) {
      truncated = true
      return []
    }
    if (depth > maxDepth) return []

    let names: string[]
    try {
      names = readdirSync(dir)
    } catch {
      return []
    }

    names.sort((a, b) => a.localeCompare(b))
    const entries: FileEntry[] = []

    for (const name of names) {
      if (truncated || count >= maxEntries) {
        truncated = true
        break
      }
      if (name.startsWith('.') && name !== '.env.example') {
        // skip hidden except we already skip .git via ignore
        if (ignore.has(name) || name === '.' || name === '..') continue
        if (name.startsWith('.')) continue
      }
      if (ignore.has(name)) continue

      const abs = join(dir, name)
      let st
      try {
        st = statSync(abs)
      } catch {
        continue
      }

      const rel = relative(root, abs).split(sep).join('/')
      count += 1

      if (st.isDirectory()) {
        const children = depth < maxDepth ? walk(abs, depth + 1) : undefined
        entries.push({
          name,
          path: rel,
          type: 'directory',
          children: children && children.length > 0 ? children : undefined,
        })
      } else if (st.isFile()) {
        entries.push({ name, path: rel, type: 'file' })
      }
    }

    return entries
  }

  try {
    const entries = walk(root, 1)
    return { ok: true, rootPath: root, entries, truncated }
  } catch (e) {
    return {
      ok: false,
      rootPath: root,
      entries: [],
      truncated: false,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}
