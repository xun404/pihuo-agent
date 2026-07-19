import assert from 'node:assert/strict'
import { describe, it, before, after } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  upsertInstallation,
  createInstallationId,
  findInstallationById,
  addWorkerReference,
} from '@swarmdesk-agent/core'
import {
  detachWorkerFromInstallation,
  listInstallationCleanupCandidates,
} from './acp-worker-detach.js'
import type { WorkerRegistration } from '@swarmdesk-agent/shared'

describe('detachWorkerFromInstallation', () => {
  let dir: string
  const prev = process.env.ACP_AGENT_INSTALLATIONS_PATH

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'acp-detach-'))
    process.env.ACP_AGENT_INSTALLATIONS_PATH = join(dir, 'installs.json')
  })

  after(() => {
    if (prev === undefined) delete process.env.ACP_AGENT_INSTALLATIONS_PATH
    else process.env.ACP_AGENT_INSTALLATIONS_PATH = prev
    rmSync(dir, { recursive: true, force: true })
  })

  it('does not mark installation removed while other workers reference it', () => {
    const installationId = createInstallationId()
    upsertInstallation({
      installationId,
      registryId: 'a',
      registryVersion: '1.0.0',
      distribution: 'npx',
      manifestDigest: 'sha256:x',
      installDir: join(dir, 'a'),
      status: 'installed',
      installedAt: new Date().toISOString(),
      workerIds: [],
    })
    addWorkerReference(installationId, 'worker_a')
    addWorkerReference(installationId, 'worker_b')

    const worker: WorkerRegistration = {
      id: 'worker_a',
      name: 'A',
      kind: 'custom',
      command: 'npx',
      args: [],
      primaryRole: 'general',
      roles: ['general'],
      capabilities: [],
      enabled: true,
      scope: 'global',
      description: '',
      health: 'unknown',
      installationId,
      source: {
        type: 'registry',
        registryId: 'a',
        registryVersion: '1.0.0',
        registrySchemaVersion: '1.0.0',
        manifestDigest: 'sha256:x',
        distribution: 'npx',
        installationId,
      },
    }

    const result = detachWorkerFromInstallation({
      worker,
      removeUnreferencedInstallation: true,
    })
    assert.equal(result.installationMarkedRemoved, false)
    assert.equal(result.installationRetained, true)
    const rec = findInstallationById(installationId)
    assert.ok(rec)
    assert.deepEqual(rec.workerIds, ['worker_b'])
    assert.equal(rec.status, 'installed')
  })

  it('can mark removed only when unreferenced and requested', () => {
    const installationId = createInstallationId()
    upsertInstallation({
      installationId,
      registryId: 'b',
      registryVersion: '1.0.0',
      distribution: 'npx',
      manifestDigest: 'sha256:y',
      installDir: join(dir, 'b'),
      status: 'installed',
      installedAt: new Date().toISOString(),
      workerIds: ['only'],
    })

    const worker: WorkerRegistration = {
      id: 'only',
      name: 'Only',
      kind: 'custom',
      command: 'npx',
      args: [],
      primaryRole: 'general',
      roles: ['general'],
      capabilities: [],
      enabled: true,
      scope: 'global',
      description: '',
      health: 'unknown',
      installationId,
    }

    const noDelete = detachWorkerFromInstallation({ worker })
    assert.equal(noDelete.installationMarkedRemoved, false)
    assert.equal(findInstallationById(installationId)?.status, 'installed')

    addWorkerReference(installationId, 'only')
    const deleted = detachWorkerFromInstallation({
      worker,
      removeUnreferencedInstallation: true,
    })
    assert.equal(deleted.installationMarkedRemoved, true)
    assert.equal(findInstallationById(installationId)?.status, 'removed')
  })

  it('retains an otherwise unreferenced installation while a Session references it', () => {
    const installationId = createInstallationId()
    upsertInstallation({
      installationId,
      registryId: 'session-ref',
      registryVersion: '1.0.0',
      distribution: 'npx',
      manifestDigest: 'sha256:session-ref',
      installDir: join(dir, 'session-ref'),
      status: 'installed',
      installedAt: new Date().toISOString(),
      workerIds: ['session-worker'],
    })
    const worker: WorkerRegistration = {
      id: 'session-worker',
      name: 'Session Worker',
      kind: 'custom',
      command: 'npx',
      args: [],
      primaryRole: 'general',
      roles: ['general'],
      capabilities: [],
      enabled: true,
      scope: 'global',
      description: '',
      health: 'unknown',
      installationId,
    }

    const retained = detachWorkerFromInstallation({
      worker,
      removeUnreferencedInstallation: true,
      referencedInstallationIds: new Set([installationId]),
    })

    assert.equal(retained.installationMarkedRemoved, false)
    assert.equal(retained.installationRetained, true)
    assert.equal(findInstallationById(installationId)?.status, 'installed')
    assert.deepEqual(findInstallationById(installationId)?.workerIds, [])
  })

  it('lists only unreferenced cleanup candidates', () => {
    const candidates = listInstallationCleanupCandidates()
    assert.ok(Array.isArray(candidates))
  })
})
