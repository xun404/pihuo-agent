import { RequestContext } from '@mastra/core/request-context'
import type { RouterSessionContext } from './runtime-dispatch-port.js'

const SWARMDESK_AGENT_HEADERS = {
  sessionId: 'x-swarmdesk-agent-session-id',
  projectId: 'x-swarmdesk-agent-project-id',
  projectRoot: 'x-swarmdesk-agent-project-root',
  memoryThreadId: 'x-swarmdesk-agent-memory-thread-id',
} as const

export interface RouterHeaders {
  sessionId?: string
  projectId?: string
  projectRoot?: string
  memoryThreadId?: string
}

/** Binding is always via owner resolution of memoryThreadId — never raw client headers. */
export type TrustedBindingResult = 'thread' | 'unbound'

function getHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const val = headers[name]
  if (Array.isArray(val)) return val[0]
  return val
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/**
 * Extract Router identity headers for diagnostics only.
 * Never trust these as ownership proof — CORS is open (`*`) and Studio can forge them.
 */
export function extractRouterHeadersFromRequest(req: {
  headers: Record<string, string | string[] | undefined>
}): RouterHeaders | undefined {
  const sessionId = getHeader(req.headers, SWARMDESK_AGENT_HEADERS.sessionId)
  const projectId = getHeader(req.headers, SWARMDESK_AGENT_HEADERS.projectId)
  const projectRoot = getHeader(req.headers, SWARMDESK_AGENT_HEADERS.projectRoot)
  const memoryThreadId = getHeader(req.headers, SWARMDESK_AGENT_HEADERS.memoryThreadId)

  if (!sessionId || !projectId || !memoryThreadId) return undefined

  return { sessionId, projectId, projectRoot, memoryThreadId }
}

/**
 * Extract memory thread id only (Studio + Desktop path).
 * Ignores Router Session/Project tuple from body and headers — never trusted from client.
 */
export function extractMemoryThreadIdOnly(req: {
  headers: Record<string, string | string[] | undefined>
  body?: unknown
}): string | undefined {
  const fromHeader = nonEmpty(getHeader(req.headers, SWARMDESK_AGENT_HEADERS.memoryThreadId))
  if (fromHeader) return fromHeader

  const body = req.body
  if (!body || typeof body !== 'object') return undefined
  const b = body as Record<string, unknown>

  const direct = nonEmpty(b.memoryThreadId) ?? nonEmpty(b.threadId)
  if (direct) return direct

  const memory = b.memory
  if (memory && typeof memory === 'object') {
    const thread = (memory as { thread?: unknown }).thread
    if (typeof thread === 'string') return nonEmpty(thread)
    if (thread && typeof thread === 'object') {
      return nonEmpty((thread as { id?: unknown }).id)
    }
  }

  return undefined
}

type RequestContextLike = {
  set: (key: string, value: unknown) => void
}

/**
 * @deprecated Prefer applyTrustedRouterBinding — raw headers are not trusted.
 * Kept for callers that already have a verified RouterHeaders tuple from the owner.
 */
export function applyRouterContextToRequest(
  requestContext: RequestContext | RequestContextLike,
  headers: RouterHeaders,
): boolean {
  if (!headers.sessionId || !headers.projectId || !headers.memoryThreadId) return false

  requestContext.set('routerSessionId', headers.sessionId)
  requestContext.set('routerProjectId', headers.projectId)
  requestContext.set('memoryThreadId', headers.memoryThreadId)
  if (headers.projectRoot) {
    requestContext.set('routerProjectRoot', headers.projectRoot)
  }

  return true
}

function applyTrustedSessionContext(
  requestContext: { set: (key: string, value: unknown) => void },
  ctx: RouterSessionContext,
): void {
  requestContext.set('routerSessionId', ctx.routerSessionId)
  requestContext.set('routerProjectId', ctx.routerProjectId)
  requestContext.set('memoryThreadId', ctx.memoryThreadId)
  if (ctx.routerProjectRoot) {
    requestContext.set('routerProjectRoot', ctx.routerProjectRoot)
  }
}

/**
 * Bind trusted Router Session into RequestContext.
 *
 * Security rules (CORS `*` + Studio):
 * 1. Only extract memoryThreadId (header or Mastra body thread) — never trust client
 *    session/project/root headers as ownership proof.
 * 2. resolveSessionContext(threadId) against the main runtime owner.
 * 3. hit → write trusted tuple from store; miss → leave unbound.
 *
 * Full Desktop Router headers are intentionally NOT applied without owner resolution.
 */
export async function applyTrustedRouterBinding(opts: {
  requestContext: RequestContextLike
  headers: Record<string, string | string[] | undefined>
  body?: unknown
  resolveSessionContext: (memoryThreadId: string) => Promise<RouterSessionContext | null>
}): Promise<TrustedBindingResult> {
  const memoryThreadId = extractMemoryThreadIdOnly({
    headers: opts.headers,
    body: opts.body,
  })
  if (!memoryThreadId) return 'unbound'

  let resolved: RouterSessionContext | null
  try {
    resolved = await opts.resolveSessionContext(memoryThreadId)
  } catch {
    // Main runtime unreachable / auth failure — leave unbound; dispatch will surface stable code.
    return 'unbound'
  }

  if (!resolved) return 'unbound'

  applyTrustedSessionContext(opts.requestContext, resolved)
  return 'thread'
}
