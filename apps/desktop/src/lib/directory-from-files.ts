/**
 * Resolve the selected directory path from a <input webkitdirectory> FileList.
 *
 * Electron no longer exposes File.path in the renderer under contextIsolation.
 * Pass resolveAbsPath = window.routerAgents.dialog.getPathForFile (preload/webUtils).
 */

export type ElectronFile = File & { path?: string }

export function isAbsoluteFsPath(p: string): boolean {
  const s = p.trim()
  if (!s) return false
  if (s.startsWith('/')) return true
  // Windows: C:\ or C:/
  if (/^[A-Za-z]:[\\/]/.test(s)) return true
  return false
}

/**
 * Given files from a directory picker input, return the absolute directory path
 * the user selected (not a nested file path).
 *
 * @param resolveAbsPath - optional (Electron): webUtils.getPathForFile via preload
 */
export function directoryPathFromFileList(
  files: ArrayLike<ElectronFile> | null | undefined,
  resolveAbsPath?: (file: File) => string | null | undefined,
): string | null {
  if (!files || files.length === 0) return null

  const file = files[0]
  if (!file) return null

  let abs = typeof file.path === 'string' ? file.path.trim() : ''
  if (!abs && resolveAbsPath) {
    try {
      const resolved = resolveAbsPath(file)
      if (typeof resolved === 'string' && resolved.trim()) abs = resolved.trim()
    } catch {
      /* ignore */
    }
  }

  const rel = (file.webkitRelativePath || '').replace(/\\/g, '/')
  const rootSeg = rel.split('/').filter(Boolean)[0]

  if (abs && isAbsoluteFsPath(abs)) {
    const sep = abs.includes('\\') && !abs.startsWith('/') ? '\\' : '/'
    const normAbs = abs.replace(/\\/g, '/')

    if (rootSeg) {
      // e.g. abs=/Users/me/MyProj/src/a.ts  rel=MyProj/src/a.ts → /Users/me/MyProj
      const marker = `/${rootSeg}/`
      const idx = normAbs.indexOf(marker)
      if (idx >= 0) {
        const end = idx + 1 + rootSeg.length
        const out = normAbs.slice(0, end)
        return sep === '\\' ? out.replace(/\//g, '\\') : out
      }

      // File directly under root: /Users/me/MyProj/file.ts with rel=MyProj/file.ts
      const markerEnd = `/${rootSeg}`
      const idxEnd = normAbs.lastIndexOf(markerEnd)
      if (idxEnd >= 0) {
        const after = normAbs.slice(idxEnd + markerEnd.length)
        if (after === '' || after.startsWith('/')) {
          const out = normAbs.slice(0, idxEnd + markerEnd.length)
          return sep === '\\' ? out.replace(/\//g, '\\') : out
        }
      }
    }

    // Fallback: parent directory of the first file
    const lastSlash = Math.max(normAbs.lastIndexOf('/'), abs.lastIndexOf('\\'))
    if (lastSlash > 0) {
      const out = abs.slice(0, lastSlash)
      return out || null
    }
    return abs
  }

  // No absolute path — only relative root name (not usable for open project)
  return null
}
