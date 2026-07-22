import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { WorkerRegistration } from '@swarmdesk-agent/shared'
import {
  computeExecutionFingerprint,
  getAcpSessionManager,
  resetAcpSessionManager,
  type SessionEntryConfig,
} from '@swarmdesk-agent/adapters'
import {
  getSharedStore,
  globalActivityLog,
  resetSharedStoreForTests,
  setTestMasterKey,
  setWorkerSecret,
} from '@swarmdesk-agent/core'
import * as schedulerModule from './scheduler.js'

test('scheduler boundary builder carries every Registry reuse discriminator without secrets', () => {
  const build = (schedulerModule as Record<string, unknown>).buildWorkerSessionBoundary
  assert.equal(typeof build, 'function')
  const worker: WorkerRegistration = {
    id: 'worker-registry',
    name: 'Registry worker',
    kind: 'custom',
    command: '/installed/agent',
    args: ['--acp'],
    env: { SAFE_SETTING: 'enabled' },
    primaryRole: 'coder',
    roles: ['coder'],
    capabilities: ['code-edit'],
    enabled: true,
    scope: 'global',
    description: '',
    health: 'healthy',
    source: {
      type: 'registry',
      registryId: 'agent.example',
      registryVersion: '1.2.3',
      registrySchemaVersion: '1',
      manifestDigest: 'sha256:manifest',
      distribution: 'binary',
      installationId: 'inst_source',
    },
    installationId: 'inst_worker',
    runtimeProfile: 'generic-acp',
    authRevision: 9,
  }
  const boundary = (
    build as (
      worker: WorkerRegistration,
      eligibilityRevision: string,
      workerSecretRevisionHmac: string,
    ) => Record<string, unknown>
  )(worker, 'eligibility-v4', 'secret-revision-hmac')

  assert.deepEqual(boundary, {
    workerKind: 'custom',
    eligibilityRevision: 'eligibility-v4',
    installationId: 'inst_worker',
    manifestDigest: 'sha256:manifest',
    runtimeProfile: 'generic-acp',
    authRevision: 9,
    workerSecretRevisionHmac: 'secret-revision-hmac',
  })
  assert.equal(JSON.stringify(boundary).includes('AGENT_API_KEY'), false)
  assert.equal(JSON.stringify(boundary).includes('secret-value'), false)
})

test('scheduler boundary builder preserves legacy workers with absent Registry fields', () => {
  const build = (schedulerModule as Record<string, unknown>).buildWorkerSessionBoundary as (
    worker: WorkerRegistration,
    eligibilityRevision: string,
    workerSecretRevisionHmac?: string,
  ) => Record<string, unknown>
  assert.equal(typeof build, 'function')
  const worker: WorkerRegistration = {
    id: 'legacy',
    name: 'Legacy',
    kind: 'codex',
    command: 'codex-acp',
    args: [],
    primaryRole: 'coder',
    roles: ['coder'],
    capabilities: ['code-edit'],
    enabled: true,
    scope: 'global',
    description: '',
    health: 'healthy',
  }
  assert.deepEqual(build(worker, 'legacy-eligibility'), {
    workerKind: 'codex',
    eligibilityRevision: 'legacy-eligibility',
  })
})

test('runJob passes only the selected Worker secret through the singleton Manager spawn field', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'scheduler-worker-secret-'))
  const previousState = process.env.SWARMDESK_AGENT_AGENTS_STATE
  const previousData = process.env.SWARMDESK_AGENT_DATA_DIR
  const previousReuse = process.env.ACP_SESSION_REUSE
  const secretA = 'scheduler-secret-worker-a'
  const secretB = 'scheduler-secret-worker-b'
  try {
    process.env.SWARMDESK_AGENT_AGENTS_STATE = join(dir, 'state.json')
    process.env.SWARMDESK_AGENT_DATA_DIR = join(dir, 'data')
    process.env.ACP_SESSION_REUSE = '1'
    setTestMasterKey(randomBytes(32))
    resetSharedStoreForTests()
    resetAcpSessionManager()
    globalActivityLog.clear()

    const store = getSharedStore({ mode: 'owner' })
    const project = store.upsertProject({ name: 'Secret isolation', rootPath: dir })
    const session = store.createSession({ projectId: project.id, title: 'Secret isolation' })
    const worker = (id: string): WorkerRegistration => ({
      id,
      name: id,
      kind: 'custom',
      command: process.execPath,
      args: ['--version'],
      env: { WORKER_LABEL: id },
      primaryRole: 'coder',
      roles: ['coder'],
      capabilities: ['code-edit'],
      enabled: true,
      scope: 'global',
      description: '',
      health: 'healthy',
      authRevision: 1,
    })
    store.upsertWorker(worker('worker-a'))
    store.upsertWorker(worker('worker-b'))
    setWorkerSecret('worker-a', 'AGENT_API_KEY', secretA)
    setWorkerSecret('worker-b', 'AGENT_API_KEY', secretB)

    const manager = getAcpSessionManager()
    const captured: Array<{
      workerId: string
      roleDefinitionId?: string
      roleRevision?: number
      buildConfig: SessionEntryConfig
      enqueueConfig?: SessionEntryConfig
      task?: string
      fingerprintInput: string
    }> = []
    ;(
      manager as unknown as {
        buildReuseKey(input: {
          routerSessionId: string
          workerId: string
          roleDefinitionId?: string
          roleRevision?: number
          cwd: string
          config: SessionEntryConfig
        }): unknown
      }
    ).buildReuseKey = (input) => {
      let fingerprintInput = ''
      computeExecutionFingerprint(input.config, (value) => {
        fingerprintInput = JSON.stringify(value)
        return `fingerprint-${input.workerId}`
      })
      captured.push({
        workerId: input.workerId,
        roleDefinitionId: input.roleDefinitionId,
        roleRevision: input.roleRevision,
        buildConfig: input.config,
        fingerprintInput,
      })
      return {
        routerSessionId: input.routerSessionId,
        workerId: input.workerId,
        canonicalCwd: input.cwd,
        executionFingerprint: `fingerprint-${input.workerId}`,
      }
    }
    ;(manager as unknown as { digestReuseKey(): string }).digestReuseKey = () => 'reuse-digest'
    ;(manager as unknown as { setSessionProject(): void }).setSessionProject = () => {}
    ;(manager as unknown as { canAccept(): boolean }).canAccept = () => true
    ;(
      manager as unknown as {
        enqueuePrompt(input: { config: SessionEntryConfig; task: string }): Promise<{
          ok: boolean
          output: string
          stopReason: string
          reusedSession: boolean
        }>
      }
    ).enqueuePrompt = async (input) => {
      const current = captured.at(-1)
      assert.ok(current)
      current.enqueueConfig = input.config
      current.task = input.task
      return { ok: true, output: 'safe output', stopReason: 'end_turn', reusedSession: false }
    }

    const scheduler = new schedulerModule.WorkerScheduler()
    ;(scheduler as unknown as { reconciled: boolean }).reconciled = true
    for (const workerId of ['worker-a', 'worker-b']) {
      const job = store.createJob({
        sessionId: session.id,
        projectId: project.id,
        workerId,
        workerName: workerId,
        role: 'coder',
        task: `safe task for ${workerId}`,
        cwd: dir,
        source: 'api',
        status: 'queued',
      })
      await (scheduler as unknown as { runJob(jobId: string): Promise<void> }).runJob(job.id)
    }

    const roleJob = store.createJob({
      sessionId: session.id,
      projectId: project.id,
      workerId: 'worker-a',
      workerName: 'worker-a',
      role: 'coder',
      roleDefinitionId: 'role-implementer',
      roleName: 'Implementer',
      roleType: 'coder',
      roleRevision: 4,
      instructionsSnapshot: 'Implement carefully.',
      effectivePrompt: 'Implement carefully.\n\nTask:\nAdd role dispatch.',
      task: 'Add role dispatch.',
      cwd: dir,
      source: 'api',
      status: 'queued',
    })
    await (scheduler as unknown as { runJob(jobId: string): Promise<void> }).runJob(roleJob.id)

    assert.equal(captured.length, 3)
    for (const capture of captured) {
      const expected = capture.workerId === 'worker-a' ? secretA : secretB
      const rejected = capture.workerId === 'worker-a' ? secretB : secretA
      assert.strictEqual(capture.enqueueConfig, capture.buildConfig)
      assert.deepEqual(capture.buildConfig.workerSecrets, { AGENT_API_KEY: expected })
      assert.equal(JSON.stringify(capture.buildConfig.env).includes(expected), false)
      assert.equal(JSON.stringify(capture.buildConfig.env).includes(rejected), false)
      assert.equal(capture.fingerprintInput.includes(expected), false)
      assert.equal(capture.fingerprintInput.includes(rejected), false)
      assert.equal(JSON.stringify(capture.buildConfig).includes(expected), false)
      assert.equal(JSON.stringify(capture.buildConfig).includes(rejected), false)
    }
    assert.equal(captured[2]?.roleDefinitionId, 'role-implementer')
    assert.equal(captured[2]?.roleRevision, 4)
    assert.equal(captured[2]?.task, 'Implement carefully.\n\nTask:\nAdd role dispatch.')

    const jobsAndActivity = JSON.stringify({
      jobs: store.listJobs({ limit: 20 }),
      activity: globalActivityLog.list(100),
      persistedState: readFileSync(join(dir, 'state.json'), 'utf8'),
    })
    assert.equal(jobsAndActivity.includes(secretA), false)
    assert.equal(jobsAndActivity.includes(secretB), false)
  } finally {
    resetAcpSessionManager()
    resetSharedStoreForTests()
    globalActivityLog.clear()
    setTestMasterKey(null)
    if (previousState === undefined) delete process.env.SWARMDESK_AGENT_AGENTS_STATE
    else process.env.SWARMDESK_AGENT_AGENTS_STATE = previousState
    if (previousData === undefined) delete process.env.SWARMDESK_AGENT_DATA_DIR
    else process.env.SWARMDESK_AGENT_DATA_DIR = previousData
    if (previousReuse === undefined) delete process.env.ACP_SESSION_REUSE
    else process.env.ACP_SESSION_REUSE = previousReuse
    rmSync(dir, { recursive: true, force: true })
  }
})
