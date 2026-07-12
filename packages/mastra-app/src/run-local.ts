/**
 * Quick local smoke test without mastra dev UI.
 * Usage: OPENAI_API_KEY=... npm run start -w @router-agents/mastra-app
 */
import { mastra } from './mastra/index.js'

const agent = mastra.getAgentById('router-leader')
const result = await agent.generate(
  'List available workers and suggest who should implement a left sidebar status dot feature.',
)
console.log(result.text)
