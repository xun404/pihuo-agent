import assert from 'node:assert/strict'
import { describe, it, before, after } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { refreshRegistryCatalog, resolveLocalRegistryCatalog } from './acp-registry-service.js'

describe('acp-registry-service', () => {
  let dir: string
  const prevData = process.env.SWARMDESK_AGENT_DATA_DIR
  const prevCat = process.env.ACP_REGISTRY_CATALOG_PATH

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'acp-reg-svc-'))
    process.env.SWARMDESK_AGENT_DATA_DIR = dir
    process.env.ACP_REGISTRY_CATALOG_PATH = join(dir, 'acp-registry.json')
  })

  after(() => {
    if (prevData === undefined) delete process.env.SWARMDESK_AGENT_DATA_DIR
    else process.env.SWARMDESK_AGENT_DATA_DIR = prevData
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

  it('refresh success persists LKG; failure keeps previous without empty forge', async () => {
    const ok = await refreshRegistryCatalog({
      fetchImpl: async () =>
        Response.json({
          version: '1.0.0',
          extensions: [],
          agents: [
            {
              id: 'remote-only',
              name: 'Remote Only',
              version: '9.9.9',
              description: 'from remote',
              icon: 'https://example.com/i.svg',
              distribution: {
                npx: { package: '@example/remote@9.9.9' },
              },
            },
          ],
        }),
    })
    assert.equal(ok.stale, false)
    assert.ok(ok.snapshot.agents.some((a) => a.id === 'remote-only'))

    const failed = await refreshRegistryCatalog({
      fetchImpl: async () => {
        throw new Error('network down')
      },
    })
    assert.equal(failed.stale, true)
    assert.ok(failed.snapshot.agents.some((a) => a.id === 'remote-only'))
    assert.notEqual(failed.snapshot.agents.length, 0)
  })

  it('schema major too new returns updateRequired and keeps LKG', async () => {
    // seed LKG first
    await refreshRegistryCatalog({
      fetchImpl: async () =>
        Response.json({
          version: '1.0.0',
          agents: [
            {
              id: 'keep-me',
              name: 'Keep',
              version: '1.0.0',
              description: 'd',
              icon: 'x',
              distribution: { npx: { package: '@e/k@1.0.0' } },
            },
          ],
        }),
    })
    const r = await refreshRegistryCatalog({
      fetchImpl: async () =>
        Response.json({
          version: '2.0.0',
          agents: [],
        }),
    })
    assert.equal(r.updateRequired, true)
    assert.equal(r.code, 'ACP_REGISTRY_SCHEMA_UNSUPPORTED')
    assert.ok(r.snapshot.agents.some((a) => a.id === 'keep-me'))
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
      const result = await refreshRegistryCatalog({
        fetchImpl: async () => {
          throw new Error(privateMessage)
        },
      })
      const publicBody = JSON.stringify({
        message: result.message,
        diagnosticMessage: result.snapshot.diagnosticMessage,
      })
      assert.equal(publicBody.includes(privateMessage), false)
      assert.ok(Buffer.byteLength(result.message ?? '', 'utf8') <= 512)
      assert.ok(Buffer.byteLength(result.snapshot.diagnosticMessage ?? '', 'utf8') <= 512)
      assert.equal(/[\u0000-\u001f\u007f-\u009f]/u.test(result.message ?? ''), false)
      assert.equal(result.message, 'Registry catalog is unavailable')
      assert.equal(result.snapshot.diagnosticMessage, 'Registry catalog is unavailable')
    }
  })
})
