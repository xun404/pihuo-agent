import React from 'react'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import type { WorkerRegistration } from '@swarmdesk-agent/shared'
import { I18nProvider } from '../i18n/I18nProvider.js'
import { WorkerDefaultRoleTypeEditor } from './WorkerDefaultRoleTypeEditor.js'

const worker: WorkerRegistration = {
  id: 'worker-1',
  name: 'Codex',
  kind: 'custom',
  command: 'agent',
  args: [],
  primaryRole: 'general',
  roles: ['general'],
  capabilities: ['general'],
  enabled: true,
  scope: 'global',
  description: '',
  defaultRoleType: 'coder',
  health: 'healthy',
}

describe('WorkerDefaultRoleTypeEditor', () => {
  it('selects a role and renders its prompt as read-only text', () => {
    const html = renderToStaticMarkup(
      <I18nProvider serverLocale="zh">
        <WorkerDefaultRoleTypeEditor
          worker={worker}
          rolePrompts={{
            general: 'General.',
            plan: 'Plan.',
            coder: 'Implement and verify.',
            review: 'Review.',
            test: 'Test.',
            research: 'Research.',
          }}
          onSave={async () => {}}
        />
      </I18nProvider>,
    )

    assert.match(html, /value="coder" selected/u)
    assert.match(html, /Implement and verify\./u)
    assert.doesNotMatch(html, /textarea/u)
    assert.doesNotMatch(html, /角色名称/u)
  })
})
