import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ACP_PUBLIC_ERROR_CODES,
  defaultRegistryWorkerRoles,
  isAcpPublicErrorCode,
  type WorkerJob,
  type WorkerKind,
  type WorkerRegistration,
  type WorkerRunEvent,
  type WorkerRunState,
  type WorkerSource,
} from './index.js'

describe('ACP registry shared types', () => {
  it('keeps WorkerKind as product family, not registry IDs', () => {
    const kinds: WorkerKind[] = ['claude', 'codex', 'opencode', 'custom']
    assert.equal(kinds.length, 4)
    assert.ok(!kinds.includes('agoragentic-acp' as WorkerKind))
  })

  it('defaultRegistryWorkerRoles is general-only', () => {
    const roles = defaultRegistryWorkerRoles()
    assert.equal(roles.primaryRole, 'general')
    assert.deepEqual(roles.roles, ['general'])
  })

  it('recognizes stable public error codes', () => {
    for (const code of ACP_PUBLIC_ERROR_CODES) {
      assert.equal(isAcpPublicErrorCode(code), true)
    }
    assert.equal(isAcpPublicErrorCode('NOT_A_CODE'), false)
    assert.equal(isAcpPublicErrorCode(null), false)
  })

  it('legacy WorkerRegistration without source/readiness remains assignable', () => {
    const legacy: WorkerRegistration = {
      id: 'worker_old',
      name: 'OpenCode',
      kind: 'opencode',
      command: 'opencode',
      args: ['acp'],
      primaryRole: 'general',
      roles: ['general', 'coder'],
      capabilities: ['general'],
      enabled: true,
      scope: 'global',
      description: 'legacy',
      health: 'unknown',
    }
    assert.equal(legacy.source, undefined)
    assert.equal(legacy.readiness, undefined)
    assert.equal(legacy.launchSpec, undefined)
  })

  it('registry WorkerSource carries install identity without secrets', () => {
    const source: WorkerSource = {
      type: 'registry',
      registryId: 'example-agent',
      registryVersion: '1.2.3',
      registrySchemaVersion: '1.0.0',
      manifestDigest: 'sha256:abc',
      distribution: 'npx',
      installationId: 'inst_1',
    }
    const json = JSON.stringify(source)
    assert.ok(!json.includes('sk-'))
    assert.ok(!json.includes('token'))
    const parsed = JSON.parse(json) as WorkerSource
    assert.equal(parsed.type, 'registry')
    if (parsed.type === 'registry') {
      assert.equal(parsed.registryId, 'example-agent')
    }
  })

  it('WorkerJob and terminal WorkerRunEvent accept optional errorCode', () => {
    const job: WorkerJob = {
      id: 'job_1',
      sessionId: 'sess_1',
      projectId: 'proj_1',
      workerId: 'w_1',
      workerName: 'Example',
      task: 'hello',
      cwd: '/tmp',
      status: 'failed',
      approvalPolicy: 'manual',
      createdAt: new Date().toISOString(),
      error: 'Auth required',
      errorCode: 'WORKER_AUTH_REQUIRED',
      source: 'leader',
    }
    assert.equal(job.errorCode, 'WORKER_AUTH_REQUIRED')

    const failed: WorkerRunEvent = {
      type: 'failed',
      jobId: 'job_1',
      error: 'Auth required',
      errorCode: 'WORKER_AUTH_REQUIRED',
      truncated: false,
    }
    assert.equal(failed.errorCode, 'WORKER_AUTH_REQUIRED')

    const state: WorkerRunState = {
      jobId: 'job_1',
      workerName: 'Example',
      workerKind: 'custom',
      reusedSession: false,
      sequence: 0,
      output: '',
      status: 'failed',
      truncated: false,
      error: 'Auth required',
      errorCode: 'WORKER_AUTH_REQUIRED',
      startedAt: Date.now(),
      lastDeltaAt: Date.now(),
      pendingApprovals: [],
    }
    assert.equal(state.errorCode, 'WORKER_AUTH_REQUIRED')
  })

  it('JSON round-trip of worker with new fields preserves values', () => {
    const worker: WorkerRegistration = {
      id: 'worker_reg',
      name: 'Example Registry Agent',
      kind: 'custom',
      command: 'npx',
      args: ['--yes', '@example/agent@1.0.0'],
      primaryRole: 'general',
      roles: ['general'],
      capabilities: ['general'],
      enabled: true,
      scope: 'global',
      description: 'from registry',
      health: 'unknown',
      source: {
        type: 'registry',
        registryId: 'example-agent',
        registryVersion: '1.0.0',
        registrySchemaVersion: '1.0.0',
        manifestDigest: 'sha256:deadbeef',
        distribution: 'npx',
        installationId: 'inst_abc',
      },
      runtimeProfile: 'generic-acp',
      installationId: 'inst_abc',
      launchSpec: {
        distribution: 'npx',
        runnerCommand: 'npx',
        runnerArgs: ['--yes'],
        packageSpec: '@example/agent@1.0.0',
        agentArgs: [],
        env: {},
      },
      readiness: {
        status: 'auth_required',
        code: 'WORKER_AUTH_REQUIRED',
        message: 'Authentication required',
        nextAction: 'authenticate',
        checkedAt: new Date().toISOString(),
      },
      authRevision: 1,
    }
    const round = JSON.parse(JSON.stringify(worker)) as WorkerRegistration
    assert.deepEqual(round.source, worker.source)
    assert.equal(round.readiness?.status, 'auth_required')
    assert.equal(round.authRevision, 1)
    assert.equal(round.launchSpec?.packageSpec, '@example/agent@1.0.0')
  })
})
