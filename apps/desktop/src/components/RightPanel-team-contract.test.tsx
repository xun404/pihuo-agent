import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const panel = readFileSync(new URL('./RightPanel.tsx', import.meta.url), 'utf8')
const chatPanel = readFileSync(new URL('./ChatPanel.tsx', import.meta.url), 'utf8')
const zhCatalog = readFileSync(new URL('../i18n/catalogs/zh.ts', import.meta.url), 'utf8')
const enCatalog = readFileSync(new URL('../i18n/catalogs/en.ts', import.meta.url), 'utf8')

test('crew inspector is a header bubble without role-copy behavior', () => {
  assert.match(zhCatalog, /'right\.roles': '团队'/u)
  assert.match(enCatalog, /'right\.roles': 'Team'/u)
  assert.match(panel, /TeamTemplateManager/u)
  assert.match(panel, /onArchiveTeamMember/u)
  assert.match(panel, /roleDraftWithDefaultPrompt/u)
  assert.match(panel, /crew-panel/u)
  assert.match(panel, /tab:\s*InspectorTab/u)
  assert.doesNotMatch(panel, /copyRoles|forkSession|复制角色/u)
  assert.doesNotMatch(panel, /drawer-tabs/u)
  assert.match(chatPanel, /chat-inspector-bubble/u)
  assert.match(chatPanel, /IconCrew/u)
  assert.match(chatPanel, /IconApprovals/u)
  assert.doesNotMatch(chatPanel, /chat\.running/u)
  assert.doesNotMatch(chatPanel, /onToggleInspector/u)
})
