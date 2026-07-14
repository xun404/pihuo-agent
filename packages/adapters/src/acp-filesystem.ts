import { realpathSync, statSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname, isAbsolute } from 'node:path'

export const DEFAULT_MAX_FILE_BYTES = 1_000_000
export const DEFAULT_WRITE_MAX_BYTES = 2_000_000

export interface ResolveContainedResult {
  ok: true
  resolved: string
  absolute: string
}

export interface ResolveContainedError {
  ok: false
  error: string
}

export function resolveContainedPath(
  cwd: string,
  target: string,
): ResolveContainedResult | ResolveContainedError {
  const normalizedCwd = realpathSync(resolve(cwd))

  if (!target || target.includes('\0')) {
    return { ok: false, error: 'Path must not be empty or contain null bytes' }
  }

  const candidate = isAbsolute(target) ? resolve(target) : resolve(normalizedCwd, target)

  let real: string
  try {
    real = realpathSync(candidate)
  } catch {
    return { ok: false, error: `Path does not exist or cannot be resolved: ${target}` }
  }

  if (real !== normalizedCwd && !real.startsWith(normalizedCwd + '/')) {
    return {
      ok: false,
      error: `Path escapes workspace: ${target}`,
    }
  }

  return { ok: true, resolved: real, absolute: candidate }
}

export function resolveContainedParent(
  cwd: string,
  target: string,
): ResolveContainedResult | ResolveContainedError {
  const dir = dirname(target)
  if (dir === target) {
    return resolveContainedPath(cwd, target)
  }
  try {
    const result = resolveContainedPath(cwd, dir)
    if (!result.ok) return result
  } catch {
    return { ok: false, error: `Parent directory not accessible: ${dir}` }
  }
  const candidate = isAbsolute(target) ? resolve(target) : resolve(cwd, target)
  return { ok: true, resolved: candidate, absolute: candidate }
}

export function readContainedText(
  cwd: string,
  target: string,
  maxBytes: number = DEFAULT_MAX_FILE_BYTES,
): { ok: true; content: string } | { ok: false; error: string } {
  const pathResult = resolveContainedPath(cwd, target)
  if (!pathResult.ok) return pathResult

  try {
    const stat = statSync(pathResult.resolved)
    if (!stat.isFile()) {
      return { ok: false, error: `Not a regular file: ${target}` }
    }
    if (stat.size > maxBytes) {
      return { ok: false, error: `File exceeds ${maxBytes} bytes: ${target}` }
    }
    const content = readFileSync(pathResult.resolved, 'utf8')
    return { ok: true, content }
  } catch (e) {
    return { ok: false, error: `Cannot read file: ${e instanceof Error ? e.message : e}` }
  }
}

export function writeContainedText(
  cwd: string,
  target: string,
  content: string,
  maxBytes: number = DEFAULT_WRITE_MAX_BYTES,
): { ok: true } | { ok: false; error: string } {
  if (Buffer.byteLength(content, 'utf8') > maxBytes) {
    return { ok: false, error: `Content exceeds ${maxBytes} bytes` }
  }

  const parentResult = resolveContainedParent(cwd, target)
  if (!parentResult.ok) return parentResult

  if (existsSync(parentResult.resolved)) {
    try {
      const real = realpathSync(parentResult.resolved)
      const normalizedCwd = realpathSync(resolve(cwd))
      if (real !== normalizedCwd && !real.startsWith(normalizedCwd + '/')) {
        return {
          ok: false,
          error: `Target path escapes workspace (existing file): ${target}`,
        }
      }
    } catch {
      return {
        ok: false,
        error: `Cannot verify target path: ${target}`,
      }
    }
  }

  try {
    writeFileSync(parentResult.absolute, content, 'utf8')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: `Cannot write file: ${e instanceof Error ? e.message : e}` }
  }
}
