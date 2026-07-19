import { LocalStore, type LocalStoreMode } from './store.js'

/**
 * Process-wide LocalStore singleton so HTTP handlers and agent tools
 * share projects/sessions/approvals/workers when co-located.
 */
let instance: LocalStore | null = null
let instanceMode: LocalStoreMode | null = null

export function getSharedStore(opts?: { mode?: LocalStoreMode }): LocalStore {
  // Studio/client-only processes must never create a writable Store via accidental import
  const envClientOnly =
    process.env.SWARMDESK_AGENT_CLIENT_ONLY === '1' || process.env.SWARMDESK_AGENT_RUNTIME_ROLE === 'client-only'
  const mode: LocalStoreMode = opts?.mode ?? (envClientOnly ? 'readOnly' : 'owner')
  if (!instance) {
    instance = new LocalStore(undefined, { mode })
    instanceMode = mode
    return instance
  }
  // Do not upgrade readOnly → owner in the same process
  if (instanceMode === 'readOnly' && mode === 'owner') {
    throw new Error('Shared LocalStore already initialized as readOnly')
  }
  return instance
}

export function resetSharedStoreForTests(): void {
  instance = null
  instanceMode = null
}
