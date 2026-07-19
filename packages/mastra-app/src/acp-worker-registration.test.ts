import assert from 'node:assert/strict'
import { describe, it, before, after } from 'node:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import {
  createInstallationId,
  loadAcpAgentInstallationIndex,
  saveAcpRegistryCatalogStore,
  saveAcpAgentInstallationIndex,
} from '@swarmdesk-agent/core'
import type { AcpRegistryCatalogSnapshot } from '@swarmdesk-agent/shared'
import {
  prepareRegistryWorker,
  registerRegistryWorker,
  RegistryRegistrationError,
} from './acp-worker-registration.js'
import { digestOfAgentEntry } from '@swarmdesk-agent/adapters'

describe('acp-worker-registration', () => {
  let dir: string
  const prevData = process.env.SWARMDESK_AGENT_DATA_DIR
  const prevCat = process.env.ACP_REGISTRY_CATALOG_PATH
  const prevInst = process.env.ACP_AGENT_INSTALLATIONS_PATH

  const rawAgent = {
    id: 'reg-agent',
    name: 'Reg Agent',
    version: '1.0.0',
    description: 'from test catalog',
    icon: 'https://example.com/i.svg',
    distribution: {
      npx: { package: '@example/reg-agent@1.0.0', args: ['--acp'] },
    },
  }
  const manifestDigest = digestOfAgentEntry(rawAgent)
  const catalogSnapshot: AcpRegistryCatalogSnapshot = {
    schemaVersion: '1.0.0',
    version: '1.0.0',
    source: 'persisted',
    digest: 'sha256:catalog',
    agents: [
      {
        id: 'reg-agent',
        name: 'Reg Agent',
        version: '1.0.0',
        description: 'from test catalog',
        icon: 'https://example.com/i.svg',
        distributions: [
          {
            kind: 'npx',
            package: '@example/reg-agent@1.0.0',
            args: ['--acp'],
            env: { ACP_MODE: 'stdio' },
          },
        ],
        manifestDigest,
        availability: 'available',
      },
    ],
  }

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'acp-reg-worker-'))
    process.env.SWARMDESK_AGENT_DATA_DIR = dir
    process.env.ACP_REGISTRY_CATALOG_PATH = join(dir, 'acp-registry.json')
    process.env.ACP_AGENT_INSTALLATIONS_PATH = join(dir, 'installs.json')
    saveAcpRegistryCatalogStore({
      schemaVersion: '1.0.0',
      digest: 'sha256:catalog',
      snapshot: catalogSnapshot,
    })
  })

  after(() => {
    if (prevData === undefined) delete process.env.SWARMDESK_AGENT_DATA_DIR
    else process.env.SWARMDESK_AGENT_DATA_DIR = prevData
    if (prevCat === undefined) delete process.env.ACP_REGISTRY_CATALOG_PATH
    else process.env.ACP_REGISTRY_CATALOG_PATH = prevCat
    if (prevInst === undefined) delete process.env.ACP_AGENT_INSTALLATIONS_PATH
    else process.env.ACP_AGENT_INSTALLATIONS_PATH = prevInst
    rmSync(dir, { recursive: true, force: true })
  })

  it('rejects command injection on register', async () => {
    await assert.rejects(
      async () =>
        registerRegistryWorker({
          body: {
            registryId: 'reg-agent',
            version: '1.0.0',
            distribution: 'npx',
            manifestDigest,
            installationId: 'inst_x',
            command: 'evil',
            args: ['-c', 'rm -rf /'],
          },
          existingWorkers: [],
        }),
      (e: unknown) =>
        e instanceof RegistryRegistrationError &&
        e.httpStatus === 409 &&
        /command/i.test(e.message),
    )
  })

  it('prepare + register materializes owner launch without client command', async () => {
    const { installation, prepare } = await prepareRegistryWorker({
      body: {
        registryId: 'reg-agent',
        version: '1.0.0',
        distribution: 'npx',
        manifestDigest,
      },
    })
    assert.ok(installation.installationId.startsWith('inst_'))
    assert.equal(prepare.packageSpec, '@example/reg-agent@1.0.0')
    assert.equal(prepare.distribution, 'npx')
    assert.equal(installation.status, 'prepared')
    assert.equal(installation.launchSpec?.runnerCommand, prepare.command)
    assert.deepEqual(installation.launchSpec?.agentArgs, ['--acp'])
    assert.deepEqual(installation.launchSpec?.env, { ACP_MODE: 'stdio' })

    const worker = await registerRegistryWorker({
      body: {
        registryId: 'reg-agent',
        version: '1.0.0',
        distribution: 'npx',
        manifestDigest,
        installationId: installation.installationId,
      },
      existingWorkers: [],
    })
    assert.equal(worker.source?.type, 'registry')
    assert.equal(worker.primaryRole, 'general')
    assert.deepEqual(worker.roles, ['general'])
    assert.equal(worker.kind, 'custom')
    assert.ok(worker.command.length > 0)
    assert.deepEqual(worker.args, prepare.args)
    assert.deepEqual(worker.env, { ACP_MODE: 'stdio' })
    assert.deepEqual(worker.launchSpec, installation.launchSpec)
    assert.equal(worker.readiness?.status, 'prepared')
    assert.equal(worker.installationId, installation.installationId)
  })

  it('idempotently reuses the prepared installation without mutating artifacts', async () => {
    const first = await prepareRegistryWorker({
      body: {
        registryId: 'reg-agent',
        version: '1.0.0',
        distribution: 'npx',
        manifestDigest,
      },
    })
    const sentinel = join(first.installation.installDir, 'sentinel')
    writeFileSync(sentinel, 'preserve')
    const second = await prepareRegistryWorker({
      body: {
        registryId: 'reg-agent',
        version: '1.0.0',
        distribution: 'npx',
        manifestDigest,
      },
    })
    assert.equal(second.installation.installationId, first.installation.installationId)
    assert.equal(readFileSync(sentinel, 'utf8'), 'preserve')
  })

  it('compares the private formal metadata with the immutable store row on reuse', async () => {
    const first = await prepareRegistryWorker({
      body: {
        registryId: 'reg-agent',
        version: '1.0.0',
        distribution: 'npx',
        manifestDigest,
      },
    })
    const metadataPath = join(first.installation.installDir, '.acp-install.json')
    const beforeMetadata = readFileSync(metadataPath, 'utf8')
    const beforeIndex = readFileSync(process.env.ACP_AGENT_INSTALLATIONS_PATH!, 'utf8')
    const tampered = JSON.parse(beforeMetadata) as Record<string, unknown>
    tampered.command = '/tmp/untrusted-runner'
    writeFileSync(metadataPath, `${JSON.stringify(tampered)}\n`)
    try {
      await assert.rejects(
        () =>
          prepareRegistryWorker({
            body: {
              registryId: 'reg-agent',
              version: '1.0.0',
              distribution: 'npx',
              manifestDigest,
            },
          }),
        (error: unknown) =>
          error instanceof RegistryRegistrationError &&
          error.code === 'ACP_INSTALL_DIGEST_MISMATCH' &&
          error.httpStatus === 409,
      )
      assert.equal(readFileSync(process.env.ACP_AGENT_INSTALLATIONS_PATH!, 'utf8'), beforeIndex)
    } finally {
      writeFileSync(metadataPath, beforeMetadata)
    }
  })

  it('anchors a jointly modified payload inventory to the immutable Store row', async () => {
    const first = await prepareRegistryWorker({
      body: {
        registryId: 'reg-agent',
        version: '1.0.0',
        distribution: 'npx',
        manifestDigest,
      },
    })
    const payloadPath = join(first.installation.installDir, 'package-prepare.json')
    const metadataPath = join(first.installation.installDir, '.acp-install.json')
    const beforePayload = readFileSync(payloadPath)
    const beforeMetadata = readFileSync(metadataPath, 'utf8')
    const changed = Buffer.from('{"tampered":true}')
    const metadata = JSON.parse(beforeMetadata) as {
      payloadFiles: Array<{ path: string; sha256: string; size: number }>
      payloadDigest: string
    }
    const file = metadata.payloadFiles.find((item) => item.path === 'package-prepare.json')!
    file.sha256 = createHash('sha256').update(changed).digest('hex')
    file.size = changed.length
    metadata.payloadDigest = createHash('sha256')
      .update(JSON.stringify(metadata.payloadFiles))
      .digest('hex')
    writeFileSync(payloadPath, changed)
    writeFileSync(metadataPath, `${JSON.stringify(metadata)}\n`)
    try {
      await assert.rejects(
        () =>
          prepareRegistryWorker({
            body: {
              registryId: 'reg-agent',
              version: '1.0.0',
              distribution: 'npx',
              manifestDigest,
            },
          }),
        (error: unknown) =>
          error instanceof RegistryRegistrationError &&
          error.code === 'ACP_INSTALL_DIGEST_MISMATCH' &&
          error.httpStatus === 409,
      )
    } finally {
      writeFileSync(payloadPath, beforePayload)
      writeFileSync(metadataPath, beforeMetadata)
    }
  })

  it('revalidates the Store-anchored payload at the separate register boundary', async () => {
    const first = await prepareRegistryWorker({
      body: {
        registryId: 'reg-agent',
        version: '1.0.0',
        distribution: 'npx',
        manifestDigest,
      },
    })
    const payloadPath = join(first.installation.installDir, 'package-prepare.json')
    const metadataPath = join(first.installation.installDir, '.acp-install.json')
    const beforePayload = readFileSync(payloadPath)
    const beforeMetadata = readFileSync(metadataPath, 'utf8')
    const changed = Buffer.from('{"tampered-between-prepare-and-register":true}')
    const metadata = JSON.parse(beforeMetadata) as {
      payloadFiles: Array<{ path: string; sha256: string; size: number }>
      payloadDigest: string
    }
    const file = metadata.payloadFiles.find((item) => item.path === 'package-prepare.json')!
    file.sha256 = createHash('sha256').update(changed).digest('hex')
    file.size = changed.length
    metadata.payloadDigest = createHash('sha256')
      .update(JSON.stringify(metadata.payloadFiles))
      .digest('hex')
    writeFileSync(payloadPath, changed)
    writeFileSync(metadataPath, `${JSON.stringify(metadata)}\n`)
    try {
      await assert.rejects(
        () =>
          registerRegistryWorker({
            body: {
              registryId: 'reg-agent',
              version: '1.0.0',
              distribution: 'npx',
              manifestDigest,
              installationId: first.installation.installationId,
            },
            existingWorkers: [],
          }),
        (error: unknown) =>
          error instanceof RegistryRegistrationError &&
          error.code === 'ACP_INSTALL_DIGEST_MISMATCH' &&
          error.httpStatus === 409,
      )
    } finally {
      writeFileSync(payloadPath, beforePayload)
      writeFileSync(metadataPath, beforeMetadata)
    }
  })

  it('reference-safely retires a zero-reference legacy artifact and re-prepares it', async () => {
    const isolated = join(dir, 'legacy-reprepare')
    const previous = {
      data: process.env.SWARMDESK_AGENT_DATA_DIR,
      catalog: process.env.ACP_REGISTRY_CATALOG_PATH,
      installs: process.env.ACP_AGENT_INSTALLATIONS_PATH,
    }
    process.env.SWARMDESK_AGENT_DATA_DIR = isolated
    process.env.ACP_REGISTRY_CATALOG_PATH = join(isolated, 'catalog.json')
    process.env.ACP_AGENT_INSTALLATIONS_PATH = join(isolated, 'installs.json')
    try {
      saveAcpRegistryCatalogStore({
        schemaVersion: '1.0.0',
        digest: 'sha256:catalog',
        snapshot: catalogSnapshot,
      })
      const legacyId = createInstallationId()
      const installDir = join(isolated, 'data', 'agents', 'reg-agent', '1.0.0', 'npx')
      mkdirSync(installDir, { recursive: true })
      writeFileSync(join(installDir, 'legacy-marker'), 'preserve')
      saveAcpAgentInstallationIndex({
        version: 1,
        installations: [
          {
            installationId: legacyId,
            registryId: 'reg-agent',
            registryVersion: '1.0.0',
            distribution: 'npx',
            manifestDigest,
            installDir,
            packageSpec: '@example/reg-agent@1.0.0',
            runnerCommand: 'npx',
            runnerVersion: 'legacy',
            status: 'prepared',
            preparedAt: '2026-07-17T00:00:00.000Z',
            workerIds: [],
          },
        ],
      })
      const result = await prepareRegistryWorker({
        body: {
          registryId: 'reg-agent',
          version: '1.0.0',
          distribution: 'npx',
          manifestDigest,
        },
      })
      assert.notEqual(result.installation.installationId, legacyId)
      assert.equal(result.installation.status, 'prepared')
      const index = loadAcpAgentInstallationIndex()
      assert.equal(
        index.installations.find((item) => item.installationId === legacyId)?.status,
        'removed',
      )
      assert.ok(
        index.installations.some(
          (item) => item.installationId === result.installation.installationId,
        ),
      )
      assert.equal(existsSync(join(installDir, 'legacy-marker')), false)
    } finally {
      process.env.SWARMDESK_AGENT_DATA_DIR = previous.data
      process.env.ACP_REGISTRY_CATALOG_PATH = previous.catalog
      process.env.ACP_AGENT_INSTALLATIONS_PATH = previous.installs
    }
  })

  it('preserves ACP_RUNNER_MISSING through the public registration boundary', async () => {
    const isolated = join(dir, 'runner-missing')
    const previous = {
      data: process.env.SWARMDESK_AGENT_DATA_DIR,
      catalog: process.env.ACP_REGISTRY_CATALOG_PATH,
      installs: process.env.ACP_AGENT_INSTALLATIONS_PATH,
    }
    process.env.SWARMDESK_AGENT_DATA_DIR = isolated
    process.env.ACP_REGISTRY_CATALOG_PATH = join(isolated, 'catalog.json')
    process.env.ACP_AGENT_INSTALLATIONS_PATH = join(isolated, 'installs.json')
    try {
      saveAcpRegistryCatalogStore({
        schemaVersion: '1.0.0',
        digest: 'sha256:catalog',
        snapshot: catalogSnapshot,
      })
      await assert.rejects(
        () =>
          prepareRegistryWorker({
            body: {
              registryId: 'reg-agent',
              version: '1.0.0',
              distribution: 'npx',
              manifestDigest,
            },
            runnerEnv: { ...process.env, PATH: '' },
          }),
        (error: unknown) =>
          error instanceof RegistryRegistrationError && error.code === 'ACP_RUNNER_MISSING',
      )
    } finally {
      process.env.SWARMDESK_AGENT_DATA_DIR = previous.data
      process.env.ACP_REGISTRY_CATALOG_PATH = previous.catalog
      process.env.ACP_AGENT_INSTALLATIONS_PATH = previous.installs
    }
  })

  it('rejects legacy installations that lack trusted launch facts', async () => {
    const installationId = createInstallationId()
    const index = loadAcpAgentInstallationIndex()
    index.installations.push({
      installationId,
      registryId: 'reg-agent',
      registryVersion: '1.0.0',
      distribution: 'npx',
      manifestDigest,
      installDir: join(dir, 'legacy-install'),
      packageSpec: '@example/reg-agent@1.0.0',
      runnerCommand: 'npx',
      runnerVersion: 'legacy',
      status: 'prepared',
      preparedAt: '2026-07-17T00:00:00.000Z',
      workerIds: [],
    })
    saveAcpAgentInstallationIndex(index)
    await assert.rejects(
      () =>
        registerRegistryWorker({
          body: {
            registryId: 'reg-agent',
            version: '1.0.0',
            distribution: 'npx',
            manifestDigest,
            installationId,
          },
          existingWorkers: [],
        }),
      (error: unknown) =>
        error instanceof RegistryRegistrationError &&
        error.code === 'ACP_INSTALL_FAILED' &&
        /launch facts/i.test(error.message),
    )
  })

  it('rejects an installation whose immutable version identity differs', async () => {
    const installationId = createInstallationId()
    const index = loadAcpAgentInstallationIndex()
    index.installations.push({
      installationId,
      registryId: 'reg-agent',
      registryVersion: '0.9.0',
      distribution: 'npx',
      manifestDigest,
      installDir: join(dir, 'wrong-version'),
      status: 'prepared',
      preparedAt: '2026-07-17T00:00:00.000Z',
      workerIds: [],
      launchSpec: {
        distribution: 'npx',
        runnerCommand: '/trusted/npx',
        runnerArgs: ['--yes'],
        packageSpec: '@example/reg-agent@0.9.0',
        agentArgs: ['--acp'],
        env: {},
      },
    })
    saveAcpAgentInstallationIndex(index)
    await assert.rejects(
      () =>
        registerRegistryWorker({
          body: {
            registryId: 'reg-agent',
            version: '1.0.0',
            distribution: 'npx',
            manifestDigest,
            installationId,
          },
          existingWorkers: [],
        }),
      (error: unknown) =>
        error instanceof RegistryRegistrationError && error.code === 'ACP_INSTALL_TRUST_REQUIRED',
    )
  })

  it('rejects stale manifestDigest', async () => {
    await assert.rejects(
      () =>
        prepareRegistryWorker({
          body: {
            registryId: 'reg-agent',
            distribution: 'npx',
            manifestDigest: `sha256:${'0'.repeat(64)}`,
          },
        }),
      (e: unknown) => e instanceof RegistryRegistrationError && e.httpStatus === 409,
    )
  })
})
