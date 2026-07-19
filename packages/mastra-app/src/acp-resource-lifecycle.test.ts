import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  deleteRouterProjectResource,
  deleteRouterSessionResource,
  reconcileWorkerRuntimeResources,
} from './acp-resource-lifecycle.js'
import type { WorkerRegistration } from '@swarmdesk-agent/shared'

function worker(overrides: Partial<WorkerRegistration> = {}): WorkerRegistration {
  return {
    id: 'w1',
    name: 'Worker',
    kind: 'opencode',
    command: 'opencode',
    args: ['acp'],
    env: { HOME: '/tmp/home' },
    primaryRole: 'coder',
    roles: ['coder'],
    capabilities: [],
    enabled: true,
    scope: 'global',
    description: 'test',
    health: 'unknown',
    ...overrides,
  }
}

describe('ACP-backed resource lifecycle', () => {
  it('cleans ACP context before deleting a Router Session', () => {
    const calls: string[] = []
    deleteRouterSessionResource({
      manager: {
        deleteContextByRouterSession: (id) => calls.push(`acp:${id}`),
        deleteContextsByRouterSessions: () => undefined,
      },
      store: {
        listSessions: () => [],
        deleteSession: (id) => calls.push(`store-session:${id}`),
        deleteProject: () => undefined,
      },
      sessionId: 'session-1',
    })
    assert.deepEqual(calls, ['acp:session-1', 'store-session:session-1'])
  })

  it('does not delete Store project state when ACP cleanup fails', () => {
    const calls: string[] = []
    assert.throws(
      () =>
        deleteRouterProjectResource({
          manager: {
            deleteContextByRouterSession: () => undefined,
            deleteContextsByRouterSessions: (ids) => {
              calls.push(`acp:${ids.join(',')}`)
              throw new Error('catalog unavailable')
            },
          },
          store: {
            listSessions: () => [{ id: 'session-1' }],
            deleteSession: () => undefined,
            deleteProject: (id) => calls.push(`store-project:${id}`),
          },
          projectId: 'project-1',
        }),
      /catalog unavailable/,
    )
    assert.deepEqual(calls, ['acp:session-1'])
  })

  it('deletes Store project state only after every session cleanup succeeds', () => {
    const calls: string[] = []
    deleteRouterProjectResource({
      manager: {
        deleteContextByRouterSession: () => undefined,
        deleteContextsByRouterSessions: (ids) => calls.push(`acp:${ids.join(',')}`),
      },
      store: {
        listSessions: () => [{ id: 'session-1' }, { id: 'session-2' }],
        deleteSession: () => undefined,
        deleteProject: (id) => calls.push(`store-project:${id}`),
      },
      projectId: 'project-1',
    })
    assert.deepEqual(calls, ['acp:session-1,session-2', 'store-project:project-1'])
  })

  it('invalidates every model catalog scope when discovery configuration changes', () => {
    const calls: string[] = []
    reconcileWorkerRuntimeResources({
      before: worker(),
      after: worker({ command: '/opt/opencode' }),
      manager: { deleteContextByWorker: (id) => calls.push(`session:${id}`) },
      catalogStore: { deleteWorker: (id) => calls.push(`catalog:${id}`) },
    })
    assert.deepEqual(calls, ['session:w1', 'catalog:w1'])
  })

  it('restarts ACP context for a model pin without deleting the catalog that validated it', () => {
    const calls: string[] = []
    reconcileWorkerRuntimeResources({
      before: worker(),
      after: worker({ model: 'opencode/model-a' }),
      manager: { deleteContextByWorker: (id) => calls.push(`session:${id}`) },
      catalogStore: { deleteWorker: (id) => calls.push(`catalog:${id}`) },
    })
    assert.deepEqual(calls, ['session:w1'])
  })

  it('invalidates ACP context when installationId / authRevision / runtimeProfile change', () => {
    const calls: string[] = []
    reconcileWorkerRuntimeResources({
      before: worker({ installationId: 'inst_1', authRevision: 0, runtimeProfile: 'generic-acp' }),
      after: worker({ installationId: 'inst_2', authRevision: 0, runtimeProfile: 'generic-acp' }),
      manager: { deleteContextByWorker: (id) => calls.push(`session:${id}`) },
      catalogStore: { deleteWorker: (id) => calls.push(`catalog:${id}`) },
    })
    assert.deepEqual(calls, ['session:w1'])

    calls.length = 0
    reconcileWorkerRuntimeResources({
      before: worker({ authRevision: 1 }),
      after: worker({ authRevision: 2 }),
      manager: { deleteContextByWorker: (id) => calls.push(`session:${id}`) },
      catalogStore: { deleteWorker: (id) => calls.push(`catalog:${id}`) },
    })
    assert.deepEqual(calls, ['session:w1'])

    calls.length = 0
    reconcileWorkerRuntimeResources({
      before: worker({ runtimeProfile: 'generic-acp' }),
      after: worker({ runtimeProfile: 'opencode' }),
      manager: { deleteContextByWorker: (id) => calls.push(`session:${id}`) },
      catalogStore: { deleteWorker: (id) => calls.push(`catalog:${id}`) },
    })
    assert.deepEqual(calls, ['session:w1'])
  })

  it('invalidates only live context and preserves durable history for Registry identity switches', () => {
    const calls: string[] = []
    reconcileWorkerRuntimeResources({
      before: worker({ installationId: 'inst_1' }),
      after: worker({ installationId: 'inst_2' }),
      manager: {
        deleteContextByWorker: (id) => calls.push(`delete-history:${id}`),
        invalidateWorker: (id) => calls.push(`invalidate-live:${id}`),
      },
      catalogStore: { deleteWorker: (id) => calls.push(`catalog:${id}`) },
      preserveSessionHistory: true,
    })

    assert.deepEqual(calls, ['invalidate-live:w1'])
  })

  it('does not invalidate when registry-irrelevant fields stay equal', () => {
    const calls: string[] = []
    reconcileWorkerRuntimeResources({
      before: worker({
        installationId: 'inst_1',
        authRevision: 1,
        runtimeProfile: 'generic-acp',
        description: 'a',
      }),
      after: worker({
        installationId: 'inst_1',
        authRevision: 1,
        runtimeProfile: 'generic-acp',
        description: 'b',
      }),
      manager: { deleteContextByWorker: (id) => calls.push(`session:${id}`) },
      catalogStore: { deleteWorker: (id) => calls.push(`catalog:${id}`) },
    })
    assert.deepEqual(calls, [])
  })
})
