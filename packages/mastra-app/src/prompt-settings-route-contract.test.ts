import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

function source(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
}

test('HTTP and Desktop owner settings surfaces transport complete prompt settings', () => {
  const ownerHttp = source('./http-server.ts')
  const desktopMain = source('../../../apps/desktop/electron/main.ts')
  const desktopPreload = source('../../../apps/desktop/electron/preload.ts')
  const rendererSettings = source('../../../apps/desktop/src/lib/settings.ts')

  for (const text of [ownerHttp, desktopMain]) {
    assert.match(text, /prompts\??:\s*PromptSettings/u)
    assert.match(text, /isValidPromptSettings/u)
    assert.match(text, /prompts:\s*normalizePromptSettings/u)
  }
  assert.match(desktopPreload, /prompts\??:\s*PromptSettings/u)
  assert.match(rendererSettings, /prompts:\s*PromptSettings/u)
})
