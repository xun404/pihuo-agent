import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { AcpSessionError, withAcpSession } from './acp-session.js'

describe('withAcpSession process boundary', () => {
  it('turns a missing executable into a controlled SPAWN error', async () => {
    await assert.rejects(
      withAcpSession(
        {
          spawn: {
            command: '__pihuo_agent_missing_acp_executable__',
            args: [],
            cwd: process.cwd(),
            env: {},
            workerId: 'worker',
            workerName: 'Missing Worker',
            kind: 'custom',
            primaryRole: 'general',
            roles: ['general'],
          },
        },
        {},
        async () => 'unreachable',
      ),
      (error: unknown) => error instanceof AcpSessionError && error.code === 'SPAWN',
    )
  })

  it('turns a synchronous spawn exception into a controlled SPAWN error', async () => {
    await assert.rejects(
      withAcpSession(
        {
          spawn: {
            command: '\0',
            args: [],
            cwd: process.cwd(),
            env: {},
            workerId: 'worker',
            workerName: 'Invalid Worker',
            kind: 'custom',
            primaryRole: 'general',
            roles: ['general'],
          },
        },
        {},
        async () => 'unreachable',
      ),
      (error: unknown) => error instanceof AcpSessionError && error.code === 'SPAWN',
    )
  })

  it('enforces timeoutMs while the agent is still initializing', async () => {
    const startedAt = Date.now()
    await assert.rejects(
      withAcpSession(
        {
          spawn: {
            command: process.execPath,
            args: ['-e', 'setInterval(() => {}, 1000)'],
            cwd: process.cwd(),
            env: {},
            workerId: 'worker',
            workerName: 'Hanging Worker',
            kind: 'custom',
            primaryRole: 'general',
            roles: ['general'],
          },
          timeoutMs: 50,
        },
        {},
        async () => 'unreachable',
      ),
      (error: unknown) => error instanceof AcpSessionError && error.code === 'TIMEOUT',
    )
    assert.ok(Date.now() - startedAt < 2_000)
  })

  it('honors cancellation while the agent is still initializing', async () => {
    const aborter = new AbortController()
    const startedAt = Date.now()
    const result = withAcpSession(
      {
        spawn: {
          command: process.execPath,
          args: ['-e', 'setInterval(() => {}, 1000)'],
          cwd: process.cwd(),
          env: {},
          workerId: 'worker',
          workerName: 'Hanging Worker',
          kind: 'custom',
          primaryRole: 'general',
          roles: ['general'],
        },
        signal: aborter.signal,
      },
      {},
      async () => 'unreachable',
    )
    aborter.abort()
    await assert.rejects(
      result,
      (error: unknown) => error instanceof AcpSessionError && error.code === 'CANCEL',
    )
    assert.ok(Date.now() - startedAt < 2_000)
  })
})
