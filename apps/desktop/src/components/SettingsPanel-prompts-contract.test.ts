import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

test('Prompt settings navigation appears immediately above Agent Worker and saves prompts only', () => {
  const source = readFileSync(
    fileURLToPath(new URL('./SettingsPanel.tsx', import.meta.url)),
    'utf8',
  )
  const model = source.indexOf("{ id: 'model'")
  const prompts = source.indexOf("{ id: 'prompts'")
  const workers = source.indexOf("{ id: 'workers'")

  assert.ok(model >= 0 && prompts > model && workers > prompts)
  assert.match(source, /tab === 'prompts'/u)
  assert.match(source, /<PromptSettingsEditor/u)
  assert.match(source, /saveSettings\(\{ prompts/u)
})
