import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resolveBuiltinProviders, MASTRA_PROVIDERS } from './models-catalog.js'
import type { ModelsDevCatalogPaths } from './models-dev-catalog.js'
import type { ModelsDevProviderRaw } from './models-dev-catalog.js'

/**
 * Faithful subset of the current models.dev api.json (npm @opencode-ai/models
 * snapshot) for openai's curated models — matches the bundled snapshot output.
 */
const OPENAI_FIXTURE: ModelsDevProviderRaw = {
  env: ['OPENAI_API_KEY'],
  npm: '@ai-sdk/openai',
  name: 'OpenAI',
  doc: 'https://platform.openai.com/docs/models',
  models: {
    'gpt-5.6': {
      id: 'gpt-5.6',
      name: 'GPT-5.6',
      reasoning: true,
      reasoning_options: [{ type: 'effort', values: ['none', 'low', 'medium', 'high', 'xhigh', 'max'] }],
      limit: { context: 1050000 },
      tool_call: true,
      modalities: { input: ['text', 'image', 'pdf'], output: ['text'] },
    },
    'gpt-5.5': {
      id: 'gpt-5.5',
      name: 'GPT-5.5',
      reasoning: true,
      reasoning_options: [{ type: 'effort', values: ['none', 'low', 'medium', 'high', 'xhigh'] }],
      limit: { context: 1050000 },
      tool_call: true,
      modalities: { input: ['text', 'image', 'pdf'], output: ['text'] },
    },
    'gpt-5.5-pro': {
      id: 'gpt-5.5-pro',
      name: 'GPT-5.5 Pro',
      reasoning: true,
      reasoning_options: [{ type: 'effort', values: ['medium', 'high', 'xhigh'] }],
      limit: { context: 1050000 },
      tool_call: true,
      modalities: { input: ['text', 'image', 'pdf'], output: ['text'] },
    },
    'gpt-5.4': {
      id: 'gpt-5.4',
      name: 'GPT-5.4',
      reasoning: true,
      reasoning_options: [{ type: 'effort', values: ['none', 'low', 'medium', 'high', 'xhigh'] }],
      limit: { context: 1050000 },
      tool_call: true,
      modalities: { input: ['text', 'image', 'pdf'], output: ['text'] },
    },
    'gpt-5.4-pro': {
      id: 'gpt-5.4-pro',
      name: 'GPT-5.4 Pro',
      reasoning: true,
      reasoning_options: [{ type: 'effort', values: ['medium', 'high', 'xhigh'] }],
      limit: { context: 1050000 },
      tool_call: true,
      modalities: { input: ['text', 'image'], output: ['text'] },
    },
    'gpt-5.4-mini': {
      id: 'gpt-5.4-mini',
      name: 'GPT-5.4 mini',
      reasoning: true,
      reasoning_options: [{ type: 'effort', values: ['none', 'low', 'medium', 'high', 'xhigh'] }],
      limit: { context: 400000 },
      tool_call: true,
      modalities: { input: ['text', 'image'], output: ['text'] },
    },
    'gpt-5.3-codex': {
      id: 'gpt-5.3-codex',
      name: 'GPT-5.3 Codex',
      reasoning: true,
      reasoning_options: [{ type: 'effort', values: ['none', 'low', 'medium', 'high', 'xhigh'] }],
      limit: { context: 400000 },
      tool_call: true,
      modalities: { input: ['text', 'image', 'pdf'], output: ['text'] },
    },
    'gpt-5.2': {
      id: 'gpt-5.2',
      name: 'GPT-5.2',
      reasoning: true,
      reasoning_options: [{ type: 'effort', values: ['none', 'low', 'medium', 'high', 'xhigh'] }],
      limit: { context: 400000 },
      tool_call: true,
      modalities: { input: ['text', 'image'], output: ['text'] },
    },
  },
}

const FRESH_FETCHED_AT = '2026-08-08T06:40:49.006Z'

function writeModelsDevDir(
  dir: string,
  registry: Record<string, ModelsDevProviderRaw>,
  meta: { fetchedAt: string; generatedAt?: string },
): ModelsDevCatalogPaths {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'api.json'), JSON.stringify(registry), 'utf8')
  writeFileSync(
    join(dir, 'meta.json'),
    JSON.stringify({
      fetchedAt: meta.fetchedAt,
      sourceUrl: 'https://models.dev/api.json',
      providerCount: Object.keys(registry).length,
      bytes: 0,
      ...(meta.generatedAt ? { generatedAt: meta.generatedAt } : {}),
    }),
    'utf8',
  )
  return { dir, apiJsonPath: join(dir, 'api.json'), metaPath: join(dir, 'meta.json'), logoCacheDir: join(dir, 'logos') }
}

describe('resolveBuiltinProviders', () => {
  let dir: string
  let paths: ModelsDevCatalogPaths

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'resolve-builtin-'))
    paths = writeModelsDevDir(dir, { openai: OPENAI_FIXTURE }, { fetchedAt: FRESH_FETCHED_AT })
  })

  afterEach(() => {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  it('external catalog newer than bundled → external wins', () => {
    const res = resolveBuiltinProviders({ paths })
    assert.equal(res.source, 'external')
    assert.equal(res.generatedAt, FRESH_FETCHED_AT)
    const openai = res.providers.find((p) => p.id === 'openai')
    assert.ok(openai, 'openai should be curated')
    assert.equal(openai.models[0]?.id, 'openai/gpt-5.6')
    assert.equal(openai.models.length, 8)
    // Same source data as bundled snapshot must yield identical curated list.
    assert.deepEqual(openai, MASTRA_PROVIDERS.find((p) => p.id === 'openai'))
  })

  it('newer model in the external catalog is picked up at runtime', () => {
    const registry: Record<string, ModelsDevProviderRaw> = {
      openai: {
        ...OPENAI_FIXTURE,
        models: {
          ...OPENAI_FIXTURE.models,
          'gpt-5.9': {
            id: 'gpt-5.9',
            name: 'GPT-5.9',
            reasoning: true,
            reasoning_options: [{ type: 'effort', values: ['low', 'medium', 'high'] }],
            limit: { context: 1000000 },
            tool_call: true,
          },
        },
      },
    }
    paths = writeModelsDevDir(dir, registry, { fetchedAt: FRESH_FETCHED_AT })
    const res = resolveBuiltinProviders({ paths })
    assert.equal(res.source, 'external')
    const openai = res.providers.find((p) => p.id === 'openai')
    assert.ok(openai, 'openai should be curated from the external catalog')
    assert.equal(openai.models[0]?.id, 'openai/gpt-5.9', 'newest external model must lead')
    assert.ok(
      !MASTRA_PROVIDERS.find((p) => p.id === 'openai')!.models.some((m) => m.id === 'openai/gpt-5.9'),
      'gpt-5.9 must not exist in the bundled snapshot',
    )
  })

  it('external catalog older than bundled → bundled wins', () => {
    paths = writeModelsDevDir(dir, { openai: OPENAI_FIXTURE }, { fetchedAt: '2020-01-01T00:00:00.000Z' })
    const res = resolveBuiltinProviders({ paths })
    assert.equal(res.source, 'bundled')
    assert.deepEqual(res.providers, MASTRA_PROVIDERS)
  })

  it('missing external catalog → bundled fallback', () => {
    rmSync(paths.apiJsonPath, { force: true })
    rmSync(paths.metaPath, { force: true })
    const res = resolveBuiltinProviders({ paths })
    assert.equal(res.source, 'bundled')
    assert.deepEqual(res.providers, MASTRA_PROVIDERS)
  })

  it('invalid external catalog → silent bundled fallback (never throws)', () => {
    writeFileSync(paths.apiJsonPath, '{not valid json', 'utf8')
    const res = resolveBuiltinProviders({ paths })
    assert.equal(res.source, 'bundled')
    assert.deepEqual(res.providers, MASTRA_PROVIDERS)
  })

  it('npm snapshot generatedAt (not fetchedAt) drives freshness', () => {
    // fetchedAt is old but the snapshot was generated recently → external wins
    paths = writeModelsDevDir(
      dir,
      { openai: OPENAI_FIXTURE },
      { fetchedAt: '2020-01-01T00:00:00.000Z', generatedAt: '2026-08-07T00:00:00.000Z' },
    )
    const res = resolveBuiltinProviders({ paths })
    assert.equal(res.source, 'external')
    assert.equal(res.generatedAt, '2026-08-07T00:00:00.000Z')
  })

  it('fallback constant is structurally compatible with MASTRA_PROVIDERS', () => {
    // When the bundled snapshot is empty the resolver must still return providers.
    const res = resolveBuiltinProviders({ paths })
    for (const p of res.providers) {
      assert.equal(typeof p.id, 'string')
      assert.equal(typeof p.name, 'string')
      assert.equal(typeof p.apiKeyEnv, 'string')
      assert.equal(typeof p.docsUrl, 'string')
      assert.ok(Array.isArray(p.models))
    }
  })
})

describe('resolveBuiltinProviders bundled snapshot', () => {
  it('bundled catalog is the same source used by MASTRA_PROVIDERS', () => {
    // Sanity: the resolver's bundled branch is byte-identical to the exported constant.
    const dir = mkdtempSync(join(tmpdir(), 'resolve-builtin-empty-'))
    try {
      const emptyPaths: ModelsDevCatalogPaths = {
        dir,
        apiJsonPath: join(dir, 'api.json'),
        metaPath: join(dir, 'meta.json'),
        logoCacheDir: join(dir, 'logos'),
      }
      const res = resolveBuiltinProviders({ paths: emptyPaths })
      assert.equal(res.source, 'bundled')
      assert.deepEqual(res.providers, MASTRA_PROVIDERS)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('bundled generatedAt is a real timestamp used for freshness comparisons', () => {
    const dir = mkdtempSync(join(tmpdir(), 'resolve-builtin-ts-'))
    try {
      const emptyPaths: ModelsDevCatalogPaths = {
        dir,
        apiJsonPath: join(dir, 'api.json'),
        metaPath: join(dir, 'meta.json'),
        logoCacheDir: join(dir, 'logos'),
      }
      const res = resolveBuiltinProviders({ paths: emptyPaths })
      assert.ok(!Number.isNaN(Date.parse(res.generatedAt)), `generatedAt=${res.generatedAt}`)
      // Bundled snapshot must predate any legitimately fresh external refresh.
      assert.ok(Date.parse(res.generatedAt) < Date.parse(FRESH_FETCHED_AT))
      assert.equal(res.source, 'bundled')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
