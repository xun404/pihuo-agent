/**
 * @deprecated Prefer explicit initializeAcpRuntime({ role }) from each entrypoint.
 * Owner uses http-server.ts. There is no Studio entrypoint.
 * Kept so accidental imports remain client-only (never steal owner lease).
 */
import { initializeAcpRuntime } from './acp-runtime.js'

export const acpRuntime = initializeAcpRuntime({
  role: process.env.PIHUO_AGENT_RUNTIME_ROLE === 'owner' ? 'owner' : 'client-only',
})
