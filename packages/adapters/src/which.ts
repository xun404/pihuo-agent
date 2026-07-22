import { accessSync, constants } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path'

/** Resolve an executable from PATH without coupling callers to Worker discovery. */
export function whichSync(command: string): string | null {
  const candidate = command.trim()
  if (!candidate) return null
  const paths = isAbsolute(candidate)
    ? [candidate]
    : (process.env.PATH ?? '')
        .split(delimiter)
        .filter(Boolean)
        .map((directory) => join(directory, candidate))

  for (const path of paths) {
    try {
      accessSync(path, constants.X_OK)
      return path
    } catch {
      // Continue searching PATH.
    }
  }
  return null
}
