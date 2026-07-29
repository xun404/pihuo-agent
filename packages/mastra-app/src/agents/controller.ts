/**
 * AgentController wiring for multi-mode collaborative sessions.
 * @see https://mastra.ai/docs/agent-controller/overview
 */
import { AgentController } from '@mastra/core/agent-controller'
import { leaderAgent, leaderStorage } from './leader-agent.js'

let controller: AgentController | null = null
let initPromise: Promise<AgentController> | null = null

export function getLeaderControllerConfig() {
  return {
    id: 'swarmdesk-agent-controller',
    modes: [
      {
        id: 'ask',
        name: 'Ask',
        instructions:
          'Coordinate an appropriate Team worker to answer the request and relay its result. Do not perform the technical work yourself.',
      },
      {
        id: 'plan',
        name: 'Plan',
        metadata: { default: true },
        instructions:
          'Coordinate plan/research workers to produce analysis or a plan and relay their deliverables. Do not dispatch implementation roles in plan mode. Do not perform the technical work yourself.',
      },
      {
        id: 'build',
        name: 'Build',
        instructions:
          'Coordinate coder workers to implement the requested or approved work, then coordinate test/review workers when needed. Relay Worker outputs without adding technical conclusions. Do not perform the technical work yourself.',
      },
      {
        id: 'review',
        name: 'Review',
        instructions:
          'Coordinate review workers to assess the requested code or result and relay their findings. Do not perform the technical work yourself.',
      },
    ],
  }
}

/**
 * Lazy-init AgentController shared by API routes.
 * Modes map to UI leader modes (ask|plan|build|review).
 */
export async function getLeaderController(): Promise<AgentController> {
  if (controller) return controller
  if (initPromise) return initPromise

  initPromise = (async () => {
    const cfg = getLeaderControllerConfig()
    const c = new AgentController({
      id: cfg.id,
      agent: leaderAgent,
      storage: leaderStorage,
      modes: cfg.modes.map((m) => ({
        id: m.id,
        name: m.name,
        metadata: m.metadata,
        instructions: m.instructions,
      })),
    })
    await c.init()
    controller = c
    return c
  })()

  return initPromise
}

export function controllerStatusSnapshot() {
  const cfg = getLeaderControllerConfig()
  return {
    id: cfg.id,
    modes: cfg.modes.map((m) => ({
      id: m.id,
      name: m.name,
      default: Boolean(m.metadata?.default),
    })),
    agentId: leaderAgent.id,
    storage: 'libsql',
    docs: 'https://mastra.ai/docs/agent-controller/overview',
  }
}
