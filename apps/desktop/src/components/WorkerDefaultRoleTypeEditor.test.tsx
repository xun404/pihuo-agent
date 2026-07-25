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
  it('renders a role chip showing the current role and a dropdown trigger', () => {
    const html = renderToStaticMarkup(
      <I18nProvider serverLocale="zh">
        <WorkerDefaultRoleTypeEditor worker={worker} onSave={async () => {}} />
      </I18nProvider>,
    )

    // chip renders the role label + the localized current role (编码 = coder)
    assert.match(html, /worker-role-chip/u)
    assert.match(html, /角色/u)
    assert.match(html, /编码/u)
    // no longer a native <select> or a prompt preview
    assert.doesNotMatch(html, /<select/u)
    assert.doesNotMatch(html, /角色名称/u)
  })
})
