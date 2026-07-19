import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { cleanupRemoteAcpSession, resolveRemoteCleanupTimeoutMs } from './acp-remote-cleanup.js'

describe('cleanupRemoteAcpSession', () => {
  it('normalizes invalid and overflowing cleanup deadlines', () => {
    assert.equal(resolveRemoteCleanupTimeoutMs(undefined), 5_000)
    assert.equal(resolveRemoteCleanupTimeoutMs(0), 5_000)
    assert.equal(resolveRemoteCleanupTimeoutMs(Number.POSITIVE_INFINITY), 5_000)
    assert.equal(resolveRemoteCleanupTimeoutMs(123.9), 123)
    assert.equal(resolveRemoteCleanupTimeoutMs(999_999_999_999), 2_147_483_647)
  })

  it('rejects a missing cleanup executable without an uncaught process error', async () => {
    const now = new Date().toISOString()
    await assert.rejects(
      cleanupRemoteAcpSession(
        {
          version: 1,
          keyDigest: 'digest',
          routerSessionId: 'router-session',
          workerId: 'worker',
          canonicalCwd: process.cwd(),
          executionFingerprint: 'fingerprint',
          agentSessionId: 'remote-session',
          capabilities: { loadSession: false, resume: false, close: false, delete: true },
          state: 'ready',
          createdAt: now,
          lastUsedAt: now,
        },
        {
          command: '__swarmdesk_agent_missing_cleanup_executable__',
          args: [],
          env: {},
          kind: 'custom',
          timeoutMs: 1_000,
        },
      ),
      /ENOENT|spawn/i,
    )
  })
})
