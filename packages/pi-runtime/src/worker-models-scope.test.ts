import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { LocalStore, WorkerModelCatalogStore } from '@pihuo-agent/core'
import {
  evaluateWorkerModelPin,
  getWorkerCatalogForDispatch,
  getWorkerModels,
  resetWorkerModelsCacheControllerForTests,
  resolveModelCatalogScopeKey,
} from './worker-models.js'
import type { ListModelsFn } from './worker-models.js'

describe('project-scoped model catalogs', () => {
  let dir: string
  let store: LocalStore
  let catalogStore: WorkerModelCatalogStore
  let cwdA: string
  let cwdB: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'model-scope-'))
    cwdA = join(dir, 'proj-a')
    cwdB = join(dir, 'proj-b')
    mkdirSync(cwdA)
    mkdirSync(cwdB)
    store = new LocalStore(join(dir, 'state.json'))
    catalogStore = new WorkerModelCatalogStore(dir)
    resetWorkerModelsCacheControllerForTests()
    store.upsertWorker({
      id: 'w1',
      name: 'W',
      kind: 'opencode',
      command: 'echo',
      args: [],
      env: {},
      primaryRole: 'coder',
      roles: ['coder'],
      capabilities: [],
      enabled: true,
      scope: 'global',
      description: 't',
    } as never)
  })

  afterEach(() => {
    resetWorkerModelsCacheControllerForTests()
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* ok */
    }
  })

  it('scope keys differ for different project roots', () => {
    assert.notEqual(resolveModelCatalogScopeKey(cwdA), resolveModelCatalogScopeKey(cwdB))
    assert.equal(resolveModelCatalogScopeKey(undefined), '')
  })

  it('project A and B catalogs do not cross-contaminate', async () => {
    let lastCwd: string | undefined
    const listModels: ListModelsFn = async (_w, opts) => {
      lastCwd = opts?.cwd
      const tag = opts?.cwd?.includes('proj-a') ? 'A' : 'B'
      return {
        ok: true,
        models: [{ modelId: `${tag}/model`, name: `${tag} model` }],
        shortlistModels: [{ modelId: `${tag}/model`, name: `${tag} model` }],
        searchIndex: [{ modelId: `${tag}/model`, name: `${tag} model` }],
        providers: {},
      }
    }

    const a = await getWorkerModels({
      workerId: 'w1',
      cwd: cwdA,
      force: true,
      store,
      catalogStore,
      listModels,
    })
    assert.equal(lastCwd, cwdA)
    assert.equal(a.models?.[0]?.modelId, 'A/model')

    const b = await getWorkerModels({
      workerId: 'w1',
      cwd: cwdB,
      force: true,
      store,
      catalogStore,
      listModels,
    })
    assert.equal(b.models?.[0]?.modelId, 'B/model')

    // Re-read A from cache — still A, not B
    const a2 = await getWorkerModels({
      workerId: 'w1',
      cwd: cwdA,
      force: false,
      store,
      catalogStore,
      listModels,
    })
    assert.equal(a2.models?.[0]?.modelId, 'A/model')
    assert.equal(a2.cached, true)

    // Worker row must not hold project-scoped shortlist as global availableModels
    const worker = store.listWorkers().find((w) => w.id === 'w1')!
    const globalModels = worker.availableModels ?? []
    assert.equal(
      globalModels.some((m) => m.modelId === 'A/model' || m.modelId === 'B/model'),
      false,
      'scoped refresh must not write project models onto global worker.availableModels',
    )
  })

  it('uses the same project scope for list, pin validation, and dispatch', async () => {
    const listModels: ListModelsFn = async (_worker, opts) => {
      const tag = opts?.cwd?.includes('proj-a') ? 'A' : 'B'
      return {
        ok: true,
        models: [{ modelId: `${tag}/model`, name: `${tag} model` }],
        shortlistModels: [{ modelId: `${tag}/model`, name: `${tag} model` }],
        searchIndex: [{ modelId: `${tag}/model`, name: `${tag} model` }],
        providers: { A: 'authenticated', B: 'authenticated' },
      }
    }

    await getWorkerModels({
      workerId: 'w1',
      cwd: cwdA,
      force: true,
      store,
      catalogStore,
      listModels,
    })
    await getWorkerModels({
      workerId: 'w1',
      cwd: cwdB,
      force: true,
      store,
      catalogStore,
      listModels,
    })

    assert.equal(
      evaluateWorkerModelPin('w1', 'A/model', { cwd: cwdA, store, catalogStore }).ok,
      true,
    )
    assert.equal(
      evaluateWorkerModelPin('w1', 'A/model', { cwd: cwdB, store, catalogStore }).ok,
      false,
    )
    assert.equal(
      getWorkerCatalogForDispatch('w1', cwdA, catalogStore)?.shortlist[0]?.modelId,
      'A/model',
    )
    assert.equal(
      getWorkerCatalogForDispatch('w1', cwdB, catalogStore)?.shortlist[0]?.modelId,
      'B/model',
    )
  })

  it('reasoning-only empty scoped shell does not block pin against global catalog', () => {
    const fetchedAt = new Date().toISOString()
    const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString()
    // Global last-known-good models (from unscoped refresh)
    catalogStore.put({
      version: 2,
      workerId: 'w1',
      source: 'acp_config_options',
      fetchedAt,
      expiresAt,
      providers: [{ providerId: 'sonnet', state: 'authenticated' }],
      shortlist: [{ modelId: 'sonnet', name: 'Sonnet', group: 'shortlist' }],
      searchIndex: [{ modelId: 'sonnet', name: 'Sonnet', group: 'shortlist' }],
      rawCandidateIds: ['sonnet'],
    })
    // Poisoned shell written by reasoning cache (empty model lists under project scope)
    catalogStore.put({
      version: 2,
      workerId: 'w1',
      scopeKey: resolveModelCatalogScopeKey(cwdA),
      projectRoot: cwdA,
      source: 'acp_config_options',
      fetchedAt,
      expiresAt,
      providers: [],
      shortlist: [],
      searchIndex: [],
      reasoning: {
        __default__: {
          supported: true,
          fetchedAt,
          expiresAt,
          lastSuccessfulFetchedAt: fetchedAt,
        },
      },
    })

    assert.equal(
      evaluateWorkerModelPin('w1', 'sonnet', { cwd: cwdA, store, catalogStore }).ok,
      true,
      'empty scoped shell must fall back to global catalog for pin',
    )
    assert.equal(
      evaluateWorkerModelPin('w1', 'missing/model', { cwd: cwdA, store, catalogStore }).ok,
      false,
    )
  })
})
