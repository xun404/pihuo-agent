import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ACP_REGISTRY_URL,
  fetchAcpRegistryCatalog,
  parseAcpRegistryCatalog,
  parseAcpRegistryCatalogV2,
  resolveAcpRegistryTargetOrError,
} from './acp-registry.js'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const registrySource = {
  version: '1.0.0',
  extensions: [],
  agents: [
    {
      id: 'package-agent',
      name: 'Package Agent',
      version: '1.2.3',
      description: 'Runs through npx',
      icon: 'https://example.com/package.svg',
      distribution: {
        npx: {
          package: '@example/package-agent@1.2.3',
          args: ['--acp'],
          env: { DISABLE_UPDATE: '1' },
        },
      },
    },
    {
      id: 'binary-agent',
      name: 'Binary Agent',
      version: '2.0.0',
      description: 'Runs as a locally installed binary',
      icon: 'https://example.com/binary.svg',
      distribution: {
        binary: {
          'darwin-aarch64': {
            archive: 'https://example.com/binary.zip',
            cmd: './binary-agent',
            args: ['acp'],
          },
        },
      },
    },
    {
      id: 'uv-agent',
      name: 'UV Agent',
      version: '3.0.0',
      description: 'Runs through uvx',
      icon: 'https://example.com/uv.svg',
      distribution: {
        uvx: {
          package: 'uv-agent-acp==3.0.0',
          args: ['--stdio'],
        },
      },
    },
    {
      id: 'dual-agent',
      name: 'Dual Agent',
      version: '4.0.0',
      description: 'Prefers package launch for registration',
      icon: 'https://example.com/dual.svg',
      distribution: {
        binary: {
          'darwin-aarch64': {
            archive: 'https://example.com/dual.zip',
            cmd: './dual-agent',
          },
        },
        npx: {
          package: '@example/dual-agent@4.0.0',
        },
      },
    },
  ],
}

function coreLaunch(agent: {
  id: string
  distribution: string
  command: string
  args: string[]
  env: Record<string, string>
  requiresLocalInstall: boolean
}) {
  return {
    id: agent.id,
    distribution: agent.distribution,
    command: agent.command,
    args: agent.args,
    env: agent.env,
    requiresLocalInstall: agent.requiresLocalInstall,
  }
}

describe('ACP registry catalog', () => {
  it('maps every registry agent to an editable worker launch template', () => {
    const catalog = parseAcpRegistryCatalog(registrySource, 'darwin-aarch64')

    assert.equal(catalog.version, '1.0.0')
    assert.equal(catalog.agents.length, 4)
    const binary = catalog.agents.find((a) => a.id === 'binary-agent')!
    assert.deepEqual(coreLaunch(binary), {
      id: 'binary-agent',
      distribution: 'binary',
      command: 'binary-agent',
      args: ['acp'],
      env: {},
      requiresLocalInstall: true,
    })
    const pkg = catalog.agents.find((agent) => agent.id === 'package-agent')!
    assert.deepEqual(coreLaunch(pkg), {
      id: 'package-agent',
      distribution: 'npx',
      command: 'npx',
      args: ['--yes', '@example/package-agent@1.2.3', '--acp'],
      env: { DISABLE_UPDATE: '1' },
      requiresLocalInstall: false,
    })
    assert.equal(catalog.agents.find((agent) => agent.id === 'dual-agent')?.distribution, 'npx')
    assert.deepEqual(catalog.agents.find((agent) => agent.id === 'uv-agent')?.args, [
      'uv-agent-acp==3.0.0',
      '--stdio',
    ])
  })

  it('v2 retains all distributions for multi-dist agents', () => {
    const snap = parseAcpRegistryCatalogV2(registrySource, {
      target: 'darwin-aarch64',
    })
    const dual = snap.agents.find((a) => a.id === 'dual-agent')!
    assert.equal(dual.distributions.length, 2)
    assert.ok(dual.distributions.some((d) => d.kind === 'npx'))
    assert.ok(dual.distributions.some((d) => d.kind === 'binary'))
    const bin = dual.distributions.find((d) => d.kind === 'binary')
    assert.ok(bin && bin.kind === 'binary')
    assert.equal(bin.targets[0]?.archiveUrl, 'https://example.com/dual.zip')
    assert.ok(dual.manifestDigest.startsWith('sha256:'))
  })

  it('isolates single-agent invalid_manifest without wiping catalog', () => {
    const snap = parseAcpRegistryCatalogV2(
      {
        version: '1.0.0',
        extensions: [],
        agents: [
          registrySource.agents[0],
          { id: 'broken', name: 'Broken', version: '1.0.0', description: 'x' },
        ],
      },
      { target: 'darwin-aarch64', isolateAgentErrors: true },
    )
    assert.equal(snap.agents.length, 2)
    const broken = snap.agents.find((a) => a.id === 'broken')!
    assert.equal(broken.availability, 'invalid_manifest')
    assert.equal(snap.agents.find((a) => a.id === 'package-agent')?.availability, 'available')
  })

  it('rejects unknown top-level fields and unsupported schema major', () => {
    assert.throws(
      () =>
        parseAcpRegistryCatalogV2({
          version: '1.0.0',
          agents: [],
          unexpected: true,
        }),
      /Unknown top-level/,
    )
    assert.throws(
      () =>
        parseAcpRegistryCatalogV2({
          version: '2.0.0',
          agents: [],
        }),
      /Unsupported ACP registry schema/,
    )
  })

  it('rejects duplicate or malformed registry agents (legacy API)', () => {
    assert.throws(
      () =>
        parseAcpRegistryCatalog(
          {
            ...registrySource,
            agents: [registrySource.agents[0], registrySource.agents[0]],
          },
          'darwin-aarch64',
        ),
      /duplicate/i,
    )
    assert.throws(
      () =>
        parseAcpRegistryCatalog(
          {
            version: '1.0.0',
            agents: [{ id: 'broken', name: 'Broken' }],
          },
          'darwin-aarch64',
        ),
      /registry/i,
    )
  })

  it('fetches the official registry and parses the response', async () => {
    let requestedUrl = ''
    const catalog = await fetchAcpRegistryCatalog({
      target: 'darwin-aarch64',
      fetchImpl: async (input) => {
        requestedUrl = String(input)
        return Response.json(registrySource)
      },
    })

    assert.equal(requestedUrl, ACP_REGISTRY_URL)
    assert.equal(catalog.agents.length, 4)
  })

  it('resolveAcpRegistryTargetOrError returns unsupported_platform code', () => {
    const bad = resolveAcpRegistryTargetOrError('aix' as NodeJS.Platform, 'mips')
    assert.equal(bad.ok, false)
    if (!bad.ok) assert.equal(bad.code, 'ACP_PLATFORM_UNSUPPORTED')
  })

  it('parses bundled real registry snapshot without executing agents', () => {
    const path = join(dirname(fileURLToPath(import.meta.url)), 'bundled/acp-registry.json')
    const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown
    const snap = parseAcpRegistryCatalogV2(raw, {
      target: 'darwin-aarch64',
      isolateAgentErrors: true,
    })
    assert.ok(snap.agents.length >= 30)
    assert.equal(snap.schemaVersion, '1.0.0')
    // multi-dist agents keep both
    const multi = snap.agents.filter((a) => a.distributions.length >= 2)
    assert.ok(multi.length >= 1)
  })
})
