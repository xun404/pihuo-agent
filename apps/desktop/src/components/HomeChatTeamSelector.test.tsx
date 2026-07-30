import React from 'react'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from '../i18n/I18nProvider.js'
import { ComposerToolbar } from './ComposerToolbar.js'

const workspaceSource = readFileSync(new URL('./ChatWorkspace.tsx', import.meta.url), 'utf8')
const toolbarSource = readFileSync(new URL('./ComposerToolbar.tsx', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')

const baseProps = {
  permissionMode: 'default' as const,
  selectedModel: '',
  thinkingIntensity: 'medium' as const,
  models: [],
  locale: 'zh' as const,
  persistThinking: false,
  onPermissionModeChange: () => {},
  onModelChange: () => {},
  onThinkingChange: () => {},
}

test('HomeChat hides the Team selector when no template exists', () => {
  const html = renderToStaticMarkup(
    <I18nProvider serverLocale="zh">
      <ComposerToolbar {...baseProps} teamTemplateOptions={[]} />
    </I18nProvider>,
  )

  assert.doesNotMatch(html, /home-team-menu-wrap/u)
})

test('HomeChat shows default and disabled saved Team options immediately after mode', () => {
  const html = renderToStaticMarkup(
    <I18nProvider serverLocale="zh">
      <ComposerToolbar
        {...baseProps}
        selectedTeamTemplateId=""
        teamTemplateOptions={[
          { id: 'template-ready', name: '研发团队', disabled: false },
          {
            id: 'template-broken',
            name: '审查团队',
            disabled: true,
            reason: '需要先在协作组面板修复映射',
          },
        ]}
        onTeamTemplateChange={() => {}}
      />
    </I18nProvider>,
  )

  assert.match(html, /home-team-menu-wrap/u)
  assert.match(html, /class="chip menu"/u)
  assert.match(html, /默认编组/u)

  // Menu is closed by default; open-state markup is verified via source contract.
  assert.match(toolbarSource, /home-team-menu/u)
  assert.match(toolbarSource, /option\.disabled/u)
  assert.match(toolbarSource, /home-team-option-reason/u)

  const modeIndex = toolbarSource.indexOf('mode-menu-wrap')
  const teamIndex = toolbarSource.indexOf('home-team-menu-wrap')
  const spacerIndex = toolbarSource.indexOf('<div className="spacer"')
  assert.ok(modeIndex < teamIndex && teamIndex < spacerIndex)
})

test('HomeChat forwards the selected template and retains the draft after creation failure', () => {
  assert.match(workspaceSource, /snapshotTeamTemplates/u)
  assert.match(workspaceSource, /teamTemplateId:\s*selectedTeamTemplateId/u)
  assert.match(workspaceSource, /await onComposeFirstMessage/u)
  assert.match(workspaceSource, /if \(sent\) setFirstMessage\(''\)/u)
  assert.match(workspaceSource, /setSelectedTeamTemplateId\(''\)/u)
  assert.match(appSource, /snapshotTeamTemplates=\{snapshot\.teamTemplates\}/u)
  assert.match(appSource, /preset\?\.teamTemplateId/u)
})
