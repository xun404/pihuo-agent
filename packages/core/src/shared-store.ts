import { LocalStore } from './store.js'

/**
 * Process-wide LocalStore singleton so HTTP handlers and agent tools
 * share projects/sessions/approvals/workers when co-located.
 */
let instance: LocalStore | null = null

export function getSharedStore(): LocalStore {
  if (!instance) {
    instance = new LocalStore()
  }
  return instance
}
