/**
 * Mastra CLI / Studio entry (`mastra dev`).
 *
 * HARD client-only: never owner lease / local executor, regardless of env.
 * Admin REST is NOT mounted — owner http-server owns Store/Scheduler/SessionManager.
 *
 * Owner entry is `http-server.ts`, which must NOT import this module (would race roles).
 * Owner uses `create-mastra.ts` after `initializeAcpRuntime({ role: 'owner' })`.
 */
import { initializeAcpRuntime } from '../acp-runtime.js'
import {
  defaultRuntimeDiscoveryPath,
  readRuntimeDiscovery,
  resolveStudioToken,
  RuntimeDiscoveryError,
} from '../runtime-discovery.js'
import { buildStudioAuthUrl, resolveStudioPort } from '../studio-auth.js'
import { createMastra } from './create-mastra.js'

// Force client-only — ignore ROUTER_RUNTIME_ROLE=owner to prevent accidental dual writers
process.env.ROUTER_RUNTIME_ROLE = 'client-only'
process.env.ROUTER_CLIENT_ONLY = '1'

const discovery = readRuntimeDiscovery(defaultRuntimeDiscoveryPath())
if (!discovery) {
  throw new RuntimeDiscoveryError(
    'ROUTER_STUDIO_OWNER_UNAVAILABLE',
    'Router Agents owner API must be running before Mastra Studio starts',
  )
}
const studioToken = resolveStudioToken(discovery)
if (!studioToken) {
  throw new RuntimeDiscoveryError(
    'ROUTER_STUDIO_AUTH_UNAVAILABLE',
    'Owner runtime does not expose a dedicated Studio capability; restart the owner API',
  )
}
const studioPort = resolveStudioPort(process.env.ROUTER_STUDIO_PORT, discovery.port)

const studioRuntime = initializeAcpRuntime({
  role: 'client-only',
  applySecrets: false,
})
void studioRuntime

if (process.env.ROUTER_STUDIO_PRINT_AUTH_URL !== '0') {
  // The token is Studio-only (not an internal-runtime capability). Mastra consumes
  // auth_header once and removes it from the address bar without localStorage persistence.
  console.info(
    `[router-agents] Authenticated Studio URL: ${buildStudioAuthUrl({
      port: studioPort,
      token: studioToken,
    })}`,
  )
}

export const mastra = createMastra({
  includeAdminApi: false,
  port: studioPort,
  studioToken,
})

export { createMastra } from './create-mastra.js'
