import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('./SettingsPanel.tsx', import.meta.url), 'utf8')

test('built-in provider detail displays a disabled Base URL field', () => {
  assert.match(
    source,
    /id="settings-builtin-base-url"[\s\S]*?value=\{selectedProvider\?\.baseURL \?\? ''\}[\s\S]*?disabled/u,
  )
})
