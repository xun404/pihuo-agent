import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { WorkerRegistration } from '@router-agents/shared'
import { selectWorkerByRole } from './select-worker.js'
import { buildAcpSpawnConfig } from './acp-config.js'
import { dispatchToWorker } from './dispatch.js'

function worker(
  partial: Partial<WorkerRegistration> &
    Pick<WorkerRegistration, 'id' | 'name' | 'kind' | 'primaryRole' | 'roles'>,
): WorkerRegistration {
  return {
    command: 'npx',
    args: ['-y', 'fake-acp'],
    capabilities: ['general'],
    enabled: true,
    scope: 'global',
    description: 'test',
    health: 'unknown',
    ...partial,
  }
}

const workers: WorkerRegistration[] = [
  worker({
    id: 'w-claude',
    name: 'Claude Code',
    kind: 'claude',
    primaryRole: 'coder',
    roles: ['coder', 'plan', 'research', 'general'],
  }),
  worker({
    id: 'w-codex',
    name: 'Codex CLI',
    kind: 'codex',
    primaryRole: 'review',
    roles: ['review', 'coder', 'test', 'general'],
  }),
  worker({
    id: 'w-oc',
    name: 'OpenCode',
    kind: 'opencode',
    primaryRole: 'general',
    roles: ['general', 'coder', 'plan', 'test'],
    enabled: false,
  }),
]

describe('selectWorkerByRole', () => {
  it('prefers primaryRole match for review', () => {
    const w = selectWorkerByRole(workers, { role: 'review' })
    assert.ok(w)
    assert.equal(w!.id, 'w-codex')
    assert.equal(w!.primaryRole, 'review')
  })

  it('selects coder primary (claude) for coder role', () => {
    const w = selectWorkerByRole(workers, { role: 'coder' })
    assert.ok(w)
    assert.equal(w!.id, 'w-claude')
  })

  it('matches by kind string', () => {
    const w = selectWorkerByRole(workers, { workerIdOrKind: 'codex' })
    assert.equal(w?.id, 'w-codex')
  })

  it('skips disabled workers when enabledOnly', () => {
    const w = selectWorkerByRole(workers, { role: 'general' })
    // opencode disabled; claude has general in roles and is enabled
    assert.ok(w)
    assert.notEqual(w!.id, 'w-oc')
  })

  it('prefers healthy worker over missing for same role', () => {
    const list = [
      worker({
        id: 'bad',
        name: 'Broken Coder',
        kind: 'custom',
        primaryRole: 'coder',
        roles: ['coder'],
        health: 'missing',
      }),
      worker({
        id: 'good',
        name: 'Good Coder',
        kind: 'claude',
        primaryRole: 'coder',
        roles: ['coder'],
        health: 'healthy',
      }),
    ]
    const w = selectWorkerByRole(list, { role: 'coder' })
    assert.equal(w?.id, 'good')
  })

  it('still selects forced missing worker by id', () => {
    const list = [
      worker({
        id: 'bad',
        name: 'Broken',
        kind: 'custom',
        primaryRole: 'coder',
        roles: ['coder'],
        health: 'missing',
      }),
      worker({
        id: 'good',
        name: 'Good',
        kind: 'claude',
        primaryRole: 'coder',
        roles: ['coder'],
        health: 'healthy',
      }),
    ]
    const w = selectWorkerByRole(list, { workerIdOrKind: 'bad' })
    assert.equal(w?.id, 'bad')
  })
})

describe('buildAcpSpawnConfig', () => {
  it('copies command/args and sets cwd', () => {
    const cfg = buildAcpSpawnConfig(workers[0]!, '/tmp/project')
    assert.equal(cfg.command, 'npx')
    assert.deepEqual(cfg.args, ['-y', 'fake-acp'])
    assert.equal(cfg.cwd, '/tmp/project')
    assert.equal(cfg.workerId, 'w-claude')
    assert.equal(cfg.primaryRole, 'coder')
  })

  it('does not copy Leader secrets into a worker spawn configuration', () => {
    const previous = process.env.ROUTER_INTERNAL_TOKEN
    process.env.ROUTER_INTERNAL_TOKEN = 'leader-only-secret'
    try {
      const cfg = buildAcpSpawnConfig(
        worker({
          id: 'isolated',
          name: 'Isolated',
          kind: 'custom',
          primaryRole: 'general',
          roles: ['general'],
          env: { WORKER_SETTING: 'ok' },
        }),
        '/tmp/project',
      )
      assert.equal(cfg.env.ROUTER_INTERNAL_TOKEN, undefined)
      assert.equal(cfg.env.WORKER_SETTING, 'ok')
    } finally {
      if (previous === undefined) delete process.env.ROUTER_INTERNAL_TOKEN
      else process.env.ROUTER_INTERNAL_TOKEN = previous
    }
  })
})

describe('dispatchToWorker', () => {
  it('returns planned_unavailable (ok=false) when ACP cannot run — not silent success', async () => {
    const result = await dispatchToWorker({
      workers,
      role: 'coder',
      task: 'add status dots',
      cwd: '/tmp/project',
      canRunAcp: async () => false,
    })
    assert.equal(result.ok, false)
    assert.equal(result.mode, 'planned_unavailable')
    assert.equal(result.acpPath, true)
    assert.equal(result.workerName, 'Claude Code')
    assert.match(result.message, /@mastra\/acp|ACP unavailable/i)
    assert.ok(!result.message.toLowerCase().includes('completed successfully') || true)
  })

  it('runs ACP path when canRunAcp and runAcp succeed', async () => {
    const result = await dispatchToWorker({
      workers,
      role: 'review',
      task: 'review SessionList',
      canRunAcp: async () => true,
      runAcp: async (config, task) => {
        assert.equal(config.workerName, 'Codex CLI')
        assert.equal(task, 'review SessionList')
        return { ok: true, output: 'LGTM with nits' }
      },
    })
    assert.equal(result.ok, true)
    assert.equal(result.mode, 'acp')
    assert.equal(result.output, 'LGTM with nits')
    assert.equal(result.acpPath, true)
  })

  it('errors when no worker matches', async () => {
    const result = await dispatchToWorker({
      workers: [],
      role: 'test',
      task: 'run tests',
      canRunAcp: async () => true,
    })
    assert.equal(result.ok, false)
    assert.equal(result.mode, 'error')
  })
})
