import { lstatSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { resolveRouterDataPaths } from '@pihuo-agent/core'

export const MAX_THEME_FILE_BYTES = 256 * 1024
export const MAX_THEME_FILES = 100

export interface ThemeLoadError {
  filename: string
  reason: string
}

export interface RawThemeFile {
  filename: string
  raw: unknown
}

export interface ThemeLoadResult {
  directory: string
  themes: RawThemeFile[]
  skipped: number
  errors: ThemeLoadError[]
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Read user color themes without following links or allowing one malformed
 * file to hide the rest. Validation of the parsed payload happens in the
 * renderer's shared theme normalizer.
 */
export function loadCustomThemeFiles(
  directory = join(resolveRouterDataPaths().configDir, 'themes'),
): ThemeLoadResult {
  const result: ThemeLoadResult = {
    directory,
    themes: [],
    skipped: 0,
    errors: [],
  }

  let entries
  try {
    entries = readdirSync(directory, { withFileTypes: true })
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return result
    result.errors.push({ filename: '', reason: messageFor(error) })
    return result
  }

  const candidates = entries
    .filter((entry) => entry.name.toLowerCase().endsWith('.json'))
    .sort((left, right) => left.name.localeCompare(right.name))
  if (candidates.length > MAX_THEME_FILES) {
    result.skipped += candidates.length - MAX_THEME_FILES
  }

  for (const entry of candidates.slice(0, MAX_THEME_FILES)) {
    const filename = entry.name
    const filePath = join(directory, filename)
    try {
      // Dirent.isFile() and lstat both intentionally reject symlinks. A user
      // theme should never cause us to follow an arbitrary path elsewhere.
      if (!entry.isFile()) {
        result.skipped += 1
        continue
      }
      const linkStat = lstatSync(filePath)
      if (linkStat.isSymbolicLink() || !linkStat.isFile()) {
        result.skipped += 1
        continue
      }
      const stat = statSync(filePath)
      if (!stat.isFile()) {
        result.skipped += 1
        continue
      }
      if (stat.size > MAX_THEME_FILE_BYTES) {
        result.skipped += 1
        result.errors.push({
          filename,
          reason: `theme file exceeds ${MAX_THEME_FILE_BYTES} bytes`,
        })
        continue
      }
      const rawText = readFileSync(filePath, 'utf8')
      try {
        result.themes.push({ filename, raw: JSON.parse(rawText) as unknown })
      } catch (error) {
        result.errors.push({ filename, reason: `invalid JSON: ${messageFor(error)}` })
      }
    } catch (error) {
      result.errors.push({ filename, reason: messageFor(error) })
    }
  }

  return result
}
