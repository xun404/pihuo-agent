import { Mastra } from '@mastra/core/mastra'
import { chatRoute } from '@mastra/ai-sdk'
import { leaderAgent, leaderStorage } from '../agents/leader-agent.js'
import { apiRoutes } from '../routes/api.js'

const port = Number(process.env.MASTRA_PORT ?? 4111)

/**
 * Mastra instance with persistent storage (required for Memory + Goals thread state).
 * Background tasks allow long worker dispatches without blocking the chat loop.
 * @see https://mastra.ai/docs/memory/overview
 * @see https://mastra.ai/docs/memory/message-history
 * @see https://mastra.ai/docs/long-running-agents/goals
 * @see https://mastra.ai/docs/long-running-agents/background-tasks
 */
export const mastra = new Mastra({
  agents: { leaderAgent },
  storage: leaderStorage,
  backgroundTasks: {
    enabled: true,
    globalConcurrency: 10,
    perAgentConcurrency: 4,
    backpressure: 'queue',
    defaultTimeoutMs: 600_000,
  },
  server: {
    port,
    cors: {
      origin: '*',
      allowMethods: ['*'],
      allowHeaders: ['*'],
    },
    apiRoutes: [
      chatRoute({
        path: '/chat/:agentId',
      }),
      ...apiRoutes,
    ],
  },
})
