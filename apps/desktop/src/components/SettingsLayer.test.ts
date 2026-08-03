import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'SettingsLayer.tsx'),
  'utf8',
)

describe('SettingsLayer open resets ephemeral state', () => {
  it('remounts SettingsPanel on each closed→open via instance key', () => {
    assert.match(source, /instanceKey/)
    assert.match(source, /setInstanceKey/)
    assert.match(source, /key=\{instanceKey\}/)
    assert.match(source, /openRef/)
  })

  it('defaults to general tab on a fresh open without an explicit tab', () => {
    assert.match(source, /resolved \?\? 'general'/)
  })

  it('does not remount when already open (only switches tab)', () => {
    assert.match(source, /Already open/)
    assert.match(source, /if \(!openRef\.current\)/)
  })
})
