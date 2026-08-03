import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import {
  DANGER_ACTION_IMPACT_IDS,
  resolveDangerZoneToggleIntent,
  shouldCollapseDangerZoneForTab,
} from './settings-danger-zone.js'
import { catalogs } from '../i18n/locales.js'

const source = readFileSync(fileURLToPath(new URL('./SettingsPanel.tsx', import.meta.url)), 'utf8')

describe('Settings Danger Zone', () => {
  it('keeps the destructive controls collapsed and confirms each action', () => {
    assert.match(source, /settings-danger-zone-toggle/u)
    assert.match(source, /aria-expanded=\{dangerOpen\}/u)
    assert.match(source, /openDangerWarning/u)
    assert.match(source, /settings-danger-action-card/u)
    assert.match(source, /settings-danger-action-button/u)
    for (const action of [
      'reset-settings',
      'clear-workers-and-crews',
      'clear-sessions',
      'clear-cache',
      'reset-all',
    ]) {
      assert.match(source, new RegExp(`'${action}'`, 'u'))
    }
    assert.match(source, /DANGER_ACTION_IMPACT_IDS/u)
    assert.match(source, /projectsCount/u)
  })

  it('warns on every expansion and keeps the card itself non-clickable', () => {
    assert.equal(resolveDangerZoneToggleIntent(false), 'warn')
    assert.equal(resolveDangerZoneToggleIntent(false), 'warn')
    assert.equal(resolveDangerZoneToggleIntent(true), 'close')

    const cardStart = source.indexOf('<div key={action} className="settings-danger-action-card">')
    const buttonStart = source.indexOf('<button', cardStart)
    assert.ok(cardStart >= 0)
    assert.ok(buttonStart > cardStart)
    const cardHeader = source.slice(cardStart, buttonStart)
    assert.doesNotMatch(cardHeader, /onClick|role="button"/u)
    assert.match(
      source,
      /className="settings-danger-action-button"[\s\S]*onClick=\{\(\) => requestDangerAction\(action\)\}/u,
    )
  })

  it('collapses when leaving General and warns again after returning', () => {
    assert.equal(shouldCollapseDangerZoneForTab('general'), false)
    assert.equal(shouldCollapseDangerZoneForTab('workers'), true)
    assert.equal(shouldCollapseDangerZoneForTab('model'), true)
    assert.match(source, /shouldCollapseDangerZoneForTab\(tab\)/u)
    assert.match(source, /setDangerOpen\(false\)/u)
    assert.match(source, /const intent = resolveDangerZoneToggleIntent\(dangerOpen\)/u)
    assert.match(source, /onConfirm: async \(\) => \{\s*setDangerOpen\(true\)/u)
    assert.doesNotMatch(source, /dangerWarningAcknowledged/u)
    assert.doesNotMatch(source, /setDangerWarningAcknowledged/u)
  })

  it('maps confirmation impacts to the operation boundary', () => {
    assert.deepEqual(DANGER_ACTION_IMPACT_IDS['reset-settings'], [
      'settings-basic',
      'settings-prompts',
      'settings-models-keys',
    ])
    assert.deepEqual(DANGER_ACTION_IMPACT_IDS['clear-workers-and-crews'], [
      'workers',
      'workerSessions',
      'crews',
    ])
    assert.deepEqual(DANGER_ACTION_IMPACT_IDS['clear-sessions'], ['chatSessions', 'workerSessions'])
    assert.deepEqual(DANGER_ACTION_IMPACT_IDS['clear-cache'], ['cache'])
    assert.deepEqual(DANGER_ACTION_IMPACT_IDS['reset-all'], [
      'settings-basic',
      'settings-prompts',
      'settings-models-keys',
      'workers',
      'workerSessions',
      'crews',
      'chatSessions',
      'projects',
      'cache',
    ])
  })

  it('uses the requested Danger Zone title in every locale', () => {
    assert.equal(catalogs.zh['settings.danger.title'], '危险区域')
    assert.equal(catalogs['zh-TW']['settings.danger.title'], '危險區域')
    assert.equal(catalogs.en['settings.danger.title'], 'Danger Zone')
    assert.doesNotMatch(catalogs.en['settings.danger.title'], /Advanced/u)
  })

  it('mounts one shared ConfirmDialog outside the Workers tab condition', () => {
    const workerStart = source.indexOf("{!loading && tab === 'workers' && (")
    const aboutStart = source.indexOf("{data && !loading && tab === 'about' &&", workerStart)
    const confirmDialog = source.search(/\{pendingConfirm && \(\s*<ConfirmDialog\s+open/u)
    const sharedLayer = source.indexOf('<div className="settings-main">')
    const animateEnd = source.indexOf('</AnimatePresence>', sharedLayer)

    assert.ok(workerStart >= 0)
    assert.ok(aboutStart > workerStart)
    assert.ok(confirmDialog > aboutStart)
    assert.ok(confirmDialog > sharedLayer)
    assert.ok(confirmDialog > animateEnd)
    assert.equal(source.match(/<ConfirmDialog\b/gu)?.length, 1)
    assert.match(source, /\{pendingConfirm && \(\s*<ConfirmDialog/u)
    assert.doesNotMatch(source, /<ConfirmDialog\s+open=\{!!pendingConfirm\}/u)
  })
})
