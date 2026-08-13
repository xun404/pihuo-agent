import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { SETTINGS_SELECT_MIN_WIDTH } from './SettingsSelect'

const source = readFileSync(new URL('./SettingsPanel.tsx', import.meta.url), 'utf8')
const selectSource = readFileSync(new URL('./SettingsSelect.tsx', import.meta.url), 'utf8')
const followUpSource = readFileSync(
  new URL('./FollowUpBehaviorSetting.tsx', import.meta.url),
  'utf8',
)

describe('SettingsPanel color theme controls', () => {
  it('keeps color mode and light/dark theme controls separate', () => {
    assert.match(source, /settings\.colorMode/u)
    assert.match(source, /settings\.lightTheme/u)
    assert.match(source, /settings\.darkTheme/u)
    assert.match(source, /settings\.reloadThemes/u)
    assert.match(source, /label: theme\.name/u)
    assert.doesNotMatch(source, /appearance\.classic/u)
    assert.doesNotMatch(source, /value: ['"]classic['"]/u)
  })

  it('uses one shared width contract for every general-page selector', () => {
    assert.equal(SETTINGS_SELECT_MIN_WIDTH, 148)
    assert.match(followUpSource, /settings\.followUpBehavior/u)
    assert.equal(
      (source.match(/<SettingsSelect\b/gu) ?? []).length +
        (followUpSource.match(/<SettingsSelect\b/gu) ?? []).length,
      7,
    )
    assert.doesNotMatch(source, /minWidth=\{\d+\}/u)
    assert.match(selectSource, /minWidth = SETTINGS_SELECT_MIN_WIDTH/u)
    assert.match(selectSource, /Math\.max\(\s*r\.width,\s*SETTINGS_SELECT_MIN_WIDTH\s*\)/u)
  })
})
