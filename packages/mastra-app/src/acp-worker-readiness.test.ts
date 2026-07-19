import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  evaluateWorkerReadinessGate,
  isWorkerDispatchable,
  bumpAuthRevision,
  applyReadinessToWorker,
} from './acp-worker-readiness.js'
import type { WorkerRegistration } from '@router-agents/shared'

function worker(overrides: Partial<WorkerRegistration> = {}): WorkerRegistration {
  return {
    id: 'w1',
    name: 'Agent',
    kind: 'custom',
    command: 'npx',
    args: [],
    primaryRole: 'general',
    roles: ['general'],
    capabilities: [],
    enabled: true,
    scope: 'global',
    description: 't',
    health: 'unknown',
    ...overrides,
  }
}

describe('evaluateWorkerReadinessGate', () => {
  it('allows legacy workers without readiness', () => {
    assert.equal(evaluateWorkerReadinessGate(worker()).ok, true)
  })

  it('allows ready and degraded', () => {
    assert.equal(
      isWorkerDispatchable(worker({ readiness: { status: 'ready', checkedAt: 't' } })),
      true,
    )
    assert.equal(
      isWorkerDispatchable(worker({ readiness: { status: 'degraded', checkedAt: 't' } })),
      true,
    )
  })

  it('blocks auth_required even with force', () => {
    const r = evaluateWorkerReadinessGate(
      worker({
        readiness: {
          status: 'auth_required',
          code: 'WORKER_AUTH_REQUIRED',
          message: 'need auth',
          nextAction: 'authenticate',
        },
      }),
      { force: true },
    )
    assert.equal(r.ok, false)
    if (!r.ok) {
      assert.equal(r.code, 'WORKER_AUTH_REQUIRED')
      assert.equal(r.nextAction, 'authenticate')
    }
  })

  it('blocks prepared / incompatible / failed', () => {
    for (const status of ['prepared', 'incompatible', 'failed'] as const) {
      assert.equal(isWorkerDispatchable(worker({ readiness: { status } })), false)
    }
  })

  it('blocks disabled workers', () => {
    assert.equal(
      isWorkerDispatchable(
        worker({
          enabled: false,
          readiness: { status: 'ready' },
        }),
      ),
      false,
    )
  })
})

describe('auth revision helpers', () => {
  it('bumps monotonically and applies readiness', () => {
    assert.equal(bumpAuthRevision(undefined), 1)
    assert.equal(bumpAuthRevision(3), 4)
    const next = applyReadinessToWorker(
      worker({ authRevision: 1 }),
      { status: 'ready', code: 'SESSION_READY' },
      { authRevision: 2 },
    )
    assert.equal(next.readiness?.status, 'ready')
    assert.equal(next.authRevision, 2)
  })
})
