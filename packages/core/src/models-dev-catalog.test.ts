import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import {
  buildCustomProviderFromModelsDev,
  deriveTransportFromModelsDev,
  ensureProviderLogoCached,
  listModelsDevProviders,
  loadModelsDevRegistry,
  mapModelsDevModel,
  modelsDevCatalogPaths,
  modelsDevLogoCandidateUrls,
  readCachedProviderLogo,
  refreshModelsDevCatalog,
  type ModelsDevProviderRaw,
} from './models-dev-catalog.js'

const FIXTURE: Record<string, ModelsDevProviderRaw> = {
  openai: {
    name: 'OpenAI',
    npm: '@ai-sdk/openai',
    api_key: 'OPENAI_API_KEY',
    doc_url: 'https://platform.openai.com/docs',
    models: {
      'gpt-test': {
        name: 'GPT Test',
        limit: { context: 128000 },
        tool_call: true,
        reasoning: true,
        reasoning_options: [{ values: ['low', 'high'] }],
        modalities: { input: ['text', 'image'], output: ['text'] },
      },
    },
  },
  deepseek: {
    name: 'DeepSeek',
    npm: '@ai-sdk/openai-compatible',
    api: 'https://api.deepseek.com',
    env: ['DEEPSEEK_API_KEY'],
    models: {
      chat: {
        name: 'DeepSeek Chat',
        limit: { context: 64000 },
        tool_call: true,
      },
    },
  },
  'cool-gateway': {
    name: 'Cool Gateway',
    npm: '@ai-sdk/openai-compatible',
    api: 'https://cool.example/v1',
    api_key: 'COOL_API_KEY',
    models: {
      'm-1': { name: 'Model One', limit: { context: 32000 } },
      'm-2': { name: 'Model Two' },
    },
  },
}

function writeFixtureRoot(): ReturnType<typeof modelsDevCatalogPaths> {
  const root = mkdtempSync(join(tmpdir(), 'sd-models-dev-'))
  const cache = join(root, 'cache')
  mkdirSync(cache, { recursive: true })
  const paths = modelsDevCatalogPaths(root, cache)
  mkdirSync(paths.dir, { recursive: true })
  writeFileSync(paths.apiJsonPath, JSON.stringify(FIXTURE), 'utf8')
  writeFileSync(
    paths.metaPath,
    JSON.stringify({
      fetchedAt: '2026-08-04T00:00:00.000Z',
      sourceUrl: 'fixture',
      providerCount: 3,
      bytes: 100,
    }),
    'utf8',
  )
  return paths
}

describe('models-dev-catalog', () => {
  it('deriveTransportFromModelsDev flags openai-compatible as needing baseURL', () => {
    const t = deriveTransportFromModelsDev({
      npm: '@ai-sdk/openai-compatible',
      api: 'https://api.example.com',
    })
    assert.equal(t.apiStyle, 'openai')
    assert.equal(t.needsBaseURL, true)
  })

  it('deriveTransportFromModelsDev maps anthropic npm', () => {
    const t = deriveTransportFromModelsDev({ npm: '@ai-sdk/anthropic' })
    assert.equal(t.apiStyle, 'anthropic')
    assert.equal(t.needsBaseURL, false)
  })

  it('mapModelsDevModel maps thinking and multimodal', () => {
    const models = FIXTURE.openai!.models
    assert.ok(models && !Array.isArray(models))
    const m = mapModelsDevModel('openai', 'gpt-test', models['gpt-test']!)
    assert.equal(m.id, 'openai/gpt-test')
    assert.equal(m.contextWindow, 128000)
    assert.equal(m.toolCall, true)
    assert.equal(m.multimodal, true)
    assert.ok(m.thinkingIntensities?.includes('off'))
    assert.ok(m.thinkingIntensities?.includes('high'))
  })

  it('listModelsDevProviders marks owned ids as alreadyAdded and filters query', () => {
    const paths = writeFixtureRoot()
    const all = listModelsDevProviders({ paths, ownedIds: ['openai'] })
    assert.equal(all.providers.length, 3)
    const openai = all.providers.find((p) => p.id === 'openai')
    assert.ok(openai)
    assert.equal(openai!.alreadyAdded, true)
    const deepseek = all.providers.find((p) => p.id === 'deepseek')
    assert.ok(deepseek)
    assert.equal(Boolean(deepseek!.alreadyAdded), false)
    // Available rows sort before already-added
    const firstOwned = all.providers.findIndex((p) => p.alreadyAdded)
    const lastFree = (() => {
      let i = -1
      all.providers.forEach((p, idx) => {
        if (!p.alreadyAdded) i = idx
      })
      return i
    })()
    assert.ok(lastFree < firstOwned)

    const q = listModelsDevProviders({ paths, q: 'cool' })
    assert.equal(q.providers.length, 1)
    assert.equal(q.providers[0]!.id, 'cool-gateway')
    assert.equal(q.providers[0]!.modelCount, 2)
    assert.equal(q.providers[0]!.needsBaseURL, true)
  })

  it('buildCustomProviderFromModelsDev imports full model list with baseURL', () => {
    const paths = writeFixtureRoot()
    const result = buildCustomProviderFromModelsDev({
      providerId: 'cool-gateway',
      paths,
      builtinIds: ['openai', 'anthropic'],
      existingCustomIds: [],
    })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.provider.source, 'models.dev')
    assert.equal(result.provider.baseURL, 'https://cool.example/v1')
    assert.equal(result.provider.apiKeyEnv, 'COOL_API_KEY')
    assert.equal(result.provider.models.length, 2)
    assert.equal(result.provider.npm, '@ai-sdk/openai-compatible')
    assert.ok(result.provider.modelsDevSyncedAt)
  })

  it('buildCustomProviderFromModelsDev rejects builtin and duplicate', () => {
    const paths = writeFixtureRoot()
    const builtin = buildCustomProviderFromModelsDev({
      providerId: 'openai',
      paths,
      builtinIds: ['openai'],
    })
    assert.equal(builtin.ok, false)
    if (builtin.ok) return
    assert.equal(builtin.code, 'BUILTIN_CONFLICT')

    const dup = buildCustomProviderFromModelsDev({
      providerId: 'deepseek',
      paths,
      builtinIds: ['openai'],
      existingCustomIds: ['deepseek'],
    })
    assert.equal(dup.ok, false)
    if (dup.ok) return
    assert.equal(dup.code, 'ALREADY_ADDED')
  })

  it('refreshModelsDevCatalog writes LKG from local file URL override', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sd-md-refresh-'))
    const cache = join(root, 'cache')
    const paths = modelsDevCatalogPaths(root, cache)
    const fixtureFile = join(root, 'source.json')
    writeFileSync(fixtureFile, JSON.stringify(FIXTURE), 'utf8')

    const result = await refreshModelsDevCatalog({ url: fixtureFile, paths })
    assert.equal(result.providerCount, 3)
    assert.ok(existsSync(paths.apiJsonPath))
    assert.ok(existsSync(paths.metaPath))
    const reg = loadModelsDevRegistry(paths)
    assert.ok(reg?.['cool-gateway'])
    const meta = JSON.parse(readFileSync(paths.metaPath, 'utf8')) as { sourceUrl: string }
    assert.equal(meta.sourceUrl, fixtureFile)
  })

  it('modelsDevLogoCandidateUrls prefers models.dev then GitHub then jsDelivr', () => {
    const urls = modelsDevLogoCandidateUrls('openrouter')
    assert.equal(urls.length, 3)
    assert.equal(urls[0], 'https://models.dev/logos/openrouter.svg')
    assert.match(urls[1]!, /raw\.githubusercontent\.com\/anomalyco\/models\.dev/)
    assert.match(urls[2]!, /cdn\.jsdelivr\.net\/gh\/anomalyco\/models\.dev/)
  })

  it('ensureProviderLogoCached falls back to the next candidate after models.dev fails', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sd-md-logo-'))
    const paths = modelsDevCatalogPaths(root, join(root, 'cache'))
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"></svg>'
    const tried: string[] = []
    const result = await ensureProviderLogoCached({
      providerId: 'openrouter',
      paths,
      timeoutMs: 9_000,
      fetchImpl: (async (input: string | URL | Request) => {
        const url = String(input)
        tried.push(url)
        if (url.includes('models.dev/logos')) {
          throw Object.assign(new TypeError('fetch failed'), {
            cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }),
          })
        }
        if (url.includes('raw.githubusercontent.com')) {
          return new Response(svg, { status: 200, headers: { 'content-type': 'image/svg+xml' } })
        }
        return new Response('nope', { status: 404 })
      }) as typeof fetch,
    })
    assert.equal(result.fromCache, false)
    assert.equal(result.svg, svg)
    assert.match(result.sourceUrl ?? '', /raw\.githubusercontent\.com/)
    assert.ok(tried.some((u) => u.includes('models.dev/logos')))
    assert.equal(readCachedProviderLogo('openrouter', paths), svg)
  })

  it('refreshModelsDevCatalog surfaces network cause codes in the error message', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sd-md-refresh-net-'))
    const paths = modelsDevCatalogPaths(root, join(root, 'cache'))
    const cause = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })
    const err = Object.assign(new TypeError('fetch failed'), { cause })
    await assert.rejects(
      () =>
        refreshModelsDevCatalog({
          url: 'https://models.dev/api.json',
          paths,
          fetchImpl: (async () => {
            throw err
          }) as typeof fetch,
        }),
      (e: unknown) => {
        assert.ok(e instanceof Error)
        assert.match(e.message, /models\.dev fetch failed/i)
        assert.match(e.message, /ECONNRESET/)
        return true
      },
    )
  })
})
