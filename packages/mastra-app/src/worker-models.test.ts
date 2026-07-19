import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { LocalStore } from '@swarmdesk-agent/core'
import { WorkerModelCatalogStore } from '@swarmdesk-agent/core'
import type { WorkerModelCatalog, WorkerRegistration } from '@swarmdesk-agent/shared'
import { WORKER_MODELS_TTL_MS } from '@swarmdesk-agent/shared'
import {
  getWorkerModels,
  resetWorkerModelsCacheControllerForTests,
  type ListModelsFn,
} from './worker-models.js'

const T0 = Date.parse('2026-06-01T12:00:00.000Z')

function baseWorker(overrides: Partial<WorkerRegistration> = {}): WorkerRegistration {
  return {
    id: 'w1',
    name: 'OpenCode',
    kind: 'opencode',
    command: 'opencode',
    args: ['acp'],
    primaryRole: 'coder',
    roles: ['coder', 'general'],
    capabilities: ['code-edit', 'general'],
    enabled: true,
    scope: 'global',
    description: 'test',
    health: 'healthy',
    cliHealth: 'healthy',
    acpSessionHealth: 'healthy',
    commandHealth: { status: 'healthy', checkedAt: new Date(T0).toISOString() },
    acpHealth: { status: 'ready', checkedAt: new Date(T0).toISOString() },
    ...overrides,
  }
}

function makeCatalog(
  workerId: string,
  fetchedAtMs: number,
  models = [{ modelId: 'opencode/big-pickle', name: 'big-pickle' }],
): WorkerModelCatalog {
  return {
    version: 1,
    workerId,
    source: 'acp_config_options',
    fetchedAt: new Date(fetchedAtMs).toISOString(),
    expiresAt: new Date(fetchedAtMs + WORKER_MODELS_TTL_MS).toISOString(),
    providers: [{ providerId: 'opencode', state: 'free' }],
    shortlist: models,
    searchIndex: models,
    lastSuccessfulFetchedAt: new Date(fetchedAtMs).toISOString(),
  }
}

describe('getWorkerModels SWR', () => {
  let dataDir: string
  let store: LocalStore
  let catalogStore: WorkerModelCatalogStore
  let listCalls: number

  beforeEach(() => {
    resetWorkerModelsCacheControllerForTests()
    dataDir = mkdtempSync(join(tmpdir(), 'wm-swr-'))
    store = new LocalStore(join(dataDir, 'state.json'))
    // Replace default workers with our fixture
    for (const w of store.listWorkers()) {
      store.upsertWorker({ ...w, enabled: false, id: `old-${w.id}` })
    }
    store.upsertWorker(baseWorker())
    catalogStore = new WorkerModelCatalogStore(dataDir)
    listCalls = 0
  })

  afterEach(() => {
    resetWorkerModelsCacheControllerForTests()
    try {
      rmSync(dataDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  function listModelsOk(
    models = [{ modelId: 'opencode/big-pickle', name: 'big-pickle' }],
  ): ListModelsFn {
    return async () => {
      listCalls += 1
      return {
        ok: true,
        models,
        shortlistModels: models,
        searchIndex: models,
        providers: { opencode: 'free' },
      }
    }
  }

  function listModelsFail(error = 'ACP down'): ListModelsFn {
    return async () => {
      listCalls += 1
      return { ok: false, models: [], error }
    }
  }

  function ports(listModels: ListModelsFn) {
    return { store, catalogStore, listModels }
  }

  it('returns fresh cache without refresh', async () => {
    const fetchedAt = T0
    catalogStore.put(makeCatalog('w1', fetchedAt))
    store.upsertWorker(
      baseWorker({
        availableModels: [{ modelId: 'opencode/big-pickle', name: 'big-pickle' }],
        modelsFetchedAt: new Date(fetchedAt).toISOString(),
        modelsState: 'fresh',
        modelCatalogState: 'fresh',
      }),
    )

    const result = await getWorkerModels({
      workerId: 'w1',
      now: fetchedAt + 1000,
      ...ports(listModelsOk()),
    })

    assert.equal(result.ok, true)
    assert.equal(result.stale, false)
    assert.equal(result.cached, true)
    assert.equal(result.catalogState, 'fresh')
    assert.equal(listCalls, 0)
    assert.equal(result.models?.[0]?.modelId, 'opencode/big-pickle')
  })

  it('returns stale cache immediately and triggers single background refresh', async () => {
    const fetchedAt = T0
    catalogStore.put(makeCatalog('w1', fetchedAt))
    store.upsertWorker(
      baseWorker({
        availableModels: [{ modelId: 'opencode/old', name: 'old' }],
        modelsFetchedAt: new Date(fetchedAt).toISOString(),
        modelsState: 'fresh',
        modelCatalogState: 'stale',
      }),
    )

    let resolveList!: (v: Awaited<ReturnType<ListModelsFn>>) => void
    const listModels: ListModelsFn = () => {
      listCalls += 1
      return new Promise((resolve) => {
        resolveList = resolve
      })
    }

    const result = await getWorkerModels({
      workerId: 'w1',
      now: fetchedAt + WORKER_MODELS_TTL_MS + 1,
      force: false,
      ...ports(listModels),
    })

    assert.equal(result.stale, true)
    assert.equal(result.cached, true)
    assert.equal(result.catalogState, 'stale')
    // Prefer catalog shortlist over divergent worker.availableModels row
    assert.equal(result.models?.[0]?.modelId, 'opencode/big-pickle')
    assert.equal(listCalls, 1)

    // Second concurrent SWR should not start another refresh (single-flight)
    const result2 = await getWorkerModels({
      workerId: 'w1',
      now: fetchedAt + WORKER_MODELS_TTL_MS + 2,
      force: false,
      ...ports(listModels),
    })
    assert.equal(result2.stale, true)
    assert.equal(listCalls, 1)

    resolveList({
      ok: true,
      models: [{ modelId: 'opencode/new', name: 'new' }],
      shortlistModels: [{ modelId: 'opencode/new', name: 'new' }],
      searchIndex: [{ modelId: 'opencode/new', name: 'new' }],
      providers: { opencode: 'free' },
    })
    // allow background to settle
    await new Promise((r) => setTimeout(r, 20))
    const updated = store.listWorkers().find((w) => w.id === 'w1')
    assert.equal(updated?.availableModels?.[0]?.modelId, 'opencode/new')
    assert.equal(updated?.modelCatalogState, 'fresh')
  })

  it('coalesces concurrent force refreshes into one in-flight', async () => {
    let resolveList!: (v: Awaited<ReturnType<ListModelsFn>>) => void
    const listModels: ListModelsFn = () => {
      listCalls += 1
      return new Promise((resolve) => {
        resolveList = resolve
      })
    }

    const p1 = getWorkerModels({
      workerId: 'w1',
      force: true,
      now: T0,
      ...ports(listModels),
    })
    const p2 = getWorkerModels({
      workerId: 'w1',
      force: true,
      now: T0,
      ...ports(listModels),
    })

    await new Promise((r) => setTimeout(r, 10))
    assert.equal(listCalls, 1)

    resolveList({
      ok: true,
      models: [{ modelId: 'opencode/a', name: 'a' }],
      shortlistModels: [{ modelId: 'opencode/a', name: 'a' }],
      searchIndex: [{ modelId: 'opencode/a', name: 'a' }],
      providers: { opencode: 'free' },
    })

    const [r1, r2] = await Promise.all([p1, p2])
    assert.equal(r1.ok, true)
    assert.equal(r2.ok, true)
    assert.equal(listCalls, 1)
    assert.equal(r1.models?.[0]?.modelId, 'opencode/a')
    assert.equal(r2.models?.[0]?.modelId, 'opencode/a')
  })

  it('backs off 30s / 2m / 10m on consecutive failures', async () => {
    // Seed last-known-good so failures keep cache
    catalogStore.put(makeCatalog('w1', T0))
    store.upsertWorker(
      baseWorker({
        availableModels: [{ modelId: 'opencode/cached', name: 'cached' }],
        modelsFetchedAt: new Date(T0).toISOString(),
        modelsState: 'stale',
        modelCatalogState: 'stale',
      }),
    )

    // First failure at T0+TTL+1
    let now = T0 + WORKER_MODELS_TTL_MS + 1
    await getWorkerModels({
      workerId: 'w1',
      force: true,
      now,
      ...ports(listModelsFail('fail-1')),
    })
    assert.equal(listCalls, 1)

    // Within 30s backoff: force still waits but SWR without force should not refresh
    now += 10_000
    listCalls = 0
    const blocked = await getWorkerModels({
      workerId: 'w1',
      force: false,
      now,
      ...ports(listModelsFail('fail-2')),
    })
    assert.equal(blocked.stale, true)
    assert.equal(listCalls, 0, 'should not refresh during 30s backoff')

    // After 30s: second failure allowed
    now += 25_000
    await getWorkerModels({
      workerId: 'w1',
      force: true,
      now,
      ...ports(listModelsFail('fail-2')),
    })
    assert.equal(listCalls, 1)

    // Within 2m second backoff
    now += 60_000
    listCalls = 0
    await getWorkerModels({
      workerId: 'w1',
      force: false,
      now,
      ...ports(listModelsFail('fail-3')),
    })
    assert.equal(listCalls, 0, 'should not refresh during 2m backoff')

    // After 2m: third failure
    now += 70_000
    await getWorkerModels({
      workerId: 'w1',
      force: true,
      now,
      ...ports(listModelsFail('fail-3')),
    })
    assert.equal(listCalls, 1)

    // Within 10m third backoff
    now += 5 * 60_000
    listCalls = 0
    await getWorkerModels({
      workerId: 'w1',
      force: false,
      now,
      ...ports(listModelsFail('fail-4')),
    })
    assert.equal(listCalls, 0, 'should not refresh during 10m backoff')

    // Success resets backoff
    now += 6 * 60_000
    listCalls = 0
    await getWorkerModels({
      workerId: 'w1',
      force: true,
      now,
      ...ports(listModelsOk([{ modelId: 'opencode/recovered', name: 'recovered' }])),
    })
    assert.equal(listCalls, 1)

    // Immediate next SWR after success should refresh if stale... after success it's fresh
    listCalls = 0
    const fresh = await getWorkerModels({
      workerId: 'w1',
      force: false,
      now: now + 1000,
      ...ports(listModelsOk()),
    })
    assert.equal(fresh.catalogState, 'fresh')
    assert.equal(listCalls, 0)
  })

  it('treats legacy availableModels without catalog as legacy stale', async () => {
    store.upsertWorker(
      baseWorker({
        availableModels: [{ modelId: 'legacy/model', name: 'legacy' }],
        modelsFetchedAt: new Date(T0).toISOString(),
        modelsState: 'fresh',
      }),
    )
    // no catalogStore.put

    let resolveList!: (v: Awaited<ReturnType<ListModelsFn>>) => void
    const listModels: ListModelsFn = () => {
      listCalls += 1
      return new Promise((resolve) => {
        resolveList = resolve
      })
    }

    const result = await getWorkerModels({
      workerId: 'w1',
      now: T0 + 1000,
      force: false,
      ...ports(listModels),
    })

    assert.equal(result.stale, true)
    assert.equal(result.catalogState, 'stale')
    assert.equal(result.models?.[0]?.modelId, 'legacy/model')
    assert.equal(listCalls, 1)

    resolveList({
      ok: true,
      models: [{ modelId: 'opencode/v1', name: 'v1' }],
      shortlistModels: [{ modelId: 'opencode/v1', name: 'v1' }],
      searchIndex: [{ modelId: 'opencode/v1', name: 'v1' }],
      providers: { opencode: 'free' },
    })
    await new Promise((r) => setTimeout(r, 20))
    assert.ok(catalogStore.get('w1'))
  })

  it('empty catalog respects backoff and does not refresh', async () => {
    // no catalog, no availableModels → empty
    let now = T0
    const fail1 = await getWorkerModels({
      workerId: 'w1',
      force: true,
      now,
      ...ports(listModelsFail('empty-fail-1')),
    })
    assert.equal(fail1.ok, false)
    assert.equal(fail1.catalogState, 'empty')
    assert.equal(listCalls, 1)

    // Within 30s backoff: empty + non-force must NOT start a new refresh
    now += 10_000
    listCalls = 0
    const blocked = await getWorkerModels({
      workerId: 'w1',
      force: false,
      now,
      ...ports(listModelsFail('empty-fail-2')),
    })
    assert.equal(listCalls, 0, 'should not refresh empty during backoff')
    assert.equal(blocked.ok, false)
    assert.deepEqual(blocked.models, [])
    assert.equal(blocked.catalogState, 'empty')
    assert.equal(blocked.stale, true)
    assert.match(blocked.error ?? '', /empty-fail-1/)
  })

  it('empty catalog search reports backoff instead of a false successful empty result', async () => {
    await getWorkerModels({
      workerId: 'w1',
      force: true,
      now: T0,
      ...ports(listModelsFail('search-refresh-failed')),
    })
    listCalls = 0

    const result = await getWorkerModels({
      workerId: 'w1',
      q: 'gpt',
      now: T0 + 10_000,
      ...ports(listModelsFail('must-not-run')),
    })

    assert.equal(listCalls, 0)
    assert.equal(result.ok, false)
    assert.equal(result.catalogState, 'empty')
    assert.equal(result.errorCode, 'ACP_MODELS')
    assert.deepEqual(result.models, [])
  })

  it('force search waits for refresh and searches the new catalog', async () => {
    const result = await getWorkerModels({
      workerId: 'w1',
      q: 'target',
      force: true,
      now: T0,
      ...ports(
        listModelsOk([
          { modelId: 'opencode/other', name: 'other' },
          { modelId: 'opencode/target-model', name: 'Target Model' },
        ]),
      ),
    })

    assert.equal(listCalls, 1)
    assert.equal(result.ok, true)
    assert.equal(result.cached, false)
    assert.deepEqual(
      result.models?.map((model) => model.modelId),
      ['opencode/target-model'],
    )
  })

  it('never clears pin when provider becomes unavailable; pin stays out of shortlist', async () => {
    catalogStore.put(
      makeCatalog('w1', T0, [
        { modelId: 'openai/gpt-4o', name: 'gpt-4o' },
        { modelId: 'opencode/big-pickle', name: 'big-pickle' },
      ]),
    )
    store.upsertWorker(
      baseWorker({
        model: 'openai/gpt-4o',
        availableModels: [
          { modelId: 'openai/gpt-4o', name: 'gpt-4o' },
          { modelId: 'opencode/big-pickle', name: 'big-pickle' },
        ],
        modelsFetchedAt: new Date(T0).toISOString(),
        modelsState: 'stale',
        modelCatalogState: 'stale',
      }),
    )

    const result = await getWorkerModels({
      workerId: 'w1',
      force: true,
      now: T0 + WORKER_MODELS_TTL_MS + 1,
      ...ports(async () => {
        listCalls += 1
        return {
          ok: true,
          models: [
            { modelId: 'opencode/big-pickle', name: 'big-pickle' },
            { modelId: 'openai/gpt-4o', name: 'gpt-4o' },
          ],
          shortlistModels: [{ modelId: 'opencode/big-pickle', name: 'big-pickle' }],
          searchIndex: [
            { modelId: 'opencode/big-pickle', name: 'big-pickle' },
            { modelId: 'openai/gpt-4o', name: 'gpt-4o' },
          ],
          providers: {
            opencode: 'free',
            openai: 'disabled',
          },
        }
      }),
    })

    assert.equal(result.ok, true)
    const updated = store.listWorkers().find((w) => w.id === 'w1')
    assert.equal(updated?.model, 'openai/gpt-4o', 'pin must be preserved')
    assert.ok(
      !updated?.availableModels?.some((m) => m.modelId === 'openai/gpt-4o'),
      'disabled pin must NOT pollute availableModels shortlist',
    )
    const catalog = catalogStore.get('w1')
    assert.ok(
      !catalog?.shortlist?.some((m) => m.modelId === 'openai/gpt-4o'),
      'disabled pin must NOT pollute catalog shortlist',
    )
    assert.equal(result.currentPinState?.modelId, 'openai/gpt-4o')
    assert.equal(result.currentPinState?.status, 'unavailable')
  })

  it('keeps empty shortlist when eligibility returns [] and candidates are non-empty', async () => {
    store.upsertWorker(baseWorker({ model: 'openai/gpt-4o' }))
    const result = await getWorkerModels({
      workerId: 'w1',
      force: true,
      now: T0,
      ...ports(async () => {
        listCalls += 1
        return {
          ok: true,
          models: [
            { modelId: 'openai/gpt-4o', name: 'gpt-4o' },
            { modelId: 'openrouter/x', name: 'x' },
          ],
          shortlistModels: [],
          searchIndex: [{ modelId: 'openrouter/x', name: 'x' }],
          providers: { openai: 'unknown', openrouter: 'authenticated' },
        }
      }),
    })
    assert.equal(result.ok, true)
    assert.equal(result.models?.length ?? 0, 0)
    assert.equal(catalogStore.get('w1')?.shortlist.length, 0)
    assert.ok((catalogStore.get('w1')?.searchIndex.length ?? 0) > 0)
    // Must NOT fall back to full result.models catalog dump
    const ids = (result.models ?? []).map((m) => m.modelId)
    assert.ok(!ids.includes('openai/gpt-4o'))
  })
})
