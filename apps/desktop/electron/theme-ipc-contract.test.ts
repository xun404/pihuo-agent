import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const main = readFileSync(new URL('./main.ts', import.meta.url), 'utf8')
const preload = readFileSync(new URL('./preload.ts', import.meta.url), 'utf8')

describe('theme reload IPC contract', () => {
  it('protects the reload handler and exposes only the narrow preload method', () => {
    assert.match(main, /ipcMain\.handle\('themes:reload'/u)
    assert.match(main, /themes:reload[\s\S]{0,240}requireTrustedRenderer/u)
    assert.match(preload, /themes:\s*\{/u)
    assert.match(preload, /ipcRenderer\.invoke\('themes:reload'\)/u)
  })
})

