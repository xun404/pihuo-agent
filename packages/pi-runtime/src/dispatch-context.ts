import { existsSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, relative as pathRelative, resolve as pathResolve } from 'node:path'

export interface DispatchContextValues {
  routerSessionId: string
  routerProjectId: string
  routerProjectRoot?: string
  memoryThreadId: string
}

interface DispatchToolContext {
  requestContext?: {
    get?: (key: string) => unknown
  }
  agent?: {
    threadId?: string
  }
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

/**
 * Resolve the Router identity carried by Mastra's trusted RequestContext.
 * `agent.threadId` is optional in Mastra, so only compare it when present.
 */
export function resolveDispatchContext(context: DispatchToolContext): DispatchContextValues {
  const get = context.requestContext?.get?.bind(context.requestContext)
  const routerSessionId = nonEmptyString(get?.('routerSessionId'))
  const routerProjectId = nonEmptyString(get?.('routerProjectId'))
  const routerProjectRoot = nonEmptyString(get?.('routerProjectRoot'))
  const memoryThreadId = nonEmptyString(get?.('memoryThreadId'))
  const agentThreadId = nonEmptyString(context.agent?.threadId)

  if (agentThreadId && memoryThreadId && agentThreadId !== memoryThreadId) {
    throw new Error(`Thread mismatch: agent thread ${agentThreadId} vs session ${memoryThreadId}`)
  }
  if (!routerSessionId || !routerProjectId || !memoryThreadId) {
    throw new Error(
      'PIHUO_AGENT_SESSION_BINDING_REQUIRED: dispatch requires bound Router Session context ' +
        '(routerSessionId, routerProjectId, memoryThreadId). ' +
        `Got: session=${routerSessionId}, project=${routerProjectId}, thread=${memoryThreadId}`,
    )
  }

  return {
    routerSessionId,
    routerProjectId,
    routerProjectRoot,
    memoryThreadId,
  }
}

export type AuthorizeCwdResult =
  | { ok: true; cwd: string }
  | {
      ok: false
      error: string
      code: 'CWD_OUTSIDE_PROJECT' | 'CWD_INVALID' | 'PROJECT_ROOT_REQUIRED'
    }

function isInsideRoot(rootReal: string, candidateReal: string): boolean {
  if (candidateReal === rootReal) return true
  // path.relative is platform-aware (Windows drive letters, separators)
  const rel = pathRelative(rootReal, candidateReal)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/**
 * Ensure `requestedCwd` (or project root default) is realpath-contained within the bound project root.
 * Requires cwd to exist as a directory (blocks symlink-ancestor + non-existent child escapes).
 * Cross-project paths require a separate explicit user authorization flow.
 */
export function authorizeDispatchCwd(
  projectRoot: string | undefined,
  requestedCwd?: string | null,
): AuthorizeCwdResult {
  const rootRaw = projectRoot?.trim()
  if (!rootRaw) {
    return {
      ok: false,
      error: 'project root required for dispatch cwd',
      code: 'PROJECT_ROOT_REQUIRED',
    }
  }

  let rootReal: string
  try {
    const absRoot = pathResolve(rootRaw)
    if (!existsSync(absRoot)) {
      return { ok: false, error: `project root does not exist: ${rootRaw}`, code: 'CWD_INVALID' }
    }
    rootReal = realpathSync(absRoot)
    if (!statSync(rootReal).isDirectory()) {
      return {
        ok: false,
        error: `project root is not a directory: ${rootRaw}`,
        code: 'CWD_INVALID',
      }
    }
  } catch {
    return { ok: false, error: `invalid project root: ${rootRaw}`, code: 'CWD_INVALID' }
  }

  const candidateRaw = requestedCwd?.trim() || rootReal
  if (candidateRaw.includes('\0')) {
    return { ok: false, error: 'cwd must not contain null bytes', code: 'CWD_INVALID' }
  }

  let candidateAbs: string
  try {
    candidateAbs = isAbsolute(candidateRaw)
      ? pathResolve(candidateRaw)
      : pathResolve(rootReal, candidateRaw)
  } catch {
    return { ok: false, error: `invalid cwd: ${candidateRaw}`, code: 'CWD_INVALID' }
  }

  // Require existing directory — blocks "symlink ancestor + non-existent child" escapes
  if (!existsSync(candidateAbs)) {
    return {
      ok: false,
      error: `cwd does not exist (must be an existing directory under the project): ${candidateRaw}`,
      code: 'CWD_INVALID',
    }
  }

  let candidateReal: string
  try {
    candidateReal = realpathSync(candidateAbs)
    if (!statSync(candidateReal).isDirectory()) {
      return { ok: false, error: `cwd is not a directory: ${candidateRaw}`, code: 'CWD_INVALID' }
    }
  } catch {
    return { ok: false, error: `cwd cannot be resolved: ${candidateRaw}`, code: 'CWD_INVALID' }
  }

  if (!isInsideRoot(rootReal, candidateReal)) {
    return {
      ok: false,
      error: `cwd escapes project root: ${candidateRaw}`,
      code: 'CWD_OUTSIDE_PROJECT',
    }
  }

  return { ok: true, cwd: candidateReal }
}
