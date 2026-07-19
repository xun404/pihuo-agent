import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { WorkerModelCatalogStore, workerModelCatalogsPath } from './worker-model-catalog-store.js'
import type { WorkerModelCatalog } from '@swarmdesk-agent/shared'

function makeCatalog(workerId: string, modelId: string): WorkerModelCatalog {
  const fetchedAt = new Date().toISOString()
  return {
    version: 1,
    workerId,
    source: 'acp_config_options',
    fetchedAt,
    expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    providers: [{ providerId: 'opencode', state: 'free' }],
    shortlist: [{ modelId, name: modelId }],
    searchIndex: [{ modelId, name: modelId }],
    lastSuccessfulFetchedAt: fetchedAt,
  }
}

describe('WorkerModelCatalogStore', () => {
  let dataDir: string
  let store: WorkerModelCatalogStore

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'wmc-'))
    store = new WorkerModelCatalogStore(dataDir)
  })

  afterEach(() => {
    try {
      rmSync(dataDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  it('returns undefined for missing worker', () => {
    assert.equal(store.get('missing'), undefined)
  })

  it('writes and reads a catalog by workerId', () => {
    const cat = makeCatalog('w1', 'opencode/big-pickle')
    store.put(cat)
    const loaded = store.get('w1')
    assert.ok(loaded)
    assert.equal(loaded.workerId, 'w1')
    assert.equal(loaded.shortlist[0]?.modelId, 'opencode/big-pickle')
    assert.equal(loaded.version, 1)
  })

  it('updates one worker without dropping another', () => {
    store.put(makeCatalog('w1', 'opencode/a'))
    store.put(makeCatalog('w2', 'opencode/b'))
    store.put(makeCatalog('w1', 'opencode/a2'))
    assert.equal(store.get('w1')?.shortlist[0]?.modelId, 'opencode/a2')
    assert.equal(store.get('w2')?.shortlist[0]?.modelId, 'opencode/b')
  })

  it('persists to worker-model-catalogs.json atomically', () => {
    store.put(makeCatalog('w1', 'opencode/big-pickle'))
    const path = workerModelCatalogsPath(dataDir)
    assert.ok(existsSync(path))
    const raw = JSON.parse(readFileSync(path, 'utf8')) as {
      version: number
      catalogs: Record<string, WorkerModelCatalog>
    }
    assert.equal(raw.version, 1)
    assert.equal(raw.catalogs.w1?.shortlist[0]?.modelId, 'opencode/big-pickle')
  })

  it('filters searchIndex by query', () => {
    store.put({
      ...makeCatalog('w1', 'opencode/big-pickle'),
      searchIndex: [
        { modelId: 'opencode/big-pickle', name: 'Big Pickle' },
        { modelId: 'openai/gpt-4o', name: 'GPT-4o' },
        { modelId: 'openrouter/meta/llama', name: 'Llama' },
      ],
    })
    const hits = store.search('w1', 'gpt', 10)
    assert.equal(hits.length, 1)
    assert.equal(hits[0]?.modelId, 'openai/gpt-4o')
  })

  it('rejects catalog entries whose worker or scope identity disagrees with the storage key', () => {
    const path = workerModelCatalogsPath(dataDir)
    const wrongWorker = makeCatalog('worker-b', 'opencode/a')
    const wrongScope = {
      ...makeCatalog('worker-a', 'opencode/b'),
      version: 2 as const,
      scopeKey: 'scope-b',
    }
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        catalogs: {
          'worker-a': wrongWorker,
          'worker-a::scope-a': wrongScope,
        },
      }),
    )

    assert.equal(store.get('worker-a'), undefined)
    assert.equal(store.get('worker-a', 'scope-a'), undefined)
  })

  it('fails closed instead of dropping a corrupt sibling entry during an update', () => {
    const path = workerModelCatalogsPath(dataDir)
    const valid = makeCatalog('worker-a', 'opencode/a')
    const corruptSibling = makeCatalog('wrong-worker', 'opencode/b')
    const original = JSON.stringify({
      version: 1,
      catalogs: {
        'worker-a': valid,
        'worker-b': corruptSibling,
      },
    })
    writeFileSync(path, original)

    assert.throws(() => store.put(makeCatalog('worker-c', 'opencode/c')), /CATALOG_CORRUPT/)
    assert.equal(readFileSync(path, 'utf8'), original)
  })

  it('delete also fails closed after isolating a corrupt whole-file catalog', () => {
    const path = workerModelCatalogsPath(dataDir)
    writeFileSync(path, '{broken')

    assert.throws(() => store.deleteWorker('worker-a'), /CATALOG_CORRUPT/)
    assert.throws(() => store.put(makeCatalog('worker-a', 'opencode/a')), /CATALOG_CORRUPT/)
  })
})
