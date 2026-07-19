import assert from 'node:assert/strict'
import { describe, it, before, after } from 'node:test'
import { mkdtempSync, rmSync, existsSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  loadAcpRegistryCatalogStore,
  saveAcpRegistryCatalogStore,
} from './acp-registry-catalog-store.js'
import type { AcpRegistryCatalogSnapshot } from '@swarmdesk-agent/shared'

describe('acp-registry-catalog-store', () => {
  let dir: string
  let path: string
  const prev = process.env.ACP_REGISTRY_CATALOG_PATH

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'acp-reg-store-'))
    path = join(dir, 'acp-registry.json')
    process.env.ACP_REGISTRY_CATALOG_PATH = path
  })

  after(() => {
    if (prev === undefined) delete process.env.ACP_REGISTRY_CATALOG_PATH
    else process.env.ACP_REGISTRY_CATALOG_PATH = prev
    rmSync(dir, { recursive: true, force: true })
  })

  it('round-trips a snapshot and isolates corrupt files', () => {
    const snapshot: AcpRegistryCatalogSnapshot = {
      schemaVersion: '1.0.0',
      version: '1.0.0',
      source: 'remote',
      digest: 'sha256:abc',
      agents: [
        {
          id: 'a',
          name: 'A',
          version: '1.0.0',
          description: 'd',
          distributions: [
            {
              kind: 'npx',
              package: '@x/a@1.0.0',
              args: [],
              env: {},
            },
          ],
          manifestDigest: 'sha256:entry',
          availability: 'available',
        },
      ],
    }
    saveAcpRegistryCatalogStore({
      schemaVersion: '1.0.0',
      digest: 'sha256:abc',
      etag: '"etag1"',
      fetchedAt: new Date().toISOString(),
      snapshot,
    })
    assert.ok(existsSync(path))
    const loaded = loadAcpRegistryCatalogStore()
    assert.ok(loaded)
    assert.equal(loaded!.digest, 'sha256:abc')
    assert.equal(loaded!.snapshot.agents[0]?.id, 'a')
    assert.equal(loaded!.snapshot.source, 'persisted')
    assert.equal(loaded!.etag, '"etag1"')

    // corrupt → isolated; store returns null without inventing catalog
    writeFileSync(path, '{not-json')
    const after = loadAcpRegistryCatalogStore()
    assert.equal(after, null)
    assert.ok(!existsSync(path))
    assert.ok(readdirSync(dir).some((n) => n.includes('corrupt')))
  })
})
