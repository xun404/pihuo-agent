import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalStore } from '@swarmdesk-agent/core'
import type { WorkerRegistration } from '@swarmdesk-agent/shared'
import { TeamTemplateService, TeamTemplateServiceError } from './team-template-service.js'

describe('TeamTemplateService', () => {
  let dir: string
  let store: LocalStore
  let cleanupCalls: string[]

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'team-template-service-'))
    store = new LocalStore(join(dir, 'state.json'))
    cleanupCalls = []
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  function addWorker(id: string, options: Partial<WorkerRegistration> = {}) {
    return store.upsertWorker({
      id,
      name: id,
      kind: 'custom',
      command: 'agent',
      args: [],
      primaryRole: 'general',
      roles: ['general'],
      capabilities: ['general'],
      enabled: true,
      scope: 'global',
      description: '',
      defaultRoleType: 'general',
      health: 'healthy',
      ...options,
    })
  }

  function service() {
    return new TeamTemplateService({
      store,
      withSessionAdmission: async (_sessionId, operation) => operation(),
      cleanupTeamMember: async (sessionId, memberId) => {
        cleanupCalls.push(`${sessionId}:${memberId}`)
      },
    })
  }

  it('validates template reasoning with the target project scope and preserves it on apply', async () => {
    const worker = addWorker('worker', { model: 'model-a' })
    const project = store.upsertProject({ name: 'P', rootPath: join(dir, 'project') })
    const session = store.createSession({ projectId: project.id })
    const template = store.createTeamTemplate({
      name: 'Reasoning team',
      members: [
        {
          name: 'Coder',
          preferredWorkerId: worker.id,
          roleType: 'coder',
          instructions: 'Implement.',
          reasoning: 'high',
        },
      ],
    })
    const evaluated: Array<{ model?: string; reasoning?: string; scopeKey?: string | null }> = []
    const scopedService = new TeamTemplateService({
      store,
      withSessionAdmission: async (_sessionId, operation) => operation(),
      cleanupTeamMember: async () => {},
      evaluateReasoning: (
        _workerId: string,
        model: string | undefined,
        reasoning: string | undefined,
        opts?: { scopeKey?: string | null },
      ) => {
        evaluated.push({ model, reasoning, scopeKey: opts?.scopeKey })
        return { ok: true }
      },
    } as never)

    const preview = scopedService.preview({ sessionId: session.id, templateId: template.id })
    assert.equal(preview.ready, true)
    const result = await scopedService.apply({
      sessionId: session.id,
      templateId: template.id,
      expectedTeamRevision: session.teamRevision,
    })

    assert.equal(result.members[0]?.reasoning, 'high')
    assert.equal(evaluated.length >= 2, true)
    assert.equal(
      evaluated.every((entry) => Boolean(entry.scopeKey)),
      true,
    )
  })

  it('previews hybrid Worker binding and explicit model repair requirements', () => {
    addWorker('preferred', { enabled: false })
    addWorker('replacement', {
      availableModels: [{ modelId: 'supported', name: 'Supported' }],
    })
    const project = store.upsertProject({ name: 'P', rootPath: join(dir, 'project') })
    const session = store.createSession({ projectId: project.id })
    const template = store.createTeamTemplate({
      name: 'Delivery',
      members: [
        {
          name: 'Coder',
          preferredWorkerId: 'preferred',
          roleType: 'coder',
          instructions: 'Implement.',
          model: 'missing',
        },
      ],
    })

    const unresolved = service().preview({ sessionId: session.id, templateId: template.id })
    assert.equal(unresolved.members[0]?.issueCode, 'WORKER_MAPPING_REQUIRED')

    const modelIssue = service().preview({
      sessionId: session.id,
      templateId: template.id,
      mappings: [{ memberIndex: 0, workerId: 'replacement' }],
    })
    assert.equal(modelIssue.members[0]?.issueCode, 'MODEL_MAPPING_REQUIRED')

    const resolved = service().preview({
      sessionId: session.id,
      templateId: template.id,
      mappings: [{ memberIndex: 0, workerId: 'replacement', model: null }],
    })
    assert.equal(resolved.ready, true)
    assert.equal(resolved.members[0]?.workerId, 'replacement')
    assert.equal(resolved.members[0]?.model, undefined)
  })

  it('resolves a ready template for one Project before Session creation', () => {
    const worker = addWorker('worker')
    const project = store.upsertProject({ name: 'P', rootPath: join(dir, 'project') })
    const template = store.createTeamTemplate({
      name: 'Delivery',
      members: [
        {
          name: 'Coder',
          preferredWorkerId: worker.id,
          roleType: 'coder',
          instructions: 'Implement.',
          model: 'model-a',
        },
      ],
    })

    assert.deepEqual(
      service().resolveForProject({
        projectId: project.id,
        templateId: template.id,
      }),
      [
        {
          workerId: worker.id,
          name: 'Coder',
          roleType: 'coder',
          instructions: 'Implement.',
          model: 'model-a',
        },
      ],
    )
  })

  it('rejects an unavailable template before a Session exists', () => {
    addWorker('worker', { enabled: false })
    const project = store.upsertProject({ name: 'P', rootPath: join(dir, 'project') })
    const template = store.createTeamTemplate({
      name: 'Delivery',
      members: [
        {
          name: 'Coder',
          preferredWorkerId: 'worker',
          roleType: 'coder',
          instructions: 'Implement.',
        },
      ],
    })

    assert.throws(
      () =>
        service().resolveForProject({
          projectId: project.id,
          templateId: template.id,
        }),
      (error: unknown) =>
        error instanceof TeamTemplateServiceError &&
        error.code === 'TEAM_TEMPLATE_MAPPING_REQUIRED',
    )
  })

  it('blocks replacement while the current Team has an open Job', async () => {
    const worker = addWorker('worker')
    const project = store.upsertProject({ name: 'P', rootPath: join(dir, 'project') })
    const session = store.createSession({ projectId: project.id })
    const template = store.createTeamTemplate({
      name: 'Delivery',
      members: [
        {
          name: 'Coder',
          preferredWorkerId: worker.id,
          roleType: 'coder',
          instructions: 'Implement.',
        },
      ],
    })
    store.createJob({
      sessionId: session.id,
      projectId: project.id,
      workerId: worker.id,
      workerName: worker.name,
      task: 'running',
      cwd: project.rootPath,
      source: 'ui',
      status: 'running',
    })

    await assert.rejects(
      () =>
        service().apply({
          sessionId: session.id,
          templateId: template.id,
          expectedTeamRevision: session.teamRevision,
          mappings: [],
        }),
      (error: unknown) =>
        error instanceof TeamTemplateServiceError && error.code === 'TEAM_HAS_OPEN_JOBS',
    )
    assert.equal(cleanupCalls.length, 0)
  })

  it('reports concurrent Team replacement with a stable service code', async () => {
    const concurrent = new TeamTemplateService({
      store,
      withSessionAdmission: async () => {
        throw new Error('TEAM_REPLACEMENT_IN_PROGRESS')
      },
      cleanupTeamMember: async () => {},
    })

    await assert.rejects(
      () =>
        concurrent.apply({
          sessionId: 'session',
          templateId: 'template',
          expectedTeamRevision: 1,
        }),
      (error: unknown) =>
        error instanceof TeamTemplateServiceError && error.code === 'TEAM_REPLACEMENT_IN_PROGRESS',
    )
  })

  it('cleans old ACP contexts and atomically replaces an idle Team', async () => {
    const worker = addWorker('worker')
    const project = store.upsertProject({ name: 'P', rootPath: join(dir, 'project') })
    const session = store.createSession({ projectId: project.id })
    const oldMembers = store.listTeamMembers(session.id)
    const template = store.createTeamTemplate({
      name: 'Delivery',
      members: [
        {
          name: 'Coder',
          preferredWorkerId: worker.id,
          roleType: 'coder',
          instructions: 'Implement.',
        },
      ],
    })

    const result = await service().apply({
      sessionId: session.id,
      templateId: template.id,
      expectedTeamRevision: session.teamRevision,
      mappings: [],
    })

    assert.equal(result.members.length, 1)
    assert.equal(result.members[0]?.roleType, 'coder')
    assert.deepEqual(
      cleanupCalls,
      oldMembers.map((member) => `${session.id}:${member.id}`),
    )
  })
})
