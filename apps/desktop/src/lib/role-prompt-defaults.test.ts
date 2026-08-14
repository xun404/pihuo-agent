import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DEFAULT_PROMPT_SETTINGS, type WorkerRegistration } from '@pihuo-agent/shared'
import {
  roleDraftFromWorker,
  roleDraftWithDefaultPrompt,
  roleDraftWithType,
} from './role-prompt-defaults.js'

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
  defaultRoleType: 'coder',
  health: 'unknown',
}

describe('role prompt defaults', () => {
  it('creates a new Chat role draft from the selected Worker default', () => {
    assert.deepEqual(roleDraftFromWorker(worker, DEFAULT_PROMPT_SETTINGS.roles), {
      name: 'Worker One',
      workerId: 'worker-one',
      roleType: 'coder',
      instructions: DEFAULT_PROMPT_SETTINGS.roles.coder,
      model: '',
    })
  })

  it('keeps instructions when role type changes and replaces them only on explicit reset', () => {
    const draft = roleDraftFromWorker(worker, DEFAULT_PROMPT_SETTINGS.roles)
    assert.deepEqual(roleDraftWithType(draft, 'review', DEFAULT_PROMPT_SETTINGS.roles), {
      ...draft,
      roleType: 'review',
    })
    assert.deepEqual(
      roleDraftWithDefaultPrompt(
        roleDraftWithType(draft, 'review', DEFAULT_PROMPT_SETTINGS.roles),
        DEFAULT_PROMPT_SETTINGS.roles,
      ),
      { ...draft, roleType: 'review', instructions: DEFAULT_PROMPT_SETTINGS.roles.review },
    )
  })
})
