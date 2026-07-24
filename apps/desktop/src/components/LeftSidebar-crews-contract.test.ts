import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const sidebar = readFileSync(new URL('./LeftSidebar.tsx', import.meta.url), 'utf8')
const settings = readFileSync(new URL('./SettingsPanel.tsx', import.meta.url), 'utf8')
const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')
const library = readFileSync(new URL('./TeamTemplateLibrary.tsx', import.meta.url), 'utf8')

test('left sidebar exposes a Crews section under Agent Worker', () => {
  assert.match(sidebar, /settings\.navWorkers/u)
  assert.match(sidebar, /sidebar\.crews/u)
  assert.match(sidebar, /teamTemplates/u)
  assert.match(sidebar, /onOpenSettings\('teams'\)/u)
  assert.match(sidebar, /TeamTemplateLibrary/u)
  assert.match(sidebar, /CREW_PREVIEW_LIMIT = 5/u)
  assert.match(sidebar, /useState\(true\)/u) // crews section default collapsed
  assert.match(sidebar, /layout="settings"/u) // modal reuses settings layout
  // Crews block appears after workers nav, before projects.
  const workersIdx = sidebar.indexOf("onOpenSettings('workers')")
  const crewsIdx = sidebar.indexOf('sidebar-crews')
  const projectsIdx = sidebar.indexOf("t('sidebar.projects')")
  assert.ok(workersIdx > 0 && crewsIdx > workersIdx && projectsIdx > crewsIdx)
})

test('settings has a dedicated teams tab wired to TeamTemplateLibrary', () => {
  assert.match(settings, /'teams'/u)
  assert.match(settings, /settings\.navTeams/u)
  assert.match(settings, /TeamTemplateLibrary/u)
  assert.match(settings, /tab === 'teams'/u)
  assert.match(settings, /settings-model-page settings-teams-page/u)
  assert.match(settings, /layout="settings"/u)
  assert.match(settings, /IconCrew/u)
})

test('settings team library reuses model master/detail layout classes', () => {
  assert.match(library, /settings-model-layout/u)
  assert.match(library, /settings-provider-rail/u)
  assert.match(library, /settings-rail-item/u)
  assert.match(library, /settings-model-main/u)
  assert.match(library, /settings-provider-head/u)
})

test('app snapshot feeds team templates into the sidebar and settings deep-link', () => {
  assert.match(app, /teamTemplates=\{snapshot\.teamTemplates\}/u)
  assert.match(app, /detail\?\.tab === 'teams'/u)
  assert.match(app, /'teams'/u)
})

test('team template library supports rename and delete without session apply', () => {
  assert.match(library, /updateTeamTemplate/u)
  assert.match(library, /deleteTeamTemplate/u)
  assert.doesNotMatch(library, /applyTeamTemplate/u)
})
