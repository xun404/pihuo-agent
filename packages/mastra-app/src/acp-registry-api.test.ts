import assert from 'node:assert/strict'
import { describe, it, before, after } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import {
  findInstallationById,
  getSharedStore,
  loadAcpAgentInstallationIndex,
  saveAcpRegistryCatalogStore,
  saveAcpAgentInstallationIndex,
  setTestMasterKey,
  setWorkerSecret,
  resetSharedStoreForTests,
  removeWorkerReference,
} from '@swarmdesk-agent/core'
import type {
  AcpRegistryCatalogSnapshot,
  WorkerReadiness,
  WorkerRegistration,
} from '@swarmdesk-agent/shared'
import {
  AcpSessionManager,
  AcpInstallError,
  computeExecutionFingerprint,
  digestOfAgentEntry,
  type CapabilityProbeResult,
  type SpawnedAcpLogoutResult,
  type SpawnedAcpSetupInput,
} from '@swarmdesk-agent/adapters'
import {
  apiAdoptRegistryManagement,
  apiAuthenticateWorker,
  apiCheckRegistryUpdate,
  apiGetRegistryCatalog,
  apiGetWorkerAuthMethods,
  apiLogoutWorker,
  apiPrepareRegistry,
  apiProbeWorker,
  apiRegisterRegistry,
  apiUpgradeRegistryWorker,
  apiWorkerReadinessStatus,
  workerFingerprintExtras,
  apiDeleteWorker,
  apiListCleanupCandidates,
  apiMarkInstallationRemoved,
  apiSetWorkerSecret,
  apiListWorkerSecretStatus,
  registryApiPublicError,
  registryCatalogApiPublicError,
  RegistryApiError,
} from './acp-registry-api.js'
import { prepareRegistryWorker, RegistryRegistrationError } from './acp-worker-registration.js'
import {
  createTerminalAuthAttempt,
  materializeTerminalAuthCommand,
  recordTerminalAuthProbeMethods,
  resetTerminalAuthAttemptsForTests,
  setPtyFeatureReadyForTests,
} from './acp-auth-terminal.js'

const FAKE_NPM = fileURLToPath(
  new URL('../../adapters/src/fixtures/fake-npm-installer.ts', import.meta.url),
)
const FAKE_PACKAGE_INSTALLER = {
  command: process.execPath,
  argsPrefix: ['--import', fileURLToPath(import.meta.resolve('tsx')), FAKE_NPM],
}

describe('acp-registry-api', () => {
  let dir: string
  const prevData = process.env.SWARMDESK_AGENT_DATA_DIR
  const prevCat = process.env.ACP_REGISTRY_CATALOG_PATH
  const prevInst = process.env.ACP_AGENT_INSTALLATIONS_PATH

  const rawAgent = {
    id: 'api-agent',
    name: 'API Agent',
    version: '1.0.0',
    description: 'api test',
    icon: 'https://example.com/i.svg',
    distribution: {
      npx: { package: '@example/api-agent@1.0.0', args: ['--acp'] },
    },
  }
  const manifestDigest = digestOfAgentEntry(rawAgent)
  const rawAgentV2 = {
    ...rawAgent,
    version: '2.0.0',
    distribution: {
      npx: { package: '@example/api-agent@2.0.0', args: ['--acp-v2'] },
    },
  }
  const manifestDigestV2 = digestOfAgentEntry(rawAgentV2)

  async function seedInstallation(input: { version?: string; digest?: string }) {
    const version = input.version ?? '1.0.0'
    const digest = input.digest ?? manifestDigest
    return prepareRegistryWorker({
      body: {
        registryId: 'api-agent',
        version,
        distribution: 'npx',
        manifestDigest: digest,
      },
      runnerEnv: process.env,
      packageInstaller: FAKE_PACKAGE_INSTALLER,
    })
  }

  function resetInstallations(): void {
    saveAcpAgentInstallationIndex({ version: 1, installations: [] })
  }

  async function registerSeededWorker(input: {
    installationId: string
    version?: string
    digest?: string
    name?: string
  }): Promise<WorkerRegistration> {
    const version = input.version ?? '1.0.0'
    const digest = input.digest ?? manifestDigest
    const prepared = await seedInstallation({ version, digest })
    return (
      await apiRegisterRegistry({
        registryId: 'api-agent',
        version,
        distribution: 'npx',
        manifestDigest: digest,
        installationId: prepared.installation.installationId,
        name: input.name,
      })
    ).worker
  }

  function probeResult(
    readiness: WorkerReadiness,
    overrides: Partial<CapabilityProbeResult> = {},
  ): CapabilityProbeResult {
    return {
      readiness,
      authMethods: [],
      capabilitySummary: { probedAt: readiness.checkedAt ?? '2026-07-17T00:00:01.000Z' },
      ...overrides,
    }
  }

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'acp-api-'))
    process.env.SWARMDESK_AGENT_DATA_DIR = dir
    process.env.ACP_REGISTRY_CATALOG_PATH = join(dir, 'acp-registry.json')
    process.env.ACP_AGENT_INSTALLATIONS_PATH = join(dir, 'installs.json')
    delete process.env.SWARMDESK_AGENT_SECRETS_PARENT_INJECTED
    setTestMasterKey(randomBytes(32))
    resetSharedStoreForTests()
    const snapshot: AcpRegistryCatalogSnapshot = {
      schemaVersion: '1.0.0',
      version: '1.0.0',
      source: 'persisted',
      digest: 'sha256:catalog',
      agents: [
        {
          id: 'api-agent',
          name: 'API Agent',
          version: '1.0.0',
          description: 'api test',
          icon: 'https://example.com/i.svg',
          distributions: [
            {
              kind: 'npx',
              package: '@example/api-agent@1.0.0',
              args: ['--acp'],
              env: {},
            },
          ],
          manifestDigest,
          availability: 'available',
        },
        {
          id: 'api-agent',
          name: 'API Agent',
          version: '2.0.0',
          description: 'api test v2',
          icon: 'https://example.com/i.svg',
          distributions: [
            {
              kind: 'npx',
              package: '@example/api-agent@2.0.0',
              args: ['--acp-v2'],
              env: {},
            },
          ],
          manifestDigest: manifestDigestV2,
          availability: 'available',
        },
      ],
    }
    saveAcpRegistryCatalogStore({
      schemaVersion: '1.0.0',
      digest: 'sha256:catalog',
      snapshot,
    })
  })

  after(() => {
    setTestMasterKey(null)
    resetSharedStoreForTests()
    if (prevData === undefined) delete process.env.SWARMDESK_AGENT_DATA_DIR
    else process.env.SWARMDESK_AGENT_DATA_DIR = prevData
    if (prevCat === undefined) delete process.env.ACP_REGISTRY_CATALOG_PATH
    else process.env.ACP_REGISTRY_CATALOG_PATH = prevCat
    if (prevInst === undefined) delete process.env.ACP_AGENT_INSTALLATIONS_PATH
    else process.env.ACP_AGENT_INSTALLATIONS_PATH = prevInst
    rmSync(dir, { recursive: true, force: true })
  })

  it('prepare + register + readiness + secrets without leaking values', async () => {
    const prepared = await apiPrepareRegistry(
      {
        registryId: 'api-agent',
        version: '1.0.0',
        distribution: 'npx',
        manifestDigest,
      },
      { packageInstaller: FAKE_PACKAGE_INSTALLER },
    )
    assert.ok(prepared.installationId)

    const registered = await apiRegisterRegistry({
      registryId: 'api-agent',
      version: '1.0.0',
      distribution: 'npx',
      manifestDigest,
      installationId: prepared.installationId,
    })
    const workerId = registered.worker.id
    assert.equal(registered.worker.readiness?.status, 'prepared')
    assert.equal(registered.worker.defaultRoleType, 'general')
    assert.equal('defaultRole' in registered.worker, false)

    const status = apiWorkerReadinessStatus(workerId)
    assert.equal(status.dispatchable, false)
    assert.ok(status.gate.ok === false)

    const sec = apiSetWorkerSecret({
      workerId,
      envName: 'OPENAI_API_KEY',
      value: 'sk-secret-value',
    })
    assert.deepEqual(sec.configuredKeys, ['OPENAI_API_KEY'])
    assert.ok(!JSON.stringify(sec).includes('sk-secret'))
    assert.ok((sec.authRevision ?? 0) >= 1)

    const listed = apiListWorkerSecretStatus(workerId)
    assert.deepEqual(listed.configuredKeys, ['OPENAI_API_KEY'])
    assert.ok(!JSON.stringify(listed).includes('sk-secret'))

    for (const invalid of [
      { envName: '../TOKEN', value: 'secret' },
      { envName: 'TOKEN', value: `bad\0secret` },
      { envName: 'TOKEN', value: 'x'.repeat(64 * 1024 + 1) },
    ]) {
      assert.throws(
        () => apiSetWorkerSecret({ workerId, ...invalid }),
        (error: unknown) =>
          error instanceof RegistryApiError &&
          error.code === 'ACP_REGISTRY_ENTRY_INVALID' &&
          error.httpStatus === 400,
      )
    }

    const del = apiDeleteWorker({ workerId })
    assert.equal(del.workerId, workerId)
  })

  it('blocks automatic and manual cleanup while a live or persisted Session references installation', async () => {
    resetInstallations()
    const prepared = await seedInstallation({})
    const registered = await apiRegisterRegistry({
      registryId: 'api-agent',
      version: '1.0.0',
      distribution: 'npx',
      manifestDigest,
      installationId: prepared.installation.installationId,
    })
    const referencedManager = {
      listInstallationReferences: () => ({
        installationIds: [prepared.installation.installationId],
        legacyWorkerIds: [],
      }),
      deleteContextByWorker: () => {},
    }
    removeWorkerReference(prepared.installation.installationId, registered.worker.id)

    const candidates = apiListCleanupCandidates({ manager: referencedManager })
    assert.equal(
      candidates.installations.some(
        (item) => item.installationId === prepared.installation.installationId,
      ),
      false,
    )
    assert.throws(
      () =>
        apiMarkInstallationRemoved(prepared.installation.installationId, {
          manager: referencedManager,
        }),
      (error: unknown) =>
        error instanceof RegistryApiError &&
        error.code === 'ACP_INSTALL_FAILED' &&
        error.httpStatus === 409,
    )

    const deleted = apiDeleteWorker(
      {
        workerId: registered.worker.id,
        removeUnreferencedInstallation: true,
      },
      { manager: referencedManager },
    )
    assert.equal(deleted.installationMarkedRemoved, false)
    assert.equal(deleted.installationRetained, true)
    assert.notEqual(findInstallationById(prepared.installation.installationId)?.status, 'removed')
  })

  it('rejects Worker deletion before lifecycle mutations while an active Chat role references it', async () => {
    resetInstallations()
    const worker = await registerSeededWorker({ installationId: 'inst-role-reference' })
    getSharedStore().setWorkerEnabled(worker.id, false)
    const project = getSharedStore().upsertProject({
      name: 'Role reference',
      rootPath: join(dir, 'role-reference-project'),
    })
    const session = getSharedStore().createSession({
      projectId: project.id,
      title: 'Role reference chat',
    })
    getSharedStore().setWorkerEnabled(worker.id, true)
    const role = getSharedStore().createTeamMember({
      chatSessionId: session.id,
      workerId: worker.id,
      name: 'Implementer',
      roleType: 'coder',
      instructions: 'Implement the task.',
    })

    // Soft-delete: a Worker referenced by an active Team member is deletable. The member is
    // auto-archived (no dangling dispatch reference) and the count is returned.
    const softDeleted = apiDeleteWorker({ workerId: worker.id })
    assert.equal(softDeleted.archivedTeamMembers, 1)
    // The member is now archived.
    assert.ok(getSharedStore().getTeamMember(session.id, role.id)?.archivedAt)
    // The Worker is gone.
    assert.equal(
      getSharedStore()
        .listWorkers()
        .find((item) => item.id === worker.id),
      undefined,
    )
  })

  it('still blocks deletion when the Worker has open jobs (WORKER_HAS_OPEN_JOBS)', async () => {
    resetInstallations()
    const prepared = await seedInstallation({})
    const registered = await apiRegisterRegistry({
      registryId: 'api-agent',
      version: '1.0.0',
      distribution: 'npx',
      manifestDigest,
      installationId: prepared.installation.installationId,
      name: 'Open Job Worker',
    })
    const worker = registered.worker
    const dir = prepared.installation.installDir
    const project = getSharedStore().upsertProject({
      name: 'open-job-project',
      rootPath: join(dir, 'open-job-project'),
    })
    const session = getSharedStore().createSession({
      projectId: project.id,
      title: 'Open job chat',
    })
    getSharedStore().setWorkerEnabled(worker.id, true)
    const openJob = getSharedStore().createJob({
      id: 'job-open-blocks-delete',
      sessionId: session.id,
      projectId: project.id,
      workerId: worker.id,
      workerName: worker.name,
      role: 'coder',
      task: 'Still running',
      cwd: project.rootPath,
      status: 'queued',
      approvalPolicy: 'manual',
      createdAt: new Date().toISOString(),
      source: 'api',
    })
    assert.throws(
      () => apiDeleteWorker({ workerId: worker.id }),
      (error: unknown) =>
        error instanceof RegistryApiError &&
        error.code === 'WORKER_HAS_OPEN_JOBS' &&
        error.httpStatus === 409,
    )
    // Finish the job → deletion now succeeds.
    getSharedStore().updateJob(openJob.id, {
      status: 'succeeded',
      finishedAt: new Date().toISOString(),
    })
    assert.equal(apiDeleteWorker({ workerId: worker.id }).workerId, worker.id)
  })

  it('maps legacy Session worker references to the current installation', async () => {
    resetInstallations()
    const prepared = await seedInstallation({})
    const registered = await apiRegisterRegistry({
      registryId: 'api-agent',
      version: '1.0.0',
      distribution: 'npx',
      manifestDigest,
      installationId: prepared.installation.installationId,
    })
    const legacyManager = {
      listInstallationReferences: () => ({
        installationIds: [],
        legacyWorkerIds: [registered.worker.id],
      }),
      deleteContextByWorker: () => {},
    }
    removeWorkerReference(prepared.installation.installationId, registered.worker.id)

    const candidates = apiListCleanupCandidates({ manager: legacyManager })
    assert.equal(
      candidates.installations.some(
        (item) => item.installationId === prepared.installation.installationId,
      ),
      false,
    )
    assert.throws(
      () =>
        apiMarkInstallationRemoved(prepared.installation.installationId, {
          manager: legacyManager,
        }),
      (error: unknown) => error instanceof RegistryApiError && error.httpStatus === 409,
    )
  })

  it('fails cleanup closed against every current Worker even when the reference index is stale', async () => {
    resetInstallations()
    const worker = await registerSeededWorker({ installationId: 'inst-current-worker-ref' })
    removeWorkerReference(worker.installationId!, worker.id)
    const manager = {
      listInstallationReferences: () => ({ installationIds: [], legacyWorkerIds: [] }),
      deleteContextByWorker: () => {},
    }

    const candidates = apiListCleanupCandidates({ manager })
    assert.equal(
      candidates.installations.some((item) => item.installationId === worker.installationId),
      false,
    )
    assert.throws(
      () => apiMarkInstallationRemoved(worker.installationId!, { manager }),
      (error: unknown) => error instanceof RegistryApiError && error.httpStatus === 409,
    )
  })

  it('keeps a non-dispatchable repair Worker and its installation reference when durable deletion fails', async () => {
    resetInstallations()
    const worker = await registerSeededWorker({ installationId: 'inst-durable-delete-failure' })
    const manager = {
      listInstallationReferences: () => ({ installationIds: [], legacyWorkerIds: [] }),
      deleteContextByWorker: () => {
        throw new Error('catalog_repair_required')
      },
    }

    await assert.rejects(
      Promise.resolve().then(() =>
        apiDeleteWorker(
          {
            workerId: worker.id,
            removeUnreferencedInstallation: true,
          },
          { manager },
        ),
      ),
      (error: unknown) => error instanceof RegistryApiError && error.code === 'ACP_INSTALL_FAILED',
    )
    const repair = getSharedStore()
      .listWorkers()
      .find((item) => item.id === worker.id)
    assert.equal(repair?.readiness?.status, 'failed')
    assert.equal(apiWorkerReadinessStatus(worker.id).dispatchable, false)
    assert.deepEqual(findInstallationById(worker.installationId!)?.workerIds, [worker.id])
  })

  it('fails API deletion closed for unavailable and unflushable catalogs with reuse disabled', async () => {
    const previousReuse = process.env.ACP_SESSION_REUSE
    process.env.ACP_SESSION_REUSE = '0'
    try {
      for (const mode of ['unavailable', 'unflushable'] as const) {
        resetInstallations()
        const worker = await registerSeededWorker({ installationId: `inst-reuse-zero-${mode}` })
        const port = {
          lookup: () => undefined,
          listAll: () => [],
          listByRouterSession: () => [],
          listByWorker: () => [],
          upsert: () => {},
          touch: () => {},
          markStale: () => {},
          deleteByKey: () => {},
          deleteByRouterSession: () => {},
          deleteByRouterSessions: () => {},
          deleteByWorker: () => {
            if (mode === 'unflushable') throw new Error('catalog flush failed')
          },
          isAvailable: () => mode !== 'unavailable',
        }
        const manager = new AcpSessionManager({
          catalogPort: port,
          catalogRequired: true,
        })
        const timer = (manager as any).idleTimer as ReturnType<typeof setInterval> | null
        if (timer) clearInterval(timer)

        assert.throws(
          () => apiDeleteWorker({ workerId: worker.id }, { manager }),
          (error: unknown) =>
            error instanceof RegistryApiError && error.code === 'ACP_INSTALL_FAILED',
        )
        const repair = getSharedStore()
          .listWorkers()
          .find((item) => item.id === worker.id)
        assert.equal(repair?.readiness?.status, 'failed')
        assert.deepEqual(findInstallationById(worker.installationId!)?.workerIds, [worker.id])

        getSharedStore().removeWorker(worker.id)
      }
    } finally {
      if (previousReuse === undefined) delete process.env.ACP_SESSION_REUSE
      else process.env.ACP_SESSION_REUSE = previousReuse
    }
  })

  it('does not detach the installation when the atomic Worker removal fails', async () => {
    resetInstallations()
    const worker = await registerSeededWorker({ installationId: 'inst-worker-delete-failure' })
    const sharedStore = getSharedStore()
    const originalCompareAndRemove = (sharedStore as any).compareAndRemoveWorker
    ;(sharedStore as any).compareAndRemoveWorker = () => {
      throw new Error('simulated Worker Store write failure')
    }
    try {
      await assert.rejects(
        Promise.resolve().then(() =>
          apiDeleteWorker(
            {
              workerId: worker.id,
              removeUnreferencedInstallation: true,
            },
            {
              manager: {
                listInstallationReferences: () => ({ installationIds: [], legacyWorkerIds: [] }),
                deleteContextByWorker: () => {},
              },
            },
          ),
        ),
      )
    } finally {
      ;(sharedStore as any).compareAndRemoveWorker = originalCompareAndRemove
    }

    const repair = sharedStore.listWorkers().find((item) => item.id === worker.id)
    assert.equal(repair?.readiness?.status, 'failed')
    assert.deepEqual(findInstallationById(worker.installationId!)?.workerIds, [worker.id])
  })

  it('restores a repair Worker when installation reference persistence fails after removal', async () => {
    resetInstallations()
    const worker = await registerSeededWorker({ installationId: 'inst-detach-failure' })
    const failingDetach = () => {
      throw new Error('installation reference write failed')
    }

    await assert.rejects(
      Promise.resolve().then(() =>
        apiDeleteWorker({ workerId: worker.id }, {
          manager: {
            listInstallationReferences: () => ({ installationIds: [], legacyWorkerIds: [] }),
            deleteContextByWorker: () => {},
          },
          detachWorker: failingDetach,
        } as any),
      ),
      (error: unknown) => error instanceof RegistryApiError && error.code === 'ACP_INSTALL_FAILED',
    )
    const repair = getSharedStore()
      .listWorkers()
      .find((item) => item.id === worker.id)
    assert.equal(repair?.readiness?.status, 'failed')
    assert.equal(apiWorkerReadinessStatus(worker.id).dispatchable, false)

    removeWorkerReference(worker.installationId!, worker.id)
    const candidates = apiListCleanupCandidates({
      manager: {
        listInstallationReferences: () => ({ installationIds: [], legacyWorkerIds: [] }),
        deleteContextByWorker: () => {},
      },
    })
    assert.equal(
      candidates.installations.some((item) => item.installationId === worker.installationId),
      false,
    )
  })

  it('maps registration errors to public payload', () => {
    const p = registryApiPublicError(
      new RegistryRegistrationError('ACP_REGISTRY_ENTRY_INVALID', 'nope', 409),
    )
    assert.equal(p.status, 409)
    assert.equal(p.code, 'ACP_REGISTRY_ENTRY_INVALID')
  })

  it('uses stable code-mapped public text and redacts unknown internal paths', () => {
    assert.deepEqual(
      registryApiPublicError(new AcpInstallError('ACP_INSTALL_DIGEST_MISMATCH', 'digest conflict')),
      {
        error: 'Registry installation integrity check failed',
        code: 'ACP_INSTALL_DIGEST_MISMATCH',
        status: 409,
      },
    )
    const unknown = registryApiPublicError(new Error('ENOENT: /Users/private/agents/secret'))
    assert.equal(unknown.status, 500)
    assert.equal(unknown.code, 'ACP_INSTALL_FAILED')
    assert.equal(unknown.error.includes('/Users/private'), false)
  })

  it('bounds public Registry errors to known codes without reflecting private-looking input', () => {
    const arbitrary = registryApiPublicError(
      new RegistryApiError(
        'UNBOUNDED_INTERNAL_CODE',
        'failed at /Users/private/agents?token=secret',
        409,
      ),
    )
    assert.deepEqual(arbitrary, {
      error: 'Registry operation failed',
      code: 'ACP_INSTALL_FAILED',
      status: 500,
    })

    let missing: unknown
    try {
      apiWorkerReadinessStatus('/Users/private/worker?token=secret')
    } catch (error) {
      missing = error
    }
    const missingPublic = registryApiPublicError(missing)
    assert.equal(missingPublic.code, 'WORKER_NOT_READY')
    assert.equal(missingPublic.error.includes('/Users/private'), false)
    assert.equal(missingPublic.error.includes('token=secret'), false)

    for (const privateMessage of [
      'failed at /Users/private/catalog.json',
      'failed at /opt/router/registry.json',
      'failed at /root/router/registry.json',
      'failed at /etc/router/registry.json',
      'failed at /app/router/registry.json',
      String.raw`failed at \\server\share\registry.json`,
      'failed at file:///srv/router/registry.json',
      'upstream?token=secret',
      'credential: super-secret',
      'password : super-secret',
      'secret => super-secret',
      'token super-secret',
      'bad\u0000control',
      `oversized-${'x'.repeat(1024)}`,
    ]) {
      const catalogPublic = registryCatalogApiPublicError(new Error(privateMessage))
      assert.equal(catalogPublic.code, 'ACP_REGISTRY_UNAVAILABLE')
      assert.equal(catalogPublic.status, 502)
      assert.equal(catalogPublic.error.includes(privateMessage), false)
      assert.ok(Buffer.byteLength(catalogPublic.error, 'utf8') <= 512)
      assert.equal(/[\u0000-\u001f\u007f-\u009f]/u.test(catalogPublic.error), false)
    }
    assert.deepEqual(registryCatalogApiPublicError(new Error('ordinary arbitrary cause')), {
      error: 'Registry catalog is unavailable',
      code: 'ACP_REGISTRY_UNAVAILABLE',
      status: 502,
    })
  })

  it('keeps manual catalog update failures bounded and retains a usable catalog', async () => {
    const privateMessage = `failed at /Users/private/catalog?token=secret-${'x'.repeat(700)}`
    const result = await apiCheckRegistryUpdate({
      fetchImpl: async () => {
        throw new Error(privateMessage)
      },
    })
    const publicBody = JSON.stringify(result)
    assert.equal(result.updateStatus, 'failed')
    assert.ok(result.agents.length > 0)
    assert.equal(publicBody.includes('/Users/private'), false)
    assert.equal(publicBody.includes('token=secret'), false)
    assert.equal(publicBody.includes('x'.repeat(700)), false)
    assert.ok(Buffer.byteLength(result.message ?? '', 'utf8') <= 512)
  })

  it('probes the exact immutable launch with the scoped secret snapshot and promotes only ready', async () => {
    resetInstallations()
    const worker = await registerSeededWorker({ installationId: 'inst-probe-ready' })
    setWorkerSecret(worker.id, 'AGENT_API_KEY', 'worker-only-secret')
    process.env.SWARMDESK_AGENT_INTERNAL_TOKEN = 'must-never-forward'
    process.env.OPENAI_API_KEY = 'leader-secret'

    let captured: SpawnedAcpSetupInput | undefined
    const result = await apiProbeWorker(worker.id, {
      terminalAuthReady: () => true,
      probeSpawnedAgent: async (input) => {
        captured = input
        const during = getSharedStore()
          .listWorkers()
          .find((w) => w.id === worker.id)
        assert.equal(during?.readiness?.status, 'initializing')
        return probeResult(
          {
            status: 'ready',
            code: 'SESSION_READY',
            message: 'ready',
            checkedAt: '2026-07-17T00:00:02.000Z',
            nextAction: 'none',
          },
          {
            authMethods: [
              {
                id: 'env',
                name: 'Environment',
                type: 'env_var',
                envVarNames: ['AGENT_API_KEY'],
                link: 'https://example.com/private-link?token=nope',
              },
              {
                id: 'terminal',
                type: 'terminal',
                terminalArgs: ['--token', 'private-terminal-value'],
                terminalEnvKeys: ['LANG'],
                terminalEnv: { LANG: 'secret-terminal-value' },
              },
            ],
            capabilitySummary: {
              protocolVersion: 1,
              authLogout: true,
              probedAt: '2026-07-17T00:00:02.000Z',
            },
          },
        )
      },
    })

    assert.equal(captured?.command, worker.command)
    assert.deepEqual(captured?.args, worker.args)
    const preparedInstallation = findInstallationById(worker.installationId!)
    assert.equal(captured?.command, preparedInstallation?.launchSpec?.interpreter)
    assert.deepEqual(captured?.args, [preparedInstallation?.resolvedExecutable, '--acp'])
    assert.equal(captured?.cwd, findInstallationById(worker.installationId!)?.installDir)
    assert.equal(captured?.terminalAuthReady, true)
    assert.equal(captured?.env.AGENT_API_KEY, 'worker-only-secret')
    assert.equal(captured?.env.SWARMDESK_AGENT_INTERNAL_TOKEN, undefined)
    assert.equal(captured?.env.OPENAI_API_KEY, undefined)
    assert.equal(result.worker.readiness?.status, 'ready')

    const installation = findInstallationById(worker.installationId!)
    assert.equal(installation?.status, 'installed')
    assert.equal(installation?.probeCode, 'SESSION_READY')
    assert.equal(installation?.lastProbedAt, '2026-07-17T00:00:02.000Z')

    const methods = apiGetWorkerAuthMethods(worker.id)
    assert.deepEqual(methods.methods, [
      {
        id: 'env',
        name: 'Environment',
        type: 'env_var',
        envVarNames: ['AGENT_API_KEY'],
      },
      {
        id: 'terminal',
        type: 'terminal',
        terminalEnvNames: ['LANG'],
      },
    ])

    const privateTerminalLaunch = materializeTerminalAuthCommand({
      worker: result.worker,
      methodId: 'terminal',
    })
    assert.equal(privateTerminalLaunch.command, captured?.command)
    assert.deepEqual(privateTerminalLaunch.args.slice(-2), ['--token', 'private-terminal-value'])
    assert.equal(JSON.stringify(methods).includes('private-terminal-value'), false)
    const publicBody = JSON.stringify({
      result,
      methods,
      status: apiWorkerReadinessStatus(worker.id),
    })
    assert.equal(publicBody.includes('worker-only-secret'), false)
    assert.equal(publicBody.includes('private-terminal-value'), false)
    assert.equal(publicBody.includes('secret-terminal-value'), false)
    assert.equal(publicBody.includes('private-link'), false)
  })

  it('self-heals a referenced legacy npx marker before probing', async () => {
    resetInstallations()
    const worker = await registerSeededWorker({ installationId: 'inst-legacy-self-heal' })
    const index = loadAcpAgentInstallationIndex()
    const record = index.installations.find(
      (item) => item.installationId === worker.installationId,
    )!
    const legacyLaunch = { ...record.launchSpec! }
    delete legacyLaunch.executable
    delete legacyLaunch.interpreter
    record.resolvedExecutable = undefined
    record.payloadDigest = 'legacy-marker-payload'
    record.launchSpec = legacyLaunch
    saveAcpAgentInstallationIndex(index)
    getSharedStore().upsertWorker({
      ...worker,
      command: record.runnerCommand!,
      args: [...legacyLaunch.runnerArgs, legacyLaunch.packageSpec!, ...legacyLaunch.agentArgs],
      launchSpec: legacyLaunch,
    })

    let captured: SpawnedAcpSetupInput | undefined
    const result = await apiProbeWorker(worker.id, {
      prepareRegistryWorker: (input) =>
        prepareRegistryWorker({ ...input, packageInstaller: FAKE_PACKAGE_INSTALLER }),
      probeSpawnedAgent: async (input) => {
        captured = input
        return probeResult({
          status: 'ready',
          code: 'SESSION_READY',
          message: 'ready',
          checkedAt: '2026-07-17T00:00:05.000Z',
          nextAction: 'none',
        })
      },
    })

    const migrated = findInstallationById(worker.installationId!)!
    assert.equal(captured?.command, migrated.launchSpec?.interpreter)
    assert.deepEqual(captured?.args, [migrated.resolvedExecutable, '--acp'])
    assert.equal(result.worker.command, migrated.launchSpec?.interpreter)
    assert.equal(
      getSharedStore()
        .listWorkers()
        .find((item) => item.id === worker.id)?.command,
      migrated.launchSpec?.interpreter,
    )
    assert.deepEqual(migrated.workerIds, [worker.id])
  })

  it('persists auth-required probe diagnostics without marking the installation installed', async () => {
    resetInstallations()
    const worker = await registerSeededWorker({ installationId: 'inst-probe-auth' })
    const result = await apiProbeWorker(worker.id, {
      probeSpawnedAgent: async () =>
        probeResult(
          {
            status: 'auth_required',
            code: 'WORKER_AUTH_REQUIRED',
            message: 'authentication required',
            checkedAt: '2026-07-17T00:00:03.000Z',
            nextAction: 'authenticate',
          },
          {
            authMethods: [{ id: 'oauth', name: 'OAuth', type: 'agent' }],
          },
        ),
    })

    assert.equal(result.worker.readiness?.code, 'WORKER_AUTH_REQUIRED')
    assert.notEqual(findInstallationById(worker.installationId!)?.status, 'installed')
    assert.equal(findInstallationById(worker.installationId!)?.probeCode, 'WORKER_AUTH_REQUIRED')
  })

  it('does not let a delayed probe resurrect a Worker deleted while the probe was running', async () => {
    resetInstallations()
    const worker = await registerSeededWorker({ installationId: 'inst-delayed-probe-delete' })
    let releaseProbe!: () => void
    let markProbeStarted!: () => void
    const probeStarted = new Promise<void>((resolve) => {
      markProbeStarted = resolve
    })
    const release = new Promise<void>((resolve) => {
      releaseProbe = resolve
    })
    const pending = apiProbeWorker(worker.id, {
      probeSpawnedAgent: async () => {
        markProbeStarted()
        await release
        return probeResult({
          status: 'ready',
          code: 'SESSION_READY',
          checkedAt: '2026-07-17T00:00:03.500Z',
          nextAction: 'none',
        })
      },
    })

    await probeStarted
    apiDeleteWorker(
      { workerId: worker.id },
      {
        manager: {
          listInstallationReferences: () => ({ installationIds: [], legacyWorkerIds: [] }),
          deleteContextByWorker: () => {},
        },
      },
    )
    releaseProbe()
    const outcome = await pending.then(
      () => ({ status: 'fulfilled' as const }),
      (error: unknown) => ({ status: 'rejected' as const, error }),
    )
    const resurrected = getSharedStore()
      .listWorkers()
      .find((item) => item.id === worker.id)
    if (resurrected) getSharedStore().removeWorker(worker.id)

    assert.equal(outcome.status, 'rejected')
    assert.equal(resurrected, undefined)
  })

  it('authenticates only an advertised agent method in one spawned setup and reconciles on ready', async () => {
    resetInstallations()
    const worker = await registerSeededWorker({ installationId: 'inst-authenticate' })
    getSharedStore().upsertWorker({
      ...worker,
      readiness: { status: 'auth_required', code: 'WORKER_AUTH_REQUIRED' },
      capabilitySummary: {
        authMethods: [
          { id: 'oauth', name: 'OAuth', type: 'agent' },
          { id: 'env', name: 'Environment', type: 'env_var', envVarNames: ['AGENT_API_KEY'] },
        ],
      },
    })
    let invalidCalled = false
    await assert.rejects(
      apiAuthenticateWorker(
        { workerId: worker.id, methodId: 'env' },
        {
          probeSpawnedAgent: async () => {
            invalidCalled = true
            return probeResult({ status: 'ready' })
          },
        },
      ),
      (error: unknown) =>
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'WORKER_AUTH_FAILED',
    )
    assert.equal(invalidCalled, false)

    const reconciled: string[] = []
    const authenticated = await apiAuthenticateWorker(
      { workerId: worker.id, methodId: 'oauth' },
      {
        manager: { deleteContextByWorker: (id) => reconciled.push(`manager:${id}`) },
        catalogStore: { deleteWorker: (id) => reconciled.push(`catalog:${id}`) },
        probeSpawnedAgent: async (input) => {
          assert.equal(input.authenticateMethodId, 'oauth')
          const during = getSharedStore()
            .listWorkers()
            .find((w) => w.id === worker.id)
          assert.equal(during?.readiness?.status, 'authenticating')
          return probeResult(
            {
              status: 'ready',
              code: 'SESSION_READY',
              checkedAt: '2026-07-17T00:00:04.000Z',
              nextAction: 'none',
            },
            {
              authMethods: [{ id: 'oauth', name: 'OAuth', type: 'agent' }],
            },
          )
        },
      },
    )

    assert.equal(authenticated.worker.readiness?.status, 'ready')
    assert.equal(authenticated.worker.authRevision, 1)
    assert.deepEqual(reconciled, [`manager:${worker.id}`])
    assert.equal(findInstallationById(worker.installationId!)?.status, 'installed')
  })

  it('rejects an auth operation whose post-auth probe is still non-dispatchable', async () => {
    resetInstallations()
    const worker = await registerSeededWorker({ installationId: 'inst-authenticate-failed' })
    getSharedStore().upsertWorker({
      ...worker,
      readiness: { status: 'auth_required', code: 'WORKER_AUTH_REQUIRED' },
      capabilitySummary: {
        authMethods: [{ id: 'oauth', name: 'OAuth', type: 'agent' }],
      },
    })

    await assert.rejects(
      apiAuthenticateWorker(
        { workerId: worker.id, methodId: 'oauth' },
        {
          probeSpawnedAgent: async () =>
            probeResult(
              {
                status: 'auth_required',
                code: 'WORKER_AUTH_FAILED',
                message: 'Authentication did not complete',
                nextAction: 'authenticate',
                checkedAt: '2026-07-17T00:00:04.500Z',
              },
              {
                authMethods: [{ id: 'oauth', name: 'OAuth', type: 'agent' }],
              },
            ),
        },
      ),
      (error: unknown) => error instanceof RegistryApiError && error.code === 'WORKER_AUTH_FAILED',
    )
    assert.equal(
      getSharedStore()
        .listWorkers()
        .find((item) => item.id === worker.id)?.readiness?.status,
      'auth_required',
    )
  })

  it('restores the prior actionable readiness synchronously when authentication is cancelled', async () => {
    resetInstallations()
    const worker = await registerSeededWorker({ installationId: 'inst-authenticate-cancelled' })
    const before = getSharedStore().upsertWorker({
      ...worker,
      readiness: { status: 'auth_required', code: 'WORKER_AUTH_REQUIRED' },
      capabilitySummary: {
        authMethods: [{ id: 'oauth', name: 'OAuth', type: 'agent' }],
      },
    })
    const controller = new AbortController()
    let release!: () => void
    let started!: () => void
    const probeStarted = new Promise<void>((resolve) => {
      started = resolve
    })
    const probeRelease = new Promise<void>((resolve) => {
      release = resolve
    })
    const pending = apiAuthenticateWorker(
      { workerId: worker.id, methodId: 'oauth' },
      {
        signal: controller.signal,
        probeSpawnedAgent: async () => {
          started()
          await probeRelease
          return probeResult({ status: 'failed', code: 'PROBE_ABORTED' })
        },
      },
    )
    await probeStarted

    controller.abort(new Error('cancelled'))
    assert.deepEqual(
      getSharedStore()
        .listWorkers()
        .find((item) => item.id === worker.id),
      before,
    )
    release()
    await assert.rejects(pending, /cancelled/u)
  })

  it('restores private terminal methods when agent authentication is cancelled', async () => {
    resetInstallations()
    resetTerminalAuthAttemptsForTests()
    setPtyFeatureReadyForTests(true)
    const worker = await registerSeededWorker({
      installationId: 'inst-authenticate-dual-cancelled',
    })
    const before = getSharedStore().upsertWorker({
      ...worker,
      readiness: { status: 'auth_required', code: 'WORKER_AUTH_REQUIRED' },
      capabilitySummary: {
        authMethods: [
          { id: 'oauth', name: 'OAuth', type: 'agent' },
          { id: 'terminal', name: 'Terminal', type: 'terminal' },
        ],
      },
    })
    recordTerminalAuthProbeMethods({
      worker: before,
      methods: [
        { id: 'oauth', name: 'OAuth', type: 'agent' },
        {
          id: 'terminal',
          name: 'Terminal',
          type: 'terminal',
          terminalArgs: ['login'],
        },
      ],
    })

    const controller = new AbortController()
    let release!: () => void
    let started!: () => void
    const probeStarted = new Promise<void>((resolve) => {
      started = resolve
    })
    const probeRelease = new Promise<void>((resolve) => {
      release = resolve
    })
    const pending = apiAuthenticateWorker(
      { workerId: worker.id, methodId: 'oauth' },
      {
        signal: controller.signal,
        probeSpawnedAgent: async () => {
          started()
          await probeRelease
          return probeResult({ status: 'failed', code: 'PROBE_ABORTED' })
        },
      },
    )
    await probeStarted

    try {
      controller.abort(new Error('cancelled'))
      const restored = getSharedStore()
        .listWorkers()
        .find((item) => item.id === worker.id)!
      const attempt = createTerminalAuthAttempt({
        workerId: worker.id,
        methodId: 'terminal',
        worker: restored,
        desktopToken: 'desktop-owner-token',
      })
      assert.ok(attempt.attemptId.startsWith('ta_'))
    } finally {
      release()
      await assert.rejects(pending, /cancelled/u)
      resetTerminalAuthAttemptsForTests()
      setPtyFeatureReadyForTests(null)
    }
  })

  it('changes auth revision only after a real successful logout', async () => {
    resetInstallations()
    const worker = await registerSeededWorker({ installationId: 'inst-logout' })
    const ready = getSharedStore().upsertWorker({
      ...worker,
      authRevision: 7,
      readiness: { status: 'ready', code: 'SESSION_READY' },
      capabilitySummary: { authLogout: true, authMethods: [] },
    })
    const before = structuredClone(ready)

    await assert.rejects(
      apiLogoutWorker(worker.id, {
        logoutSpawnedAgent: async (): Promise<SpawnedAcpLogoutResult> => ({
          ok: false,
          code: 'LOGOUT_FAILED',
          message: 'Agent logout failed',
          authMethods: [],
          capabilitySummary: { probedAt: '2026-07-17T00:00:05.000Z' },
        }),
      }),
      (error: unknown) =>
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'WORKER_AUTH_FAILED',
    )
    assert.deepEqual(
      getSharedStore()
        .listWorkers()
        .find((w) => w.id === worker.id),
      before,
    )

    const loggedOut = await apiLogoutWorker(worker.id, {
      logoutSpawnedAgent: async (): Promise<SpawnedAcpLogoutResult> => ({
        ok: true,
        code: 'LOGOUT_SUCCEEDED',
        message: 'Agent logout succeeded',
        authMethods: [],
        capabilitySummary: { authLogout: true, probedAt: '2026-07-17T00:00:06.000Z' },
      }),
    })
    assert.equal(loggedOut.worker.authRevision, 8)
    assert.equal(loggedOut.worker.readiness?.status, 'auth_required')
  })

  it('persists a non-dispatchable repair state when post-logout live cleanup fails', async () => {
    resetInstallations()
    const worker = await registerSeededWorker({ installationId: 'inst-logout-cleanup-failure' })
    getSharedStore().upsertWorker({
      ...worker,
      authRevision: 3,
      readiness: { status: 'ready', code: 'SESSION_READY' },
      capabilitySummary: { authLogout: true, authMethods: [] },
    })

    await assert.rejects(
      apiLogoutWorker(worker.id, {
        logoutSpawnedAgent: async () => ({
          ok: true,
          code: 'LOGOUT_SUCCEEDED',
          message: 'Agent logout succeeded',
          authMethods: [],
          capabilitySummary: { authLogout: true },
        }),
        manager: {
          deleteContextByWorker: () => {
            throw new Error('durable history must not be deleted')
          },
          invalidateWorker: () => {
            throw new Error('live cleanup failed')
          },
        },
        catalogStore: { deleteWorker: () => {} },
      } as any),
    )

    const repair = getSharedStore()
      .listWorkers()
      .find((item) => item.id === worker.id)
    assert.equal(repair?.readiness?.status, 'failed')
    assert.equal(repair?.readiness?.code, 'WORKER_AUTH_FAILED')
    assert.equal(repair?.authRevision, 4)
    assert.equal(apiWorkerReadinessStatus(worker.id).dispatchable, false)
  })

  it('persists a repair state before reporting a post-logout CAS conflict', async () => {
    resetInstallations()
    const worker = await registerSeededWorker({ installationId: 'inst-logout-cas-failure' })
    const ready = getSharedStore().upsertWorker({
      ...worker,
      authRevision: 5,
      readiness: { status: 'ready', code: 'SESSION_READY' },
      capabilitySummary: { authLogout: true, authMethods: [] },
    })
    let cleanupCalls = 0

    await assert.rejects(
      apiLogoutWorker(worker.id, {
        logoutSpawnedAgent: async () => {
          getSharedStore().upsertWorker({ ...ready, description: 'concurrent change' })
          return {
            ok: true,
            code: 'LOGOUT_SUCCEEDED',
            message: 'Agent logout succeeded',
            authMethods: [],
            capabilitySummary: { authLogout: true },
          }
        },
        manager: {
          deleteContextByWorker: () => {
            cleanupCalls += 100
          },
          invalidateWorker: () => {
            cleanupCalls += 1
          },
        },
        catalogStore: { deleteWorker: () => {} },
      } as any),
    )

    const repair = getSharedStore()
      .listWorkers()
      .find((item) => item.id === worker.id)
    assert.equal(repair?.description, 'concurrent change')
    assert.equal(repair?.readiness?.status, 'failed')
    assert.equal(repair?.authRevision, 6)
    assert.equal(cleanupCalls, 0)
  })

  it('does not let a stale logout overwrite a newer Registry upgrade', async () => {
    resetInstallations()
    const worker = await registerSeededWorker({ installationId: 'inst-stale-logout-old' })
    getSharedStore().upsertWorker({
      ...worker,
      readiness: { status: 'ready', code: 'SESSION_READY' },
      capabilitySummary: { authLogout: true, authMethods: [] },
    })
    const candidate = await seedInstallation({
      version: '2.0.0',
      digest: manifestDigestV2,
    })
    let releaseLogout!: () => void
    let markLogoutStarted!: () => void
    const logoutStarted = new Promise<void>((resolve) => {
      markLogoutStarted = resolve
    })
    const release = new Promise<void>((resolve) => {
      releaseLogout = resolve
    })
    const pendingLogout = apiLogoutWorker(worker.id, {
      logoutSpawnedAgent: async () => {
        markLogoutStarted()
        await release
        return {
          ok: true,
          code: 'LOGOUT_SUCCEEDED',
          message: 'Agent logout succeeded',
          authMethods: [],
          capabilitySummary: { authLogout: true, probedAt: '2026-07-17T00:00:06.500Z' },
        }
      },
      manager: { deleteContextByWorker: () => {} },
      catalogStore: { deleteWorker: () => {} },
    })

    await logoutStarted
    const upgraded = await apiUpgradeRegistryWorker(
      {
        workerId: worker.id,
        version: '2.0.0',
        distribution: 'npx',
        manifestDigest: manifestDigestV2,
      },
      {
        prepareRegistryWorker: async () => ({
          installation: candidate.installation,
          prepare: candidate.prepare,
        }),
        probeSpawnedAgent: async () =>
          probeResult({
            status: 'ready',
            code: 'SESSION_READY',
            checkedAt: '2026-07-17T00:00:06.750Z',
            nextAction: 'none',
          }),
        manager: { deleteContextByWorker: () => {}, invalidateWorker: () => {} },
        catalogStore: { deleteWorker: () => {} },
      },
    )
    releaseLogout()
    const logoutOutcome = await pendingLogout.then(
      () => ({ status: 'fulfilled' as const }),
      (error: unknown) => ({ status: 'rejected' as const, error }),
    )
    const current = getSharedStore()
      .listWorkers()
      .find((item) => item.id === worker.id)

    assert.equal(logoutOutcome.status, 'rejected')
    assert.equal(current?.installationId, upgraded.installationId)
    assert.equal(current?.source?.type, 'registry')
    if (current?.source?.type === 'registry') {
      assert.equal(current.source.registryVersion, '2.0.0')
    }
  })

  it('invalidates a delayed probe when a newer Registry upgrade switches the Worker', async () => {
    resetInstallations()
    const worker = await registerSeededWorker({ installationId: 'inst-stale-probe-old' })
    const candidate = await seedInstallation({
      version: '2.0.0',
      digest: manifestDigestV2,
    })
    let releaseProbe!: () => void
    let markProbeStarted!: () => void
    const probeStarted = new Promise<void>((resolve) => {
      markProbeStarted = resolve
    })
    const release = new Promise<void>((resolve) => {
      releaseProbe = resolve
    })
    const pendingProbe = apiProbeWorker(worker.id, {
      probeSpawnedAgent: async () => {
        markProbeStarted()
        await release
        return probeResult({
          status: 'ready',
          code: 'SESSION_READY',
          checkedAt: '2026-07-17T00:00:06.800Z',
          nextAction: 'none',
        })
      },
    })

    await probeStarted
    const upgraded = await apiUpgradeRegistryWorker(
      {
        workerId: worker.id,
        version: '2.0.0',
        distribution: 'npx',
        manifestDigest: manifestDigestV2,
      },
      {
        prepareRegistryWorker: async () => ({
          installation: candidate.installation,
          prepare: candidate.prepare,
        }),
        probeSpawnedAgent: async () =>
          probeResult({
            status: 'ready',
            code: 'SESSION_READY',
            checkedAt: '2026-07-17T00:00:06.900Z',
            nextAction: 'none',
          }),
        manager: { deleteContextByWorker: () => {}, invalidateWorker: () => {} },
        catalogStore: { deleteWorker: () => {} },
      },
    )
    releaseProbe()
    const probeOutcome = await pendingProbe.then(
      () => ({ status: 'fulfilled' as const }),
      (error: unknown) => ({ status: 'rejected' as const, error }),
    )
    const current = getSharedStore()
      .listWorkers()
      .find((item) => item.id === worker.id)

    assert.equal(probeOutcome.status, 'rejected')
    assert.equal(current?.installationId, upgraded.installationId)
    if (current?.source?.type === 'registry') {
      assert.equal(current.source.registryVersion, '2.0.0')
    } else {
      assert.fail('expected the newer Registry source to remain current')
    }
  })

  it('probes an upgrade candidate before switching and leaves an unreferenced cleanup candidate on failure', async () => {
    resetInstallations()
    const worker = await registerSeededWorker({ installationId: 'inst-upgrade-old' })
    const old = getSharedStore().upsertWorker({
      ...worker,
      readiness: { status: 'ready', code: 'SESSION_READY' },
    })
    const failedCandidate = await seedInstallation({
      version: '2.0.0',
      digest: manifestDigestV2,
    })

    await assert.rejects(
      apiUpgradeRegistryWorker(
        {
          workerId: worker.id,
          version: '2.0.0',
          distribution: 'npx',
          manifestDigest: manifestDigestV2,
        },
        {
          prepareRegistryWorker: async () => ({
            installation: failedCandidate.installation,
            prepare: failedCandidate.prepare,
          }),
          probeSpawnedAgent: async (input) => {
            assert.equal(input.command, failedCandidate.prepare.command)
            assert.equal(
              getSharedStore()
                .listWorkers()
                .find((w) => w.id === worker.id)?.command,
              old.command,
            )
            return probeResult({
              status: 'failed',
              code: 'INITIALIZE_FAILED',
              message: 'ACP initialization failed',
              checkedAt: '2026-07-17T00:00:07.000Z',
              nextAction: 'retry',
            })
          },
        },
      ),
      (error: unknown) =>
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'WORKER_NOT_READY',
    )

    assert.deepEqual(
      getSharedStore()
        .listWorkers()
        .find((w) => w.id === worker.id),
      old,
    )
    assert.deepEqual(findInstallationById(worker.installationId!)?.workerIds, [worker.id])
    assert.deepEqual(
      findInstallationById(failedCandidate.installation.installationId)?.workerIds,
      [],
    )
    assert.ok(
      loadAcpAgentInstallationIndex().installations.some(
        (installation) =>
          installation.installationId === failedCandidate.installation.installationId,
      ),
    )
  })

  it('commits one public Worker identity after a successful candidate probe and detaches the old reference', async () => {
    resetInstallations()
    const worker = await registerSeededWorker({ installationId: 'inst-upgrade-success-old' })
    const old = getSharedStore().upsertWorker({
      ...worker,
      name: 'Pinned Public Name',
      model: 'provider/model',
      readiness: { status: 'ready', code: 'SESSION_READY' },
    })
    const successfulCandidate = await seedInstallation({
      version: '2.0.0',
      digest: manifestDigestV2,
    })

    const oldFingerprint = computeExecutionFingerprint({
      command: old.command,
      args: old.args,
      env: old.env ?? {},
      model: old.model,
      workerKind: old.kind,
      ...workerFingerprintExtras(old),
    })
    const durableHistory = [{ executionFingerprint: oldFingerprint }]
    const calls: string[] = []
    const upgraded = await apiUpgradeRegistryWorker(
      {
        workerId: worker.id,
        version: '2.0.0',
        distribution: 'npx',
        manifestDigest: manifestDigestV2,
      },
      {
        prepareRegistryWorker: async () => ({
          installation: successfulCandidate.installation,
          prepare: successfulCandidate.prepare,
        }),
        probeSpawnedAgent: async () =>
          probeResult({
            status: 'ready',
            code: 'SESSION_READY',
            checkedAt: '2026-07-17T00:00:08.000Z',
            nextAction: 'none',
          }),
        manager: {
          deleteContextByWorker: () => {
            durableHistory.length = 0
            calls.push('delete-history')
          },
          invalidateWorker: (id: string) => calls.push(`invalidate-live:${id}`),
        },
        catalogStore: { deleteWorker: () => {} },
      } as any,
    )

    assert.equal(upgraded.worker.id, old.id)
    assert.equal(upgraded.worker.name, old.name)
    assert.deepEqual(upgraded.worker.roles, old.roles)
    assert.equal(upgraded.worker.model, old.model)
    assert.equal(upgraded.worker.enabled, old.enabled)
    assert.equal(upgraded.worker.command, successfulCandidate.prepare.command)
    assert.equal(upgraded.worker.readiness?.status, 'ready')
    assert.deepEqual(
      findInstallationById(successfulCandidate.installation.installationId)?.workerIds,
      [old.id],
    )
    assert.deepEqual(findInstallationById(worker.installationId!)?.workerIds, [])
    assert.deepEqual(durableHistory, [{ executionFingerprint: oldFingerprint }])
    const newFingerprint = computeExecutionFingerprint({
      command: upgraded.worker.command,
      args: upgraded.worker.args,
      env: upgraded.worker.env ?? {},
      model: upgraded.worker.model,
      workerKind: upgraded.worker.kind,
      ...workerFingerprintExtras(upgraded.worker),
    })
    assert.notEqual(newFingerprint, durableHistory[0]?.executionFingerprint)
    assert.deepEqual(calls, [`invalidate-live:${old.id}`])
  })

  it('rolls back a candidate switch when live resource reconciliation fails', async () => {
    resetInstallations()
    const worker = await registerSeededWorker({ installationId: 'inst-upgrade-reconcile-old' })
    const old = getSharedStore().upsertWorker({
      ...worker,
      readiness: { status: 'ready', code: 'SESSION_READY' },
    })
    const candidate = await seedInstallation({
      version: '2.0.0',
      digest: manifestDigestV2,
    })

    const outcome = await apiUpgradeRegistryWorker(
      {
        workerId: worker.id,
        version: '2.0.0',
        distribution: 'npx',
        manifestDigest: manifestDigestV2,
      },
      {
        prepareRegistryWorker: async () => ({
          installation: candidate.installation,
          prepare: candidate.prepare,
        }),
        probeSpawnedAgent: async () =>
          probeResult({
            status: 'ready',
            code: 'SESSION_READY',
            checkedAt: '2026-07-17T00:00:08.500Z',
            nextAction: 'none',
          }),
        manager: {
          deleteContextByWorker: () => {
            throw new Error('durable history must not be deleted')
          },
          invalidateWorker: () => {
            throw new Error('live cleanup failed')
          },
        },
        catalogStore: { deleteWorker: () => {} },
      },
    ).then(
      () => ({ status: 'fulfilled' as const }),
      (error: unknown) => ({ status: 'rejected' as const, error }),
    )

    const current = getSharedStore()
      .listWorkers()
      .find((item) => item.id === worker.id)
    if (current && current.installationId !== old.installationId) {
      getSharedStore().upsertWorker(old)
    }
    assert.equal(outcome.status, 'rejected')
    assert.deepEqual(current, old)
    assert.deepEqual(findInstallationById(old.installationId!)?.workerIds, [old.id])
    assert.deepEqual(findInstallationById(candidate.installation.installationId)?.workerIds, [])
  })

  it('rejects the older of two concurrent upgrades without overwriting the newer result', async () => {
    resetInstallations()
    const worker = await registerSeededWorker({ installationId: 'inst-two-upgrades-old' })
    const candidate = await seedInstallation({
      version: '2.0.0',
      digest: manifestDigestV2,
    })
    let releaseFirst!: () => void
    let markFirstStarted!: () => void
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve
    })
    const firstRelease = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const prepare = async () => ({
      installation: candidate.installation,
      prepare: candidate.prepare,
    })
    const noOpResources = {
      manager: { deleteContextByWorker: () => {}, invalidateWorker: () => {} },
      catalogStore: { deleteWorker: () => {} },
    }
    const first = apiUpgradeRegistryWorker(
      {
        workerId: worker.id,
        version: '2.0.0',
        distribution: 'npx',
        manifestDigest: manifestDigestV2,
      },
      {
        ...noOpResources,
        prepareRegistryWorker: prepare,
        probeSpawnedAgent: async () => {
          markFirstStarted()
          await firstRelease
          return probeResult({
            status: 'ready',
            code: 'SESSION_READY',
            message: 'older-result',
            checkedAt: '2026-07-17T00:00:08.600Z',
            nextAction: 'none',
          })
        },
      },
    )

    await firstStarted
    const second = await apiUpgradeRegistryWorker(
      {
        workerId: worker.id,
        version: '2.0.0',
        distribution: 'npx',
        manifestDigest: manifestDigestV2,
      },
      {
        ...noOpResources,
        prepareRegistryWorker: prepare,
        probeSpawnedAgent: async () =>
          probeResult({
            status: 'ready',
            code: 'SESSION_READY',
            message: 'newer-result',
            checkedAt: '2026-07-17T00:00:08.700Z',
            nextAction: 'none',
          }),
      },
    )
    releaseFirst()
    const firstOutcome = await first.then(
      () => ({ status: 'fulfilled' as const }),
      (error: unknown) => ({ status: 'rejected' as const, error }),
    )
    const current = getSharedStore()
      .listWorkers()
      .find((item) => item.id === worker.id)

    assert.equal(firstOutcome.status, 'rejected')
    assert.equal(current?.installationId, second.installationId)
    assert.equal(current?.readiness?.message, 'newer-result')
    assert.deepEqual(findInstallationById(candidate.installation.installationId)?.workerIds, [
      worker.id,
    ])
  })

  it('removes the candidate reference when the atomic Worker Store commit fails', async () => {
    resetInstallations()
    const worker = await registerSeededWorker({ installationId: 'inst-upgrade-store-failure-old' })
    const old = getSharedStore()
      .listWorkers()
      .find((item) => item.id === worker.id)!
    const candidate = await seedInstallation({
      version: '2.0.0',
      digest: manifestDigestV2,
    })
    const sharedStore = getSharedStore()
    const originalCompareAndSwap = sharedStore.compareAndSwapWorker
    ;(sharedStore as any).compareAndSwapWorker = function (
      expected: WorkerRegistration,
      replacement: WorkerRegistration,
    ) {
      if (replacement.installationId === candidate.installation.installationId) {
        throw new Error('simulated Worker Store write failure')
      }
      return originalCompareAndSwap.call(this, expected, replacement)
    }
    try {
      await assert.rejects(
        apiUpgradeRegistryWorker(
          {
            workerId: worker.id,
            version: '2.0.0',
            distribution: 'npx',
            manifestDigest: manifestDigestV2,
          },
          {
            prepareRegistryWorker: async () => ({
              installation: candidate.installation,
              prepare: candidate.prepare,
            }),
            probeSpawnedAgent: async () =>
              probeResult({
                status: 'ready',
                code: 'SESSION_READY',
                checkedAt: '2026-07-17T00:00:08.800Z',
                nextAction: 'none',
              }),
            manager: { deleteContextByWorker: () => {}, invalidateWorker: () => {} },
            catalogStore: { deleteWorker: () => {} },
          },
        ),
      )
    } finally {
      ;(sharedStore as any).compareAndSwapWorker = originalCompareAndSwap
    }

    assert.deepEqual(
      getSharedStore()
        .listWorkers()
        .find((item) => item.id === worker.id),
      old,
    )
    assert.deepEqual(findInstallationById(old.installationId!)?.workerIds, [worker.id])
    assert.deepEqual(findInstallationById(candidate.installation.installationId)?.workerIds, [])
  })

  it('adopts a custom Worker only after the Registry candidate is ready', async () => {
    resetInstallations()
    const custom: WorkerRegistration = {
      id: 'custom-adopt-worker',
      name: 'Keep Custom Name',
      kind: 'custom',
      command: '/custom/original',
      args: ['--original'],
      primaryRole: 'general',
      roles: ['general'],
      capabilities: ['general'],
      enabled: true,
      scope: 'global',
      description: 'custom',
      health: 'unknown',
      source: { type: 'custom' },
      model: 'provider/custom-model',
    }
    getSharedStore().upsertWorker(custom)
    const adoptCandidate = await seedInstallation({})

    const adopted = await apiAdoptRegistryManagement(
      {
        workerId: custom.id,
        registryId: 'api-agent',
        version: '1.0.0',
        distribution: 'npx',
        manifestDigest,
      },
      {
        prepareRegistryWorker: async () => ({
          installation: adoptCandidate.installation,
          prepare: adoptCandidate.prepare,
        }),
        probeSpawnedAgent: async () =>
          probeResult({
            status: 'ready',
            code: 'SESSION_READY',
            checkedAt: '2026-07-17T00:00:09.000Z',
            nextAction: 'none',
          }),
      },
    )

    assert.equal(adopted.worker.id, custom.id)
    assert.equal(adopted.worker.name, custom.name)
    assert.equal(adopted.worker.model, custom.model)
    assert.equal(adopted.worker.source?.type, 'registry')
    assert.equal(adopted.worker.command, adoptCandidate.prepare.command)
    assert.deepEqual(findInstallationById(adoptCandidate.installation.installationId)?.workerIds, [
      custom.id,
    ])
  })
})
