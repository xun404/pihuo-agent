import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DEFAULT_PROMPT_SETTINGS,
  type WorkerRegistration,
} from '@swarmdesk-agent/shared'
import { roleDraftFromWorker, roleDraftWithType } from './role-prompt-defaults.js'

const worker: WorkerRegistration = {
  id: 'worker-one',
  name: 'Worker One',
  kind: 'custom',
  command: 'worker-one',
  args: [],
  primaryRole: 'general',
  roles: ['general'],
  capabilities: ['general'],
  enabled: true,
  scope: 'global',
  description: '',
  health: 'unknown',
  defaultRole: {
    name: '专属实现者',
    roleType: 'coder',
    instructions: 'Worker 自己的默认提示词。',
  },
}

describe('role prompt defaults', () => {
  it('creates a new Chat role draft from the selected Worker default', () => {
    assert.deepEqual(roleDraftFromWorker(worker), {
      name: '专属实现者',
      workerId: 'worker-one',
      roleType: 'coder',
      instructions: 'Worker 自己的默认提示词。',
      model: '',
    })
  })

  it('replaces instructions only when the user explicitly changes role type', () => {
    const draft = roleDraftFromWorker(worker)
    assert.deepEqual(roleDraftWithType(draft, 'review', DEFAULT_PROMPT_SETTINGS.roles), {
      ...draft,
      roleType: 'review',
      instructions: DEFAULT_PROMPT_SETTINGS.roles.review,
    })
  })
})
