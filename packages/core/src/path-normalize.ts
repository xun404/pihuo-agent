import { resolve } from 'node:path'
import { homedir } from 'node:os'

/**
 * Normalize a project root path so equivalent strings map to one project.
 * - expand ~
 * - resolve absolute
 * - strip trailing slashes (except root)
 * - lowercase drive letter on Windows (C:\ vs c:\)
 */
export function normalizeProjectRoot(rootPath: string): string {
  let p = (rootPath ?? '').trim()
  if (!p) return ''

  if (p.startsWith('~/') || p === '~') {
    p = resolve(homedir(), p.slice(2) || '.')
  } else if (p.startsWith('~\\')) {
    p = resolve(homedir(), p.slice(2) || '.')
  } else {
    p = resolve(p)
  }

  // Windows: unify drive letter case
  if (/^[A-Za-z]:[\\/]/.test(p)) {
    p = p[0]!.toUpperCase() + p.slice(1)
  }

  // Strip trailing separators (keep "/" or "C:\")
  if (p.length > 1 && (p.endsWith('/') || p.endsWith('\\'))) {
    p = p.replace(/[/\\]+$/, '')
  }

  // Normalize path separators for comparison keys on Windows keep native
  return p
}

/**
 * Deduplicate projects by normalized rootPath (first wins order-preserving).
 */
export function dedupeProjectsByRoot<T extends { rootPath: string }>(projects: T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const proj of projects) {
    const key = normalizeProjectRoot(proj.rootPath)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push({ ...proj, rootPath: key })
  }
  return out
}
