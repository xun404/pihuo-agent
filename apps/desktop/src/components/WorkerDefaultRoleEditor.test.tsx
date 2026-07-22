import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { WorkerRegistration } from '@swarmdesk-agent/shared'
import { I18nProvider } from '../i18n/I18nProvider.js'

test('Worker default-role editor renders the complete editable template and inheritance rule', async () => {
  const sourceUrl = new URL('./WorkerDefaultRoleEditor.tsx', import.meta.url)
  assert.equal(existsSync(fileURLToPath(sourceUrl)), true, 'default-role editor must exist')
  const { WorkerDefaultRoleEditor } =
    (await import('./WorkerDefaultRoleEditor.js')) as typeof import('./WorkerDefaultRoleEditor.js')
  const worker: WorkerRegistration = {
    id: 'worker-codex',
    name: 'Codex',
    kind: 'codex',
    command: 'codex-acp',
    args: [],
    primaryRole: 'general',
    roles: ['general'],
    capabilities: ['general'],
    enabled: true,
    scope: 'global',
    description: '',
    health: 'unknown',
    model: 'openai/gpt-5.6',
    defaultRole: {
      name: '实现者',
      roleType: 'coder',
      instructions: '实现并验证任务。',
    },
  }

  const html = renderToStaticMarkup(
    <I18nProvider serverLocale="zh">
      <WorkerDefaultRoleEditor worker={worker} onSave={async () => {}} />
    </I18nProvider>,
  )

  assert.match(html, /默认角色/u)
  assert.match(html, /value="实现者"/u)
  assert.match(html, /实现并验证任务。/u)
  for (const label of ['规划', '编码', '审查', '测试', '调研', '通用']) {
    assert.match(html, new RegExp(`>${label}<`, 'u'))
  }
  assert.match(html, /继承 Worker 默认模型/u)
  assert.match(html, /保存角色/u)
})
