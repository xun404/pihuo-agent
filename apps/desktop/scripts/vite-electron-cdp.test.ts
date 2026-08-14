import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const launcherSource = readFileSync(new URL('./vite-electron.mjs', import.meta.url), 'utf8')
const mainSource = readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8')
const checkerSource = readFileSync(
  new URL('../../../scripts/cdp-check.mjs', import.meta.url),
  'utf8',
)

test('development launcher enables loopback CDP on the project default port', () => {
  assert.match(launcherSource, /const DEFAULT_DEV_CDP_PORT = '8315'/u)
  assert.match(
    launcherSource,
    /PIHUO_AGENT_CDP_PORT:\s*process\.env\.PIHUO_AGENT_CDP_PORT \?\? DEFAULT_DEV_CDP_PORT/u,
  )
  assert.match(mainSource, /appendSwitch\('remote-debugging-address', '127\.0\.0\.1'\)/u)
  assert.match(checkerSource, /const CDP_PORT = process\.env\.CDP_PORT \|\| '8315'/u)
})
