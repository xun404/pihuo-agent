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
          'Answer questions. Do not make destructive changes or dispatch implementers unless asked.',
      },
      {
        id: 'plan',
        name: 'Plan',
        metadata: { default: true },
        instructions:
          'Produce a clear step plan. Prefer plan-role workers. Do not implement unless the user asks.',
      },
      {
        id: 'build',
        name: 'Build',
        instructions:
          'Implement the approved plan. Prefer coder workers, then test. Summarize changes honestly.',
      },
      {
        id: 'review',
        name: 'Review',
        instructions:
          'Focus on code review and risk. Prefer review-role workers. Summarize findings.',
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
