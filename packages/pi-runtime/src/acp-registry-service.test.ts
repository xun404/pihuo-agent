import assert from 'node:assert/strict'
import { describe, it, before, after } from 'node:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkRegistryCatalogUpdate, resolveLocalRegistryCatalog } from './acp-registry-service.js'

function registryWith(id: string, version = '1.0.0') {
  return {
    version: '1.0.0',
    extensions: [],
    agents: [
      {
        id,
        name: id,
        version,
        description: `Registry fixture ${id}`,
        icon: 'https://example.com/icon.svg',
        distribution: {
          npx: { package: `@example/${id}@${version}` },
        },
      },
    ],
  }
}

describe('acp-registry-service', () => {
  let dir: string
  const prevData = process.env.PIHUO_AGENT_DATA_DIR
  const prevCat = process.env.ACP_REGISTRY_CATALOG_PATH

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'acp-reg-svc-'))
    process.env.PIHUO_AGENT_DATA_DIR = dir
    process.env.ACP_REGISTRY_CATALOG_PATH = join(dir, 'acp-registry.json')
  })

  after(() => {
    if (prevData === undefined) delete process.env.PIHUO_AGENT_DATA_DIR
    else process.env.PIHUO_AGENT_DATA_DIR = prevData
    if (prevCat === undefined) delete process.env.ACP_REGISTRY_CATALOG_PATH
    else process.env.ACP_REGISTRY_CATALOG_PATH = prevCat
    rmSync(dir, { recursive: true, force: true })
  })

  it('resolveLocal falls back to bundled snapshot with agents', () => {
    const local = resolveLocalRegistryCatalog()
    assert.ok(local.snapshot.agents.length >= 30)
    assert.ok(local.legacy.agents.length >= 30)
    assert.equal(local.snapshot.source, 'bundled')
  })

  it('manual check persists a changed complete snapshot and skips an unchanged digest', async () => {
    const first = await checkRegistryCatalogUpdate({
      fetchImpl: async () =>
        Response.json(registryWith('manual-update'), { headers: { etag: '"first"' } }),
    })
    assert.equal(first.status, 'updated')
    assert.equal(first.catalog.snapshot.source, 'persisted')
    assert.ok(first.catalog.snapshot.agents.some((agent) => agent.id === 'manual-update'))
    assert.equal(resolveLocalRegistryCatalog().stale, false)

    const catalogPath = process.env.ACP_REGISTRY_CATALOG_PATH!
    const persistedBefore = readFileSync(catalogPath, 'utf8')
    const second = await checkRegistryCatalogUpdate({
      fetchImpl: async () =>
        Response.json(registryWith('manual-update'), { headers: { etag: '"second"' } }),
    })

    assert.equal(second.status, 'up_to_date')
    assert.equal(readFileSync(catalogPath, 'utf8'), persistedBefore)
  })

  it('manual check preserves the active snapshot on network and schema failures', async () => {
    const seeded = await checkRegistryCatalogUpdate({
      fetchImpl: async () => Response.json(registryWith('keep-manual')),
    })
    assert.equal(seeded.status, 'updated')

    const failed = await checkRegistryCatalogUpdate({
      fetchImpl: async () => {
        throw new Error('network secret /Users/private/token')
      },
    })
    assert.equal(failed.status, 'failed')
    assert.ok(failed.catalog.snapshot.agents.some((agent) => agent.id === 'keep-manual'))

    const unsupported = await checkRegistryCatalogUpdate({
      fetchImpl: async () => Response.json({ version: '2.0.0', agents: [] }),
    })
    assert.equal(unsupported.status, 'update_required')
    assert.equal(unsupported.catalog.updateRequired, true)
    assert.ok(unsupported.catalog.snapshot.agents.some((agent) => agent.id === 'keep-manual'))
  })

  it('never exposes private or oversized refresh failures in the public catalog result', async () => {
    const privateMessages = [
      'failed at /Users/private/registry.json',
      'failed at /opt/router/registry.json',
      String.raw`failed at \\server\share\registry.json`,
      'failed at file:///srv/router/registry.json',
      'upstream?token=super-secret',
      'credential: super-secret',
      'password : super-secret',
      'bad\u0000control',
      `oversized-${'x'.repeat(1024)}`,
    ]
    for (const privateMessage of privateMessages) {
      const result = await checkRegistryCatalogUpdate({
        fetchImpl: async () => {
          throw new Error(privateMessage)
        },
      })
      const publicBody = JSON.stringify({
        message: result.catalog.message,
        diagnosticMessage: result.catalog.snapshot.diagnosticMessage,
      })
      assert.equal(publicBody.includes(privateMessage), false)
      assert.ok(Buffer.byteLength(result.catalog.message ?? '', 'utf8') <= 512)
      assert.ok(Buffer.byteLength(result.catalog.snapshot.diagnosticMessage ?? '', 'utf8') <= 512)
      assert.equal(/[\u0000-\u001f\u007f-\u009f]/u.test(result.catalog.message ?? ''), false)
      assert.equal(result.catalog.message, 'Registry catalog is unavailable')
      assert.equal(result.catalog.snapshot.diagnosticMessage, 'Registry catalog is unavailable')
    }
  })
})
