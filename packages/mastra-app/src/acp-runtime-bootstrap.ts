/**
 * @deprecated Prefer explicit initializeAcpRuntime({ role }) from each entrypoint.
 * Studio uses mastra/index.ts; owner uses http-server.ts.
 * Kept so accidental imports remain client-only (never steal owner lease).
 */
import { initializeAcpRuntime } from './acp-runtime.js'

export const acpRuntime = initializeAcpRuntime({
  role: process.env.SWARMDESK_AGENT_RUNTIME_ROLE === 'owner' ? 'owner' : 'client-only',
})
