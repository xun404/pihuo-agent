import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'ChatWorkspace.tsx'),
  'utf8',
)

describe('ChatWorkspace home model presets', () => {
  it('reloads leader models when settings closes (API key just saved)', () => {
    assert.match(source, /SETTINGS_CLOSED_EVENT/)
    assert.match(source, /loadPresetModels/)
    assert.match(source, /addEventListener\(SETTINGS_CLOSED_EVENT/)
  })
})
