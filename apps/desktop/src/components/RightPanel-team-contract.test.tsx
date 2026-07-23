import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const panel = readFileSync(new URL('./RightPanel.tsx', import.meta.url), 'utf8')
const locales = readFileSync(new URL('../i18n/locales.ts', import.meta.url), 'utf8')

test('right inspector presents crew management without role-copy behavior', () => {
  assert.match(locales, /'right\.roles': '协作组'/u)
  assert.match(locales, /'right\.roles': 'Crew'/u)
  assert.match(panel, /TeamTemplateManager/u)
  assert.match(panel, /onArchiveTeamMember/u)
  assert.match(panel, /roleDraftWithDefaultPrompt/u)
  assert.match(panel, /crew-panel/u)
  assert.doesNotMatch(panel, /copyRoles|forkSession|复制角色/u)
})
