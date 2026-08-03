import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WorkerRegistration } from '@swarmdesk-agent/shared'
import { DangerZoneBusyError, dangerZoneStats, performDangerZoneAction } from './danger-zone.js'
import { LocalStore } from './store.js'

function worker(id: string): WorkerRegistration {
  return {
    id,
    name: id,
    kind: 'custom',
    command: '/bin/echo',
    args: [],
    primaryRole: 'general',
    roles: ['general'],
    capabilities: ['general'],
    enabled: true,
    scope: 'global',
    description: '',
    defaultRoleType: 'general',
    health: 'unknown',
    source: { type: 'custom' },
    runtimeProfile: 'generic-acp',
  }
}

describe('danger zone service', () => {
  const dir = mkdtempSync(join(tmpdir(), 'swarmdesk-danger-zone-'))
  after(() => rmSync(dir, { recursive: true, force: true }))

  it('reports real Worker, Team assignment, crew, and chat counts', () => {
    const store = new LocalStore(join(dir, 'stats.json'))
    const firstWorker = store.upsertWorker(worker('worker-1'))
    const project = store.upsertProject({ name: 'project', rootPath: join(dir, 'project') })
    const session = store.createSession({ projectId: project.id, title: 'chat' })
    store.setWorkerEnabled(firstWorker.id, true)
    store.createTeamMember({
      chatSessionId: session.id,
      workerId: firstWorker.id,
      name: 'Coder',
      roleType: 'coder',
      instructions: 'code',
    })
    assert.deepEqual(dangerZoneStats(store.snapshot()), {
      projects: 1,
      workers: 1,
      workerSessions: 1,
      crews: 0,
      chatSessions: 1,
    })
  })

  it('clears Worker roster and crews without deleting chat sessions', async () => {
    const store = new LocalStore(join(dir, 'workers.json'))
    const registered = store.upsertWorker(worker('worker-1'))
    const project = store.upsertProject({ name: 'project', rootPath: join(dir, 'project-2') })
    const session = store.createSession({ projectId: project.id, title: 'chat' })
    store.setWorkerEnabled(registered.id, true)
    store.createTeamMember({
      chatSessionId: session.id,
      workerId: registered.id,
      name: 'Coder',
      roleType: 'coder',
      instructions: 'code',
    })
    const calls: string[] = []
    const result = await performDangerZoneAction('clear-workers-and-crews', {
      store,
      runtime: {
        deleteContextByWorker: (id) => calls.push(`worker:${id}`),
        deleteContextsByRouterSessions: () => calls.push('sessions'),
      },
      deleteMemoryThreads: async () => undefined,
      clearWorkerSecrets: () => ({ workers: 1 }),
      deleteWorkerCatalog: (id) => calls.push(`catalog:${id}`),
    })
    assert.equal(result.snapshot.sessions.length, 1)
    assert.equal(result.snapshot.workers.length, 0)
    assert.equal(result.snapshot.teamMembers.length, 0)
    assert.deepEqual(calls, ['worker:worker-1', 'catalog:worker-1'])
  })

  it('deletes each session memory thread before committing clear-sessions', async () => {
    const statePath = join(dir, 'memory-threads.json')
    const initialStore = new LocalStore(statePath)
    const project = initialStore.upsertProject({
      name: 'project',
      rootPath: join(dir, 'project-memory'),
    })
    const explicit = initialStore.createSession({
      projectId: project.id,
      title: 'explicit',
      memoryThreadId: 'memory-explicit',
    })
    const legacy = initialStore.createSession({
      projectId: project.id,
      title: 'legacy',
      memoryThreadId: 'memory-legacy',
    })
    const snapshot = initialStore.snapshot()
    // Simulate a legacy persisted session whose memoryThreadId was absent.
    writeFileSync(
      statePath,
      JSON.stringify({
        ...snapshot,
        sessions: snapshot.sessions.map((session) =>
          session.id === legacy.id ? { ...session, memoryThreadId: undefined } : session,
        ),
      }),
    )
    const store = new LocalStore(statePath)
    const deletedThreads: string[] = []
    const result = await performDangerZoneAction('clear-sessions', {
      store,
      runtime: {
        deleteContextByWorker: () => undefined,
        deleteContextsByRouterSessions: () => undefined,
      },
      deleteMemoryThreads: async (threadIds) => {
        deletedThreads.push(...threadIds)
      },
    })

    assert.deepEqual(new Set(deletedThreads), new Set([explicit.memoryThreadId, legacy.id]))
    assert.equal(deletedThreads.length, 2)
    assert.equal(result.snapshot.sessions.length, 0)
  })

  it('does not commit session deletion when Mastra memory cleanup fails', async () => {
    const store = new LocalStore(join(dir, 'memory-failure.json'))
    const project = store.upsertProject({
      name: 'project',
      rootPath: join(dir, 'project-memory-failure'),
    })
    store.createSession({ projectId: project.id, title: 'chat', memoryThreadId: 'memory-fails' })

    await assert.rejects(
      () =>
        performDangerZoneAction('clear-sessions', {
          store,
          runtime: {
            deleteContextByWorker: () => undefined,
            deleteContextsByRouterSessions: () => undefined,
          },
          deleteMemoryThreads: async () => {
            throw new Error('memory unavailable')
          },
        }),
      /memory unavailable/u,
    )
    assert.equal(store.snapshot().sessions.length, 1)
  })

  it('cleans every memory thread before reset-all state commit', async () => {
    const store = new LocalStore(join(dir, 'reset-memory.json'))
    const project = store.upsertProject({
      name: 'project',
      rootPath: join(dir, 'project-reset-memory'),
    })
    const session = store.createSession({
      projectId: project.id,
      title: 'chat',
      memoryThreadId: 'reset-memory-thread',
    })
    const deletedThreads: string[] = []
    const result = await performDangerZoneAction('reset-all', {
      store,
      runtime: {
        deleteContextByWorker: () => undefined,
        deleteContextsByRouterSessions: () => undefined,
      },
      deleteMemoryThreads: async (threadIds) => {
        deletedThreads.push(...threadIds)
      },
      clearCache: () => ({ removed: [] }),
    })

    assert.deepEqual(deletedThreads, [session.memoryThreadId])
    assert.equal(result.snapshot.sessions.length, 0)
  })

  it('refuses destructive state actions while jobs are open', async () => {
    const store = new LocalStore(join(dir, 'busy.json'))
    const registered = store.upsertWorker(worker('worker-1'))
    const project = store.upsertProject({ name: 'project', rootPath: join(dir, 'project-3') })
    const session = store.createSession({ projectId: project.id, title: 'chat' })
    store.createJob({
      projectId: project.id,
      sessionId: session.id,
      workerId: registered.id,
      workerName: registered.name,
      task: 'running',
      cwd: project.rootPath,
      source: 'ui',
      status: 'running',
    })
    await assert.rejects(
      () =>
        performDangerZoneAction('clear-sessions', {
          store,
          runtime: {
            deleteContextByWorker: () => undefined,
            deleteContextsByRouterSessions: () => undefined,
          },
          deleteMemoryThreads: async () => undefined,
        }),
      (error: unknown) => error instanceof DangerZoneBusyError && error.openJobs === 1,
    )
  })
})
