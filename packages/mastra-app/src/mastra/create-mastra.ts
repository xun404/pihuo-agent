/**
 * Pure Mastra factory — no side-effect runtime initialization.
 * Owner (http-server) and Studio each initialize ACP runtime before calling this.
 */
import { Mastra } from '@mastra/core/mastra'
import { chatRoute } from '@mastra/ai-sdk'
import { leaderAgent, leaderStorage } from '../agents/leader-agent.js'
import { applyTrustedRouterBinding } from '../studio-context-injector.js'
import { getRuntimeDispatchPort } from '../runtime-dispatch-port.js'
import { createStudioAuth, STUDIO_LOOPBACK_HOST } from '../studio-auth.js'
// NOTE: do not static-import routes/api.js — it constructs LocalStore at module load.

export interface CreateMastraOptions {
  port: number
  /** Dedicated Studio capability. Must never reuse Desktop or internal-runtime tokens. */
  studioToken: string
  /**
   * When true, mount full REST admin routes (projects/workers/jobs…).
   * Owner http-server already implements these natively — leave false for owner.
   * Studio client-only MUST leave false so it cannot become a second writer/executor.
   */
  includeAdminApi?: boolean
}

export function createMastra(options: CreateMastraOptions): Mastra {
  const port = options.port
  const includeAdminApi = options.includeAdminApi === true
  const studioAuth = createStudioAuth(options.studioToken)

  return new Mastra({
    agents: { leaderAgent },
    storage: leaderStorage,
    backgroundTasks: {
      enabled: true,
      globalConcurrency: 10,
      perAgentConcurrency: 4,
      backpressure: 'queue',
      defaultTimeoutMs: 600_000,
    },
    // Studio requests carry x-mastra-client-type: studio. Direct API callers use
    // server.auth; configuring both prevents spoofing either surface into a bypass.
    studio: {
      auth: studioAuth,
    },
    server: {
      port,
      host: STUDIO_LOOPBACK_HOST,
      auth: studioAuth,
      // Studio is loopback-only remote client; never open CORS to arbitrary origins.
      // Desktop uses owner http-server with desktop token + origin allowlist.
      cors: {
        origin: (origin: string) => {
          if (!origin) return 'http://127.0.0.1'
          try {
            const u = new URL(origin)
            if (u.hostname === '127.0.0.1' || u.hostname === 'localhost') return origin
          } catch {
            /* deny */
          }
          return null
        },
        allowMethods: ['GET', 'POST', 'OPTIONS'],
        allowHeaders: [
          'Content-Type',
          'Authorization',
          'X-SwarmDesk-Agent-Desktop-Token',
          'x-mastra-client-type',
        ],
      },
      middleware: [
        {
          path: '*',
          handler: async (c: any, next: any) => {
            const requestContext = c.get('requestContext')
            if (requestContext) {
              let body: unknown
              try {
                const contentType = c.req.header('content-type') ?? ''
                if (
                  contentType.includes('application/json') &&
                  typeof c.req.raw?.clone === 'function'
                ) {
                  body = await c.req.raw
                    .clone()
                    .json()
                    .catch(() => undefined)
                }
              } catch {
                body = undefined
              }
              await applyTrustedRouterBinding({
                requestContext,
                headers: {
                  'x-swarmdesk-agent-session-id': c.req.header('x-swarmdesk-agent-session-id'),
                  'x-swarmdesk-agent-project-id': c.req.header('x-swarmdesk-agent-project-id'),
                  'x-swarmdesk-agent-project-root': c.req.header('x-swarmdesk-agent-project-root'),
                  'x-swarmdesk-agent-memory-thread-id': c.req.header(
                    'x-swarmdesk-agent-memory-thread-id',
                  ),
                },
                body,
                resolveSessionContext: (memoryThreadId) =>
                  getRuntimeDispatchPort().resolveSessionContext(memoryThreadId),
              })
            }
            await next()
          },
        },
      ],
      apiRoutes: [
        chatRoute({
          path: '/chat/:agentId',
          version: 'v6',
        }),
        // Admin REST is owner-only (http-server). Never static-import routes/api here:
        // that module constructs LocalStore on load and would break client-only Studio.
        ...(includeAdminApi
          ? (() => {
              throw new Error(
                'includeAdminApi is unsupported in createMastra; use owner http-server REST',
              )
            })()
          : []),
      ],
    },
  })
}
