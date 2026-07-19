/**
 * Quick local smoke test without mastra dev UI.
 * Usage: OPENAI_API_KEY=... node --import tsx src/run-local.ts
 */
import { initializeAcpRuntime } from './acp-runtime.js'
import { createMastra } from './mastra/create-mastra.js'
import { randomBytes } from 'node:crypto'

initializeAcpRuntime({ role: 'owner', registerProcessHandlers: false })
const mastra = createMastra({
  includeAdminApi: false,
  port: 4111,
  studioToken: randomBytes(32).toString('hex'),
})

const agent = mastra.getAgentById('router-leader')
const result = await agent.generate(
  'List available workers and suggest who should implement a left sidebar status dot feature.',
)
console.log(result.text)
