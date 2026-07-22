export interface AcpSessionCatalogPort {
  lookup(keyDigest: string): AcpSessionCatalogRecord | undefined
  /** Optional only for legacy/test ports; production cleanup fails closed when absent. */
  listAll?(): AcpSessionCatalogRecord[]
  listByRouterSession(routerSessionId: string): AcpSessionCatalogRecord[]
  listByWorker(workerId: string): AcpSessionCatalogRecord[]
  upsert(record: AcpSessionCatalogRecord): void
  touch(keyDigest: string, options?: { recovered?: boolean }): void
  markStale(keyDigest: string, reason: string): void
  deleteByKey(keyDigest: string): void
  deleteByRouterSession(routerSessionId: string): void
  deleteByRouterSessions(routerSessionIds: string[]): void
  deleteByWorker(workerId: string): void
  isAvailable(): boolean
}

export interface AcpSessionCatalogRecord {
  version: 1
  keyDigest: string
  routerSessionId: string
  workerId: string
  roleDefinitionId?: string
  roleRevision?: number
  installationId?: string
  manifestDigest?: string
  canonicalCwd: string
  executionFingerprint: string
  agentSessionId: string
  capabilities: { loadSession: boolean; resume: boolean; close: boolean; delete: boolean }
  state: 'ready' | 'stale'
  createdAt: string
  lastUsedAt: string
  lastRecoveredAt?: string
  staleReason?: string
}
