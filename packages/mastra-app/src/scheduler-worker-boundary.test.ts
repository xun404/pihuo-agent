import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { WorkerRegistration } from '@router-agents/shared'
import {
  computeExecutionFingerprint,
  getAcpSessionManager,
  resetAcpSessionManager,
  type SessionEntryConfig,
} from '@router-agents/adapters'
import {
  getSharedStore,
  globalActivityLog,
  resetSharedStoreForTests,
  setTestMasterKey,
  setWorkerSecret,
} from '@router-agents/core'
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
  const previousState = process.env.ROUTER_AGENTS_STATE
  const previousData = process.env.ROUTER_DATA_DIR
  const previousReuse = process.env.ACP_SESSION_REUSE
  const secretA = 'scheduler-secret-worker-a'
  const secretB = 'scheduler-secret-worker-b'
  try {
    process.env.ROUTER_AGENTS_STATE = join(dir, 'state.json')
    process.env.ROUTER_DATA_DIR = join(dir, 'data')
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
      buildConfig: SessionEntryConfig
      enqueueConfig?: SessionEntryConfig
      fingerprintInput: string
    }> = []
    ;(
      manager as unknown as {
        buildReuseKey(input: {
          routerSessionId: string
          workerId: string
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
        enqueuePrompt(input: { config: SessionEntryConfig }): Promise<{
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

    assert.equal(captured.length, 2)
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
    if (previousState === undefined) delete process.env.ROUTER_AGENTS_STATE
    else process.env.ROUTER_AGENTS_STATE = previousState
    if (previousData === undefined) delete process.env.ROUTER_DATA_DIR
    else process.env.ROUTER_DATA_DIR = previousData
    if (previousReuse === undefined) delete process.env.ACP_SESSION_REUSE
    else process.env.ACP_SESSION_REUSE = previousReuse
    rmSync(dir, { recursive: true, force: true })
  }
})
