import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { TeamTemplate, WorkerRegistration } from './index.js'
import { evaluateTeamTemplateAvailability } from './index.js'

function worker(id: string, overrides: Partial<WorkerRegistration> = {}): WorkerRegistration {
  return {
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
    ...overrides,
  }
}

function template(preferredWorkerId: string, model?: string): TeamTemplate {
  return {
    id: 'template-1',
    name: 'Delivery',
    members: [
      {
        preferredWorkerId,
        name: 'Implementer',
        roleType: 'coder',
        instructions: 'Implement and verify.',
        model,
      },
    ],
    createdAt: '2026-07-23T00:00:00.000Z',
    updatedAt: '2026-07-23T00:00:00.000Z',
  }
}

describe('evaluateTeamTemplateAvailability', () => {
  it('accepts an enabled global Worker and an available explicit model', () => {
    const result = evaluateTeamTemplateAvailability({
      template: template('worker-1', 'model-a'),
      workers: [
        worker('worker-1', {
          availableModels: [{ modelId: 'model-a', name: 'Model A' }],
        }),
      ],
      projectId: 'project-a',
    })

    assert.equal(result.ready, true)
    assert.deepEqual(result.issues, [])
  })

  it('requires Worker repair for missing, disabled, or wrong-project Workers', () => {
    for (const workers of [
      [],
      [worker('worker-1', { enabled: false })],
      [
        worker('worker-1', {
          scope: 'project',
          projectId: 'project-b',
        }),
      ],
    ]) {
      const result = evaluateTeamTemplateAvailability({
        template: template('worker-1'),
        workers,
        projectId: 'project-a',
      })
      assert.equal(result.ready, false)
      assert.deepEqual(result.issues, [{ memberIndex: 0, code: 'WORKER_MAPPING_REQUIRED' }])
    }
  })

  it('requires model repair only when a populated catalog excludes the model', () => {
    const unavailable = evaluateTeamTemplateAvailability({
      template: template('worker-1', 'model-a'),
      workers: [
        worker('worker-1', {
          availableModels: [{ modelId: 'model-b', name: 'Model B' }],
        }),
      ],
      projectId: 'project-a',
    })
    const unknownCatalog = evaluateTeamTemplateAvailability({
      template: template('worker-1', 'model-a'),
      workers: [worker('worker-1')],
      projectId: 'project-a',
    })

    assert.deepEqual(unavailable.issues, [{ memberIndex: 0, code: 'MODEL_MAPPING_REQUIRED' }])
    assert.equal(unknownCatalog.ready, true)
  })
})
