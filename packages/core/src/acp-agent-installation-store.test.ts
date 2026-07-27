import assert from 'node:assert/strict'
import { describe, it, before, after } from 'node:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  addWorkerReference,
  createInstallationId,
  findInstallation,
  findInstallationById,
  loadAcpAgentInstallationIndex,
  listUnreferencedInstallations,
  markInstallationRemoved,
  migrateLegacyNpxInstallation,
  removeWorkerReference,
  resolveInstallationDir,
  upsertInstallation,
  type AcpAgentInstallationRecord,
} from './acp-agent-installation-store.js'

describe('acp-agent-installation-store', () => {
  let dir: string
  let path: string
  const prev = process.env.ACP_AGENT_INSTALLATIONS_PATH
  const prevData = process.env.SWARMDESK_AGENT_DATA_DIR

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'acp-inst-'))
    path = join(dir, 'acp-agent-installations.json')
    process.env.ACP_AGENT_INSTALLATIONS_PATH = path
    process.env.SWARMDESK_AGENT_DATA_DIR = dir
  })

  after(() => {
    if (prev === undefined) delete process.env.ACP_AGENT_INSTALLATIONS_PATH
    else process.env.ACP_AGENT_INSTALLATIONS_PATH = prev
    if (prevData === undefined) delete process.env.SWARMDESK_AGENT_DATA_DIR
    else process.env.SWARMDESK_AGENT_DATA_DIR = prevData
    rmSync(dir, { recursive: true, force: true })
  })

  function base(partial: Partial<AcpAgentInstallationRecord> = {}): AcpAgentInstallationRecord {
    return {
      installationId: createInstallationId(),
      registryId: 'demo-agent',
      registryVersion: '1.0.0',
      distribution: 'binary',
      target: 'darwin-aarch64',
      manifestDigest: 'sha256:manifest',
      installDir: resolveInstallationDir({
        registryId: 'demo-agent',
        registryVersion: '1.0.0',
        target: 'darwin-aarch64',
      }),
      status: 'installed',
      installedAt: new Date().toISOString(),
      workerIds: [],
      observedSha256: 'aa'.repeat(32),
      payloadDigest: 'payload-v1',
      ...partial,
    }
  }

  it('upserts, references, and blocks remove while referenced', () => {
    const rec = upsertInstallation(base())
    assert.ok(rec.installationId.startsWith('inst_'))
    assert.ok(
      findInstallation({
        registryId: 'demo-agent',
        registryVersion: '1.0.0',
        distribution: 'binary',
        target: 'darwin-aarch64',
      }),
    )
    addWorkerReference(rec.installationId, 'worker_1')
    assert.throws(() => markInstallationRemoved(rec.installationId), /IN_USE/)
    removeWorkerReference(rec.installationId, 'worker_1')
    assert.equal(listUnreferencedInstallations().length, 1)
    markInstallationRemoved(rec.installationId)
  })

  it('blocks digest mismatch for same version/target', () => {
    upsertInstallation(
      base({
        installationId: createInstallationId(),
        observedSha256: 'bb'.repeat(32),
      }),
    )
    assert.throws(
      () =>
        upsertInstallation(
          base({
            installationId: createInstallationId(),
            observedSha256: 'cc'.repeat(32),
          }),
        ),
      /DIGEST_MISMATCH/,
    )
  })

  it('finds prepared installations and preserves complete launch facts', () => {
    const rec = upsertInstallation(
      base({
        registryId: 'prepared-agent',
        status: 'prepared',
        installedAt: undefined,
        preparedAt: '2026-07-17T00:00:00.000Z',
        launchSpec: {
          distribution: 'npx',
          runnerCommand: '/trusted/bin/npx',
          runnerArgs: ['--yes'],
          runnerVersion: '11.4.2',
          packageSpec: '@example/agent@1.0.0',
          agentArgs: ['--acp', '--stdio'],
          env: { ACP_MODE: 'stdio' },
        },
      }),
    )
    const found = findInstallation({
      registryId: rec.registryId,
      registryVersion: rec.registryVersion,
      distribution: rec.distribution,
      target: rec.target,
    })
    assert.equal(found?.status, 'prepared')
    assert.deepEqual(found?.launchSpec?.agentArgs, ['--acp', '--stdio'])
    assert.deepEqual(found?.launchSpec?.env, { ACP_MODE: 'stdio' })
    assert.equal(found?.launchSpec?.runnerVersion, '11.4.2')
  })

  it('rejects manifest mutation in place and leaves the stored row unchanged', () => {
    const original = upsertInstallation(
      base({
        registryId: 'mutation-agent',
        status: 'prepared',
      }),
    )
    const before = readFileSync(path, 'utf8')
    assert.throws(
      () => upsertInstallation({ ...original, manifestDigest: 'sha256:changed' }),
      /ACP_INSTALL_DIGEST_MISMATCH/,
    )
    assert.equal(readFileSync(path, 'utf8'), before)
    assert.equal(findInstallationById(original.installationId)?.manifestDigest, 'sha256:manifest')
  })

  it('rejects mutation of persisted launch facts for the same installation', () => {
    const original = upsertInstallation(
      base({
        registryId: 'launch-facts-agent',
        status: 'prepared',
        launchSpec: {
          distribution: 'binary',
          runnerArgs: [],
          executable: '/trusted/agent',
          agentArgs: ['--acp'],
          env: { ACP_MODE: 'stdio' },
        },
      }),
    )
    const before = readFileSync(path, 'utf8')
    assert.throws(
      () =>
        upsertInstallation({
          ...original,
          launchSpec: {
            ...original.launchSpec!,
            agentArgs: ['--changed'],
          },
        }),
      /ACP_INSTALL_DIGEST_MISMATCH/,
    )
    assert.equal(readFileSync(path, 'utf8'), before)
  })

  it('rejects every immutable top-level fact mutation with presence-sensitive digests', () => {
    const original = upsertInstallation(
      base({
        registryId: 'complete-immutable-agent',
        archiveUrl: 'https://example.com/agent.tgz',
        declaredSha256: '11'.repeat(32),
        resolvedExecutable: '/trusted/agent',
        packageSpec: '@example/agent@1.0.0',
        runnerCommand: '/trusted/npx',
        runnerVersion: '11.0.0',
        trustDecision: {
          acceptedAt: '2026-07-17T00:00:00.000Z',
          manifestDigest: 'sha256:manifest',
          explicitNoSha: false,
        },
        launchSpec: {
          distribution: 'binary',
          runnerArgs: [],
          executable: '/trusted/agent',
          agentArgs: [],
          env: {},
        },
      }),
    )
    const mutations: AcpAgentInstallationRecord[] = [
      { ...original, archiveUrl: 'https://example.com/other.tgz' },
      { ...original, declaredSha256: undefined },
      { ...original, observedSha256: undefined },
      { ...original, installDir: `${original.installDir}-other` },
      { ...original, resolvedExecutable: '/different/agent' },
      { ...original, packageSpec: '@example/agent@2.0.0' },
      { ...original, runnerCommand: '/different/npx' },
      { ...original, runnerVersion: '12.0.0' },
      { ...original, payloadDigest: 'payload-v2' },
      { ...original, trustDecision: { ...original.trustDecision!, explicitNoSha: true } },
    ]
    for (const mutation of mutations) {
      assert.throws(() => upsertInstallation(mutation), /ACP_INSTALL_DIGEST_MISMATCH/)
    }
    assert.deepEqual(findInstallationById(original.installationId), original)
  })

  it('rejects conflicting launch facts for a duplicate immutable identity', () => {
    const original = upsertInstallation(
      base({
        registryId: 'duplicate-launch-agent',
        status: 'prepared',
        launchSpec: {
          distribution: 'binary',
          runnerArgs: [],
          executable: '/trusted/agent',
          agentArgs: ['--acp'],
          env: {},
        },
      }),
    )
    const before = readFileSync(path, 'utf8')
    assert.throws(
      () =>
        upsertInstallation({
          ...original,
          installationId: createInstallationId(),
          launchSpec: {
            ...original.launchSpec!,
            executable: '/different/agent',
          },
        }),
      /ACP_INSTALL_DIGEST_MISMATCH/,
    )
    assert.equal(readFileSync(path, 'utf8'), before)
  })

  it('loads legacy rows without inventing launch facts', () => {
    const legacy = base({ status: 'installed' })
    delete (legacy as Partial<AcpAgentInstallationRecord>).launchSpec
    writeFileSync(path, JSON.stringify({ version: 1, installations: [legacy] }))
    const loaded = loadAcpAgentInstallationIndex(path)
    assert.equal(loaded.installations.length, 1)
    assert.equal(loaded.installations[0]?.launchSpec, undefined)
    assert.equal(loaded.installations[0]?.manifestDigest, legacy.manifestDigest)
  })

  it('atomically migrates a referenced legacy npx marker to a materialized executable', () => {
    const legacy = upsertInstallation(
      base({
        distribution: 'npx',
        installDir: join(dir, 'agents', 'demo-agent', '1.0.0', 'npx'),
        packageSpec: '@example/agent@1.0.0',
        runnerCommand: '/trusted/npx',
        runnerVersion: '10.0.0',
        payloadDigest: 'legacy-marker',
        workerIds: ['worker_existing'],
        launchSpec: {
          distribution: 'npx',
          runnerCommand: '/trusted/npx',
          runnerVersion: '10.0.0',
          runnerArgs: ['--yes'],
          packageSpec: '@example/agent@1.0.0',
          agentArgs: ['--acp'],
          env: { ACP_MODE: 'stdio' },
        },
      }),
    )
    const executable = join(legacy.installDir, 'node_modules', '@example', 'agent', 'bin.js')
    const migrated = migrateLegacyNpxInstallation(legacy.installationId, {
      ...legacy,
      resolvedExecutable: executable,
      payloadDigest: 'materialized-payload',
      launchSpec: { ...legacy.launchSpec!, executable },
    })

    assert.equal(migrated.resolvedExecutable, executable)
    assert.equal(migrated.launchSpec?.executable, executable)
    assert.deepEqual(migrated.workerIds, ['worker_existing'])
    assert.deepEqual(findInstallationById(legacy.installationId), migrated)
  })

  it('rejects legacy npx migration after an executable has already been pinned', () => {
    const executable = '/trusted/already-materialized'
    const current = upsertInstallation(
      base({
        registryId: 'already-materialized-agent',
        distribution: 'npx',
        resolvedExecutable: executable,
        packageSpec: '@example/agent@1.0.0',
        payloadDigest: 'payload',
        launchSpec: {
          distribution: 'npx',
          runnerArgs: [],
          packageSpec: '@example/agent@1.0.0',
          executable,
          agentArgs: [],
          env: {},
        },
      }),
    )

    assert.throws(
      () => migrateLegacyNpxInstallation(current.installationId, { ...current }),
      /ACP_INSTALL_DIGEST_MISMATCH/,
    )
  })
})
