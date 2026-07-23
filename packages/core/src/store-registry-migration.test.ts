import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalStore } from './store.js'

describe('LocalStore Registry source migration', () => {
  let dir: string
  let path: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ra-registry-migration-'))
    path = join(dir, 'state.json')
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('preserves legacy Worker, Project, and Session ids while adding source fields', () => {
    writeFileSync(
      path,
      JSON.stringify({
        revision: 17,
        locale: 'en',
        projects: [
          {
            id: 'project-stable',
            name: 'Legacy Project',
            rootPath: join(dir, 'project'),
            workerIds: ['worker-builtin', 'worker-custom'],
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        sessions: [
          {
            id: 'session-stable',
            projectId: 'project-stable',
            title: 'Legacy Session',
            status: 'idle',
            mode: 'build',
            activeWorkerIds: ['worker-custom'],
            memoryThreadId: 'memory-stable',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        workers: [
          {
            id: 'worker-builtin',
            name: 'Codex',
            kind: 'codex',
            command: 'codex-acp',
            args: [],
            primaryRole: 'coder',
            roles: ['coder'],
            capabilities: ['code-edit'],
            enabled: true,
            scope: 'global',
            description: 'legacy builtin',
            health: 'unknown',
          },
          {
            id: 'worker-custom',
            name: 'Custom ACP',
            kind: 'custom',
            command: '/opt/custom-acp',
            args: ['--acp'],
            primaryRole: 'general',
            roles: ['general'],
            capabilities: ['general'],
            enabled: true,
            scope: 'global',
            description: 'legacy custom',
            health: 'unknown',
          },
        ],
        approvals: [],
        jobs: [],
        activeProjectId: 'project-stable',
        activeSessionId: 'session-stable',
      }),
    )

    const snapshot = new LocalStore(path).snapshot()
    assert.equal(snapshot.projects[0]?.id, 'project-stable')
    assert.equal(snapshot.sessions[0]?.id, 'session-stable')
    assert.deepEqual(snapshot.projects[0]?.workerIds, ['worker-builtin', 'worker-custom'])
    assert.deepEqual(snapshot.sessions[0]?.activeWorkerIds, ['worker-custom'])

    const builtin = snapshot.workers.find((worker) => worker.id === 'worker-builtin')
    const custom = snapshot.workers.find((worker) => worker.id === 'worker-custom')
    assert.deepEqual(builtin?.source, { type: 'custom' })
    assert.equal(builtin?.runtimeProfile, 'generic-acp')
    assert.deepEqual(custom?.source, { type: 'custom' })
    assert.equal(custom?.runtimeProfile, 'generic-acp')
    assert.equal(custom?.command, '/opt/custom-acp')
    assert.deepEqual(custom?.args, ['--acp'])
  })

  it('keeps explicit Registry ownership facts unchanged', () => {
    const store = new LocalStore(path)
    const saved = store.upsertWorker({
      id: 'worker-registry',
      name: 'Registry Agent',
      kind: 'custom',
      command: 'npx',
      args: ['--yes', '@example/agent@1.0.0'],
      primaryRole: 'general',
      roles: ['general'],
      capabilities: ['general'],
      enabled: true,
      scope: 'global',
      description: 'registry',
      defaultRoleType: 'general',
      health: 'unknown',
      source: {
        type: 'registry',
        registryId: 'example-agent',
        registryVersion: '1.0.0',
        registrySchemaVersion: '1.0.0',
        manifestDigest: `sha256:${'a'.repeat(64)}`,
        distribution: 'npx',
        installationId: 'installation-stable',
      },
      runtimeProfile: 'generic-acp',
      installationId: 'installation-stable',
    })

    assert.equal(saved.id, 'worker-registry')
    assert.equal(saved.source?.type, 'registry')
    assert.equal(saved.installationId, 'installation-stable')
  })
})
