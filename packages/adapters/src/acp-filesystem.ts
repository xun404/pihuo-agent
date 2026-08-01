import { realpathSync, statSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname, isAbsolute } from 'node:path'
import type { ApprovalOption } from '@swarmdesk-agent/shared'
import { classifyAcpFilePath } from './acp-path-scope.js'

export const DEFAULT_MAX_FILE_BYTES = 1_000_000
export const DEFAULT_WRITE_MAX_BYTES = 2_000_000

export interface AcpFilesystemPermissionRequest {
  source: 'client_fs'
  kind: 'edit'
  title: string
  locations: Array<{ path: string }>
  options: ApprovalOption[]
}

export type AcpFilesystemPermissionResult = {
  outcome: 'selected' | 'cancelled'
  optionId?: string
}

export interface WriteAcpTextFileInput {
  projectRoot: string
  target: string
  content: string
  maxBytes?: number
  signal?: AbortSignal
  requestPermission?: (
    request: AcpFilesystemPermissionRequest,
  ) => Promise<AcpFilesystemPermissionResult>
}

const FILESYSTEM_ALLOW_ONCE_ID = 'router_fs_allow_once'
const FILESYSTEM_REJECT_ONCE_ID = 'router_fs_reject_once'

const FILESYSTEM_PERMISSION_OPTIONS: ApprovalOption[] = [
  { optionId: FILESYSTEM_ALLOW_ONCE_ID, name: 'Allow once', kind: 'allow_once' },
  { optionId: FILESYSTEM_REJECT_ONCE_ID, name: 'Reject once', kind: 'reject_once' },
]

export function readAcpTextFile(
  projectRoot: string,
  target: string,
  maxBytes: number = DEFAULT_MAX_FILE_BYTES,
): { ok: true; content: string } | { ok: false; error: string } {
  const classification = classifyAcpFilePath({ projectRoot, path: target })
  if (!classification.resolvedPath) return { ok: false, error: 'Cannot resolve file path' }

  try {
    const stat = statSync(classification.resolvedPath)
    if (!stat.isFile()) return { ok: false, error: 'Target is not a regular file' }
    if (stat.size > maxBytes) return { ok: false, error: `File exceeds ${maxBytes} bytes` }
    return { ok: true, content: readFileSync(classification.resolvedPath, 'utf8') }
  } catch {
    return { ok: false, error: 'Cannot read file' }
  }
}

export async function writeAcpTextFileWithPermission(
  input: WriteAcpTextFileInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const maxBytes = input.maxBytes ?? DEFAULT_WRITE_MAX_BYTES
  if (Buffer.byteLength(input.content, 'utf8') > maxBytes) {
    return { ok: false, error: `Content exceeds ${maxBytes} bytes` }
  }
  if (input.signal?.aborted) return { ok: false, error: 'Write cancelled' }

  const initial = classifyAcpFilePath({ projectRoot: input.projectRoot, path: input.target })
  if (initial.scope === 'unknown' || !initial.resolvedPath) {
    return { ok: false, error: 'Cannot verify target path' }
  }

  if (initial.scope === 'outside_project') {
    if (!input.requestPermission) return { ok: false, error: 'Permission required' }
    let permission: AcpFilesystemPermissionResult
    try {
      permission = await input.requestPermission({
        source: 'client_fs',
        kind: 'edit',
        title: 'Write file outside project',
        locations: [{ path: initial.resolvedPath }],
        options: FILESYSTEM_PERMISSION_OPTIONS.map((option) => ({ ...option })),
      })
    } catch {
      return { ok: false, error: 'Permission request failed' }
    }
    if (permission.outcome !== 'selected' || permission.optionId !== FILESYSTEM_ALLOW_ONCE_ID) {
      return { ok: false, error: 'Write not allowed' }
    }
  }

  if (input.signal?.aborted) return { ok: false, error: 'Write cancelled' }
  const final = classifyAcpFilePath({ projectRoot: input.projectRoot, path: input.target })
  if (
    final.scope === 'unknown' ||
    !final.resolvedPath ||
    final.scope !== initial.scope ||
    final.resolvedPath !== initial.resolvedPath
  ) {
    return { ok: false, error: 'Target path changed before write' }
  }

  try {
    writeFileSync(final.resolvedPath, input.content, 'utf8')
    return { ok: true }
  } catch {
    return { ok: false, error: 'Cannot write file' }
  }
}

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
