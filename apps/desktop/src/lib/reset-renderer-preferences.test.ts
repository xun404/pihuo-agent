import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

describe('renderer preference reset boundary', () => {
  it('enumerates every PiHuo-owned localStorage preference', () => {
    const source = readFileSync(
      fileURLToPath(new URL('./reset-renderer-preferences.ts', import.meta.url)),
      'utf8',
    )
    for (const key of [
      'pihuo-agent.locale',
      'THEME_MODE_KEY',
      'LEGACY_PALETTE_KEY',
      'LIGHT_THEME_KEY',
      'DARK_THEME_KEY',
      'SEND_SHORTCUT_STORAGE_KEY',
      'FOLLOW_UP_BEHAVIOR_STORAGE_KEY',
      'FOLLOW_UP_OUTBOX_STORAGE_KEY',
      'MOTION_PREFERENCE_STORAGE_KEY',
      'MODEL_THINKING_MEMORY_STORAGE_KEY',
      'pihuo-agent.sidebar-w',
      'pihuo-agent.drawer-w',
    ]) {
      assert.match(source, new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'))
    }
    assert.match(source, /removeItem\(key\)/u)
  })
})
